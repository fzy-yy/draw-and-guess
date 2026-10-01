# T08 · 代码评审修复（Standards + Spec）

**Status**: ready-for-agent
**Blocked by**: 05, 06, 07

> 来源：`code-review` 两轴评审（固定点 `8e594a1`，待审 `b84498c`）。

## 目标

修复评审发现的问题：一处真实缺陷、一处死代码、若干规范/文档漂移与重复。

## 范围

1. **【缺陷】FloatingPanel 跨面板置顶失效**：`highestZIndex` 声明在 `<script setup>` 内，每个面板实例各有一份计数器，两个面板互相置顶无效。改为**模块级共享**的递增计数器（可新建 `components/game/floating-panel-z.ts` 之类的小模块），起始值仍须**低于阶段遮罩**（z-30），保证拖动置顶不会盖住暂停/结算遮罩。
2. **【死代码】`useGameHud` 的 `drawer`**：`GameView` 已不再消费，删除该 computed，并同步 `test/integration/store-contracts.ts` 中 `useGameHud` 的成员名单。
3. **【规范】单元素容器禁用无意义 flex**（AGENTS「布局规范」）：`GameHud` 题目外层包裹 `<div class="flex items-center justify-center">`（仅含一个 `HudPill`）与 `BrushSizeField` 根节点近单元素，改为 `grid place-items-center` 或移除多余 flex。
4. **【重复】`PlayerPanel`** 中 `Brush` / `Eye` 图标的长 class 串逐字重复，提取为常量。
5. **【一致性】`ColorSwatchButton`** 的预设态与自定义态 role/aria 语义不一致（预设 `<label role="button">`、自定义无 role），统一。
6. **【文档】AGENTS「布局规范」与「动画一致性」同步**：
   - 布局规范把 `GameView` 列为 Grid 主页面骨架 → 改为新的浮层布局口径（固定顶栏 + 铺满画布 + 绝对定位浮层 + 底部工具条，见 ADR-0043）。
   - 动画一致性规定 160ms：浮层出入场使用 180/140ms。**保留该手感**，在 AGENTS 补一句「浮层出入场为独立动效，不属按钮/卡片交互动效」；如需可在 ADR-0043 后果段补一行。
7. **【文档】漂移收敛**：`CONTEXT.md` 可直接更新（如「浅层包装」提到 `Tool` 的表述）；`docs/adr/README.md` 索引如需标注。**不要改写既有 ADR 正文**（仓库规定不改写历史）；必要时在 ADR 的「关联」段追加一行现状说明即可。
8. **【测试】集成层补一个用例**：规格「Testing Decisions」要求集成/E2E 覆盖对局界面。补一条 `test/integration` 用例：新骨架渲染（顶栏 + 画布 + 两个浮层面板 + 底部工具条）、面板与工具条可由顶栏开关切换。

## 非目标

- 不改协议、不改服务端语义、不改词库数据。
- 不改写既有 ADR 的决策正文。

## 验收

- 两个浮层面板可互相置顶（后点击/拖动者在上），且仍不高于阶段遮罩。
- `useGameHud` 不再暴露无消费者的 `drawer`，`store-contracts.ts` 同步。
- 上述规范/文案/重复项修复完成，AGENTS 无与实现冲突的表述。

## 验证

- `pnpm format:check && pnpm lint && pnpm typecheck`
- `pnpm test:unit && pnpm test:component && pnpm test:integration && pnpm test:coverage`
- 若条件允许再跑 `pnpm test:e2e`
