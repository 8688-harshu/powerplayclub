-- ============================================================================
-- POWERPLAY CLUB: SUPABASE POSTGRESQL BOOKING SCHEMA & MIGRATION
-- Migration: 20261020000000_powerplay_booking_schema.sql
-- Base schema with owner-controlled confirmation and advance payment lifecycle
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- 1. BOOKINGS TABLE
CREATE TABLE IF NOT EXISTS public.bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference VARCHAR(16) UNIQUE NOT NULL,
    booking_type VARCHAR(32) NOT NULL CHECK (booking_type IN ('cricket', 'event', 'tournament', 'general')),
    customer_name VARCHAR(128) NOT NULL,
    customer_phone VARCHAR(20) NOT NULL,
    booking_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    duration_hours NUMERIC(4,2) NOT NULL DEFAULT 1.00,
    player_count VARCHAR(64) DEFAULT '6–10 Players',
    total_price NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    notes TEXT,
    event_details JSONB DEFAULT '{}'::jsonb,
    status VARCHAR(32) NOT NULL DEFAULT 'pending_confirmation' CHECK (status IN (
        'pending_confirmation',
        'awaiting_advance',
        'payment_received',
        'confirmed',
        'rejected',
        'cancelled',
        'expired'
    )),
    advance_amount NUMERIC(10,2) DEFAULT 0.00,
    payment_method VARCHAR(32),
    payment_reference VARCHAR(128),
    payment_verified BOOLEAN DEFAULT FALSE,
    payment_verified_at TIMESTAMPTZ,
    hold_expires_at TIMESTAMPTZ,
    whatsapp_status VARCHAR(16) DEFAULT 'requested' CHECK (whatsapp_status IN ('requested', 'opened', 'failed')),
    idempotency_key VARCHAR(64) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. BOOKING SLOTS TABLE
CREATE TABLE IF NOT EXISTS public.booking_slots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
    slot_date DATE NOT NULL,
    slot_time TIME NOT NULL,
    slot_price NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    status VARCHAR(32) NOT NULL DEFAULT 'pending_confirmation' CHECK (status IN (
        'pending_confirmation',
        'awaiting_advance',
        'payment_received',
        'confirmed',
        'held',
        'rejected',
        'cancelled',
        'expired'
    )),
    hold_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. INDEXES
CREATE INDEX IF NOT EXISTS idx_bookings_date ON public.bookings(booking_date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON public.bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_reference ON public.bookings(reference);
CREATE INDEX IF NOT EXISTS idx_booking_slots_date ON public.booking_slots(slot_date);
CREATE INDEX IF NOT EXISTS idx_booking_slots_booking ON public.booking_slots(booking_id);

-- 4. DATABASE-ENFORCED OVERLAPPING PREVENTION (ONLY ON CONFIRMED RESERVATIONS)
-- Ensures multiple requests can exist in pending_confirmation without blocking the slot.
-- ONLY an explicit owner confirmation permanently locks the slot!
CREATE UNIQUE INDEX IF NOT EXISTS uq_confirmed_slot_idx 
ON public.booking_slots(slot_date, slot_time) 
WHERE status = 'confirmed';

-- 5. FUNCTION: UPDATE UPDATED_AT TIMESTAMP
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bookings_updated_at ON public.bookings;
CREATE TRIGGER trg_bookings_updated_at
BEFORE UPDATE ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- 6. FUNCTION: SYNCHRONIZE SLOT STATUS WITH PARENT BOOKING
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

DROP TRIGGER IF EXISTS trg_bookings_sync_slots ON public.bookings;
CREATE TRIGGER trg_bookings_sync_slots
AFTER UPDATE OF status ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.sync_booking_slot_status();

-- 7. FUNCTION: AUTO-EXPIRE TEMPORARY HOLDS
CREATE OR REPLACE FUNCTION public.cleanup_expired_holds()
RETURNS INTEGER AS $$
DECLARE
    v_expired_count INTEGER;
BEGIN
    UPDATE public.booking_slots
    SET status = 'expired'
    WHERE status = 'held' AND hold_expires_at < now();

    UPDATE public.bookings
    SET status = 'expired'
    WHERE status IN ('awaiting_advance') AND hold_expires_at IS NOT NULL AND hold_expires_at < now();
    
    GET DIAGNOSTICS v_expired_count = ROW_COUNT;
    RETURN v_expired_count;
END;
$$ LANGUAGE plpgsql;

-- 8. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_slots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view slot availability" ON public.booking_slots;
CREATE POLICY "Public can view slot availability"
ON public.booking_slots
FOR SELECT
TO anon
USING (true);

DROP POLICY IF EXISTS "Public can create pending bookings" ON public.bookings;
CREATE POLICY "Public can create pending bookings"
ON public.bookings
FOR INSERT
TO anon
WITH CHECK (status = 'pending_confirmation');

DROP POLICY IF EXISTS "Staff has full access to bookings" ON public.bookings;
CREATE POLICY "Staff has full access to bookings"
ON public.bookings
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Staff has full access to slots" ON public.booking_slots;
CREATE POLICY "Staff has full access to slots"
ON public.booking_slots
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
