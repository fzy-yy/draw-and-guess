# 0064 · 单一后端装配根与唯一请求面

**状态**：已采纳

## 背景

`apps/server/src` 曾同时存在两套后端：`server.ts` 里的 modules 装配（`registerAllGateways` 是唯一事件注册点），
与 `game-service.ts` 里 1,152 行的 `GameService`（自带一份 `DomainContext` 内存表、两个状态机、两个绘图服务）。
生产请求只走前者：`GameService` 在本仓唯一的调用点是 `index.ts` 的 `recoverOnStartup()`，而同一个动作
`server.ts` 已对活着的会话服务执行过。后果分三层：

1. 用例层写了两遍（开局 / 选词 / 换一批 / 自定义词 / 提前结束 / 再来一局），两边的错误类还不同；
2. 单测全部打在 `GameService` 上（26 个 spec 文件），于是「测过了」说的是另一个程序；
3. 文档与代码互相指着：`AGENTS.md` 教人去 `handlers/*.ts` 注册事件（那 5 个文件没有任何注册点），
   `docs/后端架构规范.md` 把已废弃的 `ws/handler-kit.ts`、`ws/contracts.ts` 写成权威，
   而 `handlers/*` 的存在还被 `service-boundaries.spec.ts` 断言着。

分叉已经在生产上兑现：活路径的绘图守卫抛裸 `Error`，经 `toAppError` 收敛为 `INTERNAL_ERROR`——
接龙画布的越权与过期收不到 `STALE_DRAW_EVENT` / `ALREADY_SUBMITTED`，客户端据此重同步的分支永远不触发；
每一次迟到的经典笔画批次都变成 500 与一条「未预期的服务器内部错误」日志。接龙的阶段过期校验
只存在于已废弃的那份实现里。归档与邀请同理：`RoomPersistenceCoordinator` 与
`SnapshotBuilder.toPublicInvite` 是统一实现却无人调用，生产内联的两份拷贝已经分叉
（接龙战报 `stats` 恒为 `'{}'`；邀请解析广播给全房间）。

## 决策

1. **唯一装配根**：新增 `apps/server/src/backend.ts` 的 `createBackend(deps): Backend`，
   负责内存上下文、发射适配器、视图/发布、两个状态机、六个模块服务与网关依赖。
   `server.ts` 只保留数据库、HTTP、Socket.IO 与关闭顺序；入口经 `application.backend` 访问领域。
2. **测试跨同一接缝**：单测经 `createBackend` + 假 io 构造世界，不再经过第二套用例层。
   `GameService`、`handlers/*`、`ws/handler-kit.ts`、`ws/contracts.ts` 与被它们牵着的兼容转发层随之删除，
   并由守卫测试禁止复活。
3. **拒绝语义归命令用例**：绘图目标解析以 `DrawingTargetDecision` 返回值表达「为什么不能画」，
   `DrawingService` 是唯一把拒绝映射成 `GameError`（含 `PHASE_EXPIRED`）的地方；
   装配根不再决定一个拒绝意味着什么，也不再抛裸 `Error`。
4. **死孪生一并收口**：`MODE_SETTINGS_KEYS` 收到 `packages/shared`（两端同时引用，客户端镜像删除）；
   归档与邀请改用既有统一实现（可观察行为变更单独提交）；`relayDrawingService` 由可选改必选，
   缺省不再静默丢掉整族接龙绘图事件。

## 后果

- 服务端只剩一条请求面：`ws/gateway.ts` 注册、`backend.ts` 装配、模块服务执行。
- 单测与生产共用装配函数；「生产行为没被测到」这类问题不再有土壤。
- 代价：26 个 spec 的调用点从 `harness.service.X` 改为 `harness.backend.<领域>.X`，
  迁移期用一个临时适配器保持全绿，适配器删除是本次任务的完成判据。
- 拒绝码变稳定后，客户端 `error-recovery` 的既有分支恢复生效，`INTERNAL_ERROR` 日志噪声消失；
  接龙绘图补上阶段过期校验，与经典同口径。
- 未一并处理：`domain/**` 与根部的 `export *` 转发文件（删除只是把复杂度搬回 import 点），
  作为后续机械任务单独进行；ADR-0021 记的端口成员数与 ADR-0024 的写入者表述在文档提交里校正。

## 关联

- 代码：`apps/server/src/backend.ts`、`apps/server/src/server.ts`、
  `apps/server/src/modules/drawing/drawing.service.ts`、`apps/server/src/ws/gateway.ts`
- 修正：ADR-0021（快照端口成员数）、ADR-0024（阶段写入者表述）；与 ADR-0058 的「装配层按模式委托」同向
- 来源：2026-10-18 架构评审候选 1（两个装配点、两条请求面）
