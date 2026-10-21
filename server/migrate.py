import sqlite3
import os

def migrate_database(db_path: str = "powerplay.db"):
    if not os.path.exists(db_path):
        return

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cur.execute("PRAGMA foreign_keys = OFF")
    
    schema_sql = cur.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='bookings'").fetchone()
    if not schema_sql or "pending_confirmation" in schema_sql["sql"]:
        print("Database already up to date or empty.")
        conn.close()
        return

    print("Migrating powerplay.db schema to owner-controlled lifecycle...")

    cur.execute("""
    CREATE TABLE bookings_new (
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
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    """)

    cur.execute("""
    CREATE TABLE booking_slots_new (
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
    """)

    old_b_rows = cur.execute("SELECT * FROM bookings").fetchall()
    for r in old_b_rows:
        d = dict(r)
        status = d.get("status", "pending_confirmation")
        if status in ("pending", "new", "requested"):
            status = "pending_confirmation"
        cur.execute("""
            INSERT OR REPLACE INTO bookings_new (
                id, reference, booking_type, customer_name, customer_phone,
                booking_date, start_time, end_time, duration_hours,
                player_count, total_price, currency, notes, event_details,
                status, advance_amount, payment_method, payment_reference,
                payment_verified, payment_verified_at, hold_expires_at,
                whatsapp_status, idempotency_key, expires_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            d["id"], d["reference"], d["booking_type"], d["customer_name"], d["customer_phone"],
            d["booking_date"], d["start_time"], d["end_time"], d.get("duration_hours", 1.0),
            d.get("player_count", "6–10 Players"), d.get("total_price", 0.0), d.get("currency", "INR"),
            d.get("notes", ""), d.get("event_details", "{}"), status,
            d.get("advance_amount", 0.0), d.get("payment_method"), d.get("payment_reference"),
            d.get("payment_verified", 0), d.get("payment_verified_at"), d.get("hold_expires_at"),
            d.get("whatsapp_status", "requested"), d.get("idempotency_key"), d.get("expires_at"),
            d["created_at"], d["updated_at"]
        ))

    old_s_rows = cur.execute("SELECT * FROM booking_slots").fetchall()
    for r in old_s_rows:
        d = dict(r)
        status = d.get("status", "pending_confirmation")
        if status in ("pending", "new", "requested"):
            status = "pending_confirmation"
        cur.execute("""
            INSERT OR REPLACE INTO booking_slots_new (
                id, booking_id, slot_date, slot_time, slot_price, status, hold_expires_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            d["id"], d["booking_id"], d["slot_date"], d["slot_time"],
            d.get("slot_price", 0.0), status, d.get("hold_expires_at"), d["created_at"]
        ))

    cur.execute("DROP TABLE bookings")
    cur.execute("ALTER TABLE bookings_new RENAME TO bookings")
    cur.execute("DROP TABLE booking_slots")
    cur.execute("ALTER TABLE booking_slots_new RENAME TO booking_slots")

    cur.execute("CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(booking_date)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_bookings_ref ON bookings(reference)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_slots_date ON booking_slots(slot_date)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_slots_booking ON booking_slots(booking_id)")
    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_confirmed_slot_idx ON booking_slots(slot_date, slot_time) WHERE status = 'confirmed'")

    conn.commit()
    cur.execute("PRAGMA foreign_keys = ON")
    print("Database migration successful!")
    conn.close()

if __name__ == "__main__":
    migrate_database()
