-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
--
-- Adds a canonical (normalised) email so alias addresses that all reach the
-- SAME inbox count as ONE member — and enforces that uniqueness at the database
-- level, which also closes the read-then-insert race in the pledge function.
--
-- The normalisation here mirrors normalizeEmail() in functions/api/pledge.js:
--   • lowercase + trim
--   • drop the "+tag" subaddress from the local part
--   • for gmail.com / googlemail.com: remove dots and fold onto gmail.com
-- Keep the two in sync if you change one.

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS email_canonical TEXT;

-- Best-effort backfill of existing rows so the unique index below can build.
-- (Test data will be cleared before launch; this keeps the migration runnable
-- either way.)
UPDATE members
SET email_canonical =
  CASE
    WHEN split_part(lower(trim(email)), '@', 2) IN ('gmail.com', 'googlemail.com')
      THEN replace(split_part(split_part(lower(trim(email)), '@', 1), '+', 1), '.', '')
           || '@gmail.com'
    ELSE split_part(split_part(lower(trim(email)), '@', 1), '+', 1)
           || '@' || split_part(lower(trim(email)), '@', 2)
  END
WHERE email IS NOT NULL AND email_canonical IS NULL;

-- Enforce one member per canonical inbox.
-- NOTE: if the table still holds test rows that are duplicates under the new
-- rules, this index will fail to create — clear or de-duplicate those rows
-- first (you mentioned the current data is disposable test data), then re-run.
CREATE UNIQUE INDEX IF NOT EXISTS members_email_canonical_key
  ON members (email_canonical);
