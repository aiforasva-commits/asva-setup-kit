-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
--
-- Fixes "Select my constituency" signups failing to save on the pledge form
-- (the signer sees "We couldn't save your signature just now").
--
-- The members table was created when a full postal address was the only way to
-- sign, so its address columns are likely declared NOT NULL. The form now also
-- lets people sign by picking their constituency alone — that submission carries
-- NO address, so pledge.js inserts NULL for address_line1 / address_line2 /
-- city / postcode. Against NOT NULL columns that insert raises a not-null
-- violation (Postgres 23502), which pledge.js catches and returns as a 500 —
-- hence the "couldn't save your signature" message. Address-mode signups always
-- fill these columns, which is why only the constituency path failed.
--
-- Making the address columns nullable lets a constituency-only row save while
-- leaving address-mode signups completely unchanged. The statements are safe to
-- re-run: DROP NOT NULL on a column that is already nullable is a no-op.

ALTER TABLE members ALTER COLUMN address_line1 DROP NOT NULL;
ALTER TABLE members ALTER COLUMN address_line2 DROP NOT NULL;
ALTER TABLE members ALTER COLUMN city          DROP NOT NULL;
ALTER TABLE members ALTER COLUMN postcode      DROP NOT NULL;
