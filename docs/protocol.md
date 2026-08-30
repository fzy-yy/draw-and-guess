# Socket.IO 通信协议

协议版本见根级 `config.ts`。事件名集中定义在 `packages/shared/src/index.ts` 的 `EVENTS`，所有客户端请求均由共享 Zod Schema 校验。

## 通用请求与 Ack

每个可失败请求都带 UUID `requestId`，并返回以下结构：

```ts
type Ack<T> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; error: { code: string; message: string }; requestId: string }
```

服务端按玩家在内存中缓存最近 100 个请求结果，重复 ID 不会重复建房、开始或计分；服务重启后缓存立即清空。

## 客户端 → 服务端

| 事件                                   | 主要字段                                                | 权限与校验                                     |
| -------------------------------------- | ------------------------------------------------------- | ---------------------------------------------- |
| `session:register`                     | `protocolVersion, profile, preferences, recoveryToken?` | 校验协议、昵称和 `#RRGGBB` 纯色头像            |
| `session:updateProfile`                | `profile`                                               | 登录且不在房间；拒绝图片、URL 和非法颜色       |
| `presence:updatePreferences`           | `discoverable, acceptsInvites`                          | 登录                                           |
| `room:list`                            | 无                                                      | 返回当前服务的全部公开房间                     |
| `room:create`                          | `name, settings`                                        | 创建固定公开、无密码房间                       |
| `room:join`                            | `roomId`                                                | 使用内部 UUID 从大厅或邀请加入                 |
| `room:leave`                           | 无                                                      | 主动释放座位                                   |
| `room:setReady`                        | `ready`                                                 | 等待阶段成员                                   |
| `room:updateSettings`                  | `patch, expectedVersion`                                | 等待阶段房主                                   |
| `room:getVocabulary`                   | 无                                                      | 仅房主取得词面列表                             |
| `room:updateVocabulary`                | `ids, expectedVersion`                                  | 仅房主，ID 必须来自权威词库                    |
| `room:kick` / `room:transferHost`      | `targetId`                                              | 房主权限                                       |
| `invite:send` / `invite:respond`       | 目标或邀请 ID                                           | 校验目标状态、频率和有效期                     |
| `game:start`                           | `expectedVersion`                                       | 房主、全员准备且规则合法                       |
| `game:chooseWord`                      | `roundId, wordId`                                       | 当前画家私有候选                               |
| `game:pauseRequest` / `game:resume`    | 原因或无                                                | 房主权威暂停；普通玩家只能建议                 |
| `game:endEarly` / `game:returnWaiting` | 无                                                      | 房主权限                                       |
| `guess:submit`                         | `roundId, text`                                         | 非画家、未猜中，服务端判定和限频               |
| `chat:preset`                          | `roundId, preset`                                       | 只接受配置中的安全短语                         |
| `draw:strokeBatch`                     | `roundId, stroke`                                       | 当前画家；校验批次、坐标、颜色、连续线宽和序号 |
| `draw:fillCommit`                      | `roundId, fill`                                         | 当前画家；校验点击坐标、颜色和递增序号         |
| `draw:undo/redo/clear`                 | `roundId`                                               | 对自由笔画和区域填充统一操作                   |
| `state:resync`                         | 无                                                      | 返回按角色裁剪的权威快照                       |
| `network:ping`                         | `clientTime`                                            | 延迟与时钟估算                                 |

## 服务端 → 客户端

| 事件                                  | 内容与隐私边界                                 |
| ------------------------------------- | ---------------------------------------------- |
| `session:ready`                       | 玩家公开身份、内存恢复令牌和恢复结果           |
| `presence:snapshot`                   | 可发现玩家与全部公开房间                       |
| `room:listChanged`                    | 建房、解散、成员或阶段变化后的完整公开房间列表 |
| `invite:received` / `invite:resolved` | 邀请房间内部 ID、邀请者和状态                  |
| `room:snapshot`                       | 当前房间、成员、规则、词数及角色裁剪游戏状态   |
| `room:closed`                         | 关闭或移除原因                                 |
| `guess:close`                         | 仅原发送者收到接近提示                         |
| `guess:correct`                       | 玩家 ID 与顺序，不含答案文本                   |
| `draw:strokeBatch`                    | 校验后的自由笔画增量                           |
| `draw:fillCommit`                     | 校验后的区域填充命令                           |
| `system:notice` / `system:error`      | 成员变化、迁移、暂停和严重错误                 |

## 绘图命令

绘图历史是 `DrawingCommand = Stroke | FillCommand` 可判别联合：

- `Stroke.kind = "stroke"`，工具只允许画笔或橡皮擦，点坐标为 0～1；两种工具共用连续粗细值；
- `FillCommand.kind = "fill"`，只包含归一化点击坐标、安全 HEX 颜色和递增 `sequence`，不传输整张像素图；
- 客户端按权威历史顺序重放命令，并以四方向洪泛算法填充与点击像素连通的封闭区域；
- 两类命令共用递增序号和撤销历史，服务端限制身份、阶段、频率和命令总数。

## 快照裁剪

- 当前画家可见候选词和答案；猜词者只见遮罩，结算后才见答案。
- 公共房间摘要只有内部 ID、名称、房主、人数、阶段和规则摘要，不存在密码、房间码或二维码信息。
- 恢复令牌、候选秘密、内部计时器和请求缓存永不进入房间快照。
- 服务端不把任何运行状态写入数据库、文件或远程日志。

常见错误码：`UNAUTHORIZED`、`PROTOCOL_MISMATCH`、`INVALID_PAYLOAD`、`INVALID_AVATAR_COLOR`、`ROOM_NOT_FOUND`、`ROOM_FULL`、`ALREADY_IN_ROOM`、`FORBIDDEN`、`INVALID_PHASE`、`VERSION_CONFLICT`、`NOT_DRAWER`、`INVALID_DRAW_STYLE`、`INVALID_FILL`、`STALE_DRAW_EVENT`、`RATE_LIMITED`、`INVITE_EXPIRED`。
