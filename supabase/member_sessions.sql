-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
--
-- Magic-link login for CONFIRMED MEMBERS, so they can propose an edit to their
-- own MP's scorecard rating (see member_submissions.sql and
-- docs/mp-rating-agent.md, "Member submissions"). Deliberately a SEPARATE
-- table from admin_sessions (which powers /goldenpath.html): the two must
-- never share a cookie, a session-validation code path, or a trust level —
-- a member session must NEVER be usable to pass requireAdmin().
--
-- Unlike admin login (which only ever emails the one fixed ADMIN_EMAIL — see
-- lib/admin-auth.js), this flow necessarily emails whatever address the
-- request names. To keep that from becoming a way to spam or phish arbitrary
-- strangers, functions/api/member/login.js only sends a link when the address
-- matches an existing CONFIRMED row in `members`, rate-limits by target email
-- as well as by IP, and always returns the same generic response either way.
--
-- login  → insert a row with a magic_token (only if the email matched a
--          confirmed member), emailed to that member's own inbox. return_to
--          carries the constituency/MP they were trying to edit so verify can
--          deep-link them straight back to the right card.
-- verify → the emailed link activates the row and its session_token becomes
--          the member cookie until session_expires_at.

CREATE TABLE IF NOT EXISTS member_login_sessions (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id          BIGINT      NOT NULL REFERENCES members(id), -- members.id is bigint, not uuid, in production

  magic_token        TEXT        UNIQUE NOT NULL,
  session_token      TEXT        UNIQUE NOT NULL,
  magic_expires_at   TIMESTAMPTZ NOT NULL,
  activated          BOOLEAN     NOT NULL DEFAULT FALSE,
  session_expires_at TIMESTAMPTZ,
  return_to_constituency TEXT,
  return_to_mp_name      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS member_login_sessions_magic_token_idx   ON member_login_sessions (magic_token);
CREATE INDEX IF NOT EXISTS member_login_sessions_session_token_idx ON member_login_sessions (session_token);

-- Service-role only — same posture as admin_sessions.
ALTER TABLE member_login_sessions ENABLE ROW LEVEL SECURITY;
