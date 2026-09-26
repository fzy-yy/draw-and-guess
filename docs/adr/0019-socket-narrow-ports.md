# 0019 Socket 窄端口：消费者与替身都不得依赖全量 Socket 类型

- 状态：已采纳
- 来源：架构评审候选 C3（be8c01f 类型整改只保护了生产方向，测试 adapter 方向反而靠 `as never` 硬转）

## 背景

be8c01f 给客户端接入 `GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>` 后，
类型整改的收益全部落在生产侧；**消费方拿到的 interface 是整个 socket.io 实例**，没人能用
受编译期核对的方式实现它：

- `request.ts`、`attachSocketListeners`、`transport.socket.connected` 的消费者侧真实用量
  只有 `emitWithAck / on / off / io.on / io.off / connected / connect / disconnect` 八个成员；
- 结果 4 套测试替身（fake-game-transport、socket-lifecycle、request-idempotency、
  game-transport.contract）全部经 `as never` / `as unknown as` 伪装整实例，编译期核对为零；
- 旧 seam 的化石成员 `timeout()`（request.ts 早已改用自有超时哨兵，生产零调用）因 cast
  无检查而在三套 fake 里永久存活；
- `request.ts` 内还有一处 `socket.emitWithAck.bind(socket) as <E>...` 断言——绑定泛型方法时
  丢失签名的补偿。

## 决策

1. **按消费角色切三个窄端口**（消费者声明 interface，生产 Socket 结构上满足，无需适配层）：
   - `RequestAckTransport`（`request.ts`）：唯一方法 `emitWithAck<E extends ClientRequestEvent>(event, payload): Promise<unknown>`——
     ack 返回值刻意保持 `unknown`，端口收窄不等于信任线路（解码仍走 `decodeClientResponse`）；
   - `PushBindingTarget`（`socket.ts`）：`on/off` 逐事件重载（connect/disconnect/推送泛型）+ `io` Manager 通道两事件；
   - `GameTransportSocket`（= PushBindingTarget ∪ RequestAckTransport ∪ { connected, connect(), disconnect() }）：
     `GameTransport.socket` 的对外视图，session/useAppBootstrap 只经此读 `connected`。
2. **fake 监听器形参用 `(…args: never[]) => void`**：重载端口的嵌套函数参数经受双重逆变，
   `unknown` 形参不可兼容（探针实证：`unknown is not assignable to string`），`never` 是逆变
   底类型、对全部重载双向兼容；假替身在派发点做一次「never 形参 → unknown 形参」的窄 cast
   （注释标明），替身整体不再需要 `as unknown as 全实例`。
3. **timeout 化石退场**：三套 fake 改为显式标注 `GameTransportSocket`/`ClientSocket` 后，
   `timeout()` 作为 excess property 被编译器当场拒绝，逐一删除——这正是「interface 即测试面」
   的兑现。
4. `connected` 在端口上 `readonly`；fake 用闭包 getter 暴露、内部可变（写状态经新增的
   `setConnected()` 测试接口，不再直接改属性）。
5. 生产边界断言清单更新：request 的 `bind as` 消失（端口方法与转发箭头完全同形）；保留
   `game-transport` 的 `io(...) as GameSocket`（工厂签名无泛型，既有）与 request 的 payload
   展开 cast（泛型 spread 不可折叠，既有）；binder `on`、GameService 推送两处不变。

## 后果

- 正面：4 套替身获得编译期核对（端口成员增删/改名时 fake 立刻失配），`as never` 清零；
  消费者只见到自己用到的面（leverage：session 的读者不再能 emit；attach 的调用方不再能
  connect）；未来任何「给 socket 加成员」的改动都被窄端口挡在消费面之外。
- 边界与代价：`never` 形参技巧有理解成本（两个 fake 文件顶部注释解释 + 本篇 ADR）；
  `GameSocket` 别名保留但用途收窄到 io() 构造点。
- 维护约定：新增消费 Socket 的代码一律依赖最小端口，不得为图方便引用 `GameSocket`；
  新增事件在 `ServerToClientEvents` 登记后，端口泛型自动覆盖，无需改端口。

## 关联

- 模块：`apps/client/src/stores/{socket,request}.ts`、`application/game-transport.ts`
- 测试：`test/client/fake-game-transport.ts`、`test/integration/socket-lifecycle.spec.ts`、
  `test/unit/{request-idempotency,game-transport.contract}.spec.ts`
- 前序：ADR-0012（ack 运行时边界）、ADR-0016（类型护栏与边界断言清单——本篇将其中
  「request emitWithAck」一项移除）
