# 01 stores 注释修正、观测接缝定性与同形合并

Status: ready-for-agent

## 背景

深审结论：stores 层质量高，问题集中在「写只存死表面未定性」「注释与职责漂移」与个别同形逻辑。
用户裁决：**分类处置**——有观测/诊断意义的接缝保留并补注释定性；纯注释错误直接修正。
本单**不删除任何成员**（删除类在 02/05 单），只做注释修正、定性补写与一处同形合并。

## 文件归属（只允许改这些 + 下方"测试联动"列出的 spec）

- apps/client/src/stores/game.ts
- apps/client/src/stores/socket.ts
- apps/client/src/stores/error-recovery.ts
- apps/client/src/stores/request.ts
- apps/client/src/stores/push-protocol.ts
- apps/client/src/stores/response-protocol.ts
- apps/client/src/stores/session.ts
- apps/client/src/stores/vocabulary-request-context.ts
- apps/client/src/stores/gameplay.ts
- apps/client/src/stores/profile.ts
- apps/client/src/stores/vocabulary.ts
- apps/client/src/application/game-transport.ts
- 测试联动：test/unit/game-transport.contract.spec.ts（仅当 installGameTransport 返回值断言需同步）

## 事项清单

1. **game.ts 头注释**：删「与 Socket 网关」的失实职责（网关在 game-transport + useAppBootstrap，
   ADR-0019/0020），改为「统一动作入口与跨领域编排」之类的准确描述。
2. **socket.ts:126 附近**「11 个推送事件」：数量写死会随协议腐化，改为「全部推送事件（清单由
   SERVER_PUSH_EVENT_NAMES 派生）」。
3. **error-recovery.ts**：补文件级头注释（登记表用途 + 新增错误码改哪里）；
   :10 附近「不重试」措辞修正——该 action 只决定"是否补弹一次 Toast"，重试由调用方
   options 声明、业务失败本就不走传输重试；`default: assertNever` 分支补一句
   「运行时不可达，防 SPECIAL_ERROR_CODES 增员漏 case」的定性注释。
4. **request.ts**：`timeout` / `cancelled` 字段与 `RequestOptions.requestId` 选项定性为
   「诊断/测试观测接缝：生产行为分支一律以 failureKind 与 ok 判定」（用户裁决：保留不删）；
   :46 注释与字段实际用途对齐。不动任何逻辑。
5. **push-protocol.ts / response-protocol.ts**：`getProtocolDiagnostics`/`clearProtocolDiagnostics`、
   `getResponseDiagnostics`/`clearResponseDiagnostics` 补注释定性「供测试断言与未来诊断 UI 预留」，
   生产暂无消费者（避免后人误接或误删）。不动逻辑。
6. **session.ts**：`generation`/`incrementGeneration` 声明处补「为什么」注释（使在途请求与词库
   迟到响应作废，配合 ADR-0025 / vocabulary-request-context）。
7. **vocabulary-request-context.ts**：`accepts()` 的四重守卫逐条补注释（operationId / 会话世代 /
   房间 / 包 ID 各拦截什么场景），特别写明「operationId 已最新时仍要查世代/房间」的原因：
   状态可经快照推送等非 begin/invalidate 路径变化。
8. **gameplay.ts**：`purgeUndone` 本体与 handleStrokeBatch 内调用点补「为什么」注释：
   新权威内容到达即不可逆丢弃撤销历史（与权威历史对齐、防止 redo 复活已被覆盖的像素），
   链接 `docs/adr/0010-drawing-history-cap.md`。
9. **profile.ts**：合并同一模块的两条 `@draw-guess/shared` import。
10. **vocabulary.ts**：`saveVocabulary` 与 `selectVocabularyPackage` 收敛为私有
    `commitVocabulary(event, payload, successText)`（begin→request→`!ok || !accepts`→写回→
    notify→true 的同形五段）；两个公开 action 变薄壳，行为与文案完全不变。
11. **game-transport.ts**：
    - 补文件级头注释（io() 构造与连接装配的唯一入口，stores 只经 socket.ts 窄端口，ADR-0019）；
    - `requestState` / `cancelRequests` 成员注释定性「测试观测接缝，生产勿依赖」；
    - `lifecycle.destroyed` 从 `reactive({...})` 降为普通 `let`（无响应式消费者）；
    - `requestState: readonly(requester.state)` 双重包装去掉外层 readonly
      （request.ts 内部已 readonly()），直接透传；
    - `installGameTransport` 返回值 `Pinia` 改 `void`（main.ts 忽略返回值；若 contract spec
      断言了返回值则同步该 spec）。

## 约束

- 全部中文注释；只解释「为什么」与定性，不复述代码。
- 除第 10 条合并与第 11 条的 destroyed/返回值微调外不改任何行为。
- 行号是审查时快照，动手前先对照当前代码验证；与事实不符的条目跳过并在报告注明。

## 验收

`npx prettier --write <改动文件>` → `npx eslint <改动文件>`（0 warning）→
`pnpm typecheck` 全绿 → `pnpm vitest run test/unit/game-transport.contract.spec.ts test/unit/request-idempotency.spec.ts` 通过。
