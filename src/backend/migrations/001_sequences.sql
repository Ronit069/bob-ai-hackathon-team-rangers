-- 001_sequences.sql
-- Runtime ID generation support (data-contract.md §1: IDs are prefixed and sequential).

CREATE TABLE IF NOT EXISTS id_sequence (
  prefix     text PRIMARY KEY,
  last_value bigint NOT NULL DEFAULT 0
);
