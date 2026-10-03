# 0054 · 绘图工具条改为画家常驻不可隐藏与手柄拖拽移动

**状态**：已采纳

- 来源：2026-10-03 对局界面与画板操作体验优化。

## 背景

1. **工具条显隐冗余且增加误操作**：对局顶栏此前提供调色盘图标按钮（`SquareIconButton`）及 `T` 快捷键，用于展开/收起底部绘图工具条。但在实际对局中，画家作画期间工具条是核心交互控件，收起并无实际收益，反而容易误触关闭导致作画中断；而猜词者本就无作画权限，工具条置灰显示不仅占用画布视野，也容易让猜词者困惑；
2. **工具条遮挡画布局部且无法移开**：工具条此前固定在画布底部居中（`bottom-[1.2cqh] left-1/2 -translate-x-1/2`），若画家需要在画布正下方作画，工具条会遮挡视线与落笔区域，缺乏类似聊天面板的拖拽避让能力。

## 决策

1. **顶栏移除工具条开关，工具条不可被隐藏**：
   - 彻底删除 `GameHud.vue` 顶栏上的工具条调色盘切换按钮（`toggleTools`）；
   - 工具条可见性收敛为仅对画家展示（`showToolbar = computed(() => store.isDrawer)`），猜词者恒不显示且不可被打开；画家作画阶段自动显示，且无法被收起或隐藏；
   - 彻底移除 `toolsPanelShortcut` 快捷键（默认 `T`）、设置项及其在 `SettingsView.vue` 与 `packages/config/src/settings.ts` 中的配置与文案，代码与 UI 保持极简。
2. **工具条最左侧新增竖向六点拖动手柄**：
   - 在 `CanvasToolbar.vue` 内部工具组左侧新增 `GripVertical` 六点拖动手柄，悬停显示抓取手势（`cursor-grab` / `active:cursor-grabbing`）；
   - 使用统一的 Pointer Events API（`setPointerCapture`）实现平滑拖动；
   - 拖拽范围通过父级画布容器的 `getBoundingClientRect` 严格限制在画布可视区内部（`clamp`），防止被拖出屏幕或盖死顶栏。
3. **换人作画或新回合开始时自动重置位置**：
   - 工具条位置采用百分比模型（`position: { x: number, y: number } | null`），未拖拽时保持默认的底部居中布局；
   - 在 `GameView.vue` 中监听 `[game?.roundId, game?.currentDrawerId]`，当新回合开始或轮换下一位画家时，自动将 `position` 置为 `null`，重置回底部居中默认位置，保证新回合界面规范一致。

## 后果

- 对局顶栏视觉更清爽，减少了一个不必要的冗余开关；
- 画家在作画时拥有了拖拽工具条避让作画区域的能力，画布利用率和操作自由度提升；
- 猜词者界面视野纯净，不再有置灰的工具条干扰猜词与看画；
- 设置页移除了已无实际语义的快捷键配置项，无死键与无效配置。

## 关联

- 代码：`apps/client/src/components/game/{CanvasToolbar,GameHud}.vue`、`apps/client/src/views/{GameView,SettingsView}.vue`、`apps/client/src/composables/usePanelShortcuts.ts`、`packages/config/src/settings.ts`、`packages/strings/src/a11y/game.ts`
- 规范：`CONTEXT.md`（「底部工具条」条目）、`AGENTS.md`（「对局骨架」相关说明）
- 相关：[ADR-0043](0043-game-view-floating-layout.md)（对局界面浮层布局与横向底部工具条）、[ADR-0044](0044-panel-shortcuts-and-unified-topbar.md)（对局面板显隐快捷键与顶栏高度统一）
