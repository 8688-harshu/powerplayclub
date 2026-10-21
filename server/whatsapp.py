"""
POWERPLAY CLUB - Centralized WhatsApp Click-to-Chat Integration
Standard Destination: +91 97011 67899
Format: https://wa.me/919701167899?text=URL_ENCODED_MESSAGE
"""

import os
import urllib.parse
from typing import Dict, Any, List, Optional

WHATSAPP_PHONE = os.environ.get("WHATSAPP_PHONE", "919701167899")
WHATSAPP_DISPLAY_PHONE = os.environ.get("WHATSAPP_DISPLAY_PHONE", "+91 97011 67899")
VENUE_NAME = "PowerPlay Club Bhimavaram"

def format_hour_12h(hour: int) -> str:
    """Formats an hour 0-23 into 12-hour AM/PM format."""
    h = hour % 24
    suffix = "PM" if h >= 12 else "AM"
    display = h % 12 or 12
    return f"{display}:00 {suffix}"

def build_whatsapp_message(
    booking: Dict[str, Any],
    itemized_slots: Optional[List[Dict[str, Any]]] = None
) -> str:
    """
    Constructs the clean, authoritative WhatsApp text payload for customer handoff.
    Never uses placeholders; populates real validated server data.
    """
    booking_type = booking.get("booking_type", "cricket")
    ref = booking.get("reference", "PP-UNKNOWN")
    name = booking.get("customer_name", "Valued Customer")
    phone = booking.get("customer_phone", "")
    date_str = str(booking.get("booking_date", ""))
    player_count = booking.get("player_count", "6–10 Players")
    notes = booking.get("notes", "").strip()
    status_raw = booking.get("status", "pending_confirmation")
    status_label = "Pending confirmation (Awaiting advance payment verification)" if status_raw == "pending_confirmation" else status_raw.replace("_", " ").capitalize()

    if booking_type == "cricket":
        start_time = str(booking.get("start_time", ""))[:5]
        end_time = str(booking.get("end_time", ""))[:5]
        duration_hrs = booking.get("duration_hours", 1)
        total_price = booking.get("total_price", 0)

        slots_text = ""
        if itemized_slots:
            slots_lines = []
            for s in itemized_slots:
                h = s["hour"]
                slots_lines.append(f"  • {format_hour_12h(h)} – {format_hour_12h((h + 1) % 24)} (₹{s['price']})")
            slots_text = "\n" + "\n".join(slots_lines)
        else:
            slots_text = f" {start_time} to {end_time}"

        msg = (
            f"Hello PowerPlay Club!\n\n"
            f"I would like to request a Box Cricket booking.\n\n"
            f"Booking ID: {ref}\n"
            f"Name: {name}\n"
            f"Phone: {phone}\n"
            f"Date: {date_str}\n"
            f"Duration: {duration_hrs} hr{'s' if duration_hrs > 1 else ''}\n"
            f"Slots:{slots_text}\n"
            f"Squad Size: {player_count}\n"
            f"Total Price: ₹{int(total_price):,}\n"
            f"Status: {status_label}\n"
            f"Notes: {notes if notes else 'None'}\n\n"
            f"Please check slot availability and share advance payment details to confirm.\n"
            f"Thank you!"
        )
    else:
        event_details = booking.get("event_details") or {}
        if isinstance(event_details, str):
            try:
                import json
                event_details = json.loads(event_details)
            except Exception:
                event_details = {}

        preferred_start = event_details.get("start_time", "Flexible")
        event_duration = event_details.get("duration", "2 Hours")
        end_date = event_details.get("end_date", "")
        addons = event_details.get("addons", [])

        type_labels = {
            "event": "Birthday / Private Event",
            "tournament": "Tournament Enquiry",
            "general": "General Enquiry"
        }
        event_label = type_labels.get(booking_type, "Private Event")

        addons_text = ", ".join(addons) if addons else "None requested"

        msg = (
            f"Hello PowerPlay Club!\n\n"
            f"I would like to plan an event at PowerPlay.\n\n"
            f"Booking ID: {ref}\n"
            f"Event Type: {event_label}\n"
            f"Name: {name}\n"
            f"Phone: {phone}\n"
            f"Event Date: {date_str}\n"
            + (f"End Date: {end_date}\n" if end_date else "") +
            f"Preferred Start: {preferred_start}\n"
            f"Estimated Duration: {event_duration}\n"
            f"Guests / Squad: {player_count}\n"
            f"Add-Ons: {addons_text}\n"
            f"Estimated Price: Custom Quote on Request\n"
            f"Status: {status_label}\n"
            f"Special Notes: {notes if notes else 'None'}\n\n"
            f"Please verify availability and send a custom quote.\n"
            f"Thank you!"
        )

    return msg

def build_whatsapp_click_url(
    booking: Dict[str, Any],
    itemized_slots: Optional[List[Dict[str, Any]]] = None
) -> str:
    """
    Builds the safe click-to-chat URL with percent-encoded query parameters.
    """
    msg = build_whatsapp_message(booking, itemized_slots)
    encoded_text = urllib.parse.quote(msg)
    return f"https://wa.me/{WHATSAPP_PHONE}?text={encoded_text}"
