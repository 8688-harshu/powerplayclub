"""
POWERPLAY CLUB - Authoritative Server-Side Pricing Engine
Exact Match with Business Rules:
- Daytime (06:00 - 17:59): ₹800 / hour
- Weekday Night (18:00 - 05:59 Mon-Fri): ₹1,000 / hour
- Weekend Night (18:00 - 05:59 Sat-Sun): ₹1,200 / hour
- Events / Tournaments: Custom Quote (₹0 base, quote_required = True)
"""

from datetime import datetime, date, time
from typing import List, Dict, Any, Tuple

DAY_RATE = 800
WEEKDAY_NIGHT_RATE = 1000
WEEKEND_NIGHT_RATE = 1200

KNOWN_ADDONS = {
    "Sound System",
    "Catering / Snacks",
    "Decorations",
    "Photography",
    "Live Streaming",
    "Trophy & Certificates",
    "Umpire Provided",
    "Equipment Rental",
}

def is_night_hour(hour: int) -> bool:
    """Returns True if the hour falls into the night window (18:00 to 05:59)."""
    return hour >= 18 or hour < 6

def is_weekend_date(target_date: date) -> bool:
    """Returns True if target_date is Saturday (5) or Sunday (6)."""
    return target_date.weekday() in (5, 6)

def calculate_slot_price(slot_date: date, slot_hour: int) -> int:
    """
    Calculates authoritative price for a single 1-hour interval starting at slot_hour.
    - Daytime (6am - 6pm): ₹800
    - Night Weekday: ₹1,000
    - Night Weekend: ₹1,200
    """
    if not (0 <= slot_hour <= 23):
        raise ValueError(f"Invalid slot hour: {slot_hour}. Must be between 0 and 23.")

    if not is_night_hour(slot_hour):
        return DAY_RATE
    
    if is_weekend_date(slot_date):
        return WEEKEND_NIGHT_RATE
    
    return WEEKDAY_NIGHT_RATE

def calculate_booking_pricing(
    booking_type: str,
    booking_date: date,
    slots: List[str]
) -> Tuple[int, List[Dict[str, Any]], bool]:
    """
    Calculates authoritative itemized price for a list of hourly slots.
    Input slots: List of time strings like ['16:00', '17:00', '18:00'].
    Returns: (total_price, itemized_slots, quote_required)
    """
    if booking_type in ("event", "tournament", "general"):
        return 0, [], True

    if not slots:
        raise ValueError("At least one time slot is required for Box Cricket bookings.")

    itemized = []
    total = 0

    sorted_slots = sorted(slots)

    for slot_str in sorted_slots:
        parts = slot_str.split(":")
        if len(parts) < 2:
            raise ValueError(f"Invalid time format: {slot_str}. Expected 'HH:MM'.")
        hour = int(parts[0])
        minute = int(parts[1])
        if minute != 0:
            raise ValueError(f"Slots must be on the hour. Got: {slot_str}")

        price = calculate_slot_price(booking_date, hour)
        total += price

        is_night = is_night_hour(hour)
        is_weekend = is_weekend_date(booking_date)
        period_label = "Day" if not is_night else ("Weekend Night" if is_weekend else "Weekday Night")

        itemized.append({
            "slot_time": f"{hour:02d}:00",
            "end_time": f"{(hour + 1) % 24:02d}:00",
            "hour": hour,
            "price": price,
            "period": period_label
        })

    return total, itemized, False
