/**
 * 画布重放状态机（Drawing Replay Machine）。
 *
 * 「权威历史 → 逻辑栅格」的完整决策与簿记收进这一个深 module：
 * - 增量补画 vs 整块重放的决策（旧版散在 GameCanvas 的 watch 触发集与 drawIncoming 两处）；
 * - 撤销可见性过滤（undone 集合）、填充 -1 哨兵、世代取代、重放后备缓冲与原子提交
 *   （ADR-0017）；提交时尾部增量、本地预览的整体补回（ADR-0018）。
 *
 * seam 约定（调用方必须知道的全部）：
 * 1. 状态入口只有 `sync()`：任何权威历史变化都原样递进来，**外部不得自行决定重放方式**；
 * 2. 渲染只发生在四个入口：`sync`、`resize`、`replay`（公开入口：useStrokeSession 在批次
 *    全部 ack 合并后直调规范化）、预览方法。一切绘制先画进后备缓冲，
 *    整帧成功后一次性换入逻辑画布——逻辑层永远不暴露半成品；
 * 3. 填充计算经端口注入（生产适配器 = FloodFillWorkerClient）：机器不关心它是 Worker、
 *    主线程降级还是测试里的假实现；
 * 4. `present` 回调是唯一出口副作用：逻辑层内容换入/增量补画后调用，组件层负责投影 DOM。
 *
 * 本 module 刻意不 import Vue：渲染态忙碌只经 `onRenderingChange` 回调报告，
 * 组件层包成 ref 与提交锁合成 canFill 门禁（两把锁的归属决议见 ADR-0018）。
 */
import type { DrawPoint, DrawingCommand, Stroke } from '@draw-guess/shared'
import { APP_CONFIG } from '@draw-guess/config'
import { FloodFillError } from './flood-fill-worker'
import { colorToRgba, type Rgba } from './flood-fill'
import { normalizedToPixelIndex } from './geometry'
import { recordFillDiagnostic } from './fill-diagnostics'
import { renderStroke } from './rendering'

/** 机器可用的权威历史快照：原始命令表 + 撤销集合 + 当前回合。 */
export interface ReplaySnapshot {
  commands: DrawingCommand[]
  undoneIds: readonly string[]
  roundId: string
}

/**
 * 预览笔画样式：由 shared `Stroke` 的落笔字段子集派生（笔画样式单源，
 * 与 useStrokeSession 的 StrokeStyle 同口径，不再各自手抄字段）。
 */
export type PreviewStyle = Pick<Stroke, 'tool' | 'color' | 'width'>

/** 填充计算端口：FloodFillWorkerClient 结构上直接满足；测试注入可编程假实现。 */
export interface FillComputePort {
  fill(
    image: ImageData,
    input: {
      roundId: string
      startX: number
      startY: number
      replacement: Rgba
      tolerance: number
    },
  ): Promise<{ image: ImageData; filledPixels: number; degraded?: boolean }>
  cancel(): void
}

export interface ReplayMachinePorts {
  /**
   * 逻辑层内容变化后请求投影到展示层（唯一出口副作用）；
   * 传入已提交的逻辑画布元素，端口实现无需反向引用机器。
   */
  present(surface: HTMLCanvasElement): void
  /** 渲染态（有填充任务在算）变化：组件层据此合成 canFill。 */
  onRenderingChange?(rendering: boolean): void
  /** 当前世代下填充彻底失败（Worker 与降级都失败）：组件层据此请求权威快照。 */
  onFillFailure?(): void
}

type Preview = { id: string; style: PreviewStyle; points: DrawPoint[] }

export class DrawingReplayMachine {
  /** 逻辑层：固定短边定标的权威栅格。外部可读（投影/探针），绘制只能经机器方法。 */
  readonly logicalCanvas = document.createElement('canvas')
  private readonly scratchCanvas = document.createElement('canvas')
  private readonly ports: ReplayMachinePorts
  private readonly computeFill: FillComputePort

  private drawn = new Map<string, number>()
  private committedCount = 0
  private committedUndoLen: number
  private committedRoundId: string
  private generation = 0
  private renderTasks = 0
  private snapshot: ReplaySnapshot | null = null
  private preview: Preview | null = null
  private disposed = false
  /** 视口是否已经定尺寸；未定尺寸前 sync/预览只登记，不产生绘制。 */
  private sized = false

  constructor(
    ports: ReplayMachinePorts,
    computeFill: FillComputePort,
    initial: { roundId: string; undoCount: number },
  ) {
    this.ports = ports
    this.computeFill = computeFill
    // 与旧版 GameCanvas 闭包初始化语义一致：setup 时即认定当前回合/撤销长度，
    // 首帧重放由随后的 resize() 触发，sync 不再把它们当作「变化」。
    this.committedRoundId = initial.roundId
    this.committedUndoLen = initial.undoCount
  }

  /** 唯一权威入口：递入最新快照，机器自行决策增量补画还是整帧重放。 */
  sync(snapshot: ReplaySnapshot): void {
    this.snapshot = snapshot
    // 尚未被视口定尺寸（挂载前）：只登记快照，首帧交给 resize() 的整帧重放统一渲染。
    if (!this.sized) return
    const visible = this.visibleCommands()
    const undoChanged = snapshot.undoneIds.length !== this.committedUndoLen
    const roundChanged = snapshot.roundId !== this.committedRoundId
    const visibleIds = new Set(visible.map((command) => command.id))
    const hasRemovedCommand = [...this.drawn.keys()].some(
      (id) => id !== this.preview?.id && !visibleIds.has(id),
    )
    const missingFill = visible.some(
      (command) => command.kind === 'fill' && !this.drawn.has(command.id),
    )
    // 整帧重放的触发条件分两类，缺一都可能让逻辑栅格与「权威历史 + 在途预览」错位：
    // ① 可见集发生变化：roundChanged（换回合清空历史）、hasRemovedCommand（撤销/回滚抹掉
    //    已画笔画）、undoChanged（undone 集合增减改变可见性）——增量路径只会补画，删不掉幽灵像素；
    // ② 镜像本身回退：commands.length < committedCount（权威历史比已提交快照更短，即本地镜像
    //    与权威错位，只能原子重建收回）、commands 为空但 drawn 非空（见下一条注释）。
    // 收窄任何一条的风险都大于收益，改动前务必对照 ADR-0018 的提交段语义。
    if (
      roundChanged ||
      hasRemovedCommand ||
      missingFill ||
      undoChanged ||
      snapshot.commands.length < this.committedCount ||
      // 权威列表为空但簿记非空（其余触发条件均未命中时，drawn 里只剩在途预览，
      // 已簿记的权威笔画会先被 hasRemovedCommand 捕获）：典型场景是新回合首笔
      // 预览期间的 revision 抖动。此时增量路径是空操作、无法证明栅格已对齐
      // 「空历史 + 预览」，强制一次原子重建。保留此分支，不做收窄。
      (snapshot.commands.length === 0 && this.drawn.size > 0)
    ) {
      this.replay()
      return
    }
    this.drawIncoming(visible)
  }

  /**
   * 视口在 CSS 尺寸变化时交付新逻辑定标；尺寸写入会隐式清空画布，
   * 因此清空只发生在提交段内——present() 之前展示层继续显示旧帧，无白闪窗口。
   * 首次调用同时点亮 sized：挂载前登记的快照在此完成首帧。
   *
   * 浏览器语义：对 canvas.width/height 的赋值即使尺寸不变也会重置位图。因此同尺寸
   * 调用必须在写入前直接返回——若先写再靠 unchanged 跳过重放，赋值本身的清空会留下
   * 「栅格被清而无人重建」的空窗（调用方 useCanvasViewport 虽有 logicalChanged 预筛，
   * 本方法仍须自守这条不变量，不依赖调用方纪律）。
   */
  resize(width: number, height: number): void {
    const unchanged =
      this.sized && this.logicalCanvas.width === width && this.logicalCanvas.height === height
    if (unchanged) return
    this.logicalCanvas.width = width
    this.logicalCanvas.height = height
    this.sized = true
    this.replay()
  }

  /** 强制整帧重放当前快照（ack 合并后消除分批抗锯齿像素差异等场景）。 */
  replay(): void {
    this.generation += 1
    this.computeFill.cancel()
    void this.runReplay(this.generation)
  }

  // ---------- 预览 seam：外部只描述笔画事件，不触碰画布与簿记 ----------

  /** 开始一笔预览（pointerdown 落点）：登记样式并绘制首个圆点。 */
  beginPreview(id: string, style: PreviewStyle, point: DrawPoint): void {
    this.preview = { id, style, points: [] }
    this.addPreviewPoint(point)
  }

  /** 追加预览点（pointermove）：只画新增段并同步簿记。 */
  addPreviewPoint(point: DrawPoint): void {
    const preview = this.preview
    if (!preview) return
    const context = this.logicalContext()
    const fromIndex = preview.points.length
    preview.points.push(point)
    this.drawn.set(preview.id, preview.points.length)
    if (context) {
      // 单点预览由 renderStroke 内的 SINGLE_POINT_DOT_EPSILON 补偿渲染成圆点
      // （常量源自 geometry，见 ADR-0003 坐标约定）。
      this.drawPreviewStroke(context, preview, preview.points, fromIndex)
      this.ports.present(this.logicalCanvas)
    }
  }

  /**
   * 超长切笔（maxPointsPerStroke）：新 id 的首点是上一段已绘制的终点，
   * 只换绑簿记、不绘制任何像素（与旧 useStrokeSession 行为逐位一致）。
   */
  rebasePreview(id: string, style: PreviewStyle, carriedPoint: DrawPoint): void {
    this.preview = { id, style, points: [carriedPoint] }
    this.drawn.set(id, 1)
  }

  /** 指针释放/会话作废：停止预览跟踪；簿记留给下一次提交重建（与旧版一致）。 */
  endPreview(): void {
    this.preview = null
  }

  /** 批次失败回滚：抹掉该乐观笔画的簿记并整帧重放（画布随之恢复权威内容）。 */
  abandonPreview(id: string): void {
    this.drawn.delete(id)
    if (this.preview?.id === id) this.preview = null
    this.replay()
  }

  /** 释放：中止在途填充任务；调用后机器不再产生渲染态回调。 */
  dispose(): void {
    this.disposed = true
    this.generation += 1
    this.computeFill.cancel()
  }

  // ---------- 内部 ----------

  private visibleCommands(): DrawingCommand[] {
    const snapshot = this.snapshot
    if (!snapshot) return []
    const undone = new Set(snapshot.undoneIds)
    return snapshot.commands.filter((command) => !undone.has(command.id))
  }

  private logicalContext(): CanvasRenderingContext2D | null {
    return this.logicalCanvas.getContext('2d', { willReadFrequently: true })
  }

  private drawPreviewStroke(
    context: CanvasRenderingContext2D,
    preview: Preview,
    points: DrawPoint[],
    fromIndex: number,
  ): void {
    const stroke: Stroke = {
      kind: 'stroke',
      id: 'local-preview',
      ...preview.style,
      points,
      sequence: 0,
    }
    renderStroke(context, stroke, fromIndex)
  }

  /** 增量路径：只补画各笔画新增段；遇到未着色的填充则升级为整帧重放。 */
  private drawIncoming(visible: DrawingCommand[]): void {
    const context = this.logicalContext()
    if (!context) return
    let changed = false
    for (const command of visible) {
      if (command.kind === 'fill') {
        if (this.drawn.has(command.id)) continue
        this.replay()
        return
      }
      const previousPointCount = this.drawn.get(command.id) ?? 0
      if (command.points.length <= previousPointCount) continue
      renderStroke(context, command, previousPointCount)
      this.drawn.set(command.id, command.points.length)
      changed = true
    }
    this.committedCount = this.snapshot?.commands.length ?? 0
    if (changed) this.ports.present(this.logicalCanvas)
  }

  /**
   * 整帧重放：一切绘制只进后备缓冲；世代/回合守卫全部通过后，
   * clearRect + drawImage 原子换入逻辑层（ADR-0017 的提交段）。
   */
  private async runReplay(generation: number): Promise<void> {
    const logical = this.logicalContext()
    // 首轮重放可能发生在 sync 之前（视口 resize 触发），回退到构造期认定的回合。
    const roundId = this.snapshot?.roundId ?? this.committedRoundId
    if (!logical) return
    const width = logical.canvas.width
    const height = logical.canvas.height
    const scratch = this.scratchCanvas
    if (scratch.width !== width) scratch.width = width
    if (scratch.height !== height) scratch.height = height
    const context = scratch.getContext('2d', { willReadFrequently: true })
    if (!context || !width || !height) return

    // 快照开跑时定版：提交段的簿记与像素以此为准，期间新到达的命令走尾部增量。
    const commands = this.visibleCommands()
    context.clearRect(0, 0, width, height)
    for (const command of commands) {
      if (command.kind === 'stroke') renderStroke(context, command)
      else if (!(await this.applyFill(context, command, generation, roundId))) return
      if (generation !== this.generation || roundId !== this.currentRoundId()) return
    }
    // 在途预览不属于权威历史：整段补进本帧（confirmedCount 之前的点已由权威路径画过）。
    if (this.preview && this.preview.points.length) {
      const confirmed = commands.find(
        (command) => command.kind === 'stroke' && command.id === this.preview?.id,
      )
      const confirmedCount = confirmed?.kind === 'stroke' ? confirmed.points.length : 0
      this.drawPreviewStroke(context, this.preview, this.preview.points, confirmedCount)
    }

    // ——提交：换入逻辑层，簿记与后备内容严格同口径（填充记 -1 哨兵）——
    logical.clearRect(0, 0, width, height)
    logical.drawImage(scratch, 0, 0)
    this.drawn.clear()
    for (const command of commands)
      this.drawn.set(command.id, command.kind === 'stroke' ? command.points.length : -1)
    if (this.preview) this.drawn.set(this.preview.id, this.preview.points.length)
    this.committedCount = this.snapshot?.commands.length ?? 0
    this.committedRoundId = roundId
    this.committedUndoLen = this.snapshot?.undoneIds.length ?? 0

    // 重放期间新到达的命令（不在开跑快照里）：原子换入会抹掉它们，尾部增量补画回来。
    this.drawIncoming(this.visibleCommands())
    this.ports.present(this.logicalCanvas)
  }

  private currentRoundId(): string {
    return this.snapshot?.roundId ?? this.committedRoundId
  }

  /** 在后备缓冲上执行一条填充命令；返回 false 表示本次重放作废（逻辑层不受影响）。 */
  private async applyFill(
    context: CanvasRenderingContext2D,
    command: Extract<DrawingCommand, { kind: 'fill' }>,
    generation: number,
    roundId: string,
  ): Promise<boolean> {
    // 尺寸非零无需在此重复校验：runReplay 入口守卫已对同一后备缓冲检查过一次，
    // 且逻辑层/后备层只会被写入 Math.max(1, …) 定标出的尺寸（单线程内不可能变 0）。
    const canvasWidth = context.canvas.width
    const canvasHeight = context.canvas.height
    // 归一化种子点 → 栅格索引：round + clamp 口径单源（geometry，ADR-0003/0022）。
    const startX = normalizedToPixelIndex(command.point.x, canvasWidth)
    const startY = normalizedToPixelIndex(command.point.y, canvasHeight)
    const image = context.getImageData(0, 0, canvasWidth, canvasHeight)
    this.setRenderTasks(this.renderTasks + 1)
    try {
      const result = await this.computeFill.fill(image, {
        roundId,
        startX,
        startY,
        replacement: colorToRgba(command.color),
        // 容差来自公开配置；填充实现（Worker 或降级）只接收数值，不依赖配置包。
        tolerance: APP_CONFIG.drawing.fillTolerance,
      })
      // 世代或回合已变：结果属于过期历史，丢弃（新一轮重放会重算）。
      if (generation !== this.generation || roundId !== this.currentRoundId()) return false
      if (result.degraded) recordFillDiagnostic('worker_degraded')
      if (result.filledPixels > 0) context.putImageData(result.image, 0, 0)
      return true
    } catch (error) {
      // 取消/被新一轮重放取代不是故障：本次重放就此结束，由当前世代的重放负责画面。
      if (error instanceof FloodFillError && error.reason === 'cancelled') return false
      // 当前世代下这次填充无法在本地完成（Worker 与降级都失败）：
      // 交回组件层请求权威全量快照，并中止本次重放——避免在缺失填充的底色上继续叠加重放。
      if (generation === this.generation && roundId === this.currentRoundId()) {
        this.ports.onFillFailure?.()
      }
      return false
    } finally {
      // 成功、失败、取消一律释放渲染态：渲染锁不得跨越任务生命周期。
      // 本 -1 与 try 之前的 +1 严格配对（且每个 applyFill 恰好各执行一次），计数不可能为负。
      this.setRenderTasks(this.renderTasks - 1)
    }
  }

  private setRenderTasks(count: number): void {
    const busy = count > 0
    this.renderTasks = count
    if (!this.disposed) this.ports.onRenderingChange?.(busy)
  }
}
