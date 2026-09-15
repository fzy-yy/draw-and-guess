# 0009 填充的两把锁与 Worker 失败降级

- 状态：已采纳
- 来源：填充状态机修复需求（渲染态与提交态分离、Worker 失败可恢复）

## 背景

`GameCanvas.vue` 原先用**单一** `fillBusy` 同时表达两件生命周期完全不同的事：

1. **渲染任务在途**：某个历史 `fill` 正交给洪泛填充 Worker 计算；
2. **本地提交待确认**：本地玩家已发出填充、等权威 `drawingRevision` 追平。

两者共用一把锁产生了三类缺陷：

- `redraw()`（首次挂载、他人填充推送、撤销、清屏、尺寸变化、回合切换都会触发）会直接
  `releaseFill()`，于是**任何整块重放都会顺手释放本地提交锁**，同一封闭区域可被重复提交；
- 更严重的是反向泄漏：`redraw()` 释放后 `pendingFillRevision` 被清空，重放中的 `drawFill`
  又在 `finally` 里通过 `releaseFillIfCaughtUp()` 释放——此时 `pendingFillRevision` 已是
  `undefined`，函数提前返回，**`fillBusy` 永远停在 `true`**，填充工具在本次挂载内彻底失效；
- 回合切换后迟到的 ack 会按「当前回合的确认」结算，可能提前解锁新回合的在途提交。

另外，Worker 一旦运行失败（脚本加载失败或计算异常），旧实现只 `catch { return false }`：
本次重放被静默放弃、缺失填充的底色上继续叠加重放、坏线程被继续复用（注释还写着「不因单次
异常销毁线程」）、且没有任何恢复手段或可观测记录。

## 决策

**两把锁，所有权分离**（`composables/useFillSession.ts`）：

- `renderBusy`（渲染态）由每次填充任务的 `finally` **无条件**释放，与世代、回合无关；
  重叠重放（新一轮重放在旧任务 `finally` 之前启动）用**计数**而非布尔值，避免旧任务误放新任务；
- `submitPending`（提交态）只由三种路径释放：对应 `drawingRevision` 追平、超时兜底
  （`network.requestTimeoutMs`）、ack 业务/传输失败；`reset()` 仅用于回合切换与卸载；
- ack 结算必须携带**发起时的回合**，与当前回合不符的迟到 ack 一律丢弃；
- 两者合并为 `canSubmit` 门禁：画布仍在重放、或上一笔填充尚未被权威确认时不接受填充点击。

**Worker 失败降级一次**（`canvas/flood-fill-worker.ts`）：

- 除「被取消 / 被新任务取代」之外的 Worker 失败：**终止该线程**并重建（不再复用可能损坏的线程）；
- 对**同一 `ImageData`** 在主线程就地降级一次，成功则记录 `worker_degraded` 诊断并继续重放；
- 主线程同样失败（缓冲已被转移作废、计算抛错）时抛 `FloodFillError('unavailable')`：
  画布中止本次重放并上抛 `fillFailure`，由 `GameView` 以 `drawing_rollback` 为由请求权威全量快照
  （Room Store 内部按冷却窗口合并），同时记录不含坐标、颜色、像素与答案的 `fill_unavailable` 诊断
  （写回 `putImageData` 抛错同样计入该原因：本地这次填充一样无法完成）；
- **取消不算失败**：被新一轮重放取代或组件卸载触发的 `cancel` 只作废结果，不降级、不终止线程
  （否则会拿过期历史算出一块错误区域）。

**为降级付出的代价**：输入缓冲不再随 `postMessage` 转移，只做一次结构化克隆给 Worker。
转移会让主线程的 `ImageData` 立即失效（`data.length === 0`），降级就只能回头重读画布，
无法满足「对同一 `ImageData` 只降级一次」；克隆一次 720p 缓冲（~3.5 MiB）换来确定性的降级路径。
`cancel`/`dispose` 语义不变，Worker 仍是常驻线程、单并发。

## 后果

- 渲染态不可能跨任务泄漏，提交锁不可能被重放或他人的推送提前释放；回合切换后旧 ack 既不锁死
  新回合也不会解锁新回合的在途提交；
- 单次填充多付一次结构化克隆（用户点击级频率，可忽略）；失败路径多一次主线程计算，仅发生在
  Worker 已损坏时；
- 诊断有界（最近 20 条，只含原因与时间戳），与 `stores/push-protocol.ts` 的推送诊断同构；
- **未引入看门狗**：Worker 既不返回也不报错（挂起）时渲染态仍会保持占用，此时重放本身也已停滞，
  这类极端环境问题不在本次范围内。

## 关联

- 代码：`apps/client/src/composables/useFillSession.ts`、`apps/client/src/canvas/flood-fill-worker.ts`、
  `apps/client/src/canvas/fill-diagnostics.ts`、`apps/client/src/components/game/GameCanvas.vue`、
  `apps/client/src/views/GameView.vue`
- 测试：`test/component/GameCanvas.spec.ts`（渲染态 / 提交锁 / 降级 / 回合切换）、
  `test/component/ClientComposables.spec.ts`（两把锁的释放规则）、
  `test/unit/flood-fill-worker.spec.ts`（终止旧线程与单次降级）
- 相关约束：AGENTS.md「画布与体验」——归一化坐标、只传点击位置与颜色、服务端权威裁决
