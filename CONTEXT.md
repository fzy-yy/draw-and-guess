# CONTEXT · 领域词表

> 本仓库的领域语言（单上下文布局，见 `docs/agents/domain.md`）。议题、提案、测试名与
> 注释指称这些概念时使用下列术语；出现同义漂移即为信号，要么改回本表用词，要么来这儿补条目。
> 首批由 2026-09-25 架构评审（候选 C1）创建，收录既有 AGENTS/ADR/代码中的核心词，非穷举。

| 术语                                                     | 一句话定义                                                                                                                                                                | 权威出处                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 服务端权威（authoritative server）                       | 身份、房间、阶段、答案、计时、绘画资格与分数全部由服务端裁决；客户端只发带 requestId 的操作请求                                                                           | AGENTS「架构与实现约定」                               |
| 角色裁剪快照（role-scoped snapshot）                     | 公开数据结构按观看者角色（画家/观众/观战/候场/已离局）生成，服务端秘密字段绝不进快照                                                                                      | `apps/server/src/snapshot.ts`                          |
| 幂等 ack（idempotent ack）                               | 客户端请求带 requestId，服务端缓存成功 ack 并对并发重复共享执行 Promise，超时以同 ID 重试                                                                                 | ADR-0012、`protocol/binder.ts`                         |
| 版本化推送（versioned push）                             | 服务端主动事件一律 `createServerPush(event, data)` 信封（protocolVersion↔data 编译期配对），客户端先 Zod 解码再过快照门禁                                                 | `shared/protocol/push.ts`                              |
| 快照门禁（snapshot gate）                                | 房间/对局/回合/状态版本/画布修订的客户端统一裁决：accept / ignore / resync                                                                                                | `stores/snapshot-gate.ts`                              |
| 席位（seat）                                             | 房间内成员的座位编号与颜色（SeatGrid 2×3 矩阵），离房释放、移交房主改其归属                                                                                               | `SeatGrid.vue`、`room-membership-service.ts`           |
| 观战 / 候场（spectate / next_game）                      | 游戏中加入策略的两态：只看不入局 / 等下一局入座；候场身份永不得画家答案权限                                                                                               | AGENTS「公开/私密房间」、`snapshot.ts`                 |
| 公开房 / 私密房 · 私密短码                               | 公开房进大厅列表；私密房仅凭服务端生成的短码或定向邀请加入                                                                                                                | AGENTS、`room.ts`(handlers)                            |
| 恢复令牌（recovery token）                               | 玩家短期身份凭证：落盘仅 SHA-256 摘要、成功恢复必旋转；不是公开快照字段                                                                                                   | AGENTS「配置、安全与敏感信息」                         |
| 回合流转状态机（round state machine）                    | LEGAL_PHASES 白名单裁决阶段转换，非法即 INVALID_TRANSITION                                                                                                                | `round-machine.ts`、`pure.ts`                          |
| 作画资格（drawing turn）                                 | 每回合由服务端指派画家；笔画/填充按序号单调递增，超预算/越资格被拒                                                                                                        | `drawing-service.ts`                                   |
| 绘图命令历史（drawing command history）                  | 权威历史只增不删，达 `maxHistoryCommands` 拒绝新增（撤销/清空释放名额）；橡皮/填充只传点击与颜色，像素由客户端重放                                                        | ADR-0010、`drawing-service.ts`                         |
| 画布重放状态机（Drawing Replay Machine）                 | 「权威历史 → 逻辑栅格」的单一所有者：增量 vs 整帧决策、世代取代、undone 过滤、后备缓冲原子提交与在途预览全在其内                                                          | ADR-0018、`canvas/replay-machine.ts`                   |
| 原子换入（atomic commit）                                | 重放只画进后备缓冲，整帧成功后一次性 clearRect+drawImage 换入逻辑层；被取代的重放零可见副作用                                                                             | ADR-0017                                               |
| 渲染态 / 提交态两把锁（render / submit lock）            | 渲染态＝重放里有填充在算（归画布重放状态机）；提交态＝本地填充待权威修订追平（归 useFillSession）。合成 canFill 门禁                                                      | ADR-0009、ADR-0018                                     |
| 填充降级（fill degradation）                             | Worker 失败终止重建 + 同一 ImageData 主线程降级恰一次；彻底失败请求权威快照                                                                                               | ADR-0009、`flood-fill-worker.ts`                       |
| 笔画批次（pending stroke batch）                         | 一笔按 maxPointsPerBatch 分批上送、序号接续（startPointIndex）；批失败即该笔回滚并请求权威快照                                                                            | `useStrokeSession.ts`                                  |
| 词库包 / 难度级配置（vocabulary package / level_config） | 词条按难度派生时限与权重（加载期查 level_config）；hint 揭示结构提示，空回退 category                                                                                     | ADR-0013、`vocabulary/`                                |
| 提示揭示节奏（hint reveal schedule）                     | 按 hintStartRatio 与渐进间隔逐格揭示 hint 槽位；选词卡对画家不展示 hint                                                                                                   | ADR-0001、`hint-scheduler.ts`                          |
| 成员事实（member facts）                                 | 房间成员状态的单一具名口径：占席 / 可玩 / 在线可玩 / 候场可玩 / 进榜，外加连接三态与阶段标称时长；计分、房主迁移、选画家、自动暂停与快照共用                              | ADR-0023、`domain/room/member-facts.ts`                |
| 占席 vs 可玩（occupiesSeat / isActivePlayer）            | 占席＝未离局（含观战与离局占位，用于容量与大厅人数）；可玩＝非观战且未离局（用于准备 / 画家 / 计分）                                                                      | `domain/room/member-facts.ts`                          |
| 进榜口径（isRankedMember）                               | 最终榜单排除观战但**保留离局者**——离局者以冻结的 leftProfile 展示成绩卡，成绩属于本局历史                                                                                 | ADR-0023、`domain/room/member-facts.ts`                |
| 回合所有权（round ownership）                            | 阶段写入、准备失效、对局消息/系统通知与候选抽取、画家轮换只归 RoundMachine；RoundContext 是运行时/副作用窄端口，GameService 退为请求 API 与装配                           | ADR-0024、`round-machine.ts`                           |
| 重同步模块（resync module）                              | 客户端权威自愈单一入口：受限全量重同步（冷却/在途/世代与房间有效性/重解析/再采纳）与会话失效跨域重置（世代自增 + 清房间 + 清词库）                                        | ADR-0025、`stores/resync.ts`                           |
| 诊断内核（bounded diagnostics）                          | 客户端三处脱敏诊断的统一容器与格式化：有界入队、副本导出、清空，以及只记字段路径与错误类别的 Zod 问题描述                                                                 | ADR-0026、`utils/bounded-diagnostics.ts`               |
| 词库弹窗会话（vocabulary dialog session）                | 词库弹窗的生命周期：打开→拉取→按世代作废迟到结果→关闭（取消在途）→保存成功才关闭；视图模式不属于会话                                                                      | ADR-0027、`useVocabularyDialogSession.ts`              |
| 客户端房间事实（client room facts）                      | 阶段文案、可玩成员判定与玩家人数选项的单一具名口径（与服务端 member-facts 对齐）；榜单与占席数是不同语义，不复用                                                          | ADR-0028、`utils/room-facts.ts`、`utils/phase-text.ts` |
| 浅层包装（shallow wrappers）                             | 图标按钮与视觉包装组件（Base/Icon/Round/Tool、HudPill/OverlayCard/RuleRow/StageHeader/SectionHeader）是为消除调用点长串而抽取的；删除测试判定删除只会搬移复杂度，保持现状 | ADR-0029                                               |

## 待打磨（deliberately unresolved）

- 「合并点列重放」（ack 后整帧规范化重绘以消除分批抗锯齿差异）：行为已定名未定，
  现由 `machine.replay()` 承载——下次触碰该语义时定名。
