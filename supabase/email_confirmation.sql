-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query)
-- BEFORE adding RESEND_API_KEY to Cloudflare — the pledge function writes these
-- columns as soon as the key is present.
--
-- Adds double opt-in email confirmation: new signups are stored unconfirmed
-- with a token, /api/confirm flips them to confirmed when the emailed link is
-- clicked, and the constituency_counts view counts confirmed members only.

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS confirmed       BOOLEAN     NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS confirmed_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirm_token   TEXT,
  ADD COLUMN IF NOT EXISTS confirm_sent_at TIMESTAMPTZ;

-- DEFAULT TRUE keeps every pre-existing member — and any signup made while
-- RESEND_API_KEY is not configured — counted exactly as before this migration.
-- Signups made through the confirmation flow explicitly insert FALSE.

CREATE INDEX IF NOT EXISTS members_confirm_token_idx ON members (confirm_token);

-- Recreate the counts view so only confirmed members are counted
DROP VIEW IF EXISTS constituency_counts;
CREATE VIEW constituency_counts AS
  SELECT constituency, COUNT(*) AS member_count
  FROM members
  WHERE confirmed AND constituency IS NOT NULL
  GROUP BY constituency;

-- The Supabase keep-alive workflow (.github/workflows/supabase-keep-alive.yml)
-- pings this view with the anon key, so the anon role needs SELECT on it. The
-- view exposes only aggregate counts (constituency, member_count) — no PII —
-- unlike the members table, which the anon role must never read (see
-- supabase/members.sql). App code reads this view with the service-role key.
GRANT SELECT ON constituency_counts TO anon;
