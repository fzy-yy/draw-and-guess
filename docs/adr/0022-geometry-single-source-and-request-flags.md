# 0022 坐标几何单口径与请求标志语义分离

**状态**：已采纳

- 来源：架构评审候选 C6（两枚小项，同一提交落地：同属"隐式约定升为可执行口径"）

## 背景

**其一（几何）**：ADR-0003 定下「归一化坐标 × (size-1)」的边界约定后，公式在运行期被
复制了五处：描边映射（`rendering.ts`）、填充种子映射 + clamp（`replay-machine.ts`）、
像素种子 clamp（`flood-fill.ts`）、光标直径（`useCanvasCursor.ts`，与 `rendering.ts`
的 `width × max(minLineScale, scale)` 是同一恒等式的两份独立实现）、e2e 探针采样
（`test/e2e/fixtures/canvas-probe.ts`，浏览器上下文里第三份 `(size-1)` 副本）。
任何一处漂移（比如漏了 round 或 clamp 边界）都会让跨端栅格指纹静默分叉——探针哈希
只能发现问题，不能预防问题。单点圆点的 `+0.01` 补偿则一直是裸字面量。

**其二（quiet）**：`RequestOptions.quiet` 一个开关承担两义：抑制失败 Toast + **翻转**
`retry` 默认值（`retry ?? !quiet`）。调用方传 `quiet: true` 时往往只想静音（lobby/room
轮询甚至要显式 `retry: true` 拉回来）；`session.register` 的 `quiet: automatic` 让
自动重连注册**顺带**失去重试——意图被隐式耦合埋住，「谁弹提示」的知识散落在各调用点
按错误码补弹（gameplay 的容量类拒绝即是一例）。

## 决策

1. **新建 `apps/client/src/canvas/geometry.ts`**：零 import 纯函数模块
   （`logicalAxis` 连续映射 / `clampPixelAxis` round+clamp / `normalizedToPixelIndex`
   合成口径 / `strokeWidthAt` 线宽恒等式 / `SINGLE_POINT_DOT_EPSILON` 常量成文），
   五处复制点全部改为引用它。刻意不引用 `@draw-guess/config`（minLineScale 由调用方
   传参）：洪泛 Worker 独立 bundle 与 Playwright 探针（Node 端）都要能直接 import，
   不触发 AGENTS「独立 bundle 的轻量导入约束」的 barrel 复制问题。
   `useStrokeSession` 的 CSS→归一化采样是**另一坐标系**（rect 宽度、非 size-1 栅格），
   不并入（评审决议：模块边界以公式口径为准，不以"坐标"字眼为准）。
2. **探针行带采样**：`canvas-probe.ts` 的 `target.evaluate()` 回调只负责读栅格
   （整块 FNV 指纹 + 指定行像素带），采样行列索引改由 Node 端 import geometry.ts 计算。
   第一趟 evaluate 取 width/height → Node 算 `bandRow`/列索引 → 第二趟取指纹与行带。
   浏览器上下文对映射公式**零副本**；`stableSampleHash` 的格式与跨客户端可对比语义
   不变，03/06/09 spec 零改动。注意实现坑：evaluate 回调会被序列化执行，模块级
   自由变量（import 的函数）不会跨越边界——DOM 取层样板必须内联在回调里，几何公式
   则全部留在 Node 侧求值。
3. **quiet 拆为两个正交开关**：`RequestOptions = { retry?: boolean（默认 true）、
notify?: 'always' | 'silent'（默认 'always'） }`，quiet 删除、无兼容别名。
   `notify: 'silent'` 只抑制三类失败的 Toast；重试与否完全由 `retry` 决定。
   十一个调用点按「当前有效值」逐一保持迁移（drawStrokeBatch/drawFillCommit/撤销重做
   清空/ping/logout/偏好同步/invalid-push 计数 = `retry:false, notify:'silent'`；
   lobby 轮询/stateResync = 仅 `notify:'silent'`；register = `retry:!automatic,
notify: automatic ? 'silent' : 'always'`——旧 quiet 的双义在此显式化为两行可读意图）。
   不预设 'caller' 第三值：选择性补弹本就是调用方对 `ok:false` 结果的自由分支，
   'silent' + 结果检查已是完整表达（YAGNI）。
4. **测试守卫**：新增 `test/unit/canvas-geometry.spec.ts` 钉死公式语义（末列=size-1、
   round 半进位、clamp 边界、恒等式两侧同值、epsilon=0.01——改动即像素漂移需同调
   e2e 指纹预期），geometry.ts 设 100/100/100/100 覆盖率门禁；契约/幂等测试随迁新标志。

## 后果

- 正面：像素一致性公式与「直径 ≡ 线宽」恒等式各得单一所有者；e2e 探针与产品代码跨同一道
  seam——探针不再有独立漂移的可能；请求调用点意图逐字可读，「静音但重试」这类组合不再互相踩线。
- 代价：探针每次读栅格多一趟 evaluate（往返 ~毫秒级，规格比对场景不受影响）；
  `retry ?? true` 意味着**新增**静默调用方若忘了 `retry:false` 会获得重试——与旧
  quiet 默认相反，这是刻意的：重试应是显式否决而非隐式绑架。
- 维护约定：新增「归一化→像素」消费点必须引用 geometry.ts，不得重写 `(size-1)`；
  新增请求调用方按语义各自声明 `retry`/`notify`，不得再引入合并标志。

## 关联

- 模块：`apps/client/src/canvas/geometry.ts`、`rendering.ts`、`replay-machine.ts`、
  `flood-fill.ts`、`composables/useCanvasCursor.ts`、`stores/request.ts`、
  `test/e2e/fixtures/canvas-probe.ts`
- 测试：`test/unit/canvas-geometry.spec.ts`、`test/unit/{game-transport.contract,request-idempotency}.spec.ts`
- 前序：ADR-0003（坐标边界约定的源头）、ADR-0012（ack 运行时边界）
