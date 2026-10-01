# T07 · 收口：文案归位、答案显隐切换恢复、死代码清理

**Status**: ready-for-agent
**Blocked by**: 03, 04

> 由主导人在 T03/T04 集成审查时发现，均为子代理各自范围之外的事项。

## 目标

消除越界与死代码，使代码回到项目约束（文案单源）与 ADR-0042 的语义。

## 范围

1. **文案归位**：把 `apps/client/src/components/game/game-labels.ts` 的全部文案并入 `packages/strings`（新增到 `strings.game` 或等价分组），删除该文件，并更新所有引用组件（`GameHud` / `PlayerPanel` / `CanvasToolbar` / `BrushSizeField` / `FloatingPanel` / `GameView` 等，以实际 grep 为准）。
   - 项目约束：UI 文案只写在 `packages/strings`（AGENTS「配置治理」第 4 条）。
2. **恢复画家答案显隐切换**（符合 `docs/adr/0042-remove-structured-hints.md`：「答案显隐切换只剩『明文 / 遮罩』」）：`GameHud` 的题目胶囊恢复画家可点击切换明文/遮罩，并使用 `store.settings.drawerDefaultReveal` 作为默认值；恢复/复核 `strings.game.toggleAnswerVisibility*` 文案（去掉「提示」字样）。
3. **清理死文案键**：grep 全仓（含 `test/**`）确认无引用后删除：`scoreStripAria`、`drawerLabel`、`drawerAvatarAria`、`drawerPending`、`colorGroup`、`toolGroup`、`widthName`、`widthAria` 及任何其它无引用键（逐个确认，不要凭猜）。
4. **删除 `components/common/ToolButton.vue`**：确认 `apps/client/src` 与 `test/**` 均无调用方后删除组件与 barrel 导出（`test/**` 的引用清理交 T05）。
5. **注释纠偏**：`apps/client/src/App.vue` 提到 `DrawingToolbar` 的注释改为事实。

## 非目标

- 不改协议/服务端（T01/T02 已完成）。
- 不改 `test/**`（T05 负责）。
- 不改 `docs/**`、`AGENTS.md`、`README.md`（T06 负责）。

## 验收

- `apps/client/src` 内不存在组件目录自建文案表；所有展示文案来自 `@draw-guess/strings`。
- 画家仍可切换答案明文/遮罩，`drawerDefaultReveal` 生效。
- 无无引用文案键、无无调用方组件。
- `pnpm exec eslint apps/client/src` 通过；`pnpm --filter @draw-guess/client typecheck` 的 src 范围通过。

## 验证

- `pnpm exec eslint apps/client/src packages/strings`
- `pnpm exec prettier --check`（改动文件）
- `pnpm --filter @draw-guess/client typecheck`（忽略 `test/**` 报错）
