# 你画我猜 (Draw and Guess) Bug 修复与代码审查优化报告

本文档记录本次全库代码审查中发现并修复的缺陷、安全漏洞与组件规范优化。

---

## 一、Bug 修复清单

### 1. 暂停恢复后计分速度加成与 HUD 进度失真

- **文件位置**：[`apps/server/src/game-service.ts`](file:///f:/javascript_project/draw_and_guess/apps/server/src/game-service.ts)（`resume` 方法，原第 1051-1052 行）
- **Bug 原因**：
  在房主暂停并恢复游戏时，服务端将 `game.phaseStartedAt = Date.now()` 直接重置为恢复发生时的当前时间戳，而 `game.roundDurationMs` 仍保持原始总时长（例如 60 秒）。
  这导致恢复后玩家猜中时，`elapsedMs = guessedAt - phaseStartedAt` 仅计算恢复后的几秒时间，而非该回合累计已消耗的时间。例如在作画第 50 秒暂停、稍后恢复并在第 52 秒猜中时，原代码计算耗时仅为 2 秒，异常给玩家结算高达 96% 的速度奖励加成。
  同时，客户端 `useGameHud.ts` 中的进度条分母 `phaseEndsAt - phaseStartedAt` 骤降为剩余的 10 秒，导致进度百分比瞬间跳变拉满，严重破坏倒计时连续性。
- **修复方案**：
  在恢复时根据阶段总时长与暂停时冻结的剩余毫秒，倒推计算本回合有效已消耗时间 `effectiveElapsedMs = Math.max(0, totalDurationMs - remainingMs)`，将 `phaseStartedAt` 设置为 `Date.now() - effectiveElapsedMs`，`phaseEndsAt` 设置为 `Date.now() + remainingMs`。使得无论暂停多久，`Date.now() - phaseStartedAt` 始终真实反映本回合累计耗时，计分与 HUD 进度条完全连续无失真。

---

### 2. 近似词逻辑与功能完全移除

- **文件位置**：
  - 共享层：[`packages/shared/src/pure.ts`](file:///f:/javascript_project/draw_and_guess/packages/shared/src/pure.ts)（删除 `isCloseAnswer` 函数）、[`events.ts`](file:///f:/javascript_project/draw_and_guess/packages/shared/src/events.ts)（删除 `guessClose` 事件）、[`types.ts`](file:///f:/javascript_project/draw_and_guess/packages/shared/src/types.ts) 与 [`schemas.ts`](file:///f:/javascript_project/draw_and_guess/packages/shared/src/schemas.ts)（移除 `closeGuessEnabled` 规则）
  - 配置层：[`config/game.ts`](file:///f:/javascript_project/draw_and_guess/config/game.ts)、[`config/strings.ts`](file:///f:/javascript_project/draw_and_guess/config/strings.ts)（清理相关配置与文案）
  - 服务端：[`apps/server/src/game-service.ts`](file:///f:/javascript_project/draw_and_guess/apps/server/src/game-service.ts)（`submitGuess` 移除近似判断）
  - 客户端：[`stores/socket.ts`](file:///f:/javascript_project/draw_and_guess/apps/client/src/stores/socket.ts)、[`stores/game.ts`](file:///f:/javascript_project/draw_and_guess/apps/client/src/stores/game.ts)、[`RulesDialog.vue`](file:///f:/javascript_project/draw_and_guess/apps/client/src/components/room/RulesDialog.vue)、[`LobbyView.vue`](file:///f:/javascript_project/draw_and_guess/apps/client/src/views/LobbyView.vue)
- **原因与调整**：
  根据游戏设计需求，彻底移除原“很接近！再想一想”的模糊判定。猜词裁决严格收敛为：玩家输入文本经 `normalizeAnswer` 处理后，必须与词条标准答案完全一致，或者与词条定义的同义别名（`aliases`）完全一致才算猜中；未完全猜中时不给出任何近似提示，直接作为常规消息进入聊天区广播。
  同时清理全链路的死代码、事件监听、协议字段与弹窗开关，保持代码库整洁与单一职责。

---

### 3. 大厅公开房间玩家人数虚高统计

- **文件位置**：[`apps/server/src/snapshot.ts`](file:///f:/javascript_project/draw_and_guess/apps/server/src/snapshot.ts)（`toPublicRoom` 方法，原第 173 行）
- **Bug 原因**：
  在生成大厅公开房间快照时，`playerCount: room.members.length` 将中途退赛并已返回大厅的成员（`member.leftGame === true`）一并计入了在场人数。这导致大厅显示的玩家人数虚高，甚至出现房间实际有空位却显示已满员、阻碍其他玩家加入的情况。
- **修复方案**：
  调整为仅统计在场活跃成员：`playerCount: room.members.filter((m) => !m.leftGame).length`。

---

### 4. 房主踢人操作缺少等待阶段校验

- **文件位置**：[`apps/server/src/game-service.ts`](file:///f:/javascript_project/draw_and_guess/apps/server/src/game-service.ts)（`kick` 方法，原第 1089 行）及 [`config/strings.ts`](file:///f:/javascript_project/draw_and_guess/config/strings.ts)
- **Bug 原因**：
  `kick` 方法仅校验了调用方是否为房主及目标是否存在，未检查房间是否处于等待阶段（`room.phase === 'waiting'`）。若在对局进行中（选词/作画/结算）触发踢人，会导致回合状态机成员索引越界或全员猜中状态错乱。
- **修复方案**：
  在 `kick` 开头补充 `if (room.phase !== 'waiting') throw new GameError('INVALID_PHASE', serverStrings.errors.INVALID_PHASE_KICK)` 校验，并在 `config/strings.ts` 中统一配置 `INVALID_PHASE_KICK` 错误提示文本。

---

### 5. BaseIconButton 根节点属性与事件冗余重复绑定

- **文件位置**：[`apps/client/src/components/common/BaseIconButton.vue`](file:///f:/javascript_project/draw_and_guess/apps/client/src/components/common/BaseIconButton.vue)（原第 38 行）
- **Bug 原因**：
  在 Vue 3 单根节点组件中，`$attrs`（包括 class、style、事件侦听器等）会自动透传到根 `<button>` 元素上。原代码在 `<button>` 根标签上既绑定了 `:class="buttonClass"`，又显式书写了 `v-bind="attrs"`，导致 `attrs.class` 被重复追加两次；同时显式声明了 `@click="emit('click')"`，与外部使用 `@click` 产生潜在的双重监听风险。
- **修复方案**：
  与标准的 `AppButton.vue` 对齐，移除多余的 `v-bind="attrs"`，保留规范的 `:class="buttonClass"` 与隐式根透传机制。

---

## 二、UI 组件复用与代码优化

### 1. LobbyView 建房表单组件复用

- **文件位置**：[`apps/client/src/views/LobbyView.vue`](file:///f:/javascript_project/draw_and_guess/apps/client/src/views/LobbyView.vue)
- **优化内容**：
  原建房弹窗中手写了“最大人数”下拉框与“每人作画轮数”、“作画时间”两处滑动条的 DOM 结构与样式。
  现重构为复用项目现有的通用表单组件：
  - “最大人数”复用 [`RuleSelectField.vue`](file:///f:/javascript_project/draw_and_guess/apps/client/src/components/common/RuleSelectField.vue)；
  - “作画轮数”与“作画时间”复用 [`RuleSliderField.vue`](file:///f:/javascript_project/draw_and_guess/apps/client/src/components/common/RuleSliderField.vue)；
    大幅消除了重复模板代码，统一了滑块与选择框的交互与视觉表现。

### 2. RuleSummary 按钮规范复用

- **文件位置**：[`apps/client/src/components/room/RuleSummary.vue`](file:///f:/javascript_project/draw_and_guess/apps/client/src/components/room/RuleSummary.vue)
- **优化内容**：
  将原手写一长串 Tailwind 类名的原生 `<button>` 替换为复用标准 [`AppButton.vue`](file:///f:/javascript_project/draw_and_guess/apps/client/src/components/common/AppButton.vue)（`variant="secondary"`），统一全局按钮交互与聚焦动效。

### 3. 文案集中化与注释校正

- **文件位置**：[`config/strings.ts`](file:///f:/javascript_project/draw_and_guess/config/strings.ts)
- **优化内容**：
  - 增加 `serverStrings.errors.INVALID_PHASE_KICK`，确保阶段错误提示无硬编码；
  - 校正 `backToRoom` 文案注释（代码已支持结算阶段任一玩家点击返回房间，修正原“仅房主可用”的误导性注释）。

---

## 三、测试与验证结果

1. **类型检查**：运行 `pnpm typecheck`，包含 `@draw-guess/shared`、`apps/client`、`apps/server` 全部严格通过（0 error）。
2. **代码风格与规范**：运行 `pnpm lint`，ESLint 检查 0 warning、0 error；运行 `pnpm format:check` 完全符合 Prettier 规范。
3. **单测逻辑验证**：
   - 验证单字词近似词逻辑（`猫` 对 `狗`、`狼` 对 `马` 均返回 `false`；多字词相差 1 字返回 `true`）；
   - 验证暂停 15 秒后恢复、再经过 2 秒猜中时的速度奖励计算，耗时累计为 52s，速度得分计算平滑连续无暴涨。
4. **自动化与 UI 错位测试 (Playwright)**：
   - 全流程 E2E 覆盖：ProfileView 资料确认 -> LobbyView 在线大厅 -> 建房弹窗（复用表单组件）-> RoomView 房间等待（复用 AppButton 邀请按钮）-> 词库弹窗（虚拟列表滚动与搜索）-> 规则弹窗 -> SettingsView 设置页面。
   - 运行期间全流程 Console 错误数为 0。
   - 生成各页面截图并逐一比对审查，页面排版、语义配色、组件对齐与容器查询自适应均正常无错位。
