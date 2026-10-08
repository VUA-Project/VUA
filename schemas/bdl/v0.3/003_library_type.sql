-- BDL v0.3 migration: persistent-format v0.2 -> v0.3 (2026-10-02, N5 S1
-- library-type slice, together with schemas/bdl/v0.3/schema.sql, the
-- vectors/ directory and the bdl-store consumer tests; see the freeze
-- triad in docs/REGISTRY.md).
--
-- Adds products.library_type: which account library a product was listed
-- from (bought | gifts | free_downloads). NULL = unknown: rows written by
-- v0.2 hosts and library-agnostic observations stay readable; the read
-- face filters NULL only when the filter is asked for explicitly.
-- Additive column, no rebuild, no data loss.

ALTER TABLE products ADD COLUMN library_type TEXT;

UPDATE bdl_meta SET value = '0.3' WHERE key = 'format_version';
