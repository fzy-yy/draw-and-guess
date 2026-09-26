# 0026 · 客户端诊断内核单一口径

## 状态

已采纳

## 背景

客户端有三处「脱敏诊断」模块，各自维护一份同样的骨架：

- `stores/response-protocol.ts`：请求响应解码诊断（`ResponseDiagnostic { event, reason, receivedAt }`）；
- `stores/push-protocol.ts`：主动推送解码诊断（`ProtocolDiagnostic { event, reason, receivedAt }`）；
- `canvas/fill-diagnostics.ts`：填充执行诊断（`FillDiagnostic { reason, receivedAt }`）。

三者重复了同一套「有界数组 + 上限 20 + 超限丢最旧 + 副本导出 + 清空」样板，
以及两套 Zod 问题格式化：`response-protocol` 会递归下钻联合分支
（`collectIssues` + `describeIssues`），`push-protocol` 只展开顶层
（`issue.path.join('.')` + `slice(0, 3)`）。诊断本身只被测试消费，但脱敏白名单
（只记字段路径与 Zod 错误类别，绝不写入被拒绝的原始值）分散在每处，任何一处漂移
都会削弱 ADR-0007 的隐私约束。

## 决策

新建 `apps/client/src/utils/bounded-diagnostics.ts` 作为统一内核，导出两个能力：

- `createBoundedDiagnostics<T>(max = 20)`：有界入队（超限丢最旧）、`list()` 返回副本、
  `clear()` 清空。三处诊断各自持有自己的实例与条目类型，不再各写一遍样板。
- `describeZodIssues(issues)`：把 Zod 问题格式化为 `path:code` 列表（最多 3 条），
  递归展开联合分支的嵌套问题，只保留字段路径与错误类别。

三处模块保留各自的文件路径、类型与公开函数（`decodeClientResponse` /
`decodeServerPush` / `get*Diagnostics` / `clear*Diagnostics` / `recordFillDiagnostic`），
内部改为调用内核。**Zod 问题格式化统一为递归版**：`push-protocol` 由「只展开顶层」
改为与 `response-protocol` 相同的递归展开，诊断粒度更细，但仍只记路径与类别。
文件路径必须保留——`test/unit/documentation.consistency.spec.ts` 与
`test/type/schema-first.ts` 固定引用 `stores/push-protocol.ts`。

## 后果

- 记录上限、副本语义、清空行为与脱敏格式化各只有一处实现：改口径只需改内核并补一条单测。
- 三处诊断的隐私边界一致，`describeZodIssues` 成为「如何安全描述被拒载荷」的唯一定义。
- 代价：多了一层 `utils/bounded-diagnostics.ts` 间接；诊断条目类型仍是各模块自己的，
  内核只提供容器与格式化，不承担协议知识。
- 行为变化仅限 `push-protocol` 的诊断粒度（嵌套联合问题会展开到具体字段），
  不影响解码结果、恢复策略或任何隐私字段；现有断言只校验条数 / 字段名 / 不含原始文案。

## 关联

- 代码：`apps/client/src/utils/bounded-diagnostics.ts`、`stores/response-protocol.ts`、
  `stores/push-protocol.ts`、`canvas/fill-diagnostics.ts`
- 测试：`test/unit/client-boundaries.spec.ts`、`test/unit/game-transport.contract.spec.ts`、
  `test/integration/app-runtime-boundaries.spec.ts`、`test/integration/client-state-coverage.spec.ts`
- 来源：2026-09-26 架构评审候选 4（两个孪生解码器合并）
- 相关：ADR-0007（本地运维诊断脱敏）、ADR-0012（ack 运行时边界）、ADR-0009（填充降级与锁）
