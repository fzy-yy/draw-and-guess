# 03 canvas 注释修正/补全 + 冗余守卫清理 + 笔画样式单源

Status: ready-for-agent

## 背景

canvas 域审查：渲染模型与原子提交机制受 ADR-0017/0018 保护，**不得改变任何渲染决策**；
问题集中在注释漂移（入口清单少写 replay、补偿常量名过时）、少量重复守卫、关键算法缺
「为什么」注释、笔画样式三处同形声明。

## 文件归属

- apps/client/src/canvas/replay-machine.ts
- apps/client/src/canvas/rendering.ts
- apps/client/src/canvas/viewport.ts
- apps/client/src/canvas/flood-fill.ts
- apps/client/src/canvas/flood-fill.worker-entry.ts
- apps/client/src/canvas/flood-fill-worker.ts
- apps/client/src/canvas/fill-diagnostics.ts
- apps/client/src/composables/useStrokeSession.ts（仅本单列出的三处）
- 测试联动：canvas / StrokeSession 相关 spec（仅在断言引用被删符号时同步；预期无删除面外溢）

## 事项清单

1. **replay-machine.ts:11 头注释**：「渲染只发生在三个入口」漏写公开的 `replay()`
   （useStrokeSession 直调）；按 AGENTS 口径改为「sync + resize/replay/预览方法」。
2. **replay-machine.ts:170 附近注释**：「由 drawPreviewStroke 的 +0.01 补偿」失实——补偿在
   `rendering.ts` 的 renderStroke、字面量已是 `SINGLE_POINT_DOT_EPSILON` 常量（geometry.ts）；
   措辞改为指向 renderStroke 与常量名。
3. **replay-machine.ts resize() 的 unchanged 早退分支**：**保留分支本身**（它正是「绝不把
   同尺寸写回 canvas.width/height」的防护——同尺寸赋值在浏览器同样清空位图），把这一层
   「为什么」写进注释；不改逻辑。
4. **replay-machine.ts:123 附近**：`commands.length < committedCount`（权威历史缩短=镜像回退，
   只能原子重建）触发整帧重放处补一行 why 注释。
5. **replay-machine.ts:124**：`commands.length === 0 && drawn.size > 0` 整帧分支——收窄风险大于
   收益，保留并补注释说明其覆盖场景（新回合首笔预览期间的 revision 抖动）。
6. **replay-machine.ts:315-317**：runReplay 内 `!canvasWidth || !canvasHeight` 与 :269 重复守卫
   同一后备缓冲（单线程、循环内尺寸不可能变化）——删内层重复守卫。
7. **replay-machine.ts:348**：`Math.max(0, renderTasks - 1)` 的 `Math.max` 移除（+1/:finally
   -1 严格配对不可能为负），保留原注释语义。
8. **rendering.ts:23**：`start = Math.max(0, fromIndex - 1)` 补「为什么」——增量描边必须从上一
   已画点起笔，否则新增段与旧线悬空断开（这正是白边/断线缺陷的防回潮点）。
9. **viewport.ts:39-44**：`imageSmoothingEnabled = false` 双写 + 两处 save/restore 冗余包裹收敛
   （display 层 2d context 全仓仅此函数获取）；不动 DPR 封顶逻辑与既有注释。
10. **flood-fill.ts:90-106**：`blendAntialiasPixel` 补函数级「为什么」注释（半透明边界像素与替换色
    混合并强制 alpha=255：消抗锯齿白边 fringe、不留透明洞）。
11. **flood-fill.ts:76,81**：栈容量封顶处补安全性论证注释——每个未填充 run 起点最多被相邻行
    压入常数次，`pixelCount` 上界来自「压入次数 ≤ 像素数」不变量；如论证站不住，改为保留并
    标「待人工确认」，**不要**擅自加断言改变热点循环成本。
12. **flood-fill.worker-entry.ts**：补文件头注释（独立 chunk 身份、type-only import 不拖执行器
    进 Worker 的原因、`response.buffer` transfer 的所有权一次性交接语义）。
13. **flood-fill-worker.ts:34-35**：`peakWorkingBytes` / `execution` 字段保留，注释定性
    「观测/测试接缝（spec 断言与基准测量用），生产渲染路径不消费」。
14. **fill-diagnostics.ts:25**：「避免诊断 UI 或测试修改内部记录」——当前无诊断 UI 消费者，
    改为「供测试与未来诊断 UI 消费」的准确表述。
15. **useStrokeSession.ts:73**：`Math.max(sequence + 1, lastSequence() + 1, 0)` 第三参 `0` 删除
    （sequence 自 0 严格递增，`sequence+1 ≥ 1` 恒成立）。
16. **useStrokeSession.ts:244-246**：`pendingBatches` / `activeStrokeId` 保留，注释定性
    「测试观测出口（StrokeSession.spec / app-runtime-boundaries.spec 消费）」。
17. **笔画样式单源**：`useStrokeSession.ts` 的 `StrokeStyle`、`replay-machine.ts` 的
    `PreviewStyle` 与 `@draw-guess/shared` 的 `Stroke` 三处同形声明——统一改为
    `Pick<Stroke, 'tool' | 'color' | 'width'>` 派生（shared 在客户端可依赖；两文件各自
    import type，删除本地手抄字段，行为零变化）。若发现字段与 shared Stroke 有出入，
    以 shared 为准并检查两处使用点，报告中说明。

## 约束

- ADR-0017/0018 红线：不改重放决策、不触碰原子提交、不引入平滑库、组件不得直接持有逻辑层上下文。
- 行号为审查快照，动手前逐条对照当前代码验证；不符者跳过并记录。
- 中文注释。

## 验收

`npx prettier --write <改动文件>` → `npx eslint <改动文件>` → `pnpm typecheck` 全绿 →
`pnpm vitest run` canvas/replay/flood-fill 与 StrokeSession 相关 spec 文件（先 grep 定位路径）全部通过。
