# T03 · 客户端对局界面浮层布局与新共享组件

**Status**: ready-for-agent
**Blocked by**: 01

> 依据：`.scratch/game-ui-redesign/spec.md`、`docs/adr/0043-game-view-floating-layout.md`。
> 视觉参照：`prototypes` 分支的 `apps/client/prototype/game-layout/`（原型仅作参照，不作为交付物）。

## 目标

把对局界面由 3×3 网格改为「固定顶栏 + 铺满画布 + 浮层面板 + 底部横向工具条」，并把重复样式收敛为共享组件。

## 范围

新增（`components/game/`，并在 barrel 导出）：

- `FloatingPanel.vue`：浮层壳——标题栏拖动、关闭、`.game-stage` 内位置夹取、统一「淡入淡出 + 缩放」出入场。
- `PlayerPanel.vue`：收窄玩家列表（头像 + 昵称 + 分数 + 局内角色 + 座位色条），**不含「我」标记**。
- `CanvasToolbar.vue`：底部横向工具条（工具 / 色板 / 画笔大小 / 历史），**无阴影**，除画笔数值外无文字。
- `BrushSizeField.vue`：画笔大小数值控件——只显示数值；悬停时鼠标指针变为与当前粗细同直径的画笔圆点；滚轮调整。

提升为 `components/common/` 共享原语（消除相同样式重复类串）：

- 方形图标按钮（顶栏面板开关与工具条按钮共用底座/激活态）。
- 圆形色板按钮（预设色 + 自定义取色，统一选中环）。
- 分组分隔线。

改造：

- `GameHud.vue`：删「当前画家」与提示区；并入面板开关（`ROUND` 在最左，按钮右排）；高度 `9cqh`；保留题目、倒计时、网络、暂停、设置、全屏。
- `views/GameView.vue`：改为顶栏 + 铺满画布（含黑色描边、圆角 `0.7em`、极微边距）+ 浮层面板 + 底部工具条；保留阶段遮罩、设置弹窗与各确认弹窗。

删除：

- `components/game/ScoreStrip.vue`、`components/game/DrawingToolbar.vue` 及其 barrel 导出与 `role-text` 中仅服务它们的注释表述（若 `role-text` 仍被别处使用则保留）。

尺寸（与原型一致）：顶栏 `9cqh`；玩家面板 `10cqw`、聊天面板 `24cqw`、均 `h-full`；面板默认打开、贴左右两缘；底部工具条默认打开、浮于画布底部居中。

## 非目标

- 不改房间/大厅/设置页（T04 只处理房间规则与词库弹窗）。
- 不改画布渲染链路（`GameCanvas` / `replay-machine` 行为不变）。

## 验收

- 对局界面按新骨架渲染；面板可拖动、可关闭、可从顶栏开关重开；底部工具条可开关。
- 猜词者视角看不到任何提示文案。
- 消除被删组件的全部引用（含 `components/game/index.ts` 与测试）。
- 所有中文展示文案走 `@draw-guess/strings` 或原型同级的集中来源，禁止硬编码。

## 验证

- `pnpm exec eslint apps/client/src`
- `pnpm --filter @draw-guess/client typecheck`
- 组件测试相关失败清单交 T05。
