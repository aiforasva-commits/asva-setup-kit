-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
--
-- Backs the member-submitted MP-rating edit flow (see docs/mp-rating-agent.md,
-- "Member submissions"). A confirmed ASVA member can log in (via
-- member_login_sessions, see member_sessions.sql) and propose a grade +
-- bullets + sources for their own MP's card. Nothing here is ever shown
-- publicly, or even to other members — it is reviewed on /goldenpath.html
-- exactly like an agent-drafted recommendation, and only reaches the public
-- mp_ratings table when an admin confirms it.
--
-- This is a SEPARATE table from mp_recommendations rather than reusing it,
-- because mp_recommendations enforces "at most one pending draft per seat"
-- (mp_recommendations_one_pending_per_seat) to stop the agent re-queuing
-- duplicates of its own drafts. That invariant doesn't fit here: several
-- different members may reasonably propose edits for the same seat at once,
-- and a member's edit must never silently collide with (or block) whatever
-- the agent already has pending for that MP.

CREATE TABLE IF NOT EXISTS member_submissions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  constituency     TEXT        NOT NULL,
  mp_name          TEXT        NOT NULL,

  -- Who submitted it. member_id is the FK for joins; email/name are a snapshot
  -- taken at submission time so the review card and outcome email still make
  -- sense even if the member later edits their pledge details.
  member_id        BIGINT      NOT NULL REFERENCES members(id), -- members.id is bigint, not uuid, in production
  member_email     TEXT        NOT NULL,
  member_name      TEXT        NOT NULL,

  -- What the member proposed.
  proposed_grade   TEXT        NOT NULL,
  bullets          JSONB       NOT NULL DEFAULT '[]'::jsonb,  -- array of strings (≤5)
  sources          JSONB       NOT NULL DEFAULT '[]'::jsonb,  -- array of {title,url} (≤6)
  note             TEXT,                                       -- optional message to the reviewer

  -- Snapshot of the LIVE mp_ratings row (if any) at the moment of submission,
  -- so the golden-path review card can show an honest "current vs proposed"
  -- diff even if the live rating changes again before anyone reviews this.
  base_grade       TEXT,
  base_bullets     JSONB,
  base_sources     JSONB,

  status           TEXT        NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'confirmed', 'rejected')),
  confirmed_grade  TEXT,                                       -- what was actually saved (may differ if the admin edited it)
  amended          BOOLEAN,                                    -- true if the admin changed something before confirming — drives the outcome email wording
  reject_reason    TEXT,                                       -- optional note shown to the member on rejection

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS member_submissions_status_idx ON member_submissions (status);
CREATE INDEX IF NOT EXISTS member_submissions_member_idx ON member_submissions (member_id);

-- A member resubmitting for a seat they already have a pending edit on
-- replaces it in place (upsert), rather than piling up near-duplicates —
-- mirrors the existing "edit your pledge details" pattern in pledge.js.
CREATE UNIQUE INDEX IF NOT EXISTS member_submissions_one_pending_per_member_seat
  ON member_submissions (member_id, constituency)
  WHERE status = 'pending';

-- Only the Cloudflare Functions (service-role key) touch this table; no public
-- or member-facing access at all — a member never reads another member's
-- submission, and the anon key never touches this table.
ALTER TABLE member_submissions ENABLE ROW LEVEL SECURITY;
