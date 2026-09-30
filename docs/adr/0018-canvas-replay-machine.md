# 0018 画布重放状态机：决策入机、单快照入口与锁的归属分家

**状态**：已采纳

- 来源：架构评审候选 C1（画布链路是近期修复最密集区，四次修复三次同根）

## 背景

ADR-0017 把「重放原子提交」修进了 `GameCanvas.vue` 后，评审勘查确认剩余摩擦：

- 「历史 → 逻辑栅格」状态机的全部状态（世代、`drawnPoints` 簿记与 -1 哨兵、提交快照、
  后备缓冲、在途预览）是 SFC `<script setup>` 闭包自由变量，**零 interface**；组件测试被迫
  经 `__logicalCanvas` 探针 + 「排除法」摸后备缓冲，e2e 被迫用构建旗标 + 像素哈希。
- 「增量补画 vs 整块重放」的决策分裂在三处：GameCanvas watch 的条件集、`drawIncoming` 的
  missingFill 分支、`useStrokeSession` 各路径直调的 `redraw()`。
- 世代/回合失效知识横跨 5 个文件（组件世代号、Worker jobId+roundId、两会话的回合守卫）。
- `useStrokeSession` 直接持有簿记 Map、逻辑层 ctx 与 `redraw`/`present`（跨 module 共享可变
  状态）；ADR-0009 两把锁的「驱动时机」仍散在组件。

## 决策

1. **抽出 `DrawingReplayMachine`（画布重放状态机）**，新文件 `apps/client/src/canvas/replay-machine.ts`，
   零 Vue 依赖纯 class。逻辑层与后备缓冲都归机器所有；GameCanvas.vue 退化为薄装配壳
   （props→快照转发、指针接线、投影 DOM）。
2. **单快照入口**：`sync({ commands, undoneIds, roundId })` 是唯一权威状态入口，
   「增量还是整帧」「undone 过滤」「命令快照定版」「尾部增量」全部是机器内政；
   辅助入口仅 `resize`（首帧定尺寸 + 整帧重放）、`replay`（ack 合并规范化）、
   预览方法组（`beginPreview/addPreviewPoint/rebasePreview/endPreview/abandonPreview`）。
   定尺寸前 sync 只登记不绘制（`sized` 门闩），杜绝「setup sync + 首次 resize」双重重放。
3. **预览 seam 契约化**：`useStrokeSession` 不再持有簿记 Map / ctx / redraw——改依赖窄接口
   `StrokePreviewSurface`（机器结构上满足）。预览像素、单点补偿、换帧整体补回、失败回滚
   重放的簿记抹除全部入机；「rebase 不绘制」「endPreview 保留像素」等隐式约定变为有主方法。
4. **两把锁分家**（细化 ADR-0009）：渲染态（重放里有填充在算）成为机器内禀事实，经
   `onRenderingChange` 回调报告；提交态（本地填充待权威追平）留在 `useFillSession`。
   `canFill` 门禁在组件层合成。锁的**驱动时机**不再散在组件。
5. **Worker 生命周期不入机**：`FloodFillWorkerClient` 只作为 `FillComputePort` 端口的生产
   适配器注入（假实现即普通对象）；Worker 创建/终止/一次性降级的守卫仍归
   `flood-fill-worker` 自己的单测（ADR-0009 语义不变）。
6. **测试重定向不双养**：行为断言（提交原子性、世代取代、取消/故障/降级、undone 可见性、
   容量重放完整性、09 flake 回归 ×2）迁 `test/component/canvas-replay-machine.spec.ts`
   （直接 new 机器，替身从 9 类降到 2-3 类）；GameCanvas.spec 只留薄接线例；
   `replay-machine.ts` 设独立覆盖率门禁（90/85/100/95）。
7. **AGENTS 约束更新**：「画布增量绘制」条目改为指向机器单入口；新增禁令——任何新渲染
   路径只能经 `sync/resize/replay/预览方法`，不得向逻辑层直接 `clearRect`。

## 后果

- 正面：画布正确性知识首次拥有单一所有者；测试与调用方跨同一道 interface，09 类时序竞态在
  毫秒级机器测例中钉死；探针/像素哈希仅作 e2e 跨客户端一致性用途，不再承担单元职责。
- 代价：GameCanvas → 机器多一层端口接线（回调 ×3）；`StrokePreviewSurface` 是新增的
  module 间契约，改预览语义要同看两个文件（可接受：契约有类型、行为有测例）。
- 迁移边界：`useCanvasViewport` 不再写逻辑层尺寸（经 `onLogicalResize` 交机器）；
  `useFillSession` 公开面收窄为提交锁。二者调用点均已同步，无兼容层。
- 与 ADR-0017 的关系：0017 定「原子提交」不变量，本篇定「谁拥有该不变量」——
  后备缓冲/世代/簿记随机器收拢，0017 的维护约定由注释升级为构造性（写入口在机器内）。

## 关联

- 组件/模块：`apps/client/src/canvas/replay-machine.ts`、`components/game/GameCanvas.vue`、
  `composables/{useStrokeSession,useFillSession,useCanvasViewport}.ts`
- 测试：`test/component/canvas-replay-machine.spec.ts`、`test/component/GameCanvas.spec.ts`
- 前序：ADR-0009（两把锁）、ADR-0010（历史只增不删）、ADR-0017（原子提交）
