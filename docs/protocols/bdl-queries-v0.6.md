# BDL queries v0.6

> Document version: 0.6
> Status: **Frozen** (2026-10-02) — schema + vectors + consumer tests; supersedes [v0.5](bdl-queries-v0.5.md)

v0.5 的全部八方法词面不变（见 v0.5 文档）。v0.6 家族信封常量升至 "0.6"，单点增补：

## Addition: catalog.list `libraryType` filter + entries field

- `catalog.list` params 新增可选 `libraryType: "bought" | "gifts" | "free_downloads"`
  （闭集；null/缺省 = 不过滤）。匹配持久化列 `products.library_type`（BDL v0.3）；
  NULL 行仅在无筛选查询中可见。
- `catalog.list` 条目新增必填 `libraryType`（三值或 null = 未知/旧数据行）。
  其余方法的条目形态不变。

Schemas: [`schemas/bdl-queries/v0.6`](../../schemas/bdl-queries/v0.6)；
消费测试 `crates/bdl-store/tests/catalog_serving.rs`
（`bdl_v03_library_type_persists_and_filters`）与
`crates/provider-host/tests/catalog_queries.rs`。

## Document changelog

- 0.6 (2026-10-02): catalog.list libraryType filter and entries field over the
  frozen v0.5 face; family envelope const rises to 0.6.
