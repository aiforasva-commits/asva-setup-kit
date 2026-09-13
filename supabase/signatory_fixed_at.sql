-- Run once in the Supabase SQL editor. Adds the marker the signatory-coverage
-- pass stamps on every live rating it edits, so the /goldenpath.html "Live
-- ratings" tab can filter to exactly the cards changed by that pass (see
-- functions/api/ratings/signatory-fix.js and lib/signatory-status.js).
--
-- The column is nullable and defaults to NULL: existing rows, and any rating
-- confirmed or hand-edited by other paths, simply leave it unset. Only the
-- signatory-fix endpoint sets it. A later manual edit via /api/ratings/update
-- does NOT clear it (that endpoint doesn't touch this column), so the marker
-- persists as a record that the card once went through the pass.

ALTER TABLE mp_ratings
  ADD COLUMN IF NOT EXISTS signatory_fixed_at TIMESTAMPTZ;
