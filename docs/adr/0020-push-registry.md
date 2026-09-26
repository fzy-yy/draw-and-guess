# 0020 推送事件单注册表：登记一处、清单派生、门禁域进条目

- 状态：已采纳
- 来源：架构评审候选 C2（新增一个推送事件需联动五张互不绑定的表，且 roomScoped 数组删除后静默退化）

## 背景

ADR-0019 把 Socket 消费面收窄为端口后，推送链路的「事件清单知识」仍复制在四处：

1. `SERVER_PUSH_SCHEMAS`（shared，事件与解码的权威源，事件名类型即其键）；
2. `SocketHandlers` 的 16 个成员名（推送事件被翻译成 `onRooms`/`onPresence` 等命名间接，
   签名还泄漏相邻私有词汇：`DrawingIncrementMeta` 与载荷完全同形、拆参再拼回可蒸发）；
3. `socket.ts` 的三段平行清单：11 个同构 decode 闭包、11 个 `on()`、11 个 `off()`；
4. `useAppBootstrap.ts` 的 attach 字面量表 + `handleInvalidPush` 里的 `roomScoped` 数组
   （5 个事件名）与 presence/roomList 特判分支。

四处零编译期联动：漏登一处 = 运行时静默失联；`roomScoped` 数组若被误删，房间事件的非法载荷
会退化为无 roomId 上下文的裸 resync，无类型拦截。新增事件（如未来的回合预告推送）要五处协同。

## 决策

1. **单注册表**：`SocketHandlers` 收敛为「5 个生命周期成员（onConnect/onDisconnect/
   onReconnectAttempt/onIoError/onInvalidPush）+ `push: PushHandlerMap`」。
   `PushHandlerMap = { [E in ServerPushEventName]: { on(data: ServerPushData<E>): void; recovery: PushRecovery } }`
   ——映射类型按协议事件穷尽，漏 `on` 或漏 `recovery` 任一编译失败。表实体住在
   `useAppBootstrap`（handler 本就是 store 接线，登记处即消费处）。
2. **载荷整体透传**：解码层不再拆字段（`payload.id`/`reason+code`/`text` 解构移入表项），
   `DrawingIncrementMeta` 退出 handler 签名（绘图增量表项直接把 data 作 meta 超集递给
   `roomSync.onStroke(data, data.stroke)`）。解码器只知道「schema 的 data 形状」，字段语义归消费方。
3. **清单从事实源派生**：shared 导出 `SERVER_PUSH_EVENT_NAMES = Object.keys(SERVER_PUSH_SCHEMAS)`
   （唯一 `as` 断言放在事实源旁边）；`attachSocketListeners` 用 `bindPushEvent<E>` 循环注册并
   收集解绑闭包——11 闭包/注册清单/解绑清单三段平行结构蒸发为「一个泛型函数 + 一次 map」。
   泛型体内 `handlers.push[event]` 与 `decodeServerPush(event, raw)` 共享同一 `E` 实例化，
   事件↔载荷配对由编译器锁定，全程零断言（探针验证过：循环变量若放宽成联合再索引映射类型会
   退化为并集签名，必须保持泛型体）。
4. **门禁域进注册表条目**：非法推送的恢复策略枚举 `PushRecovery = 'room-snapshot' |
'presence-refresh' | 'room-list-refresh' | 'generic-resync'` 与 handler 同条目共存；
   `handleInvalidPush` 改为查表 switch，`roomScoped` 数组与事件名特判分支删除。行为映射与
   旧逻辑逐事件一致（presence/room-list 保留「先通用 resync 让服务端计数、再刷新对应列表」的
   双步语义）。
5. **生命周期事件不入表**：connect/disconnect/Manager 通道（reconnect_attempt/error）不是
   协议推送、没有 schema，保持显式绑定——表只覆盖「有 Schema 的事件」。

## 后果

- 正面：新增推送事件 = SCHEMAS +1 与表 +1 两处，其余（监听、解绑、恢复路由、类型）自动派生
  （leverage）；「事件清单」与「非法恢复域」两摊知识各得单一所有者（locality）；
  `roomScoped` 误删静默退化路径被类型封死。socket.ts 从 16 成员契约 + 33 行平行清单瘦身为
  端口 + 契约 + 一个泛型绑定函数。
- 代价：`bindPushEvent` 泛型体的「同 E 配对」论证不显式（靠映射类型的泛型键索引语义，
  源码注释已指向本篇）；表项内联箭头后，个别消费方（roomSync 回调）与表的对应关系从
  名字对名字变为事件名为键——检索时按 `EVENTS.x` 而非 `onXxx` grep。
- 迁移边界：`SocketHandlers` 是内部 seam，外部消费者只有 `useAppBootstrap` 与
  `game-transport.attach`（类型透传）；测试面 `socket-lifecycle.spec.ts` 的 handlers()
  构造按新形态适配，10 例行为断言（注册完整性、精确解绑、invalid-push 恢复路径）原样保留
  作回归闸——穷尽性由映射类型负责，未另加运行时守卫用例（避免与类型检查双养）。
- 与前序：ADR-0019（窄端口）提供 `PushBindingTarget`，本篇在其上做「清单派生」；两者共同
  兑现「interface 即测试面」——替身实现的是端口，登记的是协议，均编译期核对。

## 关联

- 模块：`packages/shared/src/protocol/push.ts`（清单导出）、`apps/client/src/stores/socket.ts`
  （PushHandlerMap/bindPushEvent）、`apps/client/src/composables/useAppBootstrap.ts`（表实体与恢复 switch）
- 测试：`test/integration/socket-lifecycle.spec.ts`
- 前序：ADR-0019（Socket 窄端口）、ADR-0012（ack 运行时边界）
