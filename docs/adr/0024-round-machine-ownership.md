# 0024 · 回合所有权归 RoundMachine

**状态**：已采纳（接龙模式下由平级的 RelayMachine 承担同类写入；请求 API 在 modules 服务、装配在 backend.ts；见 ADR-0058 / ADR-0064）

## 背景

`GameService` 从早期起同时承担三种角色：请求边界（handler 调用的用例方法）、应用装配
（构建七个领域协作者）、以及**回合领域的所有者**（阶段写入、准备失效、对局消息、系统通知、
候选抽取、画家轮换、提示计时器）。`RoundMachine` 被设计为「回合流转状态机」，却通过
17 个成员的 `RoundContext` 回调袋反指 `GameService` 取回这些能力，催生约 19 个
`/** @internal */` 方法和 15 个公开协作者字段。

实测的泄漏：

- 阶段转换 `transition`（`room.phase` 的唯一写入点）、准备失效 `invalidateReady`、
  对局消息 `addMessage`、系统通知 `addSystemNotice`、提示计时器清理 `clearHintTimers`
  都定义在 `GameService`，由 `RoundMachine` 与成员/词库子服务经回调调用；
- 候选抽取 `pickCandidates`（含 `sampleDiverseCandidates`）、画家轮换 `findNextDrawer`、
  纯规则 `isPausable` / `shuffle` 同样如此；
- `RoundContext` 的每个成员都是一份手写的回指投影，import 环被窄端口切断，但运行时耦合照旧。

## 决策

把**回合领域的所有权**整体移入 `RoundMachine`：

- 归 `RoundMachine`：`transition`（阶段写入 + 版本号 + 日志）、`invalidateReady`、
  `addMessage`、`addSystemNotice`、`clearHintTimers`、`isPausable`、`shuffle`、
  `sampleDiverseCandidates`、`pickCandidates`、`findNextDrawer`。
- `RoundContext` 收窄为 12 个成员，只剩**运行时**（clock / scheduler / random / logger）、
  **地图读取**（players）、**词库查询**（getRoomVocabularyStore）、**跨模块副作用出口**
  （emitSystemNotice / emitRoom / broadcastPresence / persistGameResult / safeRun）与
  `requireGame`。新增 `emitSystemNotice` 作为系统通知的唯一传输出口。
- 成员/会话/词库等子服务的接线改为指向 `this.round.*`；`GameService` 删除对应
  10 个 `@internal` 方法，退为请求 API 与装配适配。
- **阶段写入静态守卫**（`test/unit/room-phase-transition.spec.ts`）由「服务端只有
  `game-service.ts` 写 `room.phase`」改为「只有 `round-machine.ts` 写」。

不改动 `SnapshotViewPort`（ADR-0021）与其 `isPlaying`：它是快照裁剪的既有窄端口，
`isPlaying` 保留在 `GameService` 供该端口与成员子服务使用，避免把本轮所有权迁移
扩散到快照边界。七个 `Context` 之间重复的手写投影（session / membership / invite /
drawing / vocabulary）不在本轮范围，留待后续独立评估。

## 后果

- 回合规则、阶段与对局消息只有一个所有者，改动集中在 `round-machine.ts`；`RoundContext`
  不再是「回指 GameService 的回调袋」，而是真正的运行时/副作用窄端口。
- `GameService` 的公开面显著收窄（约 19 → 9 个 `@internal`），更接近「请求边界 + 装配」。
- 代价：阶段写入点从 `game-service.ts` 迁到 `round-machine.ts`，凡依赖「GameService 写阶段」
  的心智模型与文档需要同步；子服务改经 `this.round.*` 调用，读代码时要意识到 `round`
  已经是回合领域的入口而非纯状态机。
- 剩余：七个 `Context` 的重复投影、`GameService` 仍保留的少量 `@internal`
  （`emitRoom` / `requirePlayer` / `requireGame` / `getRoomVocabularyStore` /
  `getDrawingSession` / `isPlaying` 等）是跨模块端口的必要出口；若继续收敛，应作为
  独立候选评估，不要在回合迁移里顺带扩大。

## 关联

- 代码：`apps/server/src/round-machine.ts`、`game-service.ts`、
  `domain/game/round-context.ts`、`domain/room/room-membership-service.ts`、
  `domain/vocabulary/room-vocabulary-service.ts`
- 测试：`test/unit/room-phase-transition.spec.ts`（阶段写入静态守卫）
- 来源：2026-09-26 架构评审候选 1（让 RoundMachine 拥有比赛状态）
- 相关：ADR-0018（客户端画布决策入机，同型「决策归模块」取舍）、ADR-0023（成员事实单一口径）
