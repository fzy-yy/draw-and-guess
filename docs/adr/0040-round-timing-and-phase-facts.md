# 0040 · 回合时序与阶段事实收口

**状态**：已采纳

- 来源：2026-09-30 服务端架构审查候选 1/2（回合时序所有权 + 装配与 seam 收口）

## 背景

ADR-0024 把「回合领域」判给了 RoundMachine，但对局**时序**仍从单个职责中间穿过：

- `GameService.startGame` 构造整份 `GameSecret`（28 字段），`RoundMachine.beginChoosing`
  又内联重置 13+ 个回合字段——同一字段集两处手抄，新增字段漏改一处会跨回合残留
  （如漏重置 `fillCount` 会让上一回合的填充预算吞掉新回合额度）；
- `pause` 在 RoundMachine、`resume` 在 GameService：`phaseStartedAt`/`phaseEndsAt` 的
  重建逻辑与暂停现场清理跨两个模块读写；
- 阶段分类白名单内联 4 份（`isPlaying` 不含 paused、`isPausable`、`finishRound` 的
  `['drawing','paused']`、endEarly 的 `|| phase === 'paused'` 补偿），语义漂移已经发生：
  暂停中的房间成员在大厅被显示为「房间中」而非「游戏中」；
- 暂停现场是两个成对存在的可选字段（`phaseBeforePause` / `pausedRemainingMs`），
  类型上允许「半状态」，resume 只能对不可能分支写 `?? 1_000` 兜底；
- `nominalPhaseDurationMs` 只覆盖 drawing / choosing_word，而 round_result 同样是可暂停
  阶段：暂停中的回合结算期，快照把「阶段总时长」误算为冻结剩余量，
  客户端进度条分母等于剩余量、被**钉死在 100%**（已确认行为缺陷）；
- `finishRound` 先改现场（标记已结算、清计时器）再执行阶段转换，与 pauseRoomInternal
  自己写明的「先确认状态机允许，再动现场」纪律相反；
- 装配层有 41 个 `(...args) => this.x(...args)` 延迟闭包（`this.round`/`this.snapshotter`
  构造晚于子服务所致）：丢形参名、装配代码比业务模块还长，窄端口在运行时仍是整份
  GameService 的延迟投影。

## 决策

1. **阶段事实单一口径**：新增 `domain/room/phase-facts.ts`（纯函数）作为阶段分类白名单的
   唯一来源：`IN_MATCH_PHASES`（含 paused）、`PAUSABLE_PHASES`、`ROUND_SETTLE_PHASES`
   与三个谓词。`GameService.isPlaying`、`RoundMachine.isPausable`、`finishRound`、
   `endEarly`、快照端口实现全部改为引用它。阶段标称时长仍归 `member-facts`
   （ADR-0023 的既有归属），但补齐 round_result 分支。
2. **GameSecret 的诞生与全部时序写入归 RoundMachine**：新增 `beginStarting`
   （唯一构造 GameSecret 处，含倒计时）；`resume` 从 GameService 迁入并与 `pause` 成对；
   抽取单一 `resetRoundState`，`beginStarting` 构造骨架后立即调用它，首回合与后续回合
   共用同一清场口径（字段全集只维护一处）。
3. **暂停现场合并为 `pauseState?: { phase; remainingMs }`**：半状态由类型消除，
   resume 无需对不可能分支兜底；`roundSettled` 双标志删除，`roundResult` 成为
   「已结算」的唯一事实。
4. **`finishRound` 先转换阶段、后清理现场**：转换失败即抛出且现场未动，
   不再留下「计时器已清但阶段未推进」的僵死回合。
5. **装配依赖驱动**：constructor 按依赖顺序构造（能力出口 → 持久化/快照 → 发布 →
   回合状态机 → 成员 → 会话 → 绘图/邀请/词库），每个协作者引用已构造对象；
   `RoundContext` / `SnapshotViewPort` 改为显式对象字面量（不再传 `this`）。
   `requestCache` 的绑定归 SessionService（此前 handler 越 seam 直读玩家册）、
   `forceFull` 的游标作废归 SnapshotBuilder（此前 publisher 直接改写领域状态）、
   `RoundContext.players` 收窄为 `ReadonlyMap`。

## 后果

- 进度条缺陷消除（快照矩阵补「暂停 × round_result」专项断言）；字段初始化、阶段白名单、
  暂停现场、结算事实各只有一处定义；装配顺序自解释，形参名不再丢失。
- 行为可见变化：暂停中的房间成员在大厅显示为「游戏中」（isPlaying 含 paused 的语义修正）。
- 代价与边界：新增 phase-facts 模块与装配样板；`resume` 中
  `nominalPhaseDurationMs(...) ?? pauseState.remainingMs` 保留一处类型兜底
  （TS 无法证明可暂停阶段全覆盖，语义上不可达）；`GameService` 的 Facade 转发
  （handlers 只依赖它，见 `service-boundaries.spec.ts`）保持现状——删除转发属独立候选。
- 未纳入本轮：路径默认值统一（`runtime-layout.ts` 已是生产路径唯一权威，各模块默认参数
  只在源码模式生效）、`Context` 成员表进一步收敛、`room-persistence-coordinator`
  去留——均记录为后续独立评估。

## 关联

- 代码：`domain/room/phase-facts.ts`（新增）、`round-machine.ts`、`game-service.ts`、
  `snapshot.ts`、`member-facts.ts`、`models.ts`、`domain/session/session-service.ts`、
  `domain/room/room-membership-service.ts`、`application/room-publisher.ts`
- 测试：`test/unit/snapshot.matrix.spec.ts`（暂停 × round_result 专项）、
  `room-phase-transition.spec.ts`、`runtime-lifecycle.spec.ts`、`room-facts.spec.ts`、
  `member-facts.spec.ts`
- 前序：ADR-0021（快照窄端口）、ADR-0023（成员事实）、ADR-0024（回合所有权，其「剩余」
  清单中的装配投影在本轮评估并部分落地）
