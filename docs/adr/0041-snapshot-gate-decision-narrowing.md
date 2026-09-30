# 0041 快照门禁决策类型按裁决能力收窄：无房间增量的 resync 判空转

**状态**：已采纳

## 背景

客户端推送门禁（`apps/client/src/stores/snapshot-gate.ts`）用单一 `PushDecision`
三值联合（`accept | ignore | resync`）描述所有入口的裁决。两个问题因此产生：

1. `acceptRoomSnapshot` 的全部代码路径只可能返回 `accept | ignore`（快照自带全量
   `stateVersion`，倒退包丢弃即可），但返回类型声明含 `resync`，消费侧
   `useRoomSync` 据此写出的 `decision === 'resync'` 分支永不可达——类型过宽把
   「快照推送损坏可就地触发重同步」这一并不存在的契约想象固化进了代码。
2. `acceptDrawingIncrement` 在本地尚无房间快照时返回 `resync`，而重同步入口
   （`stores/resync.ts`）需要 roomId 才能发起，遇到 `room` 为空直接 return——
   这次「重同步」实际是无操作，读者却会以为存在自愈路径。

## 决策

**一、返回类型按实际裁决能力收窄**：`acceptRoomSnapshot` 返回
`RoomSnapshotDecision = Extract<PushDecision, 'accept' | 'ignore'>`；不可达的
消费分支删除，由类型系统而非人脑守卫「快照门禁不产生 resync」这一事实。

**二、无房间快照时的绘图增量改判 `ignore`**，注释写明「丢弃是裁决而非疏漏」
（重同步入口此时本就无从发起）；有房间但缺 game 镜像的增量维持 `resync`
（入口可正常工作），修订回退类场景的 `resync` 逐字保留——门禁强度只表达、
不放宽。

**三、`useRoomSync` 对外的 `requestFullSnapshot` 转发回收**：生产消费者
（`useAppBootstrap`、Facade）都直连 resync store，该转发成员仅剩编译期名单
（`test/integration/store-contracts.ts`）在维持幻觉；删除后名单同步，
composable 接口面与其真实职责（门禁 + 增量合并）对齐。

## 后果

- 净可观察行为不变：旧「无房间 → resync」路径在运行时同样是什么都不做，
  新口径只是让契约诚实地表达这一点。
- 回归钉死在 `test/unit/client-boundaries.spec.ts`（`!current → ignore` 与
  `!game → resync` 两条断言），后续若有人把裁决改宽会先撞测试。
- 取舍：门禁各入口的返回类型不再同名统一（`PushDecision` vs
  `RoomSnapshotDecision`），换来的是「类型即契约」——新增入口时必须显式
  声明自己能产生哪些决策，而不是顺手复用全联合。
