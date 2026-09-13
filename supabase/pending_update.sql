-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
--
-- Supports "edit your details" via the same double opt-in flow used for signup.
-- When someone re-submits the pledge form with an email address that already
-- belongs to a CONFIRMED member, the pledge function stores their newly
-- submitted details here (rather than overwriting the live record) and emails a
-- fresh confirmation link. /api/confirm applies these pending details to the
-- member row and clears this column once the link is clicked — so an
-- unconfirmed edit can never silently change a live membership.

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS pending_update JSONB;
