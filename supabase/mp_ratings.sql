-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
--
-- Backs the MP ASVA-rating agent (see docs/mp-rating-agent.md). Three tables:
--
--   mp_ratings          The LIVE, confirmed rating for each current MP. This is
--                       what the site build reads and overlays onto the scorecard.
--                       Only rows you have approved (or edited by hand) live here.
--
--   mp_recommendations  Draft ratings produced by the research skill, waiting for
--                       your review. Confirm copies one into mp_ratings; reject
--                       discards it. Nothing here is ever shown on the public site.
--
--   admin_sessions      One-time magic-link tokens + activated review sessions for
--                       the /goldenpath.html review page. A link is emailed to the ASVA
--                       address; clicking it activates a session cookie.
--
-- Grades use the same rubric as the Candidates sheet: A, B, C, ?, DNR, D, E, F.


-- ── Live confirmed ratings ────────────────────────────────────────────────────
-- Keyed by constituency name exactly as it appears in hex-layout.json / the
-- Candidates sheet, since there is one current MP per constituency. The build
-- (scripts/fetch-data.js) overlays these onto the current MP's scorecard card.
CREATE TABLE IF NOT EXISTS mp_ratings (
  constituency TEXT        PRIMARY KEY,
  mp_name      TEXT        NOT NULL,
  grade        TEXT        NOT NULL,
  bullets      JSONB       NOT NULL DEFAULT '[]'::jsonb,  -- array of strings (≤5)
  sources      JSONB       NOT NULL DEFAULT '[]'::jsonb,  -- array of {title,url} (≤6)
  updated_by   TEXT,                                      -- 'agent-confirmed' | 'manual' | 'signatory-fix'
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Set by the both-campaign signatory-coverage pass (functions/api/ratings/
  -- signatory-fix.js) on each row it edits, so the review page can filter to
  -- exactly those cards. NULL on every other row. See supabase/signatory_fixed_at.sql.
  signatory_fixed_at TIMESTAMPTZ
);

-- The site build reads this table with the ANON key, so allow public SELECT only.
-- (Grades are public information — they are shown on the scorecard.) Writes come
-- exclusively from the Cloudflare Functions using the service-role key, which
-- bypasses RLS, so no INSERT/UPDATE policy is granted to anon/public.
ALTER TABLE mp_ratings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mp_ratings_public_read ON mp_ratings;
CREATE POLICY mp_ratings_public_read ON mp_ratings
  FOR SELECT TO anon, authenticated USING (TRUE);


-- ── Draft recommendations awaiting review ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS mp_recommendations (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  constituency      TEXT        NOT NULL,
  mp_name           TEXT        NOT NULL,
  party             TEXT,
  recommended_grade TEXT        NOT NULL,
  rationale         TEXT,                                  -- one-line summary
  bullets           JSONB       NOT NULL DEFAULT '[]'::jsonb,
  sources           JSONB       NOT NULL DEFAULT '[]'::jsonb,
  status            TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'confirmed', 'rejected')),
  confirmed_grade   TEXT,                                  -- what was actually saved (may differ if edited)
  model             TEXT,                                  -- which model drafted it
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS mp_recommendations_status_idx
  ON mp_recommendations (status);

-- At most one PENDING recommendation per constituency, so re-running the research
-- skill refreshes rather than duplicates. Confirmed/rejected history is kept.
CREATE UNIQUE INDEX IF NOT EXISTS mp_recommendations_one_pending_per_seat
  ON mp_recommendations (constituency)
  WHERE status = 'pending';

-- Only the Cloudflare Functions (service-role key) touch this table; no public
-- access at all.
ALTER TABLE mp_recommendations ENABLE ROW LEVEL SECURITY;


-- ── Admin magic-link sessions ─────────────────────────────────────────────────
-- login  → insert a row with a magic_token, emailed to the ASVA address.
-- verify → the emailed link activates the row and its session_token becomes the
--          admin cookie until session_expires_at.
CREATE TABLE IF NOT EXISTS admin_sessions (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  magic_token        TEXT        UNIQUE NOT NULL,
  session_token      TEXT        UNIQUE NOT NULL,
  magic_expires_at   TIMESTAMPTZ NOT NULL,
  activated          BOOLEAN     NOT NULL DEFAULT FALSE,
  session_expires_at TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_sessions_magic_token_idx   ON admin_sessions (magic_token);
CREATE INDEX IF NOT EXISTS admin_sessions_session_token_idx ON admin_sessions (session_token);

-- Service-role only.
ALTER TABLE admin_sessions ENABLE ROW LEVEL SECURITY;
