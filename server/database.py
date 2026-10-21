"""
POWERPLAY CLUB - Production Database Layer
Owner-Controlled Lifecycle & Advance Payment Confirmation:
- Customer submissions create 'pending_confirmation' and do NOT block slots.
- Owner manually reviews, requests advance, or places temporary holds.
- ONLY an explicit owner confirmation ('confirmed') permanently books a slot.
- Database unique constraint on confirmed slots prevents double bookings.
- Auto-cleanup of expired temporary holds.
- Full audit fields: advance_amount, payment_method, payment_reference, payment_verified.
"""

import os
import sqlite3
import uuid
import random
import json
import re
from datetime import datetime, timezone, timedelta, date
from typing import Dict, Any, List, Optional, Tuple

DB_PATH = os.environ.get("POWERPLAY_DB_PATH", "powerplay.db")
DEFAULT_HOLD_MINUTES = int(os.environ.get("DEFAULT_HOLD_MINUTES", "15"))

def parse_duration_to_hours(duration_str: str) -> int:
    d = str(duration_str).lower()
    if "half" in d:
        return 6
    if "full" in d or "all" in d or "multi" in d:
        return 24
    m = re.search(r"(\d+)", d)
    if m:
        return max(1, min(24, int(m.group(1))))
    return 2

def get_event_slots(event_details: Any) -> List[str]:
    """Computes the 24-hour time slots ('HH:00') that an event covers."""
    ev = event_details or {}
    if isinstance(ev, str):
        try:
            ev = json.loads(ev)
        except Exception:
            ev = {}
    start_raw = str(ev.get("start_time", "")).strip()
    duration_raw = str(ev.get("duration", "2 hours")).strip().lower()

    duration_hours = parse_duration_to_hours(duration_raw)

    m_start = re.match(r"^(\d{1,2})", start_raw)
    if m_start and "flexible" not in start_raw.lower():
        start_h = int(m_start.group(1)) % 24
        if duration_hours >= 24:
            return [f"{h:02d}:00" for h in range(24)]
        return [f"{(start_h + i) % 24:02d}:00" for i in range(duration_hours)]
    else:
        return [f"{h:02d}:00" for h in range(24)]

class SlotUnavailableError(Exception):
    """Raised when one or more requested slots are already confirmed or held."""
    def __init__(self, message: str, conflicted_slots: List[str]):
        super().__init__(message)
        self.conflicted_slots = conflicted_slots

class BookingNotFoundError(Exception):
    """Raised when a requested booking reference cannot be found."""
    pass

def get_db_connection() -> sqlite3.Connection:
    """Returns a SQLite connection with WAL mode and foreign keys enabled."""
    conn = sqlite3.connect(DB_PATH, timeout=20.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn

def init_db(conn: Optional[sqlite3.Connection] = None) -> None:
    """Initializes tables and indexes supporting the owner confirmation lifecycle."""
    close_after = False
    if conn is None:
        conn = get_db_connection()
        close_after = True

    try:
        with conn:
            schema_row = conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='bookings'").fetchone()
            if schema_row and schema_row["sql"] and "pending_confirmation" not in schema_row["sql"]:
                from server.migrate import migrate_database
                migrate_database()

            conn.executescript("""
            CREATE TABLE IF NOT EXISTS bookings (
                id TEXT PRIMARY KEY,
                reference TEXT UNIQUE NOT NULL,
                booking_type TEXT NOT NULL CHECK (booking_type IN ('cricket', 'event', 'tournament', 'general')),
                customer_name TEXT NOT NULL,
                customer_phone TEXT NOT NULL,
                booking_date TEXT NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                duration_hours REAL NOT NULL DEFAULT 1.0,
                player_count TEXT DEFAULT '6–10 Players',
                total_price REAL NOT NULL DEFAULT 0.0,
                currency TEXT NOT NULL DEFAULT 'INR',
                notes TEXT,
                event_details TEXT DEFAULT '{}',
                status TEXT NOT NULL DEFAULT 'pending_confirmation' CHECK (status IN (
                    'pending_confirmation',
                    'awaiting_advance',
                    'payment_received',
                    'confirmed',
                    'rejected',
                    'cancelled',
                    'expired'
                )),
                advance_amount REAL DEFAULT 0.0,
                payment_method TEXT,
                payment_reference TEXT,
                payment_verified INTEGER DEFAULT 0,
                payment_verified_at TEXT,
                hold_expires_at TEXT,
                whatsapp_status TEXT DEFAULT 'requested',
                idempotency_key TEXT UNIQUE,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS booking_slots (
                id TEXT PRIMARY KEY,
                booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
                slot_date TEXT NOT NULL,
                slot_time TEXT NOT NULL,
                slot_price REAL NOT NULL DEFAULT 0.0,
                status TEXT NOT NULL DEFAULT 'pending_confirmation' CHECK (status IN (
                    'pending_confirmation',
                    'awaiting_advance',
                    'payment_received',
                    'confirmed',
                    'held',
                    'rejected',
                    'cancelled',
                    'expired'
                )),
                hold_expires_at TEXT,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(booking_date);
            CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
            CREATE INDEX IF NOT EXISTS idx_bookings_ref ON bookings(reference);
            CREATE INDEX IF NOT EXISTS idx_slots_date ON booking_slots(slot_date);
            CREATE INDEX IF NOT EXISTS idx_slots_booking ON booking_slots(booking_id);

            -- CRITICAL FIX: ONLY CONFIRMED SLOTS PREVENT OVERLAPPING RESERVATIONS!
            -- Customer pending requests do NOT block slots.
            DROP INDEX IF EXISTS uq_active_slot_idx;
            CREATE UNIQUE INDEX IF NOT EXISTS uq_confirmed_slot_idx 
            ON booking_slots(slot_date, slot_time) 
            WHERE status = 'confirmed';

            -- System Settings & PIN Authentication
            CREATE TABLE IF NOT EXISTS system_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            -- Owner WhatsApp PIN Recovery Requests
            CREATE TABLE IF NOT EXISTS pin_recovery_requests (
                id TEXT PRIMARY KEY,
                code TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                used INTEGER DEFAULT 0,
                created_at TEXT NOT NULL
            );

            -- Owner-blocked slots (maintenance, private events, etc.)
            CREATE TABLE IF NOT EXISTS blocked_slots (
                id TEXT PRIMARY KEY,
                slot_date TEXT NOT NULL,
                slot_time TEXT NOT NULL,
                reason TEXT DEFAULT 'Blocked by Owner',
                blocked_by TEXT DEFAULT 'owner',
                created_at TEXT NOT NULL,
                UNIQUE(slot_date, slot_time)
            );
            """)

            now_iso = datetime.now(timezone.utc).isoformat()
            cur = conn.execute("SELECT 1 FROM system_settings WHERE key = 'booking_manager_pin'")
            if not cur.fetchone():
                conn.execute(
                    "INSERT INTO system_settings (key, value, updated_at) VALUES ('booking_manager_pin', '123456', ?)",
                    (now_iso,)
                )
    finally:
        if close_after:
            conn.close()

def generate_booking_reference(conn: sqlite3.Connection) -> str:
    """Generates a collision-free human-readable reference like PP-7392015."""
    for _ in range(10):
        ref = f"PP-{random.randint(1000000, 9999999)}"
        cursor = conn.execute("SELECT 1 FROM bookings WHERE reference = ?", (ref,))
        if not cursor.fetchone():
            return ref
    return f"PP-{int(datetime.now(timezone.utc).timestamp()) % 10000000:07d}"

def cleanup_expired_holds(conn: sqlite3.Connection) -> int:
    """
    Releases temporary holds that have passed their hold_expires_at timestamp.
    Does NOT delete the booking record; transitions it to 'expired' hold.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    cur_slots = conn.execute(
        """
        UPDATE booking_slots 
        SET status = 'expired' 
        WHERE status = 'held' AND hold_expires_at IS NOT NULL AND hold_expires_at < ?
        """,
        (now_iso,)
    )
    cur_b = conn.execute(
        """
        UPDATE bookings 
        SET status = 'expired', updated_at = ?
        WHERE status = 'awaiting_advance' AND hold_expires_at IS NOT NULL AND hold_expires_at < ?
        """,
        (now_iso, now_iso)
    )
    return cur_slots.rowcount + cur_b.rowcount

def check_date_availability(slot_date: str) -> List[Dict[str, Any]]:
    """
    Returns real-time availability for all 24 hours on slot_date.
    RULE:
    - Confirmed reservations -> available = False, status = 'booked'
    - Active unexpired holds -> available = False, status = 'held'
    - Pending customer requests -> available = True (does NOT block slot!)
    """
    conn = get_db_connection()
    try:
        with conn:
            cleanup_expired_holds(conn)
            now_iso = datetime.now(timezone.utc).isoformat()

            cur_confirmed = conn.execute(
                """
                SELECT slot_time FROM booking_slots 
                WHERE slot_date = ? AND status = 'confirmed'
                """,
                (slot_date,)
            )
            confirmed_slots = {row["slot_time"] for row in cur_confirmed.fetchall()}

            cur_events = conn.execute(
                """
                SELECT id, event_details FROM bookings 
                WHERE booking_date = ? AND status = 'confirmed' AND booking_type != 'cricket'
                """,
                (slot_date,)
            )
            for ev_row in cur_events.fetchall():
                ev_slots = get_event_slots(ev_row["event_details"])
                for s_time in ev_slots:
                    confirmed_slots.add(s_time)

            cur_blocked = conn.execute(
                "SELECT slot_time, reason FROM blocked_slots WHERE slot_date = ?",
                (slot_date,)
            )
            blocked_slot_map = {row["slot_time"]: row["reason"] for row in cur_blocked.fetchall()}

            cur_held = conn.execute(
                """
                SELECT slot_time, hold_expires_at FROM booking_slots 
                WHERE slot_date = ? AND status = 'held' 
                AND (hold_expires_at IS NULL OR hold_expires_at > ?)
                """,
                (slot_date, now_iso)
            )
            held_slots = {row["slot_time"]: row["hold_expires_at"] for row in cur_held.fetchall()}

            cur_event_holds = conn.execute(
                """
                SELECT id, event_details, hold_expires_at FROM bookings 
                WHERE booking_date = ? AND status = 'awaiting_advance' AND booking_type != 'cricket'
                AND (hold_expires_at IS NULL OR hold_expires_at > ?)
                """,
                (slot_date, now_iso)
            )
            for ev_h in cur_event_holds.fetchall():
                ev_slots = get_event_slots(ev_h["event_details"])
                for s_time in ev_slots:
                    held_slots[s_time] = ev_h["hold_expires_at"]

        now_utc = datetime.now(timezone.utc)
        ist_now = now_utc + timedelta(hours=5, minutes=30)
        today_ist_str = ist_now.date().isoformat()
        current_hour_ist = ist_now.hour

        is_today = (slot_date == today_ist_str)

        results = []
        for h in range(24):
            time_str = f"{h:02d}:00"
            is_past = is_today and (h < current_hour_ist)

            if time_str in confirmed_slots:
                status_label = "booked"
                is_available = False
            elif time_str in blocked_slot_map:
                status_label = "blocked"
                is_available = False
            elif time_str in held_slots:
                status_label = "held"
                is_available = False
            elif is_past:
                status_label = "past"
                is_available = False
            else:
                status_label = "available"
                is_available = True

            results.append({
                "hour": h,
                "time": time_str,
                "available": is_available,
                "status": status_label,
                "hold_expires_at": held_slots.get(time_str),
                "block_reason": blocked_slot_map.get(time_str),
                "is_night": h >= 18 or h < 6
            })
        return results
    finally:
        conn.close()

def create_booking_atomic(
    booking_type: str,
    customer_name: str,
    customer_phone: str,
    booking_date: str,
    slots: List[str],
    total_price: float,
    player_count: str = "6–10 Players",
    notes: str = "",
    event_details: Optional[Dict[str, Any]] = None,
    idempotency_key: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Creates a booking request in 'pending_confirmation' state.
    Does NOT close or lock the slot for other customers!
    Only checks if the slot is ALREADY confirmed or currently held.
    """
    conn = get_db_connection()
    now_utc = datetime.now(timezone.utc)
    now_iso = now_utc.isoformat()

    try:
        with conn:
            cleanup_expired_holds(conn)

            if idempotency_key:
                cur = conn.execute(
                    "SELECT * FROM bookings WHERE idempotency_key = ?",
                    (idempotency_key,)
                )
                existing = cur.fetchone()
                if existing:
                    return dict(existing)

            if booking_type == "cricket":
                sorted_slots = sorted(slots) if slots else []
            else:
                sorted_slots = sorted(slots) if slots else get_event_slots(event_details)

            start_time = sorted_slots[0] if sorted_slots else "00:00:00"
            if sorted_slots:
                last_hour = int(sorted_slots[-1].split(":")[0])
                end_time = f"{(last_hour + 1) % 24:02d}:00:00"
            else:
                end_time = "00:00:00"

            duration_hours = float(len(sorted_slots)) if sorted_slots else 1.0

            if sorted_slots and booking_type == "cricket":
                placeholders = ",".join("?" for _ in sorted_slots)
                cur = conn.execute(
                    f"""
                    SELECT slot_time, status FROM booking_slots 
                    WHERE slot_date = ? AND slot_time IN ({placeholders}) 
                    AND (status = 'confirmed' OR (status = 'held' AND hold_expires_at > ?))
                    """,
                    [booking_date] + sorted_slots + [now_iso]
                )
                blocked = [row["slot_time"] for row in cur.fetchall()]
                if blocked:
                    raise SlotUnavailableError(
                        f"Requested slot(s) are already booked or held: {', '.join(blocked)}",
                        blocked
                    )

            booking_id = str(uuid.uuid4())
            ref = generate_booking_reference(conn)

            conn.execute(
                """
                INSERT INTO bookings (
                    id, reference, booking_type, customer_name, customer_phone,
                    booking_date, start_time, end_time, duration_hours,
                    player_count, total_price, currency, notes, event_details,
                    status, advance_amount, payment_verified, whatsapp_status,
                    idempotency_key, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_confirmation', 0.0, 0, 'requested', ?, ?, ?)
                """,
                (
                    booking_id, ref, booking_type, customer_name, customer_phone,
                    booking_date, start_time, end_time, duration_hours,
                    player_count, total_price, "INR", notes,
                    json.dumps(event_details or {}),
                    idempotency_key, now_iso, now_iso
                )
            )

            unit_price = (total_price / len(sorted_slots)) if (total_price and sorted_slots) else 0.0
            for slot_str in sorted_slots:
                slot_id = str(uuid.uuid4())
                conn.execute(
                    """
                    INSERT INTO booking_slots (
                        id, booking_id, slot_date, slot_time, slot_price, status, created_at
                    ) VALUES (?, ?, ?, ?, ?, 'pending_confirmation', ?)
                    """,
                    (slot_id, booking_id, booking_date, slot_str, unit_price, now_iso)
                )

            cur = conn.execute("SELECT * FROM bookings WHERE id = ?", (booking_id,))
            return dict(cur.fetchone())
    finally:
        conn.close()

def place_temporary_hold(booking_id: str, hold_minutes: int = DEFAULT_HOLD_MINUTES) -> Dict[str, Any]:
    """
    Owner action: Places a temporary hold on the booking's slots while awaiting payment.
    The hold temporarily blocks availability for other customers until hold_expires_at.
    """
    conn = get_db_connection()
    now_utc = datetime.now(timezone.utc)
    now_iso = now_utc.isoformat()
    hold_expires_at = (now_utc + timedelta(minutes=hold_minutes)).isoformat()

    try:
        with conn:
            cleanup_expired_holds(conn)
            cur = conn.execute("SELECT * FROM bookings WHERE id = ?", (booking_id,))
            b = cur.fetchone()
            if not b:
                raise BookingNotFoundError(f"Booking {booking_id} not found.")

            cur_slots = conn.execute(
                """
                SELECT slot_date, slot_time FROM booking_slots WHERE booking_id = ?
                """,
                (booking_id,)
            )
            requested_slots = cur_slots.fetchall()
            if not requested_slots and b["booking_type"] != "cricket":
                ev_slots = get_event_slots(b["event_details"])
                for s_time in ev_slots:
                    s_id = str(uuid.uuid4())
                    conn.execute(
                        """
                        INSERT INTO booking_slots (
                            id, booking_id, slot_date, slot_time, slot_price, status, created_at
                        ) VALUES (?, ?, ?, ?, 0.0, 'pending_confirmation', ?)
                        """,
                        (s_id, booking_id, b["booking_date"], s_time, now_iso)
                    )
                cur_slots = conn.execute(
                    "SELECT slot_date, slot_time FROM booking_slots WHERE booking_id = ?",
                    (booking_id,)
                )
                requested_slots = cur_slots.fetchall()
            for s in requested_slots:
                conflict = conn.execute(
                    """
                    SELECT 1 FROM booking_slots 
                    WHERE slot_date = ? AND slot_time = ? AND status = 'confirmed' AND booking_id != ?
                    """,
                    (s["slot_date"], s["slot_time"], booking_id)
                ).fetchone()
                if conflict:
                    raise SlotUnavailableError(
                        f"Cannot place hold: Slot {s['slot_time']} is already confirmed for another booking.",
                        [s["slot_time"]]
                    )

            conn.execute(
                """
                UPDATE bookings 
                SET status = 'awaiting_advance', hold_expires_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (hold_expires_at, now_iso, booking_id)
            )

            conn.execute(
                """
                UPDATE booking_slots 
                SET status = 'held', hold_expires_at = ?
                WHERE booking_id = ?
                """,
                (hold_expires_at, booking_id)
            )

            cur = conn.execute("SELECT * FROM bookings WHERE id = ?", (booking_id,))
            return dict(cur.fetchone())
    finally:
        conn.close()

def record_advance_details(
    booking_id: str,
    advance_amount: float,
    payment_method: str,
    payment_reference: str,
    verified: bool = False
) -> Dict[str, Any]:
    """
    Owner action: Records the advance payment details received from customer.
    Sets status to 'payment_received' if verified or 'awaiting_advance' if awaiting verification.
    DOES NOT automatically confirm the booking! Confirmation requires explicit owner action.
    """
    conn = get_db_connection()
    now_utc = datetime.now(timezone.utc)
    now_iso = now_utc.isoformat()
    new_status = "payment_received" if verified else "awaiting_advance"

    try:
        with conn:
            cur = conn.execute("SELECT * FROM bookings WHERE id = ?", (booking_id,))
            b = cur.fetchone()
            if not b:
                raise BookingNotFoundError(f"Booking {booking_id} not found.")

            conn.execute(
                """
                UPDATE bookings 
                SET status = ?, advance_amount = ?, payment_method = ?,
                    payment_reference = ?, payment_verified = ?,
                    payment_verified_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    new_status, advance_amount, payment_method,
                    payment_reference, 1 if verified else 0,
                    now_iso if verified else None, now_iso, booking_id
                )
            )

            cur = conn.execute("SELECT * FROM bookings WHERE id = ?", (booking_id,))
            return dict(cur.fetchone())
    finally:
        conn.close()

def confirm_booking_atomic(
    booking_id: str,
    advance_amount: Optional[float] = None,
    payment_method: Optional[str] = None,
    payment_reference: Optional[str] = None
) -> Dict[str, Any]:
    """
    CRITICAL OWNER ACTION: Explicitly approves booking after payment verification.
    Atomically:
    1. Checks if any slot is already confirmed for another customer.
    2. Changes booking status to 'confirmed' and marks payment_verified = 1.
    3. Changes slot rows to 'confirmed', enforcing database exclusion.
    4. Automatically releases/rejects competing unconfirmed requests for the same slots.
    """
    conn = get_db_connection()
    now_utc = datetime.now(timezone.utc)
    now_iso = now_utc.isoformat()

    try:
        with conn:
            cur = conn.execute("SELECT * FROM bookings WHERE id = ?", (booking_id,))
            b = cur.fetchone()
            if not b:
                raise BookingNotFoundError(f"Booking {booking_id} not found.")

            if b["status"] in ("cancelled", "rejected"):
                raise SlotUnavailableError(f"Cannot confirm: this booking is {b['status']}.", [])

            cur_slots = conn.execute(
                "SELECT slot_date, slot_time FROM booking_slots WHERE booking_id = ?",
                (booking_id,)
            )
            slots_to_confirm = cur_slots.fetchall()
            if not slots_to_confirm and b["booking_type"] != "cricket":
                ev_slots = get_event_slots(b["event_details"])
                for s_time in ev_slots:
                    s_id = str(uuid.uuid4())
                    conn.execute(
                        """
                        INSERT INTO booking_slots (
                            id, booking_id, slot_date, slot_time, slot_price, status, created_at
                        ) VALUES (?, ?, ?, ?, 0.0, 'pending_confirmation', ?)
                        """,
                        (s_id, booking_id, b["booking_date"], s_time, now_iso)
                    )
                cur_slots = conn.execute(
                    "SELECT slot_date, slot_time FROM booking_slots WHERE booking_id = ?",
                    (booking_id,)
                )
                slots_to_confirm = cur_slots.fetchall()

            for s in slots_to_confirm:
                conflict = conn.execute(
                    """
                    SELECT b.reference FROM booking_slots bs
                    JOIN bookings b ON bs.booking_id = b.id
                    WHERE bs.slot_date = ? AND bs.slot_time = ? AND bs.status = 'confirmed' AND bs.booking_id != ?
                    """,
                    (s["slot_date"], s["slot_time"], booking_id)
                ).fetchone()
                if conflict:
                    raise SlotUnavailableError(
                        f"Cannot confirm: Slot {s['slot_time']} on {s['slot_date']} is already confirmed under booking {conflict['reference']}.",
                        [s["slot_time"]]
                    )

            adv_amt = advance_amount if advance_amount is not None else b["advance_amount"]
            p_method = payment_method if payment_method is not None else b["payment_method"]
            p_ref = payment_reference if payment_reference is not None else b["payment_reference"]

            conn.execute(
                """
                UPDATE bookings 
                SET status = 'confirmed', advance_amount = ?, payment_method = ?,
                    payment_reference = ?, payment_verified = 1,
                    payment_verified_at = ?, hold_expires_at = NULL, updated_at = ?
                WHERE id = ?
                """,
                (adv_amt, p_method, p_ref, now_iso, now_iso, booking_id)
            )

            try:
                conn.execute(
                    """
                    UPDATE booking_slots 
                    SET status = 'confirmed', hold_expires_at = NULL
                    WHERE booking_id = ?
                    """,
                    (booking_id,)
                )
            except sqlite3.IntegrityError:
                raise SlotUnavailableError(
                    "Database constraint violation: Slot was confirmed concurrently by another staff action.",
                    [s["slot_time"] for s in slots_to_confirm]
                )

            for s in slots_to_confirm:
                conn.execute(
                    """
                    UPDATE bookings 
                    SET status = 'rejected', updated_at = ?
                    WHERE id IN (
                        SELECT booking_id FROM booking_slots 
                        WHERE slot_date = ? AND slot_time = ? AND booking_id != ? AND status != 'confirmed'
                    ) AND status IN ('pending_confirmation', 'awaiting_advance')
                    """,
                    (now_iso, s["slot_date"], s["slot_time"], booking_id)
                )

            cur = conn.execute("SELECT * FROM bookings WHERE id = ?", (booking_id,))
            return dict(cur.fetchone())
    finally:
        conn.close()

def update_booking_status(booking_id: str, new_status: str) -> Dict[str, Any]:
    """
    Transitions booking status (pending_confirmation, awaiting_advance, payment_received, confirmed, rejected, cancelled).
    Routes confirmation through confirm_booking_atomic.
    """
    valid_statuses = (
        "pending_confirmation", "awaiting_advance", "payment_received",
        "confirmed", "rejected", "cancelled", "expired"
    )
    if new_status not in valid_statuses:
        raise ValueError(f"Invalid booking status: {new_status}")

    if new_status == "confirmed":
        return confirm_booking_atomic(booking_id)

    conn = get_db_connection()
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        with conn:
            cur = conn.execute("SELECT * FROM bookings WHERE id = ?", (booking_id,))
            existing = cur.fetchone()
            if not existing:
                raise BookingNotFoundError(f"Booking ID {booking_id} not found.")

            conn.execute(
                "UPDATE bookings SET status = ?, updated_at = ? WHERE id = ?",
                (new_status, now_iso, booking_id)
            )

            if new_status in ("cancelled", "rejected", "expired"):
                conn.execute(
                    "UPDATE booking_slots SET status = ? WHERE booking_id = ?",
                    (new_status, booking_id)
                )

            cur = conn.execute("SELECT * FROM bookings WHERE id = ?", (booking_id,))
            return dict(cur.fetchone())
    finally:
        conn.close()

def get_booking_by_ref(reference: str) -> Optional[Dict[str, Any]]:
    """Retrieves a booking record by reference."""
    conn = get_db_connection()
    try:
        cleanup_expired_holds(conn)
        cur = conn.execute("SELECT * FROM bookings WHERE reference = ?", (reference,))
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()

def list_admin_bookings(
    date_filter: Optional[str] = None,
    status_filter: Optional[str] = None,
    search_query: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Lists bookings for staff dashboard with audit details and hold information."""
    conn = get_db_connection()
    try:
        cleanup_expired_holds(conn)
        sql = """
            SELECT b.*,
                   COALESCE(
                       (SELECT GROUP_CONCAT(bs.slot_time, ', ') 
                        FROM (SELECT slot_time FROM booking_slots WHERE booking_id = b.id ORDER BY slot_time) bs),
                       b.start_time
                   ) AS booked_slots
            FROM bookings b 
            WHERE 1=1
        """
        params: List[Any] = []

        if date_filter:
            sql += " AND b.booking_date = ?"
            params.append(date_filter)
        if status_filter:
            if status_filter.lower() in ("pending_confirmation", "pending", "new"):
                sql += " AND (b.status = 'pending_confirmation' OR b.status = 'pending' OR b.status = 'new')"
            else:
                sql += " AND b.status = ?"
                params.append(status_filter)
        if search_query:
            sql += " AND (b.reference LIKE ? OR b.customer_name LIKE ? OR b.customer_phone LIKE ?)"
            term = f"%{search_query.strip()}%"
            params.extend([term, term, term])

        sql += " ORDER BY b.created_at DESC"
        cur = conn.execute(sql, params)
        return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


def get_booking_manager_pin() -> str:
    """Gets the active 6-digit PIN for the Booking Manager, defaulting to '123456'."""
    env_pin = os.environ.get("BOOKING_MANAGER_PIN")
    if env_pin and len(env_pin) == 6 and env_pin.isdigit():
        return env_pin
    conn = get_db_connection()
    try:
        cur = conn.execute("SELECT value FROM system_settings WHERE key = 'booking_manager_pin'")
        row = cur.fetchone()
        if row and row["value"]:
            return row["value"]
        return "123456"
    finally:
        conn.close()

def set_booking_manager_pin(new_pin: str) -> bool:
    """Sets a new 6-digit PIN for the Booking Manager."""
    clean_pin = str(new_pin).strip()
    if not (len(clean_pin) == 6 and clean_pin.isdigit()):
        raise ValueError("PIN must be exactly 6 digits.")
    conn = get_db_connection()
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        with conn:
            conn.execute(
                """
                INSERT INTO system_settings (key, value, updated_at)
                VALUES ('booking_manager_pin', ?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
                """,
                (clean_pin, now_iso)
            )
        return True
    finally:
        conn.close()

def create_pin_recovery_code(expiry_minutes: int = 10) -> Dict[str, Any]:
    """
    Generates a secure 6-digit recovery code for owner WhatsApp verification.
    Valid for 10 minutes.
    """
    req_id = str(uuid.uuid4())
    code = f"{random.randint(100000, 999999)}"
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    expires_at = (now + timedelta(minutes=expiry_minutes)).isoformat()

    conn = get_db_connection()
    try:
        with conn:
            conn.execute(
                """
                INSERT INTO pin_recovery_requests (id, code, expires_at, used, created_at)
                VALUES (?, ?, ?, 0, ?)
                """,
                (req_id, code, expires_at, now_iso)
            )
        return {
            "request_id": req_id,
            "code": code,
            "expires_at": expires_at,
            "expires_in_minutes": expiry_minutes
        }
    finally:
        conn.close()

def verify_and_consume_recovery_code(request_id: str, code: str) -> bool:
    """
    Verifies that the provided 6-digit recovery code matches and is still valid.
    Marks it as used upon verification.
    """
    clean_code = str(code).strip()
    now_iso = datetime.now(timezone.utc).isoformat()
    conn = get_db_connection()
    try:
        with conn:
            cur = conn.execute(
                """
                SELECT id, code, expires_at, used FROM pin_recovery_requests
                WHERE id = ? AND code = ? AND used = 0 AND expires_at > ?
                """,
                (request_id, clean_code, now_iso)
            )
            row = cur.fetchone()
            if not row:
                return False
            conn.execute("UPDATE pin_recovery_requests SET used = 1 WHERE id = ?", (request_id,))
            return True
    finally:
        conn.close()



def get_blocked_slots(slot_date: str) -> List[Dict[str, Any]]:
    """Returns all owner-blocked slots for a given date."""
    conn = get_db_connection()
    try:
        cur = conn.execute(
            "SELECT id, slot_time, reason, created_at FROM blocked_slots WHERE slot_date = ? ORDER BY slot_time",
            (slot_date,)
        )
        return [dict(row) for row in cur.fetchall()]
    finally:
        conn.close()


def set_slot_blocked(slot_date: str, slot_times: List[str], reason: str = "Blocked by Owner") -> int:
    """Blocks one or more time slots for a date. Returns count of newly blocked slots."""
    conn = get_db_connection()
    now_iso = datetime.now(timezone.utc).isoformat()
    count = 0
    try:
        with conn:
            for slot_time in slot_times:
                slot_id = str(uuid.uuid4())
                try:
                    conn.execute(
                        """
                        INSERT INTO blocked_slots (id, slot_date, slot_time, reason, blocked_by, created_at)
                        VALUES (?, ?, ?, ?, 'owner', ?)
                        ON CONFLICT(slot_date, slot_time) DO UPDATE SET reason = excluded.reason
                        """,
                        (slot_id, slot_date, slot_time, reason, now_iso)
                    )
                    count += 1
                except Exception:
                    pass
        return count
    finally:
        conn.close()


def set_slot_unblocked(slot_date: str, slot_times: List[str]) -> int:
    """Unblocks one or more time slots for a date. Returns count of unblocked slots."""
    conn = get_db_connection()
    try:
        with conn:
            placeholders = ",".join("?" for _ in slot_times)
            cur = conn.execute(
                f"DELETE FROM blocked_slots WHERE slot_date = ? AND slot_time IN ({placeholders})",
                [slot_date] + slot_times
            )
            return cur.rowcount
    finally:
        conn.close()


def unblock_all_slots_for_date(slot_date: str) -> int:
    """Removes all owner-blocked slots for a given date."""
    conn = get_db_connection()
    try:
        with conn:
            cur = conn.execute("DELETE FROM blocked_slots WHERE slot_date = ?", (slot_date,))
            return cur.rowcount
    finally:
        conn.close()



def confirm_manual_booking(
    booking_type: str,
    customer_name: str,
    customer_phone: str,
    booking_date: str,
    slots: List[str],
    total_price: float,
    player_count: str = "Walk-in",
    notes: str = "",
    advance_amount: float = 0.0,
    payment_method: str = "Cash",
    payment_reference: str = "",
) -> Dict[str, Any]:
    """
    Owner-initiated manual booking that is IMMEDIATELY confirmed and permanently
    locks the requested slots. Used for walk-in / offline customers.
    """
    conn = get_db_connection()
    now_utc = datetime.now(timezone.utc)
    now_iso = now_utc.isoformat()

    try:
        with conn:
            cleanup_expired_holds(conn)

            sorted_slots = sorted(slots) if slots else []
            if not sorted_slots:
                raise ValueError("At least one time slot is required.")

            placeholders = ",".join("?" for _ in sorted_slots)
            cur = conn.execute(
                f"""
                SELECT slot_time, status FROM booking_slots
                WHERE slot_date = ? AND slot_time IN ({placeholders})
                AND (status = 'confirmed' OR (status = 'held' AND hold_expires_at > ?))
                """,
                [booking_date] + sorted_slots + [now_iso]
            )
            blocked = [row["slot_time"] for row in cur.fetchall()]
            if blocked:
                raise SlotUnavailableError(
                    f"Slot(s) already booked or held: {', '.join(blocked)}",
                    blocked
                )

            start_time = sorted_slots[0]
            last_hour = int(sorted_slots[-1].split(":")[0])
            end_time = f"{(last_hour + 1) % 24:02d}:00:00"
            duration_hours = float(len(sorted_slots))

            booking_id = str(uuid.uuid4())
            ref = generate_booking_reference(conn)

            is_verified = 1 if advance_amount > 0 else 0

            conn.execute(
                """
                INSERT INTO bookings (
                    id, reference, booking_type, customer_name, customer_phone,
                    booking_date, start_time, end_time, duration_hours,
                    player_count, total_price, currency, notes, event_details,
                    status, advance_amount, payment_method, payment_reference,
                    payment_verified, whatsapp_status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INR', ?, '{}',
                    'confirmed', ?, ?, ?, ?, 'manual', ?, ?)
                """,
                (
                    booking_id, ref, booking_type, customer_name, customer_phone,
                    booking_date, start_time, end_time, duration_hours,
                    player_count, total_price, notes,
                    advance_amount, payment_method, payment_reference,
                    is_verified, now_iso, now_iso
                )
            )

            unit_price = (total_price / len(sorted_slots)) if (total_price and sorted_slots) else 0.0
            for slot_str in sorted_slots:
                slot_id = str(uuid.uuid4())
                conn.execute(
                    """
                    INSERT INTO booking_slots (id, booking_id, slot_date, slot_time, slot_price, status, created_at)
                    VALUES (?, ?, ?, ?, ?, 'confirmed', ?)
                    """,
                    (slot_id, booking_id, booking_date, slot_str, unit_price, now_iso)
                )

            cur = conn.execute("SELECT * FROM bookings WHERE id = ?", (booking_id,))
            return dict(cur.fetchone())
    finally:
        conn.close()
