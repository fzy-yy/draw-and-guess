# 0010 绘图历史上限用「拒绝新增」，不用 FIFO 丢弃

- 状态：已采纳
- 来源：绘图历史上限语义修复需求

## 背景

`GameSecret.strokes` 是整回合唯一的内存画布历史：每个客户端都按它增量构建本地镜像，
重连、晚加入、回滚恢复与撤销重绘时又都按它整块重放。`maxHistoryCommands`（1500）原本被实现成
**FIFO 容量阀**：`trimHistory()` 在超限时 `strokes.shift()` 丢掉最旧命令，并调用
`releaseCommandBudget` 把点数/填充额度还回去。

这在语义上是错的，而且是**静默**的：

- 丢掉最旧命令会改变整段历史的重放结果。最典型的是「早期封闭边界 + 后续填充」：
  边界命令被丢掉后，那条本来只覆盖左侧封闭区域的填充会在重放时吞掉整张画布——
  一直在线的人看到的画面与「重新连上/晚加入」的人重放出来的画面不一致；
- 客户端 `stores/gameplay.ts` 里还镜像了一份同样的 `shift()`，把这条容量规则复制到了两处，
  而容量语义本该只由服务端裁决；
- 丢弃时归还预算，等于让「点数/填充次数预算」可以被历史压力绕过：
  刷满历史再继续画，总量不再受 `maxPointsPerRound` 约束。

## 决策

**上限是硬上限：达到上限后拒绝新增命令，绝不丢弃已有命令。**

- 服务端 `DrawingService` 用 `assertHistoryCapacity()` 取代 `trimHistory()`：
  新命令（含填充）在 `strokes.length >= maxHistoryCommands` 时抛
  `GameError('DRAW_HISTORY_LIMIT_REACHED')`，**不写入任何状态**（`lastSequence`、点数、
  填充次数与历史都保持原样，也不广播任何增量）；
- 检查点在 `discardUndone()` **之后**：撤销会释放名额，所以「撤销或清空后继续画」这条恢复路径成立
  （与提示文案一致）；续接批次（同一笔画补点）不新增命令，因此不受容量限制；
- 检查顺序固定：**旧包 → 非法样式 → 历史容量 → 点数/单笔/填充次数预算**，
  同一条请求任何时候都得到同一个错误码；
- 新增稳定错误码 `DRAW_HISTORY_LIMIT_REACHED` 与中文安全文案
  （`packages/strings` 的 `serverErrorMessages` 必须覆盖每个登记错误码）；
- 客户端**删除**本地 `shift()`：镜像只做「服务端推送多少条就保留多少条」，
  并在收到该错误码时复用既有 `warn-drawing-limit` 恢复动作（提示一次、不重试，
  乐观批次回滚仍走 `strokeFailure` 的权威快照恢复）；
- 点数预算、单笔点数上限与单回合填充次数上限**全部保留**，与历史容量并行裁决，互不替代。

### 协议兼容性

**不需要提升 `protocolVersion`**：本次只新增一个错误码常量，推送 DTO 与既有字段语义都没有变化。
旧客户端收到未知错误码时按既有分支回落到「展示服务端安全文案」，不会崩溃也不会重试；
旧客户端里那份 `shift()` 也永远不会触发，因为新服务端不会让历史超过上限。
换言之：新旧客户端都能与新版服务端协同工作，属于向后兼容的行为修正。

## 后果

- 权威历史与所有客户端镜像**逐条一致**：增量重放、全量快照重放、晚加入者的重放得到同一张画面
  （`test/unit/drawing-history-limit.spec.ts`、`test/integration/drawing-history-mirror.spec.ts`、
  `test/e2e/specs/09-drawing-history-limit.spec.ts` 分别从服务端语义、镜像一致性、
  真实浏览器跨端指纹三层守住）；
- 上限从此是「一回合能画多少条命令」的产品约束：画满后必须撤销或清空才能继续，
  而不是像以前那样"画得越多、丢得越早"；
- 代价：上限内不再有自动腾挪空间，极端刷笔画的玩家会在回合中途被明确拒绝（比静默丢历史可预期得多）；
- 内存上限同时受 `maxHistoryCommands`（命令条数）与 `maxPointsPerRound`（点数总量）约束，
  两者都不会再被对方的压力绕过；`maxFillsPerRound` 继续限制重放成本最高的填充命令数量。

## 后续（未实施）

若将来确实需要「画得比上限更多」，正确的方向是引入**检查点**（例如把前缀命令烘焙成一张位图快照，
只保留快照 + 之后的增量），而不是回到丢弃历史。检查点方案必须先单独评审并明确：
权威来源（服务端生成、客户端只消费，禁止上传像素）、跨端确定性（固定逻辑栅格与同一重放算法）、
内存上限（快照与增量的总占用）以及撤销语义（越过检查点的撤销必须回退到快照重建）。
本次不引入检查点。

## 关联

- 代码：`apps/server/src/domain/drawing/drawing-service.ts`（`assertHistoryCapacity`）、
  `packages/shared/src/error-codes.ts`、`packages/strings/src/server.ts`、
  `packages/config/src/drawing.ts`、`apps/client/src/stores/gameplay.ts`、
  `apps/client/src/stores/error-recovery.ts`
- 测试（四层）：`test/unit/drawing-history-limit.spec.ts`（服务端语义）、
  `test/integration/drawing-history-mirror.spec.ts`（镜像一致性与拒绝可见）、
  `test/e2e/specs/09-drawing-history-limit.spec.ts`（真实浏览器跨端指纹）三层均在旧实现上验证过失败；
  `test/component/GameCanvas.spec.ts` 的「绘图历史容量」用例守住「画布逐条重放收到的历史、自身不设上限」
  （向画布注入本地裁剪即可复现失败）
- 相关：ADR 0003（画布坐标边界）、ADR 0009（填充重放与降级）
