-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query)
-- BEFORE enabling the partner export (setting PARTNER_EXPORT_EMAILS in Cloudflare).
--
-- Adds the per-member "already sent to partners" stamp used by the daily partner
-- newsletter export (functions/api/partners/export.js). Members are shared with
-- the partner distributions (ControlAI, PauseAI) exactly once: the export selects
-- confirmed, opted-in members whose partner_exported_at IS NULL, emails them to
-- the partner address(es), then stamps this column. A member is therefore never
-- sent twice, and a failed run simply leaves them unstamped to be retried.

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS partner_exported_at TIMESTAMPTZ;

-- Partial index over exactly the hot set the export query scans: opted-in,
-- confirmed members not yet exported. Keeps the daily lookup cheap as the
-- members table grows.
CREATE INDEX IF NOT EXISTS members_partner_pending_idx
  ON members (signed_at)
  WHERE partner_exported_at IS NULL
    AND confirmed
    AND contact_pref = 'urgent_and_updates';
