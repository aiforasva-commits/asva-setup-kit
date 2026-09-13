-- Run this ONCE in the Supabase SQL editor (Dashboard → SQL Editor → New query),
-- BEFORE deploying the golden-path changes that split the live ratings into
-- "Live Claude Ratings" and "Live Human Reviewed".
--
-- What it does:
--   1. Adds a `human_reviewed_at` flag to mp_ratings. NULL = a live "Claude
--      rating" that a person has not checked yet; a timestamp = a person has
--      Saved/Confirmed it (it then shows under "Live Human Reviewed"). Both
--      states stay live on the public map either way.
--   2. Adds `rationale`, `party`, `model` to mp_ratings so the extra context a
--      draft carried in the Pending review tab (its one-line rationale — including
--      any leading ⚑ "borderline" marker — the MP's party, and which model drafted
--      it) survives once the rating is live, and is shown on the Live Claude card.
--   3. One-time migration: publishes every PENDING recommendation to the live map
--      as a Claude rating (human_reviewed_at NULL), preserving that context, then
--      marks those recommendations confirmed so they leave the Pending queue.
--
-- Idempotent: the ALTERs use IF NOT EXISTS, and re-running the migration step is a
-- no-op once there are no pending recommendations left.


-- 1 + 2 · new columns ---------------------------------------------------------
ALTER TABLE mp_ratings ADD COLUMN IF NOT EXISTS human_reviewed_at TIMESTAMPTZ;
ALTER TABLE mp_ratings ADD COLUMN IF NOT EXISTS rationale         TEXT;
ALTER TABLE mp_ratings ADD COLUMN IF NOT EXISTS party             TEXT;
ALTER TABLE mp_ratings ADD COLUMN IF NOT EXISTS model             TEXT;

CREATE INDEX IF NOT EXISTS mp_ratings_human_reviewed_idx
  ON mp_ratings (human_reviewed_at);


-- 3 · publish all current PENDING drafts to the live map as Claude ratings -----
-- Existing live rows keep human_reviewed_at = NULL too (every current rating
-- starts life in "Live Claude Ratings" and is moved to "Live Human Reviewed"
-- only when Saved/Confirmed from the review page).
INSERT INTO mp_ratings
  (constituency, mp_name, grade, bullets, sources, rationale, party, model,
   updated_by, updated_at, human_reviewed_at)
SELECT
  constituency, mp_name, recommended_grade, bullets, sources, rationale, party, model,
  'agent-bulk-publish', NOW(), NULL
FROM mp_recommendations
WHERE status = 'pending'
ON CONFLICT (constituency) DO UPDATE SET
  mp_name           = EXCLUDED.mp_name,
  grade             = EXCLUDED.grade,
  bullets           = EXCLUDED.bullets,
  sources           = EXCLUDED.sources,
  rationale         = EXCLUDED.rationale,
  party             = EXCLUDED.party,
  model             = EXCLUDED.model,
  updated_by        = EXCLUDED.updated_by,
  updated_at        = EXCLUDED.updated_at,
  human_reviewed_at = NULL;   -- a fresh draft going live is unreviewed again

-- Retire the drafts we just published so they drop out of the Pending queue.
UPDATE mp_recommendations
SET status = 'confirmed', confirmed_grade = recommended_grade, reviewed_at = NOW()
WHERE status = 'pending';
