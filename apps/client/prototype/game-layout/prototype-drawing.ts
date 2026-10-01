/**
 * 原型画板本地历史（纯 UI 演示，不连后端）。
 *
 * 画布渲染链路保持真实组件原样：GameCanvas → DrawingReplayMachine 的
 * 「乐观预览 → ack → 权威重放」流程不变，只是「权威」由本模块在本地维护——
 * 笔画批次/填充在本地回显并立即确认，撤销/重做/清空直接在本地历史上执行。
 * 因此这里的行为要与服务端的两个口径对齐：
 * 1. 同一笔画 id 的后续批次合并进同一命令（服务端按 id 合并后再下发快照）；
 * 2. 撤销用「撤销集」表达（渲染由重放状态机按可见性过滤），不是从历史里删除。
 */
import { ref } from 'vue'
import type { DrawingCommand, FillCommand, Stroke, StrokeAck } from '@draw-guess/shared'
import type { FillAck } from '@/composables/useFillSession'
import type { RequestResult } from '@/stores/request'
import { createInitialCommands } from './mock-game.ts'

/** 演示用剩余预算（与公开配置 maxHistoryCommands 同值，仅用于 ack 字段完整）。 */
const REMAINING_BUDGET = 1_500

function createPrototypeDrawing() {
  const commands = ref<DrawingCommand[]>(createInitialCommands())
  const undoneIds = ref<string[]>([])
  const revision = ref(1)
  const lastSequence = ref(
    commands.value.reduce((max, command) => Math.max(max, command.sequence), 0),
  )

  /** 笔画批次回显：同一 id 的后续批次合并进同一命令，立即以成功 ack 确认。 */
  function submitStroke(
    stroke: Stroke,
    onResult: (result: RequestResult<StrokeAck>) => void,
  ): void {
    const index = commands.value.findIndex(
      (command) => command.kind === 'stroke' && command.id === stroke.id,
    )
    const existing = commands.value[index]
    if (existing?.kind === 'stroke') {
      const next = [...commands.value]
      next[index] = { ...existing, points: [...existing.points, ...stroke.points] }
      commands.value = next
    } else {
      commands.value = [...commands.value, { ...stroke, startPointIndex: undefined }]
    }
    lastSequence.value = Math.max(lastSequence.value, stroke.sequence)
    revision.value += 1
    onResult({
      ok: true,
      data: {
        strokeId: stroke.id,
        pointCount: stroke.points.length,
        drawingRevision: revision.value,
        remainingBudget: REMAINING_BUDGET - commands.value.length,
      },
    })
  }

  /** 填充回显：追加填充命令并确认；实际像素由重放状态机按历史重算（含 Worker 计算）。 */
  function submitFill(fill: FillCommand, onResult: (result: RequestResult<FillAck>) => void): void {
    commands.value = [...commands.value, fill]
    lastSequence.value = Math.max(lastSequence.value, fill.sequence)
    revision.value += 1
    onResult({ ok: true, data: { drawingRevision: revision.value } })
  }

  /** 撤销：把最后一条可见命令加入撤销集（重放状态机会把它从画面中过滤掉）。 */
  function undo(): void {
    const undone = new Set(undoneIds.value)
    const lastVisible = [...commands.value].reverse().find((command) => !undone.has(command.id))
    if (!lastVisible) return
    undoneIds.value = [...undoneIds.value, lastVisible.id]
    revision.value += 1
  }

  /** 重做：撤销集是栈式语义，弹出最后一项即恢复该命令的可见性。 */
  function redo(): void {
    const lastUndone = undoneIds.value.at(-1)
    if (!lastUndone) return
    undoneIds.value = undoneIds.value.slice(0, -1)
    revision.value += 1
  }

  function clear(): void {
    commands.value = []
    undoneIds.value = []
    revision.value += 1
  }

  return {
    commands,
    undoneIds,
    revision,
    lastSequence,
    submitStroke,
    submitFill,
    undo,
    redo,
    clear,
  }
}

/** 原型单例（同一时刻只有一个舞台，无需多实例）。 */
export const prototypeDrawing = createPrototypeDrawing()
