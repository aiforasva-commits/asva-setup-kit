-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query)
-- Creates the rate_limits table used by the pledge form to block repeated submissions

CREATE TABLE IF NOT EXISTS rate_limits (
  ip_hash      TEXT        PRIMARY KEY,
  attempts     INTEGER     NOT NULL DEFAULT 1,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Service role key (used by the Pages function) bypasses RLS automatically.
-- Enable RLS so anonymous/public roles cannot read or write this table directly.
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
