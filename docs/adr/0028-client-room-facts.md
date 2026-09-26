# 0028 · 客户端房间事实单一口径

## 状态

已采纳

## 背景

客户端的几项「房间事实」在多个组件里各写一遍：

- **阶段文案**：`useGameHud` 的 HUD 标签与 `PhaseOverlay` 的无障碍播报各写一份
  **逐字相同**的 `Record<RoomPhase, string>`；
- **可玩成员判定**：`RoomView` 的 `allSet` 用 `filter(!spectating)` 判定开局门槛，
  同一文件模板里又内联重算一次 `(members).filter(!spectating).length` 来决定提示文案；
- **玩家人数选项**：`CreateRoomDialog` 用 `for` 循环、`RulesDialog` 用 `Array.from`
  各自构造同一份 `{ value, label: strings.common.playersUnit(count) }` 列表。

同族的正例是既有的 `utils/role-text.ts`（`roleTextFor`，ScoreStrip 与 ChatPanel 共用），
本次按同一套路补齐。

需要澄清的边界：最终榜单的成员口径**不是**可玩成员——服务端榜单刻意保留离局者
（ADR-0023），因此榜单回退不能复用可玩成员选择器；`SeatGrid` 的`seatCount` 是「占席数」
（含观战），与可玩成员不同；`SeatGrid` 的就绪状态三元式是单处使用、无重复，不做抽取。

## 决策

新增两个客户端纯模块：

- `apps/client/src/utils/phase-text.ts`：`phaseTextFor(phase)`，以 `Record<RoomPhase, string>`
  集中阶段文案，缺省回退 `waiting`；`useGameHud` 与 `PhaseOverlay` 改为调用它。
- `apps/client/src/utils/room-facts.ts`：
  - `isActiveMember(member)` / `activeMembers(members)`：非观战且未离局，与服务端
    `member-facts.isActivePlayer` 同口径；`RoomView` 的 `allSet` 与提示文案改用它。
  - `playerCountOptions({ min, max })`：闭区间人数选项；建房与规则弹窗改用它。

**未纳入**：把「房间规则字段」改成声明式 schema（默认值/编辑器/摘要由同一 schema 派生）。
它是跨 `packages/config`、`packages/strings`、协议类型、`RulesDialog` / `RuleSummary` 的
重构，而非复制粘贴去重；本次只收敛真正的重复，规则 schema 作为独立候选另评估。

## 后果

- 阶段文案、可玩成员与人数选项各只有一处定义：改口径只需改一处并补一条单测；
  HUD 标签与阶段播报不会再出现「改了标签忘了播报」。
- 客户端可玩成员口径与服务端 `isActivePlayer` 对齐，读代码时两端口径可互相印证。
- 代价：多两个 `utils` 模块；`playerCountOptions` 只做选项构造，不含 UI 文案以外的规则知识。
- 边界：榜单口径、`SeatGrid` 占席数与就绪状态文案保持原样（语义不同或单处使用）。

## 关联

- 代码：`apps/client/src/utils/phase-text.ts`、`utils/room-facts.ts`、
  `composables/useGameHud.ts`、`components/game/PhaseOverlay.vue`、`views/RoomView.vue`、
  `components/lobby/CreateRoomDialog.vue`、`components/room/RulesDialog.vue`
- 测试：`test/unit/client-room-facts.spec.ts`、`test/component/GameHudPhaseOverlay.spec.ts`
- 来源：2026-09-26 架构评审候选 6（客户端领域事实单一口径）
- 相关：ADR-0023（服务端成员事实，本模块与之对齐）、ADR-0024（回合所有权）
