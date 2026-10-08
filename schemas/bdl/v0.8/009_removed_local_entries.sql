CREATE TABLE removed_local_entries (
  warehouse_item_id TEXT PRIMARY KEY REFERENCES warehouse_items(warehouse_item_id),
  removed_at TEXT NOT NULL
) STRICT;
CREATE TABLE removed_local_entry_commands (
  command_id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  result_json TEXT NOT NULL
) STRICT;
UPDATE bdl_meta SET value='0.8' WHERE key='format_version' AND value='0.7';
