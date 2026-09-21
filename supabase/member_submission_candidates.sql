-- Run this ONCE in the Supabase SQL editor (Dashboard → SQL Editor → New query).
--
-- Lets a member submission propose a brand-new candidate (not yet on the
-- Candidates sheet) instead of only editing one already on the scorecard —
-- see functions/api/member-submissions/create.js and scorecard.html's
-- member-edit modal.
--
--   is_new_candidate  true when the member is proposing a candidate who isn't
--                     on the scorecard yet (mp_name is the name they typed,
--                     not one picked from the existing list).
--   party             the candidate's party. Members can set this for a new
--                     candidate; NULL for an edit to an existing one (the
--                     sheet already carries their party).
--   current_mp        whether the member is flagging this candidate as the
--                     seat's current MP. For an edit to an existing candidate
--                     this just mirrors what the scorecard already shows; for
--                     a new candidate it's their proposal. confirm.js only
--                     publishes straight to the live mp_ratings overlay (one
--                     row per constituency) when this is true — a new
--                     candidate who ISN'T the current MP has to be added to
--                     the Candidates sheet by hand, same as any other
--                     candidate data (mp_ratings only ever overlays the
--                     current MP's row, see supabase/mp_ratings.sql).

ALTER TABLE member_submissions ADD COLUMN IF NOT EXISTS is_new_candidate BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE member_submissions ADD COLUMN IF NOT EXISTS party             TEXT;
ALTER TABLE member_submissions ADD COLUMN IF NOT EXISTS current_mp        BOOLEAN NOT NULL DEFAULT false;
