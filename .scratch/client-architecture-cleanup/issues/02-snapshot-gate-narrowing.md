# 02 snapshot-gate 返回类型收窄与 useRoomSync 死分支回收（行为修复③）

Status: ready-for-agent

## 背景

深审发现 `PushDecision` 三值联合中，`acceptRoomSnapshot` 的全部代码路径只可能返回
`accept | ignore`，但类型声明含 `resync`，导致消费侧 `useRoomSync` 存在一个永不可达的
`decision === 'resync'` 分支；同时 `acceptDrawingIncrement` 在本地无房间快照时返回 `resync`，
而重同步入口（resync.ts）此时因 `room` 为空直接 return——「resync」语义落空，属误导性契约。
用户裁决：**修复③获批**。

## 文件归属

- apps/client/src/stores/snapshot-gate.ts
- apps/client/src/composables/useRoomSync.ts
- test/integration/store-contracts.ts（仅当 useRoomSync 成员名单联动）
- 测试联动：grep 涉及 `acceptRoomSnapshot` / `requestFullSnapshot` 的 spec（如
  test/integration 下 room-sync / snapshot-gate 相关），按新签名/新成员表同步

## 事项清单

1. **snapshot-gate.ts 补文件级头注释**：三值决策各自的触发场景（accept/ignore/resync），
   resync 仅由修订回退类场景产生；补 `acceptRoomSnapshot` 各分支「为什么」（game 消失/gameId
   变化时须 stateVersion 前进才 accept 等）。
2. **`acceptRoomSnapshot` 返回类型收窄为 `'accept' | 'ignore'`**（用独立类型别名或
   `PushDecision` 的子集），保持运行时行为不变。
3. **`acceptDrawingIncrement` 的 `!current` 分支改返回 `'ignore'`**，并注释「本地无房间快照时
   重同步入口无从发起（需 roomId），丢弃是裁决而非疏漏」；修订回退（revision < lastSequence
   类）分支维持 `'resync'` 不动。
4. **useRoomSync.ts**：删除对 `acceptRoomSnapshot` 结果的 `decision === 'resync'` 不可达分支
   （类型收窄后编译即强制）；核对 `acceptDrawingIncrement` 消费的 resync 分支仍然可达、保留。
5. **useRoomSync.ts 返回成员 `requestFullSnapshot` 回收**（生产零调用，bootstrap 与 Facade 都
   直连 resyncStore；先 grep 全仓确认唯一引用是 store-contracts.ts 名单）：
   - 从 composable 返回值删除；
   - 同步 `test/integration/store-contracts.ts` 的 useRoomSync 成员名单；
   - 若 grep 发现 stores/game.ts Facade 有转发引用，则连该一行一起删（**这是本单唯一允许
     触碰 game.ts 的情形**，仅限删除 requestFullSnapshot 转发）。
6. 若第 5 步 grep 发现生产真实消费者，立即改为「保留 + 定性注释」，并在报告中说明。

## 约束

- 不放宽任何门禁强度：只删类型不可达分支与零消费者成员，其余裁决逻辑逐字保留。
- 中文注释；行为修复③已获用户批准，报告中单列。

## 验收

`npx prettier --write <改动文件>` → `npx eslint <改动文件>` → `pnpm typecheck` 全绿 →
`pnpm test:integration` 通过（store-contracts 由 vue-tsc 在 typecheck 阶段把关）。
