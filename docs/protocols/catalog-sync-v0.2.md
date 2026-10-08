# Catalog-sync v0.2 — library-typed page ingest

> Document version: 0.2
> Status: **Frozen** (2026-10-02) — schema + positive/negative vectors + consumer test; supersedes [v0.1](catalog-sync-v0.1.md) (whose wire face remains accepted)

v0.1 的全部语义不变（见 v0.1 文档：分区会话单页归档投递、诚实规则、任务折叠、边界）。
v0.2 单点增补：

## Addition: `libraryType`

请求可选字段 `libraryType: "bought" | "gifts" | "free_downloads"`（BDL v0.3
`products.library_type` 列的数据源）。provider 校验闭集后随观察写入；v0.1 请求
（无该字段）继续接受并写入 NULL。回执信封回显请求的 schemaVersion。
Electron 触发面以 `libraryType` 声明同步哪个账号库，Main 按类型派生入口
（`/library`、`/library/gifts`、`/library/free_downloads`）。

Schemas: [`schemas/catalog-sync/v0.2`](../../schemas/catalog-sync/v0.2)；
消费测试 `crates/provider-host/tests/catalog_sync_wire_v01.rs`
（`v02_requests_carry_library_type_into_observations`）。

## Document changelog

- 0.2 (2026-10-02): add optional request `libraryType` (closed set) writing the BDL
  v0.3 column; v0.1 requests stay accepted.
