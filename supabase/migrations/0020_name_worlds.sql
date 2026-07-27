-- Sodio v23.2 — name-uniqueness WORLDS. B2C has no relation with the other
-- functions' archive: a name IGV/IGT/B2B/BD burned can still be a fresh B2C
-- partner (and vice versa). Active names stay unique across EVERYTHING; the
-- unique index now scopes per world (ICX-raising vs B2C) so an archived row
-- in one world no longer occupies the name for the other.
-- Run after 0019.

drop index if exists accounts_normalized_name_key;
create unique index accounts_normalized_name_world_key
  on accounts (normalized_name, (function = 'B2C'::lc_function));

-- NOTE: app-level checkAccountName() keeps ACTIVE names globally unique —
-- the index only opens the door for cross-world reuse of ARCHIVED names.
