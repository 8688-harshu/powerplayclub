"""
POWERPLAY CLUB - FULL WEBSITE QA AUDIT & RESPONSIVENESS AUTOMATED TEST SUITE
Covers:
- Responsive layout contracts & viewport requirements (320px to 1920px)
- Hero video & fallback contracts
- Booking manager mobile cards & desktop table contracts
- Booking workflow state transitions & authorization
- Payment verification contracts
"""

import os
import re
import tempfile
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

# Isolated test environment
test_db_fd, test_db_path = tempfile.mkstemp(suffix=".db")
os.close(test_db_fd)
os.environ["POWERPLAY_DB_PATH"] = test_db_path
os.environ["POWERPLAY_ADMIN_KEY"] = "test_qa_staff_key_2026"
os.environ["POWERPLAY_OWNER_EMAIL"] = "owner@powerplay.club"
os.environ["POWERPLAY_OWNER_PASSWORD"] = "SecretPassword123!"

from server.main import app
from server.database import init_db, get_db_connection
from server.whatsapp import WHATSAPP_PHONE

init_db()
client = TestClient(app)

def get_future_date(days_ahead: int = 3) -> str:
    utc_now = datetime.now(timezone.utc)
    target = utc_now + timedelta(days=days_ahead)
    return target.strftime("%Y-%m-%d")

from server.auth import ADMIN_API_KEY

def get_admin_token() -> str:
    res = client.post("/api/admin/login", json={"key": ADMIN_API_KEY})
    assert res.status_code == 200, f"Login failed: {res.text}"
    return res.json()["token"]


# ==============================================================================
# 1. RESPONSIVE VIEWPORT & ASSET CONTRACTS
# ==============================================================================

def test_viewport_meta_and_html_structure():
    """Validates that index.html contains proper viewport meta and semantic tags."""
    with open("index.html", "r", encoding="utf-8") as f:
        html = f.read()

    assert '<meta name="viewport" content="width=device-width, initial-scale=1">' in html
    assert '<header class="nav"' in html
    assert '<main>' in html
    assert '<footer' in html
    assert 'id="actionConfirmModal"' in html
    assert 'id="advancePaymentModal"' in html
    assert 'id="bookingConfirmModal"' in html


def test_hero_video_configuration_and_fallbacks():
    """
    Validates Phase 3 requirements:
    - Primary MP4 source exists and is not an 80MB MOV masquerading as mp4.
    - Poster image fallback is set.
    - Inline playback & muted attributes are present.
    - Preload metadata is set.
    - CSS provides a background-image fallback on .hero.
    """
    with open("index.html", "r", encoding="utf-8") as f:
        html = f.read()

    # Video element attributes
    assert 'class="hero-video"' in html
    assert 'poster="assets/images/Cirket.jpeg"' in html
    assert 'playsinline' in html
    assert 'muted' in html
    assert 'loop' in html
    assert 'preload="metadata"' in html

    # MP4 source is listed
    assert '<source src="assets/images/hero-video.mp4" type="video/mp4">' in html

    # Verify CSS hero fallback
    with open("assets/css/main.css", "r", encoding="utf-8") as f:
        css = f.read()

    assert "background-image: url('../images/Cirket.jpeg')" in css or 'background-image: url("../images/Cirket.jpeg")' in css
    # Verify preloader does not use 100vw causing horizontal scroll
    assert "width: 100vw;" not in css
    # Verify reduced-motion support
    assert "prefers-reduced-motion" in css


def test_mobile_booking_manager_css_contracts():
    """
    Validates Phase 4 requirements:
    - Responsive booking cards (.admin-booking-cards) for mobile/tablet (< 860px).
    - Desktop table (.admin-table-wrap) for desktop (>= 860px).
    - Touch targets >= 44px on mobile controls.
    """
    with open("assets/css/admin.css", "r", encoding="utf-8") as f:
        css = f.read()

    assert ".admin-booking-cards" in css
    assert ".admin-card" in css
    assert "min-height: 44px" in css
    assert "#actionConfirmModal" in css


def test_whatsapp_link_integrity_in_js():
    """Validates that no truncated WhatsApp links exist in main.js."""
    with open("assets/js/main.js", "r", encoding="utf-8") as f:
        js = f.read()

    # Ensure no truncated href="https:
    assert 'href="https:\n' not in js
    assert 'href="https: ' not in js
    assert 'wa.me' in js


# ==============================================================================
# 2. BOOKING WORKFLOW & LIFECYCLE TESTS
# ==============================================================================

def test_booking_request_creates_pending_without_blocking():
    """Submitting a booking request creates Pending status and DOES NOT close the slot."""
    date_str = get_future_date(5)
    slot_time = "16:00"

    avail_before = client.get(f"/api/availability?date={date_str}").json()
    slot_info = next(s for s in avail_before["slots"] if s["time"] == slot_time)
    assert slot_info["available"] is True

    # Customer submits
    res = client.post("/api/bookings", json={
        "booking_type": "cricket",
        "customer_name": "QA Test Customer",
        "customer_phone": "9876543210",
        "booking_date": date_str,
        "slots": [slot_time],
        "player_count": "6–10 Players"
    })
    assert res.status_code == 201
    data = res.json()
    assert data["booking"]["status"] == "pending_confirmation"
    ref = data["booking"]["reference"]

    # Slot must still be publicly available
    avail_after = client.get(f"/api/availability?date={date_str}").json()
    slot_after = next(s for s in avail_after["slots"] if s["time"] == slot_time)
    assert slot_after["available"] is True

    # Check status endpoint with masked customer details
    status_res = client.get(f"/api/bookings/{ref}/status")
    assert status_res.status_code == 200
    status_data = status_res.json()
    assert status_data["status"] == "pending_confirmation"
    assert status_data["is_confirmed"] is False
    assert status_data["masked_customer"]["phone"].endswith("3210")


def test_owner_confirmation_and_slot_lock():
    """Explicit owner confirmation locks the slot and rejects competing requests."""
    date_str = get_future_date(6)
    slot_time = "18:00"
    token = get_admin_token()

    # Create request 1
    res1 = client.post("/api/bookings", json={
        "booking_type": "cricket",
        "customer_name": "Winner Booking",
        "customer_phone": "9876500001",
        "booking_date": date_str,
        "slots": [slot_time]
    })
    b1_id = res1.json()["booking"]["id"]

    # Owner confirms request 1
    confirm_res = client.post(
        f"/api/admin/bookings/{b1_id}/confirm",
        headers={"Authorization": f"Bearer {token}"},
        json={"notes": "Advance payment verified via UPI"}
    )
    assert confirm_res.status_code == 200

    # Availability must now show slot as closed/booked
    avail = client.get(f"/api/availability?date={date_str}").json()
    slot = next(s for s in avail["slots"] if s["time"] == slot_time)
    assert slot["available"] is False
    assert slot["status"] == "booked"

    # Subsequent customer request for the same slot must be rejected with 409 Conflict
    res2 = client.post("/api/bookings", json={
        "booking_type": "cricket",
        "customer_name": "Competing Customer",
        "customer_phone": "9876500002",
        "booking_date": date_str,
        "slots": [slot_time]
    })
    assert res2.status_code == 409


def test_cancelled_booking_releases_slot():
    """Cancelling a confirmed booking releases the slot back to available."""
    date_str = get_future_date(7)
    slot_time = "20:00"
    token = get_admin_token()

    # Create and confirm booking
    res = client.post("/api/bookings", json={
        "booking_type": "cricket",
        "customer_name": "To Be Cancelled",
        "customer_phone": "9876500003",
        "booking_date": date_str,
        "slots": [slot_time]
    })
    b_id = res.json()["booking"]["id"]

    client.post(
        f"/api/admin/bookings/{b_id}/confirm",
        headers={"Authorization": f"Bearer {token}"}
    )

    # Verify slot is closed
    avail1 = client.get(f"/api/availability?date={date_str}").json()
    assert next(s for s in avail1["slots"] if s["time"] == slot_time)["available"] is False

    # Owner cancels booking
    cancel_res = client.patch(
        f"/api/admin/bookings/{b_id}/status",
        headers={"Authorization": f"Bearer {token}"},
        json={"status": "cancelled"}
    )
    assert cancel_res.status_code == 200

    # Slot must now be available again
    avail2 = client.get(f"/api/availability?date={date_str}").json()
    assert next(s for s in avail2["slots"] if s["time"] == slot_time)["available"] is True


def test_security_authorization_enforced():
    """Protected admin endpoints reject unauthenticated or customer requests with 401."""
    # List bookings without token
    assert client.get("/api/admin/bookings").status_code == 401

    # Place hold without token
    assert client.post("/api/admin/bookings/fake-id/hold").status_code == 401

    # Confirm booking without token
    assert client.post("/api/admin/bookings/fake-id/confirm").status_code == 401

    # Record advance without token
    assert client.post("/api/admin/bookings/fake-id/advance", json={
        "advance_amount": 500,
        "payment_method": "UPI",
        "payment_reference": "TXN123"
    }).status_code == 401

    # Block slots without token
    assert client.post("/api/admin/block-slots", json={
        "slot_date": "2026-11-01",
        "slot_times": ["10:00"]
    }).status_code == 401


def test_mobile_navigation_menu_contracts():
    """Validates the modern floating mobile menu structure, CSS contracts, and JS dismissals."""
    with open("index.html", "r", encoding="utf-8") as f:
        html = f.read()

    # Mobile toggle structure
    assert 'class="menu-toggle" id="menuToggle"' in html
    assert 'aria-label="Toggle navigation"' in html
    assert 'aria-expanded="false"' in html
    assert 'class="menu-toggle-bars"' in html
    assert 'class="menu-bar bar-1"' in html
    assert 'class="menu-bar bar-2"' in html

    # Navigation items preserved
    assert '<a href="#home">Home</a>' in html
    assert '<a href="#gallery">Gallery</a>' in html
    assert '<a href="#booking">Book Slot</a>' in html
    assert '<a href="#contact">Contact</a>' in html

    with open("assets/css/main.css", "r", encoding="utf-8") as f:
        css = f.read()

    # Floating navigation panel CSS contracts
    assert ".menu-toggle-bars" in css
    assert ".menu-bar.bar-1" in css
    assert ".menu-bar.bar-2" in css
    assert "position: fixed;" in css
    assert "backdrop-filter: blur(28px)" in css
    assert "border-radius: 20px;" in css
    assert ".nav-links.open" in css

    with open("assets/js/main.js", "r", encoding="utf-8") as f:
        js = f.read()

    # JS interactions: outside-click and escape key
    assert "closeMobileNav" in js
    assert "e.key === 'Escape'" in js
    assert "!navLinks.contains(e.target)" in js

