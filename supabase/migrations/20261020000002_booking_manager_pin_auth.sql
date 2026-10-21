-- Migration: 20261020000002_booking_manager_pin_auth.sql
-- Description: Adds system_settings table for 6-digit PIN authentication (default: 123456)
--              and pin_recovery_requests table for Owner WhatsApp verification.

CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pin_recovery_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default Booking Manager PIN (123456)
INSERT INTO system_settings (key, value, updated_at)
VALUES ('booking_manager_pin', '123456', NOW())
ON CONFLICT (key) DO NOTHING;

-- RLS: Only service_role can read/write system_settings and recovery requests
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE pin_recovery_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to system_settings"
ON system_settings FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Service role full access to pin_recovery_requests"
ON pin_recovery_requests FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
