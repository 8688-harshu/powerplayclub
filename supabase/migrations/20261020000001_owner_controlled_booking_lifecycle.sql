-- ============================================================================
-- POWERPLAY CLUB: OWNER-CONTROLLED BOOKING & ADVANCE PAYMENT CONFIRMATION
-- Migration: 20261020000001_owner_controlled_booking_lifecycle.sql
-- ============================================================================

-- 1. ADD ADVANCE PAYMENT AND HOLD FIELDS TO BOOKINGS IF NOT EXISTS
ALTER TABLE public.bookings 
ADD COLUMN IF NOT EXISTS advance_amount NUMERIC(10,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS payment_method VARCHAR(32),
ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(128),
ADD COLUMN IF NOT EXISTS payment_verified BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS payment_verified_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS hold_expires_at TIMESTAMPTZ;

-- 2. UPDATE STATUS CHECK CONSTRAINT ON BOOKINGS
-- Drop old check constraint if exists
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_status_check;

-- Add updated check constraint supporting the full owner lifecycle
ALTER TABLE public.bookings ADD CONSTRAINT bookings_status_check 
CHECK (status IN (
    'pending_confirmation',
    'awaiting_advance',
    'payment_received',
    'confirmed',
    'rejected',
    'cancelled',
    'expired'
));

-- 3. UPDATE BOOKING_SLOTS TABLE
ALTER TABLE public.booking_slots 
ADD COLUMN IF NOT EXISTS hold_expires_at TIMESTAMPTZ;

ALTER TABLE public.booking_slots DROP CONSTRAINT IF EXISTS booking_slots_status_check;
ALTER TABLE public.booking_slots ADD CONSTRAINT booking_slots_status_check 
CHECK (status IN (
    'pending_confirmation',
    'awaiting_advance',
    'payment_received',
    'confirmed',
    'held',
    'rejected',
    'cancelled',
    'expired'
));

-- 4. CRITICAL FIX: REPLACE OLD PREMATURE CLOSURE UNIQUE INDEX
-- Drop the index that prematurely closed slots on pending/contacted requests!
DROP INDEX IF EXISTS public.uq_active_slot_idx;

-- CREATE NEW CONSTRAINT: ONLY OWNER-CONFIRMED BOOKINGS PERMANENTLY RESERVE A SLOT
CREATE UNIQUE INDEX IF NOT EXISTS uq_confirmed_slot_idx 
ON public.booking_slots(slot_date, slot_time) 
WHERE status = 'confirmed';

-- 5. FUNCTION TO AUTO-EXPIRE TEMPORARY HOLDS
CREATE OR REPLACE FUNCTION public.cleanup_expired_holds()
RETURNS INTEGER AS $$
DECLARE
    v_expired_count INTEGER;
BEGIN
    -- Release slots whose hold_expires_at has passed and booking is not confirmed
    UPDATE public.booking_slots
    SET status = 'expired'
    WHERE status = 'held' AND hold_expires_at < now();

    -- Update bookings whose hold has expired without confirmation
    UPDATE public.bookings
    SET status = 'expired'
    WHERE status IN ('awaiting_advance') AND hold_expires_at IS NOT NULL AND hold_expires_at < now();
    
    GET DIAGNOSTICS v_expired_count = ROW_COUNT;
    RETURN v_expired_count;
END;
$$ LANGUAGE plpgsql;

-- 6. TRIGGER: SYNC STATUS ON CONFIRMATION OR CANCELLATION
CREATE OR REPLACE FUNCTION public.sync_booking_slot_status()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        IF NEW.status = 'confirmed' THEN
            UPDATE public.booking_slots
            SET status = 'confirmed'
            WHERE booking_id = NEW.id;
        ELSIF NEW.status IN ('cancelled', 'rejected', 'expired') THEN
            UPDATE public.booking_slots
            SET status = NEW.status
            WHERE booking_id = NEW.id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
