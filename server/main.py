"""
POWERPLAY CLUB - Production Booking Server
FastAPI Server delivering:
- Availability checks calculated from central database
- Server-side authoritative pricing
- Atomic reservation protection against concurrent overbooking
- WhatsApp click-to-chat deep link generation
- Secure staff admin APIs with authentication
- Static asset serving for zero-friction local development
"""

import os
import re
import io
import csv
import urllib.parse
from datetime import datetime, date, timezone, timedelta
from typing import List, Optional, Dict, Any

from fastapi import FastAPI, HTTPException, status, Depends, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field, field_validator

from server.pricing import calculate_booking_pricing, calculate_slot_price, KNOWN_ADDONS
from server.whatsapp import build_whatsapp_click_url, build_whatsapp_message, WHATSAPP_PHONE, WHATSAPP_DISPLAY_PHONE
from server.database import (
    init_db,
    check_date_availability,
    create_booking_atomic,
    get_booking_by_ref,
    update_booking_status,
    list_admin_bookings,
    place_temporary_hold,
    record_advance_details,
    confirm_booking_atomic,
    confirm_manual_booking,
    get_blocked_slots,
    set_slot_blocked,
    set_slot_unblocked,
    unblock_all_slots_for_date,
    SlotUnavailableError,
    BookingNotFoundError,
    create_pin_recovery_code,
    verify_and_consume_recovery_code,
    set_booking_manager_pin,
    get_booking_manager_pin,
)
from server.auth import (
    require_staff_auth,
    verify_admin_token,
    verify_admin_credentials,
    generate_staff_session_token,
)

init_db()

app = FastAPI(
    title="PowerPlay Club Booking API",
    version="1.0.0",
    description="Production-ready booking backend for PowerPlay Club Bhimavaram",
)

ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PHONE_REGEX = re.compile(r"^\+?[0-9\s\-()]{10,16}$")


class BookingRequest(BaseModel):
    booking_type: str = Field(..., description="cricket, event, tournament, or general")
    customer_name: str = Field(..., min_length=2, max_length=120)
    customer_phone: str = Field(..., min_length=10, max_length=16)
    booking_date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    slots: List[str] = Field(default_factory=list, description="List of 'HH:00' time strings")
    player_count: str = Field(default="6–10 Players")
    notes: Optional[str] = Field(default="", max_length=1000)
    event_details: Optional[Dict[str, Any]] = Field(default_factory=dict)
    idempotency_key: Optional[str] = Field(default=None, max_length=64)

    @field_validator("customer_name")
    def validate_name(cls, v: str) -> str:
        cleaned = v.strip()
        if len(cleaned) < 2:
            raise ValueError("Customer name must be at least 2 characters.")
        if "<" in cleaned or ">" in cleaned:
            raise ValueError("Customer name cannot contain HTML characters.")
        return cleaned

    @field_validator("customer_phone")
    def validate_phone(cls, v: str) -> str:
        cleaned = re.sub(r"[\s\-()]", "", v.strip())
        digits_only = cleaned.lstrip("+")
        if not (10 <= len(digits_only) <= 15 and digits_only.isdigit()):
            raise ValueError("Please provide a valid phone number (10 to 15 digits).")
        return v.strip()

    @field_validator("booking_type")
    def validate_type(cls, v: str) -> str:
        normalized = v.lower().strip()
        if "cricket" in normalized:
            return "cricket"
        elif "tournament" in normalized:
            return "tournament"
        elif "event" in normalized:
            return "event"
        return "general"

class StatusUpdateRequest(BaseModel):
    status: str = Field(..., pattern=r"^(pending_confirmation|awaiting_advance|payment_received|confirmed|rejected|cancelled|expired)$")

class HoldRequest(BaseModel):
    hold_minutes: Optional[int] = None
    hold_duration_minutes: Optional[int] = None

    @property
    def minutes(self) -> int:
        if self.hold_duration_minutes is not None:
            return self.hold_duration_minutes
        if self.hold_minutes is not None:
            return self.hold_minutes
        return 15

class AdvancePaymentRequest(BaseModel):
    advance_amount: float = Field(..., ge=0)
    payment_method: str = Field(..., min_length=2, max_length=32)
    payment_reference: str = Field(..., min_length=2, max_length=128)
    verified: bool = Field(default=False)
    payment_verified: Optional[bool] = None

    @property
    def is_verified(self) -> bool:
        if self.payment_verified is not None:
            return bool(self.payment_verified)
        return bool(self.verified)

class ConfirmBookingRequest(BaseModel):
    advance_amount: Optional[float] = None
    payment_method: Optional[str] = None
    payment_reference: Optional[str] = None

class AdminLoginRequest(BaseModel):
    email:    Optional[str] = None
    password: Optional[str] = None
    key: Optional[str] = None
    pin: Optional[str] = None

class ManualBookingRequest(BaseModel):
    booking_type: str = Field(..., description="cricket, event, tournament, or general")
    customer_name: str = Field(..., min_length=1, max_length=120)
    customer_phone: str = Field(..., min_length=10, max_length=16)
    booking_date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    slots: List[str] = Field(..., min_length=1, description="List of HH:00 slot strings")
    total_price: float = Field(0.0, ge=0)
    player_count: str = "Walk-in"
    notes: str = ""
    advance_amount: float = 0.0
    payment_method: str = "Cash"
    payment_reference: str = ""

class BlockSlotsRequest(BaseModel):
    slot_date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    slot_times: List[str] = Field(..., min_length=1, description="List of HH:00 slot strings")
    reason: str = "Blocked by Owner"

class UnblockSlotsRequest(BaseModel):
    slot_date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    slot_times: Optional[List[str]] = None  # None = unblock all for date

class VerifyForgotPinRequest(BaseModel):
    request_id: str
    code: str
    new_pin: Optional[str] = None

class UpdatePinRequest(BaseModel):
    new_pin: str = Field(..., pattern=r"^\d{6}$")

def get_current_ist_date() -> date:
    utc_now = datetime.now(timezone.utc)
    ist_now = utc_now + timedelta(hours=5, minutes=30)
    return ist_now.date()

def mask_customer_info(name: str, phone: str) -> Dict[str, str]:
    parts = name.split()
    masked_name = " ".join([p[0] + "*" * max(1, len(p) - 1) for p in parts]) if parts else "Customer"
    digits = re.sub(r"\D", "", phone)
    masked_phone = ("*" * max(0, len(digits) - 4)) + digits[-4:] if len(digits) >= 4 else "****"
    return {"name": masked_name, "phone": masked_phone}


@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "service": "powerplay-booking-api",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "venue": "PowerPlay Club, Bhimavaram",
        "whatsapp_destination": WHATSAPP_PHONE
    }

@app.get("/api/availability")
def get_availability(date_str: str = Query(..., alias="date", pattern=r"^\d{4}-\d{2}-\d{2}$")):
    """
    Returns real-time availability for all 24 slots on date_str.
    Calculated directly from the central database.
    """
    try:
        target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Expected YYYY-MM-DD.")

    current_date = get_current_ist_date()
    if target_date < current_date:
        raise HTTPException(
            status_code=400,
            detail=f"Past dates cannot be queried or booked. Today is {current_date.isoformat()}."
        )

    slots = check_date_availability(date_str)
    
    for s in slots:
        s["price"] = calculate_slot_price(target_date, s["hour"])

    return {
        "date": date_str,
        "is_weekend": target_date.weekday() in (5, 6),
        "day_rate": 800,
        "night_rate": 1200 if target_date.weekday() in (5, 6) else 1000,
        "slots": slots
    }

@app.post("/api/bookings", status_code=status.HTTP_201_CREATED)
def create_booking(req: BookingRequest):
    """
    Validates, calculates authoritative server price, checks availability,
    and atomically creates a pending booking with a WhatsApp handoff link.
    """
    try:
        target_date = datetime.strptime(req.booking_date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Expected YYYY-MM-DD.")

    current_date = get_current_ist_date()
    if target_date < current_date:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot book past dates. Today is {current_date.isoformat()}."
        )

    if req.booking_type == "cricket":
        if not req.slots:
            raise HTTPException(status_code=400, detail="Please select at least one hourly time slot.")
        
        if target_date == current_date:
            ist_now = datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)
            cur_hour = ist_now.hour
            for s in req.slots:
                h = int(s.split(":")[0])
                if h < cur_hour:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Slot {s} has already passed for today. Please select current or future hours."
                    )

    try:
        total_price, itemized_slots, quote_required = calculate_booking_pricing(
            req.booking_type,
            target_date,
            req.slots
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        booking_record = create_booking_atomic(
            booking_type=req.booking_type,
            customer_name=req.customer_name,
            customer_phone=req.customer_phone,
            booking_date=req.booking_date,
            slots=req.slots,
            total_price=float(total_price),
            player_count=req.player_count,
            notes=req.notes or "",
            event_details=req.event_details or {},
            idempotency_key=req.idempotency_key,
        )
    except SlotUnavailableError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": str(e),
                "conflicts": e.conflicted_slots
            }
        )

    wa_msg = build_whatsapp_message(booking_record, itemized_slots)
    wa_url = build_whatsapp_click_url(booking_record, itemized_slots)

    return {
        "success": True,
        "message": "Booking request recorded as Pending Confirmation.",
        "booking": {
            "id": booking_record["id"],
            "reference": booking_record["reference"],
            "status": booking_record["status"],
            "booking_type": booking_record["booking_type"],
            "booking_date": booking_record["booking_date"],
            "start_time": booking_record["start_time"],
            "end_time": booking_record["end_time"],
            "duration_hours": booking_record["duration_hours"],
            "total_price": booking_record["total_price"],
            "quote_required": quote_required,
            "created_at": booking_record["created_at"],
        },
        "itemized_slots": itemized_slots,
        "whatsapp": {
            "destination": WHATSAPP_PHONE,
            "url": wa_url,
            "message": wa_msg,
            "instruction": "Please send the prepared WhatsApp message to PowerPlay Club. Your slot is not confirmed until the owner approves your booking and verifies the agreed advance payment."
        }
    }

@app.get("/api/bookings/{reference}/status")
def get_booking_status(reference: str):
    """
    Public lookup by booking reference.
    Returns status without leaking full customer telephone or private records.
    """
    record = get_booking_by_ref(reference.strip().upper())
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Booking reference '{reference}' not found."
        )

    masked = mask_customer_info(record["customer_name"], record["customer_phone"])

    return {
        "reference": record["reference"],
        "status": record["status"],
        "is_confirmed": record["status"] == "confirmed",
        "booking_type": record["booking_type"],
        "booking_date": record["booking_date"],
        "start_time": record["start_time"],
        "end_time": record["end_time"],
        "duration_hours": record["duration_hours"],
        "total_price": record["total_price"],
        "advance_amount": record.get("advance_amount", 0.0),
        "payment_verified": bool(record.get("payment_verified", False)),
        "hold_expires_at": record.get("hold_expires_at"),
        "masked_customer": masked,
        "created_at": record["created_at"]
    }


@app.post("/api/admin/login")
def admin_login(payload: AdminLoginRequest):
    """Authenticates the owner using Gmail + password, PIN, or staff key."""
    if payload.key and verify_admin_token(payload.key):
        token = generate_staff_session_token()
        return {"token": token, "expires_in_hours": 12}
    if payload.pin and get_booking_manager_pin() == payload.pin:
        token = generate_staff_session_token()
        return {"token": token, "expires_in_hours": 12}
    email    = (payload.email or "").strip()
    password = (payload.password or "").strip()
    if not verify_admin_credentials(email, password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password."
        )
    token = generate_staff_session_token()
    return {"token": token, "expires_in_hours": 12}

@app.post("/api/admin/forgot-pin/request")
def request_pin_recovery():
    """
    Owner action: Initiates Forgot PIN recovery by generating a 6-digit OTP
    and returning a prefilled WhatsApp link addressed to the owner (+91 97011 67899).
    """
    recovery = create_pin_recovery_code(expiry_minutes=10)
    code = recovery["code"]
    req_id = recovery["request_id"]

    msg = (
        f"Hello PowerPlay Club Owner!\n\n"
        f"A request was made to unlock / reset the Booking Manager PIN.\n\n"
        f"Owner Verification Code: {code}\n"
        f"Valid for: 10 minutes\n\n"
        f"Please share this code to verify your identity and authorize access."
    )
    encoded = urllib.parse.quote(msg)
    wa_url = f"https://wa.me/{WHATSAPP_PHONE}?text={encoded}"

    return {
        "success": True,
        "request_id": req_id,
        "whatsapp_url": wa_url,
        "owner_phone": WHATSAPP_DISPLAY_PHONE,
        "expires_in_minutes": recovery["expires_in_minutes"],
        "message": "Verification request created. Please open WhatsApp to verify with the owner."
    }

@app.post("/api/admin/forgot-pin/verify")
def verify_pin_recovery(payload: VerifyForgotPinRequest):
    """
    Owner action: Verifies the 6-digit code received via Owner WhatsApp.
    Unlocks portal and optionally updates the 6-digit PIN.
    """
    valid = verify_and_consume_recovery_code(payload.request_id, payload.code)
    if not valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired verification code. Please request a new code on WhatsApp."
        )

    if payload.new_pin:
        clean_new_pin = payload.new_pin.strip()
        if not (len(clean_new_pin) == 6 and clean_new_pin.isdigit()):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="New PIN must be exactly 6 digits."
            )
        set_booking_manager_pin(clean_new_pin)

    token = generate_staff_session_token()
    return {
        "success": True,
        "token": token,
        "message": "Owner WhatsApp authentication verified. Booking Manager unlocked."
    }

@app.post("/api/admin/pin/update")
def update_pin(payload: UpdatePinRequest, _token: str = Depends(require_staff_auth)):
    """Allows authenticated staff to change the 6-digit PIN."""
    set_booking_manager_pin(payload.new_pin.strip())
    return {"success": True, "message": "Booking Manager PIN updated successfully."}

@app.post("/api/admin/manual-booking")
def create_manual_booking(
    payload: ManualBookingRequest,
    _token: str = Depends(require_staff_auth)
):
    """Owner action: Immediately confirms a walk-in/offline booking and locks the slots."""
    try:
        booking = confirm_manual_booking(
            booking_type=payload.booking_type,
            customer_name=payload.customer_name,
            customer_phone=payload.customer_phone,
            booking_date=payload.booking_date,
            slots=payload.slots,
            total_price=payload.total_price,
            player_count=payload.player_count,
            notes=payload.notes,
            advance_amount=payload.advance_amount,
            payment_method=payload.payment_method,
            payment_reference=payload.payment_reference,
        )
        return {"success": True, "booking": booking}
    except SlotUnavailableError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/admin/blocked-slots")
def fetch_blocked_slots(
    date: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
    _token: str = Depends(require_staff_auth)
):
    """Returns the list of owner-blocked slots for a given date."""
    return {"date": date, "blocked": get_blocked_slots(date)}

@app.post("/api/admin/block-slots")
def block_slots(
    payload: BlockSlotsRequest,
    _token: str = Depends(require_staff_auth)
):
    """Owner action: Blocks one or more time slots on a date (e.g. for private events or maintenance)."""
    count = set_slot_blocked(payload.slot_date, payload.slot_times, payload.reason)
    return {"success": True, "blocked_count": count, "message": f"{count} slot(s) blocked."}

@app.post("/api/admin/unblock-slots")
def unblock_slots(
    payload: UnblockSlotsRequest,
    _token: str = Depends(require_staff_auth)
):
    """Owner action: Unblocks specific or all slots for a date."""
    if payload.slot_times:
        count = set_slot_unblocked(payload.slot_date, payload.slot_times)
    else:
        count = unblock_all_slots_for_date(payload.slot_date)
    return {"success": True, "unblocked_count": count, "message": f"{count} slot(s) unblocked."}

@app.get("/api/admin/bookings")
def get_admin_bookings(
    date: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    _token: str = Depends(require_staff_auth)
):
    """Lists bookings with staff privileges."""
    return list_admin_bookings(date_filter=date, status_filter=status, search_query=search)

@app.post("/api/admin/bookings/{booking_id}/hold")
def admin_place_hold(
    booking_id: str,
    payload: HoldRequest = HoldRequest(),
    _token: str = Depends(require_staff_auth)
):
    """Owner action: Places a temporary hold (e.g. 15 mins) while awaiting advance payment."""
    try:
        updated = place_temporary_hold(booking_id, payload.minutes)
        return {"success": True, "booking": updated}
    except BookingNotFoundError:
        raise HTTPException(status_code=404, detail=f"Booking {booking_id} not found.")
    except SlotUnavailableError as e:
        raise HTTPException(status_code=409, detail=str(e))

@app.post("/api/admin/bookings/{booking_id}/advance")
def admin_record_advance(
    booking_id: str,
    payload: AdvancePaymentRequest,
    _token: str = Depends(require_staff_auth)
):
    """Owner action: Records the advance payment details received from customer."""
    try:
        updated = record_advance_details(
            booking_id,
            advance_amount=payload.advance_amount,
            payment_method=payload.payment_method,
            payment_reference=payload.payment_reference,
            verified=payload.is_verified
        )
        return {"success": True, "booking": updated}
    except BookingNotFoundError:
        raise HTTPException(status_code=404, detail=f"Booking {booking_id} not found.")

@app.post("/api/admin/bookings/{booking_id}/confirm")
def admin_confirm_booking(
    booking_id: str,
    payload: ConfirmBookingRequest = ConfirmBookingRequest(),
    _token: str = Depends(require_staff_auth)
):
    """Owner action: Explicitly approves booking and permanently reserves the slot after advance verification."""
    try:
        updated = confirm_booking_atomic(
            booking_id,
            advance_amount=payload.advance_amount,
            payment_method=payload.payment_method,
            payment_reference=payload.payment_reference
        )
        return {"success": True, "booking": updated}
    except BookingNotFoundError:
        raise HTTPException(status_code=404, detail=f"Booking {booking_id} not found.")
    except SlotUnavailableError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.patch("/api/admin/bookings/{booking_id}/status")
def update_status(
    booking_id: str,
    payload: StatusUpdateRequest,
    _token: str = Depends(require_staff_auth)
):
    """Updates booking status (awaiting_advance, payment_received, confirmed, cancelled, rejected)."""
    try:
        updated = update_booking_status(booking_id, payload.status)
        return {"success": True, "booking": updated}
    except BookingNotFoundError:
        raise HTTPException(status_code=404, detail=f"Booking {booking_id} not found.")
    except SlotUnavailableError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/admin/export")
def export_csv(
    date: Optional[str] = None,
    status: Optional[str] = None,
    _token: str = Depends(require_staff_auth)
):
    """Exports bookings to standard CSV including advance payment audit details."""
    bookings = list_admin_bookings(date_filter=date, status_filter=status)
    output = io.StringIO()
    writer = csv.writer(output)

    headers = [
        "reference", "created_at", "status", "booking_type", "customer_name",
        "customer_phone", "booking_date", "start_time", "end_time",
        "duration_hours", "player_count", "total_price", "advance_amount",
        "payment_method", "payment_reference", "payment_verified",
        "hold_expires_at", "notes"
    ]
    writer.writerow(headers)

    for b in bookings:
        writer.writerow([
            b.get("reference", ""),
            b.get("created_at", ""),
            b.get("status", ""),
            b.get("booking_type", ""),
            b.get("customer_name", ""),
            b.get("customer_phone", ""),
            b.get("booking_date", ""),
            b.get("start_time", ""),
            b.get("end_time", ""),
            b.get("duration_hours", ""),
            b.get("player_count", ""),
            b.get("total_price", ""),
            b.get("advance_amount", 0.0),
            b.get("payment_method", ""),
            b.get("payment_reference", ""),
            b.get("payment_verified", 0),
            b.get("hold_expires_at", ""),
            b.get("notes", ""),
        ])

    today_str = datetime.now().strftime("%Y-%m-%d")
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=powerplay-bookings-{today_str}.csv"}
    )

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ASSETS_DIR = os.path.join(PROJECT_ROOT, "assets")

if os.path.isdir(ASSETS_DIR):
    app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")

@app.get("/")
def serve_index():
    index_file = os.path.join(PROJECT_ROOT, "index.html")
    if os.path.isfile(index_file):
        return FileResponse(index_file)
    return {"message": "PowerPlay Club Backend Running."}
