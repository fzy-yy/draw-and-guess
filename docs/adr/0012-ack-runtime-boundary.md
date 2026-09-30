# 0012 客户端请求响应：ack 也建立运行时 Schema 边界

**状态**：已采纳

- 来源：请求响应协议对称性需求

## 背景

请求 payload（`CLIENT_REQUEST_SCHEMAS`）与主动推送（`SERVER_PUSH_SCHEMAS`）都已是
schema-first：服务端在 binder 里校验请求，客户端在 `push-protocol.ts` 里校验推送。
但**请求响应（ack）只有编译期类型**：

1. `ClientResponseContract` 是手写接口，服务端处理器返回值与它对不上时 TypeScript 会拦，
   可一旦运行时数据与类型不符（旧版本服务端、代理或传输层损坏），客户端会直接把
   `unknown` 断言成 `Ack<ClientResponse<E>>` 并读取字段；
2. `request.ts` 从不核对 ack 回显的 `requestId`，迟到或串线的响应会被当成当前请求的结果；
3. 未知错误码 / 缺字段的“成功”/ 空响应带了 data 等畸形外壳不会被识别，
   最坏情况是把脏数据写进 Pinia；
4. `void` 事件在 JSON 线传输中会丢掉 `data` 字段（服务端 `success()` 写入 `undefined`），
   任何“成功必须带 data”的朴素校验都会误伤这些合法响应。

因此需要与请求/推送对称的运行时边界，同时**不改变既有线格式**（避免协议版本升级）。

## 决策

**在 `packages/shared/src/protocol/response.ts` 建立 ack 的唯一 Schema 注册表。**

1. `CLIENT_RESPONSE_SCHEMAS` 为每个请求事件提供完整 ack Schema：成功分支为
   `{ ok: true, data: <事件级 Schema>, requestId }`，失败分支为共享的
   `{ ok: false, error: { code: ErrorCodeSchema, message }, requestId }`，两者都 strict。
   `ErrorCodeSchema` 由 `ERROR_CODES` 注册表枚举生成：**未知错误码属于协议损坏，不是业务失败**。
2. 空响应事件使用共享的 `z.void().optional()`、`invite:respond` / `state:resync` 使用
   `RoomSnapshotSchema.optional()`——缺 `data` 的成功只在这些语义允许的事件上合法，
   完全复刻现有线格式，`protocolVersion` 保持不变。
3. 响应类型从 Schema 推导：`ClientResponseData<E>` / `ClientResponseAck<E>`；
   `SessionRegistration`、`StrokeAck`、`VocabularySnapshot` 等原本手写的接口也改为 `z.infer`，
   消除类型漂移空间。
4. 客户端新增 `stores/response-protocol.ts`：对每次 `emitWithAck` 结果 safeParse，
   再核对 `requestId`；失败只记录「事件 + 字段路径:错误类别 + 时间」的有界脱敏诊断
   （最多 20 条、导出副本），绝不保留响应正文、错误文案或 requestId 值。
5. `createRequester` 把这类失败归类为新的 `failureKind: 'protocol'`：**不重试、不写入 Pinia、
   统一展示 `strings.request.protocolFailure`**；只有传输异常才按原策略重试。业务失败路径不变。
6. ack 外壳不增加 `protocolVersion` 字段：注册已按版本门禁（`PROTOCOL_MISMATCH` 是合法业务失败），
   再在每一条 ack 上带版本只会重复信息并造成不兼容变更。
7. 空响应与“可能没有房间”外壳在同类事件间共享同一 Schema 实例。当时的首屏预算只有约 3 KiB 余量，
   36 个事件各建一套 ZodObject/ZodUnion 曾让入口 gzip 触线；共享实例后实测
   `test/e2e/specs/08-performance-budget.spec.ts` 入口 164.6 KiB（余量 0.4 KiB）、首屏 175.5 KiB（余量 4.5 KiB）
   ——上列数字是写作时的实测值（对应当时的入口 165 / 首屏 180 KiB 预算），该预算其后由
   ADR-0014 上调为入口 176 / 首屏 192 KiB。

## 后果

- 畸形成功、未知错误码、requestId 不匹配在任何 store 看到结果之前就被拒绝，
  客户端不会再把脏数据写进 Pinia；协议损坏不再伪装成“网络超时”触发无意义重试。
- 新增 `failureKind: 'protocol'`；现有消费方按 `=== 'transport'` 判断，语义自动收紧
  （自动身份恢复不会把协议损坏当作可重试的断线）。
- 协议损坏只提示统一安全文案，用户无法从 UI 看到细节；诊断与推送诊断一样暂未接入设置页，
  需要时通过 `getResponseDiagnostics()` 读取。
- 代价：入口体积逼近预算，后续给客户端加协议 Schema 时必须先跑性能门禁并优先复用共享实例。
- `CLIENT_RESPONSE_SCHEMAS` 比真实服务端输出更严会直接破坏游戏，因此用真实 `GameService`
  输出做契约测试（`test/unit/response-contract.spec.ts`）守住两侧一致性。

## 关联

- 代码：`packages/shared/src/protocol/response.ts`、`packages/shared/src/protocol/base.ts`
  （`RequestIdSchema` / `ErrorCodeSchema`）、`apps/client/src/stores/response-protocol.ts`、
  `apps/client/src/stores/request.ts`
- 测试：`test/unit/client-boundaries.spec.ts`（注册表对称、解码分类、诊断有界脱敏）、
  `test/unit/game-transport.contract.spec.ts`（malformed success 不重试、统一文案、undefined 合法响应）、
  `test/unit/response-contract.spec.ts`（真实服务端输出契约）、
  `test/unit/session-service.contract.spec.ts`（版本错配不落库）、
  `test/integration/client-state-coverage.spec.ts`（损坏成功响应不写 Pinia）、
  `test/type/schema-first.ts`（类型从 Schema 推导的编译期守卫）
- 相关：ADR 0007（本地可观测性隐私边界，诊断只留安全字段）、AGENTS.md「Schema-first 线协议」
  与「请求响应运行时边界」
