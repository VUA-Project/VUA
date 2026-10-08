# BDL commands v0.5

> Document version: 0.5
> Status: **Frozen** (2026-10-03) — schema + vectors + consumer tests; supersedes [v0.4](bdl-commands-v0.4.md)

v0.4 的全部命令词面不变(见 v0.4 文档)。v0.5 单点增补:

## Addition: `warehouse.import` optional `autoGenerate`

- `warehouse.import` params 新增可选 `autoGenerate: boolean`(缺省/false = 仅导入,
  与 v0.3/v0.4 行为一致)。`true` 时导入任务在每个文件夹完成后自动制成 VPM 包
  再入库(注入既有的 AutoGenerateSpec 管道;渲染层以设置-实验性开关门控该选项
  的显示)。执行侧无 executor 时以 `vua.warehouse.unavailable` 如实拒绝。

消费测试:`crates/provider-host/tests/warehouse_commands.rs`
(bdl-commands 家族信封 const 0.5 随本增补)。

## Document changelog

- 0.5 (2026-10-03): warehouse.import optional autoGenerate over the frozen v0.4 face;
  family envelope const rises to 0.5.
