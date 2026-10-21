"""
POWERPLAY CLUB - OWNER-CONTROLLED BOOKING & ADVANCE PAYMENT AUTOMATED TEST SUITE

Tests the 17 core requirements:
1. Submitting a request does not permanently block the slot.
2. Opening WhatsApp does not confirm the booking.
3. A pending request is visible to the owner.
4. An owner-authorized temporary hold blocks availability only until expiry.
5. Expired holds release availability.
6. An owner can move a request into the advance-payment workflow.
7. An unauthorized user cannot verify payment.
8. An unauthorized user cannot confirm a booking.
9. A payment record alone does not silently confirm a booking.
10. An authorized owner can verify advance payment and confirm the booking.
11. A confirmed booking blocks the slot for all customers.
12. Rejected and cancelled bookings release the slot.
13. Two concurrent confirmation attempts for the same slot cannot both succeed.
14. An expired request can remain visible without blocking the slot.
15. Public availability correctly reflects holds and confirmed reservations.
16. Existing pricing and WhatsApp integration still work.
17. Existing website design and responsive layout remain intact.
"""

import os
import sys
import tempfile
import urllib.parse
from datetime import datetime, date, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

# Use isolated temporary database for testing
test_db_fd, test_db_path = tempfile.mkstemp(suffix=".db")
os.close(test_db_fd)
os.environ["POWERPLAY_DB_PATH"] = test_db_path
os.environ["POWERPLAY_ADMIN_KEY"] = "test_staff_key_2026"

from server.main import app
from server.database import init_db, get_db_connection, cleanup_expired_holds
from server.pricing import calculate_booking_pricing, calculate_slot_price
from server.whatsapp import WHATSAPP_PHONE, build_whatsapp_click_url

# Re-init fresh schema in test database
init_db()

client = TestClient(app)

# Helper for future dates
def get_future_date(days_ahead: int = 2) -> str:
    utc_now = datetime.now(timezone.utc)
    target = utc_now + timedelta(days=days_ahead)
    return target.strftime("%Y-%m-%d")

def get_admin_token() -> str:
    res = client.post("/api/admin/login", json={"key": "test_staff_key_2026"})
    return res.json()["token"]


# ============================================================================
# TEST 1: Submitting a request does not permanently block the slot
# ============================================================================
def test_01_submitting_request_does_not_block_slot():
    book_date = get_future_date(3)
    slot_time = "10:00"

    # Customer 1 submits request
    res1 = client.post("/api/bookings", json={
        "booking_type": "cricket",
        "customer_name": "Kiran Kumar",
        "customer_phone": "9876543210",
        "booking_date": book_date,
        "slots": [slot_time],
        "player_count": "6–10 Players"
    })
    assert res1.status_code == 201, res1.text
    b1 = res1.json()["booking"]
    assert b1["status"] == "pending_confirmation"

    # Slot must STILL be available to other customers
    avail = client.get(f"/api/availability?date={book_date}").json()
    slot_info = next(s for s in avail["slots"] if s["time"] == slot_time)
    assert slot_info["available"] is True, "Slot was prematurely closed by a pending request!"
    assert slot_info["status"] == "available"

    # Customer 2 can also submit a request for the same slot
    res2 = client.post("/api/bookings", json={
        "booking_type": "cricket",
        "customer_name": "Ravi Teja",
        "customer_phone": "9876543211",
        "booking_date": book_date,
        "slots": [slot_time],
        "player_count": "6–10 Players"
    })
    assert res2.status_code == 201, "Second customer request was blocked prematurely!"
    assert res2.json()["booking"]["status"] == "pending_confirmation"


# ============================================================================
# TEST 2: Opening WhatsApp does not confirm the booking
# ============================================================================
def test_02_opening_whatsapp_does_not_confirm_booking():
    book_date = get_future_date(4)
    res = client.post("/api/bookings", json={
        "booking_type": "cricket",
        "customer_name": "Vijay Raju",
        "customer_phone": "9955112233",
        "booking_date": book_date,
        "slots": ["14:00"]
    })
    assert res.status_code == 201
    data = res.json()
    ref = data["booking"]["reference"]
    wa_url = data["whatsapp"]["url"]

    # WhatsApp message must state pending verification
    assert "Pending%20confirmation" in wa_url or "Pending confirmation" in urllib.parse.unquote(wa_url)
    assert "advance" in urllib.parse.unquote(wa_url).lower()

    # Query status from backend: MUST remain unconfirmed
    status_res = client.get(f"/api/bookings/{ref}/status")
    assert status_res.status_code == 200
    st_data = status_res.json()
    assert st_data["status"] == "pending_confirmation"
    assert st_data["is_confirmed"] is False


# ============================================================================
# TEST 3: A pending request is visible to the owner
# ============================================================================
def test_03_pending_request_visible_to_owner():
    token = get_admin_token()
    book_date = get_future_date(5)

    res = client.post("/api/bookings", json={
        "booking_type": "cricket",
        "customer_name": "Visible Customer",
        "customer_phone": "9123456780",
        "booking_date": book_date,
        "slots": ["16:00"]
    })
    ref = res.json()["booking"]["reference"]

    admin_res = client.get(f"/api/admin/bookings?search={ref}", headers={"Authorization": f"Bearer {token}"})
    assert admin_res.status_code == 200
    bookings = admin_res.json()
    assert len(bookings) >= 1
    found = next((b for b in bookings if b["reference"] == ref), None)
    assert found is not None
    assert found["status"] == "pending_confirmation"
    assert found["customer_name"] == "Visible Customer"


# ============================================================================
# TEST 4: Owner-authorized temporary hold blocks availability only until expiry
# ============================================================================
def test_04_owner_authorized_hold_blocks_availability_until_expiry():
    token = get_admin_token()
    book_date = get_future_date(6)
    slot_time = "17:00"

    res = client.post("/api/bookings", json={
        "booking_type": "cricket",
        "customer_name": "Hold Customer",
        "customer_phone": "9123456781",
        "booking_date": book_date,
        "slots": [slot_time]
    })
    b_id = res.json()["booking"]["id"]

    # Owner places temporary hold for 15 minutes
    hold_res = client.post(
        f"/api/admin/bookings/{b_id}/hold",
        json={"hold_duration_minutes": 15},
        headers={"Authorization": f"Bearer {token}"}
    )
    assert hold_res.status_code == 200
    assert hold_res.json()["booking"]["status"] == "awaiting_advance"
    assert hold_res.json()["booking"]["hold_expires_at"] is not None

    # Availability must now show temporarily held
    avail = client.get(f"/api/availability?date={book_date}").json()
    slot_info = next(s for s in avail["slots"] if s["time"] == slot_time)
    assert slot_info["available"] is False
    assert slot_info["status"] == "held"
    assert slot_info["hold_expires_at"] is not None


# ============================================================================
# TEST 5: Expired holds release availability
# ============================================================================
def test_05_expired_holds_release_availability():
    token = get_admin_token()
    book_date = get_future_date(7)
    slot_time = "18:00"

    res = client.post("/api/bookings", json={
        "booking_type": "cricket",
        "customer_name": "Expiring Hold Customer",
        "customer_phone": "9123456782",
        "booking_date": book_date,
        "slots": [slot_time]
    })
    b_id = res.json()["booking"]["id"]

    # Place hold
    client.post(f"/api/admin/bookings/{b_id}/hold", json={"hold_duration_minutes": 15}, headers={"Authorization": f"Bearer {token}"})

    # Artificially set hold_expires_at to the past in database
    conn = get_db_connection()
    past_iso = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    with conn:
        conn.execute("UPDATE bookings SET hold_expires_at = ? WHERE id = ?", (past_iso, b_id))
        conn.execute("UPDATE booking_slots SET hold_expires_at = ? WHERE booking_id = ?", (past_iso, b_id))
    conn.close()

    # Query availability: expired hold must be released automatically
    avail = client.get(f"/api/availability?date={book_date}").json()
    slot_info = next(s for s in avail["slots"] if s["time"] == slot_time)
    assert slot_info["available"] is True, "Expired hold did not release the slot!"
    assert slot_info["status"] == "available"


# ============================================================================
# TEST 6: Owner can move request into advance-payment workflow
# ============================================================================
def test_06_owner_moves_request_to_advance_payment_workflow():
    token = get_admin_token()
    book_date = get_future_date(8)

    res = client.post("/api/bookings", json={
        "booking_type": "cricket",
        "customer_name": "Advance Workflow Customer",
        "customer_phone": "9123456783",
        "booking_date": book_date,
        "slots": ["19:00"]
    })
    b_id = res.json()["booking"]["id"]

    # Owner updates status to awaiting_advance
    patch_res = client.patch(
        f"/api/admin/bookings/{b_id}/status",
        json={"status": "awaiting_advance"},
        headers={"Authorization": f"Bearer {token}"}
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["booking"]["status"] == "awaiting_advance"


# ============================================================================
# TEST 7: Unauthorized user cannot verify payment
# ============================================================================
def test_07_unauthorized_user_cannot_verify_payment():
    book_date = get_future_date(9)
    res = client.post("/api/bookings", json={
        "booking_type": "cricket",
        "customer_name": "Security Test User",
        "customer_phone": "9123456784",
        "booking_date": book_date,
        "slots": ["20:00"]
    })
    b_id = res.json()["booking"]["id"]

    # Attempt to record advance payment without token
    res_no_auth = client.post(f"/api/admin/bookings/{b_id}/advance", json={
        "advance_amount": 500,
        "payment_method": "UPI",
        "payment_reference": "TXN_FAKE",
        "payment_verified": True
    })
    assert res_no_auth.status_code == 401

    # Attempt with bad token
    res_bad_auth = client.post(
        f"/api/admin/bookings/{b_id}/advance",
        json={"advance_amount": 500, "payment_method": "UPI", "payment_reference": "TXN_FAKE", "payment_verified": True},
        headers={"Authorization": "Bearer bad_secret"}
    )
    assert res_bad_auth.status_code == 401


# ============================================================================
# TEST 8: Unauthorized user cannot confirm a booking
# ============================================================================
def test_08_unauthorized_user_cannot_confirm_booking():
    book_date = get_future_date(10)
    res = client.post("/api/bookings", json={
        "booking_type": "cricket",
        "customer_name": "Security Customer 2",
        "customer_phone": "9123456785",
        "booking_date": book_date,
        "slots": ["21:00"]
    })
    b_id = res.json()["booking"]["id"]

    # Try confirm without token
    res_no_auth = client.post(f"/api/admin/bookings/{b_id}/confirm", json={})
    assert res_no_auth.status_code == 401

    # Try confirm with invalid token
    res_bad = client.post(f"/api/admin/bookings/{b_id}/confirm", json={}, headers={"Authorization": "Bearer wrong_token"})
    assert res_bad.status_code == 401


# ============================================================================
# TEST 9: Payment record alone does not silently confirm a booking
# ============================================================================
def test_09_payment_record_alone_does_not_confirm_booking():
    token = get_admin_token()
    book_date = get_future_date(11)
    slot_time = "22:00"

    res = client.post("/api/bookings", json={
        "booking_type": "cricket",
        "customer_name": "Advance Paid Customer",
        "customer_phone": "9123456786",
        "booking_date": book_date,
        "slots": [slot_time]
    })
    b_id = res.json()["booking"]["id"]

    # Owner records advance payment
    adv_res = client.post(
        f"/api/admin/bookings/{b_id}/advance",
        json={
            "advance_amount": 500.0,
            "payment_method": "Google Pay",
            "payment_reference": "UPI/987654321/PP",
            "payment_verified": True
        },
        headers={"Authorization": f"Bearer {token}"}
    )
    assert adv_res.status_code == 200
    b_data = adv_res.json()["booking"]
    assert b_data["status"] == "payment_received"
    assert b_data["advance_amount"] == 500.0
    assert bool(b_data["payment_verified"]) is True

    # Booking must NOT be confirmed yet!
    status_check = client.get(f"/api/bookings/{b_data['reference']}/status").json()
    assert status_check["status"] == "payment_received"
    assert status_check["is_confirmed"] is False


# ============================================================================
# TEST 10: Authorized owner verifies advance payment and confirms booking
# ============================================================================
def test_10_authorized_owner_verifies_advance_and_confirms():
    token = get_admin_token()
    book_date = get_future_date(12)
    slot_time = "10:00"

    res = client.post("/api/bookings", json={
        "booking_type": "cricket",
        "customer_name": "Verified Customer",
        "customer_phone": "9123456787",
        "booking_date": book_date,
        "slots": [slot_time]
    })
    b_id = res.json()["booking"]["id"]
    ref = res.json()["booking"]["reference"]

    # 1. Record advance
    client.post(f"/api/admin/bookings/{b_id}/advance", json={
        "advance_amount": 500.0,
        "payment_method": "PhonePe",
        "payment_reference": "PP998877",
        "payment_verified": True
    }, headers={"Authorization": f"Bearer {token}"})

    # 2. Explicitly Confirm Booking
    confirm_res = client.post(
        f"/api/admin/bookings/{b_id}/confirm",
        json={"notes": "Advance verified on PhonePe"},
        headers={"Authorization": f"Bearer {token}"}
    )
    assert confirm_res.status_code == 200
    c_data = confirm_res.json()["booking"]
    assert c_data["status"] == "confirmed"

    # Public status check
    st = client.get(f"/api/bookings/{ref}/status").json()
    assert st["status"] == "confirmed"
    assert st["is_confirmed"] is True


# ============================================================================
# TEST 11: Confirmed booking blocks the slot for all customers
# ============================================================================
def test_11_confirmed_booking_blocks_slot_for_all_customers():
    token = get_admin_token()
    book_date = get_future_date(13)
    slot_time = "11:00"

    # Create and confirm booking
    res = client.post("/api/bookings", json={
        "booking_type": "cricket",
        "customer_name": "Master Booker",
        "customer_phone": "9123456788",
        "booking_date": book_date,
        "slots": [slot_time]
    })
    b_id = res.json()["booking"]["id"]
    client.post(f"/api/admin/bookings/{b_id}/confirm", json={}, headers={"Authorization": f"Bearer {token}"})

    # Public availability check must now show 'booked' and unavailable
    avail = client.get(f"/api/availability?date={book_date}").json()
    slot_info = next(s for s in avail["slots"] if s["time"] == slot_time)
    assert slot_info["available"] is False
    assert slot_info["status"] == "booked"

    # Any new customer request for this confirmed slot must be rejected with 409
    res_conflict = client.post("/api/bookings", json={
        "booking_type": "cricket",
        "customer_name": "Late Customer",
        "customer_phone": "9123456789",
        "booking_date": book_date,
        "slots": [slot_time]
    })
    assert res_conflict.status_code == 409
    assert "already booked" in res_conflict.json()["detail"]["message"].lower()


# ============================================================================
# TEST 12: Rejected and cancelled bookings release the slot
# ============================================================================
def test_12_rejected_and_cancelled_bookings_release_slot():
    token = get_admin_token()
    book_date = get_future_date(14)
    slot_time = "12:00"

    # 1. Book and confirm slot
    res = client.post("/api/bookings", json={
        "booking_type": "cricket",
        "customer_name": "Will Cancel Customer",
        "customer_phone": "9123456790",
        "booking_date": book_date,
        "slots": [slot_time]
    })
    b_id = res.json()["booking"]["id"]
    client.post(f"/api/admin/bookings/{b_id}/confirm", json={}, headers={"Authorization": f"Bearer {token}"})

    # Verify slot is booked
    avail1 = client.get(f"/api/availability?date={book_date}").json()
    assert next(s for s in avail1["slots"] if s["time"] == slot_time)["available"] is False

    # 2. Owner cancels booking
    cancel_res = client.patch(
        f"/api/admin/bookings/{b_id}/status",
        json={"status": "cancelled"},
        headers={"Authorization": f"Bearer {token}"}
    )
    assert cancel_res.status_code == 200

    # 3. Slot MUST be released back to available
    avail2 = client.get(f"/api/availability?date={book_date}").json()
    assert next(s for s in avail2["slots"] if s["time"] == slot_time)["available"] is True


# ============================================================================
# TEST 13: Two concurrent confirmation attempts cannot both succeed
# ============================================================================
def test_13_concurrent_confirmation_attempts_cannot_both_succeed():
    token = get_admin_token()
    book_date = get_future_date(15)
    slot_time = "13:00"

    # Customer A and Customer B both submit requests for the same slot
    res_a = client.post("/api/bookings", json={
        "booking_type": "cricket",
        "customer_name": "Contender A",
        "customer_phone": "9123456791",
        "booking_date": book_date,
        "slots": [slot_time]
    })
    id_a = res_a.json()["booking"]["id"]

    res_b = client.post("/api/bookings", json={
        "booking_type": "cricket",
        "customer_name": "Contender B",
        "customer_phone": "9123456792",
        "booking_date": book_date,
        "slots": [slot_time]
    })
    id_b = res_b.json()["booking"]["id"]

    # Concurrently attempt to confirm both
    def try_confirm(booking_id):
        c = TestClient(app)
        return c.post(
            f"/api/admin/bookings/{booking_id}/confirm",
            json={},
            headers={"Authorization": f"Bearer {token}"}
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        f_a = executor.submit(try_confirm, id_a)
        f_b = executor.submit(try_confirm, id_b)
        results = [f_a.result(), f_b.result()]

    # Exactly ONE must succeed (200), and the other MUST fail with 409 Conflict
    assert 200 in results
    assert 409 in results
    assert results.count(200) == 1
    assert results.count(409) == 1


# ============================================================================
# TEST 14: Expired request remains visible without blocking the slot
# ============================================================================
def test_14_expired_request_remains_visible_without_blocking_slot():
    token = get_admin_token()
    book_date = get_future_date(16)
    slot_time = "14:00"

    res = client.post("/api/bookings", json={
        "booking_type": "cricket",
        "customer_name": "Expired Request Customer",
        "customer_phone": "9123456793",
        "booking_date": book_date,
        "slots": [slot_time]
    })
    b_id = res.json()["booking"]["id"]
    ref = res.json()["booking"]["reference"]

    # Place hold and expire it in DB
    client.post(f"/api/admin/bookings/{b_id}/hold", json={"hold_duration_minutes": 15}, headers={"Authorization": f"Bearer {token}"})
    past_iso = (datetime.now(timezone.utc) - timedelta(minutes=20)).isoformat()
    conn = get_db_connection()
    with conn:
        conn.execute("UPDATE bookings SET hold_expires_at = ? WHERE id = ?", (past_iso, b_id))
        conn.execute("UPDATE booking_slots SET hold_expires_at = ? WHERE booking_id = ?", (past_iso, b_id))
    conn.close()

    # Trigger availability check (cleans expired holds)
    avail = client.get(f"/api/availability?date={book_date}").json()
    assert next(s for s in avail["slots"] if s["time"] == slot_time)["available"] is True

    # Check admin list: request is STILL visible in owner dashboard with status 'expired'
    admin_list = client.get(f"/api/admin/bookings?search={ref}", headers={"Authorization": f"Bearer {token}"}).json()
    assert len(admin_list) >= 1
    item = next(b for b in admin_list if b["reference"] == ref)
    assert item["status"] == "expired"


# ============================================================================
# TEST 15: Public availability correctly reflects holds and confirmed reservations
# ============================================================================
def test_15_public_availability_reflects_holds_and_confirmed():
    token = get_admin_token()
    book_date = get_future_date(17)

    # 15:00 Confirmed
    r_conf = client.post("/api/bookings", json={
        "booking_type": "cricket", "customer_name": "Conf User", "customer_phone": "9123456794",
        "booking_date": book_date, "slots": ["15:00"]
    }).json()["booking"]["id"]
    client.post(f"/api/admin/bookings/{r_conf}/confirm", json={}, headers={"Authorization": f"Bearer {token}"})

    # 16:00 Held
    r_held = client.post("/api/bookings", json={
        "booking_type": "cricket", "customer_name": "Held User", "customer_phone": "9123456795",
        "booking_date": book_date, "slots": ["16:00"]
    }).json()["booking"]["id"]
    client.post(f"/api/admin/bookings/{r_held}/hold", json={"hold_duration_minutes": 15}, headers={"Authorization": f"Bearer {token}"})

    # 17:00 Pending request only (NOT confirmed, NOT held)
    client.post("/api/bookings", json={
        "booking_type": "cricket", "customer_name": "Pending User", "customer_phone": "9123456796",
        "booking_date": book_date, "slots": ["17:00"]
    })

    # Query public availability
    avail = client.get(f"/api/availability?date={book_date}").json()
    slots_map = {s["time"]: s for s in avail["slots"]}

    assert slots_map["15:00"]["status"] == "booked"
    assert slots_map["15:00"]["available"] is False

    assert slots_map["16:00"]["status"] == "held"
    assert slots_map["16:00"]["available"] is False

    assert slots_map["17:00"]["status"] == "available"
    assert slots_map["17:00"]["available"] is True, "Pending request must remain Available!"


# ============================================================================
# TEST 16: Existing pricing and WhatsApp integration still work
# ============================================================================
def test_16_pricing_and_whatsapp_integration():
    # Helper to find weekday and weekend
    cur = datetime.now(timezone.utc).date() + timedelta(days=1)
    while cur.weekday() >= 5: cur += timedelta(days=1)
    weekday = cur

    cur2 = datetime.now(timezone.utc).date() + timedelta(days=1)
    while cur2.weekday() < 5: cur2 += timedelta(days=1)
    weekend = cur2

    # Daytime rate: ₹800
    assert calculate_slot_price(weekday, 10) == 800
    assert calculate_slot_price(weekend, 10) == 800

    # Weekday night: ₹1,000
    assert calculate_slot_price(weekday, 19) == 1000

    # Weekend night: ₹1,200
    assert calculate_slot_price(weekend, 19) == 1200

    # Boundary crossing calculation
    total, itemized, _ = calculate_booking_pricing("cricket", weekday, ["17:00", "18:00"])
    assert total == 1800  # 800 + 1000

    # Event quote required (0 base)
    total_ev, _, quote_req = calculate_booking_pricing("event", weekday, [])
    assert quote_req is True
    assert total_ev == 0.0

    # WhatsApp phone destination verification
    booking_sample = {
        "booking_type": "cricket",
        "reference": "PP-1234567",
        "customer_name": "John",
        "customer_phone": "9876543210",
        "booking_date": "2026-10-25",
        "start_time": "18:00",
        "end_time": "19:00",
        "duration_hours": 1,
        "total_price": 1000.0,
        "status": "pending_confirmation"
    }
    url = build_whatsapp_click_url(booking_sample)
    assert f"wa.me/{WHATSAPP_PHONE}" in url
    assert "PP-1234567" in url
    assert "Pending%20confirmation" in url or "Pending confirmation" in urllib.parse.unquote(url)


# ============================================================================
# TEST 17: Existing website design and responsive layout remain intact
# ============================================================================
def test_17_website_contracts_and_responsive_layout():
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    index_html = os.path.join(project_root, "index.html")
    with open(index_html, "r", encoding="utf-8") as f:
        html = f.read()

    # Verify essential IDs exist
    for element_id in [
        "bookingForm", "bookingType", "bookingDate", "customerName",
        "customerPhone", "slotGrid", "selectedPrice", "adminModal",
        "advancePaymentModal", "toast"
    ]:
        assert f'id="{element_id}"' in html, f"Missing {element_id}"

    # Verify CSS contains responsive & held styles
    css_path = os.path.join(project_root, "assets", "css", "main.css")
    with open(css_path, "r", encoding="utf-8") as f:
        css = f.read()

    assert ".slot-btn.is-held" in css
    assert ".legend-dot.held" in css
    assert ".badge-confirmed" in css
    assert "@media (max-width: 768px)" in css


# ============================================================================
# TEST 18: Booking Manager 6-Digit PIN Authentication (123456)
# ============================================================================
def test_18_booking_manager_pin_authentication():
    # 1. Login with correct 6-digit PIN: 123456
    res_correct = client.post("/api/admin/login", json={"pin": "123456"})
    assert res_correct.status_code == 200
    assert "token" in res_correct.json()

    # 2. Login with incorrect PIN
    res_incorrect = client.post("/api/admin/login", json={"pin": "999999"})
    assert res_incorrect.status_code == 401


# ============================================================================
# TEST 19: Forgot PIN with Owner WhatsApp Authentication & Reset
# ============================================================================
def test_19_forgot_pin_owner_whatsapp_verification_and_reset():
    from server.database import get_db_connection

    # 1. Request PIN recovery code
    req_res = client.post("/api/admin/forgot-pin/request")
    assert req_res.status_code == 200
    req_data = req_res.json()
    assert req_data["success"] is True
    assert WHATSAPP_PHONE in req_data["whatsapp_url"]
    req_id = req_data["request_id"]

    # 2. Submitting incorrect verification code fails
    verify_bad = client.post("/api/admin/forgot-pin/verify", json={
        "request_id": req_id,
        "code": "000000"
    })
    assert verify_bad.status_code == 400

    # 3. Retrieve actual code generated from database (simulates Owner reading WhatsApp)
    conn = get_db_connection()
    row = conn.execute("SELECT code FROM pin_recovery_requests WHERE id = ?", (req_id,)).fetchone()
    conn.close()
    assert row is not None
    real_code = row["code"]

    # 4. Verify with real code and set new PIN to '654321'
    verify_good = client.post("/api/admin/forgot-pin/verify", json={
        "request_id": req_id,
        "code": real_code,
        "new_pin": "654321"
    })
    assert verify_good.status_code == 200
    assert "token" in verify_good.json()

    # 5. Old PIN no longer works, new PIN works
    assert client.post("/api/admin/login", json={"pin": "123456"}).status_code == 401
    assert client.post("/api/admin/login", json={"pin": "654321"}).status_code == 200

    # 6. Reset PIN back to default 123456 for consistency
    client.post("/api/admin/pin/update", json={"new_pin": "123456"}, headers={"Authorization": f"Bearer {verify_good.json()['token']}"})
    assert client.post("/api/admin/login", json={"pin": "123456"}).status_code == 200

def test_20_confirmed_event_party_booking_blocks_availability():
    """
    Verifies that when an event/party booking is confirmed by owner,
    the requested slots (or whole day if flexible) are blocked from being booked by other users.
    """
    token = get_admin_token()
    event_date = get_future_date(8)

    # 1. Customer creates an event booking (flexible timing)
    req = client.post("/api/bookings", json={
        "booking_type": "event",
        "customer_name": "Wedding Reception Event",
        "customer_phone": "9701167899",
        "booking_date": event_date,
        "slots": [],
        "player_count": "50+ Guests",
        "event_details": {
            "start_time": "Flexible",
            "duration": "Full Day"
        }
    })
    assert req.status_code == 201
    b_id = req.json()["booking"]["id"]

    # 2. Before confirmation, slots are available (pending request doesn't block)
    avail_before = client.get(f"/api/availability?date={event_date}").json()
    assert any(s["available"] is True for s in avail_before["slots"])

    # 3. Owner confirms the event booking
    conf_res = client.post(f"/api/admin/bookings/{b_id}/confirm", json={}, headers={"Authorization": f"Bearer {token}"})
    assert conf_res.status_code == 200
    assert conf_res.json()["booking"]["status"] == "confirmed"

    # 4. After confirmation, all slots on this date are now booked and unavailable!
    avail_after = client.get(f"/api/availability?date={event_date}").json()
    assert all(s["available"] is False and s["status"] == "booked" for s in avail_after["slots"])


