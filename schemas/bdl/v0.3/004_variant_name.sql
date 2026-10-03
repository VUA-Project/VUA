-- BDL v0.3 migration 004: products.variant_name (2026-10-03, N5 card
-- wall redesign — purchased variant marker from the library row title
-- suffix). Additive column; NULL = not variant-differentiated.

ALTER TABLE products ADD COLUMN variant_name TEXT;
