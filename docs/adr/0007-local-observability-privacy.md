# 0007 本地运维诊断采用有界安全聚合

- 状态：已采纳
- 来源：本地运维诊断需求

## 背景

局域网服务需要判断连接、房间、协议恢复与请求失败是否异常，但记录完整 Socket payload、
聊天正文、答案或恢复令牌会把排障能力变成新的敏感数据面。同步文件日志还会把每次业务日志
写入放到请求关键路径，而纯异步写入若不管理退出生命周期，又可能丢失关停前的最后一批记录。

## 决策

- Pino 使用异步有缓冲 destination；正常关停依次关闭应用资源、flush 并 close 日志，强制退出
  只做一次 `flushSync` 尽力落盘；
- `RuntimeLogger` 的上下文字段和正文均使用静态白名单，异常只记录类型；Pino redaction 作为
  纵深保护，不接收恢复令牌、答案、聊天正文或完整 payload；
- 指标只使用有限协议事件名、错误码和数值计数，不保存玩家/连接 ID 集合；客户端触发重同步时
  仅附带枚举原因，非法 push 的原始内容不会回传；
- `/api/health` 默认返回应用版本与协议版本。详细指标需要 `HEALTH_METRICS_ENABLED=true`，
  且直接 TCP 来源必须是回环地址；不信任 `X-Forwarded-For` 等转发头。

## 后果

- 请求路径不再等待同步磁盘写入，运维能看到错误分布、恢复频率与 ack 延迟；
- 指标内存由有限键空间约束，运行时间增长不会增加键数量；
- `SIGINT` / `SIGTERM` 下日志确定性排空。进程被强杀或日志介质失效时，最后一个缓冲批次仍可能
  丢失，这是避免业务线程长期阻塞所接受的代价；
- 局域网客户端无法读取详细运行指标，本机管理员必须显式启用后访问。

## 关联

- 日志：`apps/server/src/logging/file-logger.ts`、`apps/server/src/startup/shutdown.ts`
- 指标：`apps/server/src/observability/metrics.ts`、`apps/server/src/protocol/binder.ts`
- 健康检查：`apps/server/src/app.ts`、`apps/server/src/config/deployment.ts`
