# 0052 · 顶栏操作按钮统一为图文胶囊并收敛基座组件

**状态**：已采纳

- 来源：2026-10-03 顶栏视觉与组件走查。

## 背景

大厅（LobbyView）、房间等待页（RoomView）与设置页（SettingsView）共用 `StageHeader` 顶栏骨架，但此前各顶栏的操作按钮写法分裂：

1. **按钮文字不统一**：大厅「设置」与设置页「返回」有图标和文字，而房间「退出」按钮使用的是纯图标方块 `IconButton`（无可见文字），造成同一层次的顶栏按钮视觉语言不一致；
2. **缺乏顶栏按钮基座**：大厅「设置」与设置页「返回」各自在模板中内联了原生 `<button>` 与一长串行内类（padding、高度、圆角各异）；
3. **网络状态指示未复用按钮结构**：`NetworkStatusButton` 作为独立业务组件自行实现了 button 结构与内联尺寸，与旁边的设置按钮在视觉细节上略有脱节；
4. **大厅标题层级冗余**：原标题为竖向双行（应用名 + `ONLINE LOBBY` 英文副标），占用纵向空间且中英文混排不够精炼；
5. **房间居中标题偏小**：房间等待页原本的盾牌/钥匙图标与公开/私密文案仅为 `text-fs-12`，居中视觉份量显著弱于大厅；
6. **对局倒计时胶囊长度抖动**：倒计时从 3 位数减至 2 位数、1 位数时胶囊随文本宽度收缩，不限时状态下中文字「不限时」又使长度突变，视觉跳动明显。

## 决策

1. **抽取统一顶栏按钮基座 `StageHeaderButton`**：
   收敛顶栏胶囊按钮规格：高度固定 `4.6cqh`、圆角 `rounded-[0.6em]`、内边距 `px-[0.8em]`、水平单行 flex 排版（`gap-[0.4em]`）、字体规范（`text-fs-14 font-bold`）与交互动效（`.ui-feedback`、点击音效）；
   根元素 class 透传经 `cn()` 自动合并，允许外部或业务包装按需覆盖或追加颜色类。
2. **顶栏主要操作统一为「图标 + 文字」**：
   - 房间等待页「退出」按钮改用 `StageHeaderButton`，增加可见文案「退出」（`strings.ui.room.exit`）；
   - 大厅「设置」按钮与设置页「返回」按钮统一替换为 `StageHeaderButton`，消除散落的原生内联 `<button>`。
3. **网络状态指示复用底层基座**：
   `NetworkStatusButton` 内部改由 `<StageHeaderButton>` 作为根渲染，仅保留其网络测速、4 档质量颜色（绿/橙/红/中性）与 ARIA/title 逻辑，既复用了顶栏统一底座，又保留了网络领域的自包含封装与独立单测。
4. **大厅标题精简为单行**：
   移除英文副标 `ONLINE LOBBY`，改为水平单行 Gamepad 图标 +「你画我猜游戏大厅」（`strings.ui.lobby.lobbyTitle`）。
5. **对局 GameHud 顶栏保持纯图标**：
   GameHud 对局顶栏控件密集（包含回合、倒计时、题目遮罩、画板工具、聊天开关、暂停、设置、全屏、退出等 8+ 个控件），在 1280×720 视口下宽度极度敏感，故继续保留紧凑无文字的 `IconButton` / `SquareIconButton`。
6. **房间居中标题与大厅居中标题 1:1 对齐**：
   图标统一约束为 `4.2cqh`（`KeyRound` / `ShieldCheck`），文字提升为 `text-fs-18 font-bold leading-none`，间距 `gap-[0.6em]`，保持大厅与房间顶栏中心视觉权重一致。
7. **对局倒计时胶囊三位等宽固定与数字居中**：
   数字容器锁定为 `w-[3ch] text-center tabular-nums`，三位变两位、一位时数字在 3 字符宽度的盒内水平居中；不限时状态改用大字号「---」（`strings.ui.game.chooseNoLimit`）居中填充，单位后缀以 `invisible` 占位，使整个胶囊在倒计时全程与不限时状态下的几何长度绝对恒定。

## 后果

- `StageHeader` 顶栏的操作与状态按钮完全统一：尺寸对齐、圆角一致、均带文字说明，视觉与交互手感整齐划一。
- 消除了多处视图模板内散落的原生 `<button>` 重复类名。
- `NetworkStatusButton` 无侵入地复用了顶栏按钮结构，原有的 props 接口、质量颜色映射和单元测试完全兼容。
- 维护规则：`StageHeader` 顶栏内的新增操作按钮一律优先使用 `StageHeaderButton`，禁止在调用点重新内联私有 `<button>` 样式。

## 关联

- 代码：`apps/client/src/components/common/StageHeaderButton.vue`、`NetworkStatusButton.vue`、`StageHeader.vue`、`components/game/GameHud.vue`、`views/{LobbyView,RoomView,SettingsView}.vue`、`packages/strings/src/ui/{lobby,room,game}.ts`
- 规范：`CONTEXT.md`（「顶栏按钮」、「固定等宽倒计时」条目）
- 相关：[ADR-0029](0029-shallow-wrappers-kept.md)（浅层包装保持现状）、[ADR-0044](0044-panel-shortcuts-and-unified-topbar.md)（对局面板显隐快捷键与顶栏高度统一）
