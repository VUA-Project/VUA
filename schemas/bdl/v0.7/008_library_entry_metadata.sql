CREATE TABLE library_entry_metadata (
  warehouse_item_id TEXT PRIMARY KEY REFERENCES warehouse_items(warehouse_item_id),
  revision INTEGER NOT NULL CHECK(revision >= 1),
  product_id TEXT REFERENCES products(product_id),
  thumbnail_ref TEXT,
  updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE library_entry_metadata_commands (
  command_id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  result_json TEXT NOT NULL
) STRICT;
UPDATE bdl_meta SET value='0.7' WHERE key='format_version' AND value='0.6';
