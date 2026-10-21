# POWERPLAY CLUB — Owner-Controlled Booking Backend & Platform

A high-performance sports and events web platform for **PowerPlay Club, Bhimavaram** (Opposite SRKR Engineering College). Features a responsive dark athletic interface, 24/7 dynamic slot picker, authoritative server-side pricing engine, central database persistence with concurrency protection, WhatsApp click-to-chat integration, and a secure owner booking & advance payment confirmation manager.

---

## 1. System Architecture

```
powerplay-club-website/
├── index.html                                 # Semantic frontend landing page, slot picker & owner modals
├── README.md                                  # Complete architecture & deployment guide
├── .env.example                               # Environment template with security instructions
├── .gitignore                                 # Prevents secrets & databases from being tracked
├── server/
│   ├── main.py                                # FastAPI production booking server & API endpoints
│   ├── database.py                            # Atomic DB layer, owner confirmations, holds & cleanup
│   ├── pricing.py                             # Authoritative server-side pricing engine
│   ├── whatsapp.py                            # Centralized WhatsApp click-to-chat URL generator
│   └── auth.py                                # Constant-time staff token verification & hashing
├── supabase/
│   ├── migrations/
│   │   ├── 20261020000000_powerplay_booking_schema.sql         # Base Supabase PostgreSQL schema
│   │   └── 20261020000001_owner_controlled_booking_lifecycle.sql # Owner-controlled lifecycle migration
│   └── functions/
│       └── booking-api/
│           └── index.ts                       # Supabase Edge Function (Deno / TypeScript)
├── tests/
│   └── test_booking_backend.py                # Automated test suite covering all 17 owner-controlled scenarios
└── assets/
    ├── css/
    │   └── main.css                           # Athletic design system, hold badges & responsive styling
    ├── js/
    │   ├── main.js                            # Frontend controller, live API, owner actions & WhatsApp
    │   ├── arena3d.js                         # Three.js 3D cricket stadium & equipment module
    │   └── three.min.js                       # Local offline copy of Three.js r128
    └── images/                                # High-resolution venue & cricket photographs
```

---

## 2. Root Cause of Premature Slot Closure & The Fix

### The Problem
Previously, a slot was prematurely closed whenever a customer submitted a booking request or opened WhatsApp. This happened because:
1. The database had a partial unique index on `booking_slots(slot_date, slot_time)` for `status IN ('pending', 'contacted', 'confirmed')`.
2. As soon as a customer clicked "Book Slot", a pending row was inserted into `booking_slots`, permanently blocking all other customers and rendering the slot as "Booked" before the owner ever reviewed the request or verified payment.

### The Correct Business Workflow
1. **Customer Submits Request**: Creates a booking in status `pending_confirmation`. **This does not reserve or block the slot.** Competing customers can still request the same slot.
2. **WhatsApp Opens**: Prefilled message to PowerPlay Club (`+91 97011 67899`) contains booking reference and requests owner verification.
3. **Owner Discussion & Negotiation**: Owner and customer discuss availability and advance payment on WhatsApp.
4. **Temporary Hold (Optional)**: Owner can explicitly place a temporary hold (e.g. 15 minutes) while awaiting payment (`awaiting_advance`). This hold blocks the slot only until `hold_expires_at`.
5. **Record Advance Payment**: Owner records the advance amount, payment method (UPI, PhonePe, Google Pay, Bank Transfer, Cash), and transaction reference/UTR. Status moves to `payment_received`.
6. **Owner Confirms Booking**: Owner clicks **"✓ Confirm Booking"** only after verifying payment.
7. **Atomic Reservation**: The backend atomically transitions the booking to `confirmed`, locks the slot, and sets `booking_slots.status = 'confirmed'`. Only now does the slot show **Booked** across all devices. Any unconfirmed competing requests for that slot are automatically rejected.

---

## 3. Booking Status Lifecycle

| Status | Meaning | Slot Availability Impact |
|:---|:---|:---|
| `pending_confirmation` | Customer request received; awaiting owner review. | **Available** (Does not block slot). |
| `awaiting_advance` | Owner contacted customer and placed temporary hold or requested advance. | **Held** (Blocks slot only until `hold_expires_at`). |
| `payment_received` | Advance payment received/recorded, awaiting final owner approval. | **Held** (or available if no hold placed). |
| `confirmed` | Owner explicitly verified payment and approved booking. | **Booked** (Permanently reserved). |
| `rejected` | Owner declined request. | **Available** (Slot released). |
| `cancelled` | Owner cancelled booking. | **Available** (Slot released). |
| `expired` | Temporary hold expired before confirmation. | **Available** (Slot released automatically). |

---

## 4. Database Constraints & Concurrency Protection

### Database Constraints
- Unique index applies strictly to confirmed bookings:
  ```sql
  CREATE UNIQUE INDEX uq_confirmed_slot_idx 
  ON booking_slots(slot_date, slot_time) 
  WHERE status = 'confirmed';
  ```
- Advance audit columns on `bookings`:
  - `advance_amount`: Real/Numeric agreed amount.
  - `payment_method`: Method used (UPI, PhonePe, Google Pay, etc.).
  - `payment_reference`: Transaction UTR or receipt reference.
  - `payment_verified`: Boolean flag (0 or 1).
  - `payment_verified_at`: Timestamp when owner verified payment.
  - `hold_expires_at`: Expiry timestamp for temporary holds.

### Concurrency Protection
If two concurrent attempts are made to confirm different bookings for the same slot, the database transaction ensures **exactly one succeeds (HTTP 200)** and the competing attempt is **rejected with HTTP 409 Conflict**.

---

## 5. Authoritative Pricing Rules & Midnight Policy

The server calculates all booking prices independently; client-submitted prices are never trusted.

### Box Cricket Pricing
- **Daytime (06:00 – 17:59)**: ₹800 per hour.
- **Weekday Night (18:00 – 05:59 Mon–Fri)**: ₹1,000 per hour under tournament floodlights.
- **Weekend Night (18:00 – 05:59 Sat–Sun)**: ₹1,200 per hour.

### Midnight & Boundary Policy
- Each 1-hour interval `[HH:00, (HH+1):00)` is calculated based on its specific slot date and start hour.
- A booking that crosses from day to night (e.g. 16:00 to 19:00 on a weekday) calculates each hour independently:
  - `16:00–17:00`: ₹800 (Day)
  - `17:00–18:00`: ₹800 (Day)
  - `18:00–19:00`: ₹1,000 (Weekday Night)
  - **Total**: ₹2,600.
- A booking that spans across midnight (e.g. 23:00 to 02:00) computes each hour according to its calendar day and night rate.

### Private Events & Tournaments
- Box cricket hourly rates do **not** apply.
- Base price is ₹0 (`quote_required: true`).
- Preferred start time, duration, multi-day dates, and selected add-ons (Sound System, Catering, Decorations, Photography, etc.) are validated and itemized in the booking record and WhatsApp message.

---

## 6. WhatsApp Click-to-Chat Integration

- **Destination**: `+91 97011 67899` (`919701167899`)
- **Format**: `https://wa.me/919701167899?text=URL_ENCODED_MESSAGE`
- **Popup Blocker Prevention**: The frontend pre-opens a blank window tab synchronously within the user gesture, then redirects it once the backend creates the `pending_confirmation` request.
- **On-Page Notice**:
  > *"Your booking request has been recorded. Please send the prepared WhatsApp message to PowerPlay Club. Your slot is not confirmed until the owner approves your booking and verifies the agreed advance payment."*

---

## 7. API Endpoints

| Method | Endpoint | Access | Description |
|:---|:---|:---:|:---|
| `GET` | `/health` | Public | Service health & timestamp check |
| `GET` | `/api/availability?date=YYYY-MM-DD` | Public | Slot availability (`available`, `held`, `booked`, `past`) |
| `POST` | `/api/bookings` | Public | Creates request in `pending_confirmation` state (non-blocking) |
| `GET` | `/api/bookings/{ref}/status` | Public | Safe status check with masked customer info |
| `POST` | `/api/admin/login` | Staff | Authenticates staff with key, returns 12-hour session token |
| `GET` | `/api/admin/bookings` | Staff | Lists requests with filters (`date`, `status`, `search`) |
| `POST` | `/api/admin/bookings/{id}/hold` | Staff | Places temporary hold (default 15m) on slot (`awaiting_advance`) |
| `POST` | `/api/admin/bookings/{id}/advance` | Staff | Records advance payment details & marks verified |
| `POST` | `/api/admin/bookings/{id}/confirm` | Staff | **Confirms booking & locks slot permanently** |
| `PATCH` | `/api/admin/bookings/{id}/status` | Staff | Status updates (`awaiting_advance`, `payment_received`, `rejected`, `cancelled`) |
| `GET` | `/api/admin/export` | Staff | Exports live bookings with advance audit trail to CSV |

---

## 8. How to Run Locally

### Step 1: Copy Environment Configuration
```powershell
cp .env.example .env
```

### Step 2: Start the Production Server
Using Python (FastAPI + Uvicorn):
```powershell
python -m uvicorn server.main:app --host 0.0.0.0 --port 8000
```
Visit `http://localhost:8000` in any browser.

### Step 3: Run the Automated Test Suite
```powershell
python -m pytest tests/test_booking_backend.py -v
```
All 19 automated integration, PIN authentication, Owner WhatsApp recovery, hold expiry, payment verification, concurrency, and security scenarios pass.

---

## 9. Booking Manager Authentication & PIN Recovery

### 6-Digit Authentication PIN
- **Default PIN**: `123456`
- **Access**: Open **Booking Manager** in footer (`#adminOpen`) and enter the 6-digit PIN.
- **Persistence**: PIN is stored securely in `system_settings` and can also be overridden with the `BOOKING_MANAGER_PIN` environment variable.

### Forgot PIN? — Owner WhatsApp Verification Workflow
If staff forgets the PIN:
1. Click **"Forgot PIN? Verify with Owner on WhatsApp"** on the login screen.
2. Click **"Send Verification Code to Owner WhatsApp"**.
3. A 6-digit single-use OTP is securely generated (valid for 10 minutes) and WhatsApp opens addressed directly to the PowerPlay Club Owner at **+91 97011 67899** (`919701167899`).
4. The owner receives:
   ```
   Hello PowerPlay Club Owner!
   A request was made to unlock / reset the Booking Manager PIN.
   Owner Verification Code: [6-DIGIT-OTP]
   Valid for: 10 minutes
   ```
5. Enter the 6-digit verification code into the modal (with an optional new 6-digit PIN).
6. Click **"Verify Code & Unlock Manager"**.
7. The server validates the code, logs in, unlocks the portal, and updates the PIN if a new one was provided.

---

## 10. Cloud Deployment Guide

### Supabase Cloud (PostgreSQL + Edge Functions)
1. Run migrations in your Supabase SQL Editor:
   - `supabase/migrations/20261020000000_powerplay_booking_schema.sql`
   - `supabase/migrations/20261020000001_owner_controlled_booking_lifecycle.sql`
   - `supabase/migrations/20261020000002_booking_manager_pin_auth.sql`
2. Deploy the Edge Function:
   ```bash
   supabase functions deploy booking-api
   supabase secrets set WHATSAPP_PHONE=919701167899
   ```

### Container / Virtual Server (Docker, Render, Railway, AWS)
```bash
uvicorn server.main:app --host 0.0.0.0 --port $PORT
```
Configure environment variables from `.env.example`.
