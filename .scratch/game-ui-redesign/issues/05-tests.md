# T05 · 测试更新（单元 / 组件 / 集成 / E2E）

**Status**: ready-for-agent
**Blocked by**: 02, 03, 04

> 依据：`.scratch/game-ui-redesign/spec.md` 的「Testing Decisions」。

## 目标

按现有分层镜像更新测试，只断言外部行为。

## 范围

- 单元：揭示调度（仅逐字遮罩节奏）；快照矩阵（移除 `wordHint`/`revealedHints` 断言并收缩 `FORBIDDEN_KEYS`）；协议 Schema 正/负向配对。
- 组件：新增 `FloatingPanel` / `PlayerPanel` / `CanvasToolbar` / `BrushSizeField` 用例；更新 `GameHud` 用例；删除或改写 `ScoreStrip` / `DrawingToolbar` 的既有用例。
- 集成 / E2E：对局界面按新骨架渲染、面板可开关、底部工具条可开关、猜词者无提示文案。
- 文档一致性：`test/unit/documentation.consistency.spec.ts` 若因路径变更失败，交由 T06 同步文档后再跑。

## 验收

- `pnpm test:unit`、`pnpm test:component`、`pnpm test:integration` 全绿。
- 未新增对实现细节的断言。
- 覆盖率不低于现有门禁。

## 验证

- `pnpm test:unit && pnpm test:component && pnpm test:integration && pnpm test:coverage`
- 关键路径再跑 `pnpm test:e2e`。
