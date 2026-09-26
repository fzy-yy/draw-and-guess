# 0025 · 重连/重同步独立成 resync 模块

## 状态

已采纳

## 背景

「重连后回到权威状态」这一个行为，此前横跨七个客户端模块：

- `stores/room.ts` 的 `requestFullSnapshot` 同时持有冷却窗口、在途标记、发起时的
  会话世代与房间上下文、迟到响应有效性校验、`RoomSnapshotSchema` 重解析与快照门禁再采纳；
- `composables/useRoomSync.ts` 是门禁决策与增量合并的协调器，并在 `resync` 决策时
  回调 room store；
- `composables/useAppBootstrap.ts` 承载非法推送恢复策略，以及 `roomClosed` 与
  连接被接管两处**重复的跨域重置**（`session.incrementGeneration` + 清房间 + 清词库）；
- `stores/snapshot-gate.ts`（纯门禁）、`stores/session.ts`（世代）、`stores/vocabulary.ts`
  与 `vocabulary-request-context.ts`（失效）、`views/GameView.vue`（绘图回滚触发）。

三处问题：

1. **room store 承载了不属于它的策略**：它本应只持有房间数据与 CRUD，却拥有自愈节流、
   世代校验与协议重解析；`requestFullSnapshot` 无法脱离 room store 单测，集成测试只能
   `vi.spyOn(room, 'requestFullSnapshot')` 绕过验证。
2. **跨域编排散落在组合式函数**：AGENTS 明确要求「跨领域编排只允许写在 Facade 或所属领域
   action 中」，而 `useAppBootstrap` 在两处自行串联 session/room/vocabulary 三个 store。
3. **重复**：`roomClosed` 与「连接被接管」各写一遍同样的重置三连。

## 决策

新建 Pinia store `apps/client/src/stores/resync.ts`，作为客户端权威自愈的单一入口，接口两个动作：

- `requestFullSnapshot(reason)`：受限全量重同步。拥有冷却窗口（`stateResyncCooldownMs`）、
  在途去重、发起时的会话世代与房间/对局/回合上下文、迟到响应有效性校验、协议重解析与
  快照门禁再采纳。名字保持不变，避免改动 5 个调用点、Facade 与契约快照。
- `invalidateSession()`：会话失效（房间关闭 / 连接被接管 / 注销）时的跨域重置——
  自增会话世代（使在途请求与词库响应失效）+ 清房间 + 清词库。

配套改动：

- `stores/room.ts` 删除重同步策略与节流状态，只留数据与 CRUD；
- `composables/useRoomSync.ts` 与 `composables/useAppBootstrap.ts` 改从 resync store 取
  `requestFullSnapshot`，`roomClosed` / 连接被接管的重置三连收敛为 `invalidateSession()`；
- Facade（`stores/game.ts`）转发 resync 的 `requestFullSnapshot` 并暴露 `invalidateSession`；
  `store-contracts.ts` 同步成员名单；
- 选择 Pinia store 而非无状态工厂：自愈节流状态需要按测试 Pinia 实例隔离，调用方也已
  统一使用 store。

## 后果

- 「重连 → 重同步」只有一个所有者，冷却/世代/重解析/重采纳集中在一处；room store 回到
  「只持有数据」，自愈路径可经 resync store 直接单测与断言，不必 spy room store。
- `useAppBootstrap` 不再自行串联多个 store，符合 AGENTS 的跨域编排约束。
- 代价：多了一个 store；调用方读代码时要意识到 `requestFullSnapshot` 已从 room 域迁到
  resync 域，Facade 的转发是稳定层。
- 边界：`useRoomSync` 仍是快照门禁决策与绘图增量合并（`onRoomSnapshot` / `onStroke` /
  `onFill`）的协调器——这些不是自愈请求，未并入本模块。`snapshot-gate.ts` 的纯门禁、
  `vocabulary-request-context.ts` 的词库失效保持不动；非房间推送的 `presence-refresh` /
  `room-list-refresh` / `generic-resync` 恢复策略仍留在 `useAppBootstrap`。

## 关联

- 代码：`apps/client/src/stores/resync.ts`、`stores/room.ts`、`stores/game.ts`、
  `stores/index.ts`、`composables/useRoomSync.ts`、`composables/useAppBootstrap.ts`
- 测试：`test/integration/client-state-coverage.spec.ts`、`socket-lifecycle.spec.ts`、
  `app-runtime-boundaries.spec.ts`、`store-contracts.ts`
- 来源：2026-09-26 架构评审候选 3（重连/重同步独立成模块）
- 相关：ADR-0012（ack 运行时边界）、ADR-0020（推送单注册表）、ADR-0024（回合所有权）
