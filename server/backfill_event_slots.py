import sqlite3
import uuid
import json
import re

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

def get_event_slots(event_details) -> list:
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

def backfill_event_slots(db_path: str = "powerplay.db"):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    with conn:
        rows = conn.execute("SELECT * FROM bookings WHERE booking_type != 'cricket'").fetchall()
        for b in rows:
            booking_id = b["id"]
            ref = b["reference"]
            status = b["status"]
            b_date = b["booking_date"]
            ev_slots = get_event_slots(b["event_details"])
            
            existing = [r["slot_time"] for r in conn.execute("SELECT slot_time FROM booking_slots WHERE booking_id = ?", [booking_id]).fetchall()]
            
            for s_time in ev_slots:
                if s_time not in existing:
                    slot_id = str(uuid.uuid4())
                    conn.execute("""
                        INSERT INTO booking_slots (id, booking_id, slot_date, slot_time, slot_price, status, created_at)
                        VALUES (?, ?, ?, ?, 0.0, ?, ?)
                    """, [slot_id, booking_id, b_date, s_time, status, b["created_at"]])
                else:
                    conn.execute("UPDATE booking_slots SET status = ? WHERE booking_id = ? AND slot_time = ?", [status, booking_id, s_time])
            print(f"Synced {len(ev_slots)} slots for event {ref} (status: {status})")

    conn.close()

if __name__ == "__main__":
    backfill_event_slots()
