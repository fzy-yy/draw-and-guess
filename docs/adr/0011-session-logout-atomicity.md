# 0011 会话注销：先原子吊销持久化令牌，再清理内存

**状态**：已采纳

- 来源：会话注销原子性修复需求

## 背景

`SessionService.logout()` 原先的顺序是「清内存 → 删库」，而且删除持久化记录的那一步是
**best-effort**：抛错只记日志、`logout` 仍返回成功。于是出现两类问题：

1. **分裂状态**：内存身份与令牌索引已删除，`players` 表里的旧摘要却还在。该行的
   `disconnected_at` 为 NULL（玩家是「在线」状态被注销的），因此运行期内
   `consumeRecoveryToken()` 的 `disconnected_at IS NOT NULL AND disconnected_at >= ?` 守卫
   会挡住它；但**服务重启**时 `recoverOnStartup()` 会对所有行执行 `markAllDisconnected()`，
   这一行随即变成「宽限期内可恢复」——用户以为已删除的身份，旧令牌还能复活。
2. **注销假成功**：客户端收到成功 ack，服务端却留着凭据；两层状态不一致且没有任何重试入口。

另外发现一处同类竞态：`logout()` 只按 `socket.data.playerId` 取身份，不校验连接归属。
身份被新连接接管后（`reclaimPlayer` 会 `socket.data.playerId = player.id` 并把旧 socket
`disconnect(true)`），旧 socket 若迟到注销，会把**新会话**的身份与持久化记录一起删掉
（`handleDisconnect` 有归属判断，`logout` 没有）。

## 决策

**把注销改成「持久化优先」的原子操作**，顺序固定为：

1. **先原子删除持久化记录**（`repositories.players.remove(id)`，单条 `DELETE` 即原子吊销令牌）：
   这是唯一可失败的步骤，失败时立即中止——记白名单日志（只含 `errorType` 与 `playerId`，
   绝不含明文恢复令牌）并抛统一 `GameError('INTERNAL_ERROR')`；
2. 再做不可回滚的领域清理：离房失败只记日志（房间状态问题不能反过来让注销半途而废）；
3. 最后清理内存身份、令牌索引与 Socket 绑定（`delete socket.data.playerId`、清空请求缓存、
   广播在线状态）。第 2、3 步都不再抛错，因此「库与内存要么都在、要么都不在」。

**连接归属守卫**：`logout` 只允许 `player.socketId === socket.id` 的连接注销身份；
其余情况（已被接管、身份已不在内存）只解绑该 socket 自身并广播一次在线状态，返回成功——
重复注销与陈旧 socket 因此天然幂等，也不会误删他人会话。

**不扩大持久化范围**：只调整删除顺序与失败语义，没有新增表/字段/写穿路径；
玩家身份与完成局战报的落盘边界保持不变。

## 后果

- 注销成功后两层同时失效；注销失败（持久化异常）时两层同时保留，当前连接继续可用，
  客户端可用同一 `requestId` 重试（binder 只缓存成功 ack，失败不缓存）。
- 代价：持久化成功之后若 `leaveRoom` 抛错，房间侧可能残留一个成员条目，但身份已按约定失效
  （日志留痕）。这是「不可回滚步骤放在可失败步骤之后」的必然结果，比反过来更安全：
  宁可房间脏一点，也不能留下可复活的凭据。
- 宽限到期路径（`expireDisconnectedPlayer`）仍保持「先清内存、再尽力删库」：它没有 ack 可失败，
  且过期行的 `disconnected_at` 已超出宽限，`consumeRecoveryToken` 守卫不会再放行，
  残留行由下次启动的 `deleteStaleDisconnected()` 回收。本次不改动该路径。

## 关联

- 代码：`apps/server/src/domain/session/session-service.ts`（`logout` / `detachSocket`）、
  `apps/server/src/handlers/session.ts`（失败 ack 由 binder 统一生成）、
  `apps/server/src/repositories/player-repository.ts`（`remove` / `consumeRecoveryToken` 守卫）
- 测试：`test/unit/session-service.contract.spec.ts`（持久化失败不提交内存副作用、失败重试自愈、
  重复注销幂等、身份已不在内存、离房失败只记日志、被接管的旧连接不删新会话；
  并断言日志不含明文恢复令牌）
- 相关：ADR 0007（本地可观测性隐私边界）、AGENTS.md「持久化分层」与「约束与禁止事项」
