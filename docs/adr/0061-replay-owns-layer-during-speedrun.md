# 0061 · 回放进行中逻辑层归回放所有

**状态**：已采纳

- 来源：2026-10-18 缺陷修复——「接龙复盘画作重播时，在聊天框发言会让重播立刻结束」

## 背景

回合结算（经典 `round_result`）与接龙复盘半场（`relay_showcase`）都会用
`DrawingReplayMachine.speedrun()` 做一次 3 秒的画作快速重播（ADR-0057）。
重播期间，**任何**引起房间快照替换的推送都会走同一条路径进入机器：

1. 接龙聊天（`chat:say`）写消息后服务端 `emitRoom`，向全房推一份完整 `room:snapshot`
   （`RelaySnapshotBuilder` 每次重建视图，`showcase.drawing.strokes` 因此是一个
   **内容与权威完全相同、数组身份却是新的**数组）；
2. 客户端 `acceptRoomSnapshot` 对同 `stateVersion` 的聊天快照照常采纳，
   `useRoomSync` 整棵替换房间对象（经典房有一条「修订/序号未前进则复用本地数组引用」的优化，
   接龙视图没有）；
3. `GameCanvas` 的转发 watch 以 `props.strokes` **引用**为触发源，于是调用
   `machine.sync({ commands: 新数组, … })`——递进来的其实是同一段历史。

而 `sync()` 当时并不知道有回放在飞（`speedrunCancel` 只在机器内部），于是照常做「增量 vs 整帧」
决策，两条分支都会毁掉回放：

- 历史里存在尚未重放到的那条**填充**时命中 `missingFill` → `replay()` → `cancelSpeedrun()`，
  `speedrun()` 的 Promise 当场 resolve，宿主的「重播 → 停顿 → 结算」节奏被打断（画面跳到成品）；
- 无填充时走 `drawIncoming()`，它用 `drawn.get(id) ?? 0` 作起点，而重播中 `drawn` 只记录
  **已重播进度**（起步即清空、后续渐进填充），于是回放尚未画到的笔迹被**一次性补完**，
  画面同样瞬间跳到成品。

经典模式下结算期聊天框被禁用（`canGuess` 要求 `phase === 'drawing'`），所以现象只在
「聊天恒可用」的接龙复盘期暴露；但同一缺陷对任何同回合快照推送都成立。

## 决策

**回放进行中，逻辑层归回放所有：`sync()` 对同回合快照只登记、不改写画面。**

- `sync()` 先按 `roundId` 判回合：回合变化（换半场 / 换回合）仍照旧取消回放并走正常路径——
  画面内容确实换了一幅，重播必须重来；
- 回合未变且 `speedrunCancel` 非空（回放确在飞）时，只登记最新快照后直接返回：不重放、不增量补画；
- 快照不会被丢弃：回放结束时 `finish()` 本来就以最新快照执行一次整帧重放，最终画面仍与权威一致
  （ADR-0017 的原子提交语义不变）；
- 机器的状态入口仍是 `sync()` 唯一，调用方（组件 / store）不需要知道回放，也不需要自行
  比较数组身份（决策归属见 ADR-0018）。

## 后果

- 重播不再被聊天、成员变动、系统通知等纯展示推送打断，玩家发言与观赏互不干扰；
- 代价：回放窗口内（≤ 重播时长）同回合的权威变更最多延迟到回放收尾才落到逻辑层；
  该窗口内画作本就冻结（结算 / 复盘期不产生新笔画），因此没有可见损失；
- 若回放期间回合真的推进，行为与修复前一致（取消当前回放、按新回合重建，由宿主再次触发重播）。

## 关联

- 代码：`apps/client/src/canvas/replay-machine.ts`（`sync` 的回放守卫、`speedrun`、`finish`）、
  `apps/client/src/components/game/GameCanvas.vue`（快照转发 watch）、
  `apps/client/src/composables/useRoomSync.ts`、`apps/server/src/domain/relay/relay-snapshot.ts`
- 测试：`test/component/canvas-replay-machine.spec.ts` 的「回放期间的快照同步」两条用例
  （无填充＝增量补完路径、含填充＝取消回放路径），均在旧实现上验证过失败
- 相关：ADR 0017（重放原子提交）、ADR 0018（画布重放状态机）、ADR 0057（回合画作快速重播）、
  ADR 0058（接龙模式权威推进）
