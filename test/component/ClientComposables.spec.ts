import { defineComponent, h, nextTick, ref } from 'vue'
import { setActivePinia, type Pinia } from 'pinia'
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EVENTS,
  type VocabularyPackageInfo,
  type VocabularySnapshot,
  type VocabularyWord,
} from '@draw-guess/shared'
import { APP_CONFIG } from '@draw-guess/config'
import type { RequestResult } from '@/stores/request'
import { useCanvasCursor } from '@/composables/useCanvasCursor'
import { useCanvasViewport } from '@/composables/useCanvasViewport'
import { useFillSession } from '@/composables/useFillSession'
import { useFullscreenPrompt } from '@/composables/useFullscreenPrompt'
import { useInviteQueue } from '@/composables/useInviteQueue'
import { useSelectAllState } from '@/composables/useSelectAllState'
import { useShortcuts } from '@/composables/useShortcuts'
import { useTableSort } from '@/composables/useTableSort'
import { useVocabularyDialogSession } from '@/composables/useVocabularyDialogSession'
import { useVocabularyPackages } from '@/composables/useVocabularyPackages'
import { useVocabularyQuery } from '@/composables/useVocabularyQuery'
import { useVocabularySelection } from '@/composables/useVocabularySelection'
import { useGameStore } from '@/stores/game'
import { useLobbyStore } from '@/stores/lobby'
import { useRoomStore } from '@/stores/room'
import { useSessionStore } from '@/stores/session'
import { GUEST_ID, HOST_ID, ROOM_ID, createRoomFixture } from '../client/room-fixture'
import { createPiniaWithFakeTransport } from '../client/fake-game-transport'

let pinia: Pinia
const wrappers: VueWrapper[] = []

function mountComposable<T>(factory: () => T): T {
  let result!: T
  const wrapper = mount(
    defineComponent({
      setup() {
        result = factory()
        return () => h('div')
      },
    }),
    { global: { plugins: [pinia] } },
  )
  wrappers.push(wrapper)
  return result
}

beforeEach(() => {
  pinia = createPiniaWithFakeTransport().pinia
  setActivePinia(pinia)
  vi.useFakeTimers()
})

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.useRealTimers()
})

describe('画布与浏览器生命周期 composables', () => {
  it('光标按工具、权限和画布尺寸派生显示状态', () => {
    const canvas = ref<HTMLCanvasElement>()
    const width = ref(10)
    const resizeTick = ref(0)
    const tool = ref<'pen' | 'eraser' | 'fill'>('pen')
    const canDraw = ref(true)
    const cursor = useCanvasCursor({
      canvas,
      width,
      resizeTick,
      tool: () => tool.value,
      color: () => '#EF4444',
      canDraw: () => canDraw.value,
    })
    expect(cursor.cursorDiameter.value).toBe(10)
    canvas.value = {
      getBoundingClientRect: () => ({ left: 5, top: 7, width: 360, height: 720 }),
    } as HTMLCanvasElement
    cursor.cursorEnter()
    cursor.cursorTrack({ clientX: 25, clientY: 37 } as PointerEvent)
    expect(cursor.cursorPos.value).toEqual({ x: 20, y: 30 })
    expect(cursor.cursorDiameter.value).toBe(6)
    expect(cursor.showCursorDot.value).toBe(true)
    tool.value = 'eraser'
    resizeTick.value += 1
    expect(cursor.cursorColor.value).toBe('var(--color-line)')
    tool.value = 'fill'
    expect(cursor.showCursorDot.value).toBe(false)
    canDraw.value = false
    cursor.cursorLeave()
    expect(cursor.cursorVisible.value).toBe(false)
  })

  it('视口挂载、显式缩放和卸载都会维护 backing size', () => {
    const displayContext = {
      save: vi.fn(),
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      restore: vi.fn(),
      imageSmoothingEnabled: true,
    } as unknown as CanvasRenderingContext2D
    const canvas = ref({
      width: 0,
      height: 0,
      getBoundingClientRect: () => ({ width: 360, height: 720 }),
      getContext: () => displayContext,
    } as unknown as HTMLCanvasElement)
    const logicalCanvas = { width: 0, height: 0 } as HTMLCanvasElement
    // 真实接线里尺寸由机器写回：替身模拟该职责，视口的「变化判定」才有后续参照。
    const logicalResize = vi.fn((width: number, height: number) => {
      logicalCanvas.width = width
      logicalCanvas.height = height
    })
    const viewport = mountComposable(() => useCanvasViewport(canvas, logicalCanvas, logicalResize))
    viewport.resizeCanvas()
    // 逻辑尺寸写入移交机器（resize 回调）：视口自身不写 logicalCanvas。
    expect(logicalResize).toHaveBeenCalledWith(720, 1_440)
    expect(canvas.value.width).toBe(360 * Math.min(devicePixelRatio, 2))
    expect(canvas.value.height).toBe(720 * Math.min(devicePixelRatio, 2))
    expect(viewport.resizeTick.value).toBeGreaterThan(0)

    // 第二次尺寸未变：不再回调，直接重新投影整帧。
    viewport.resizeCanvas()
    expect(logicalResize).toHaveBeenCalledTimes(1)
    expect(displayContext.imageSmoothingEnabled).toBe(false)
    expect(displayContext.drawImage).toHaveBeenCalledWith(
      logicalCanvas,
      0,
      0,
      canvas.value.width,
      canvas.value.height,
    )
  })

  it('全屏提示可确认、关闭，并在邀请或已有房间时保持隐藏', async () => {
    const session = useSessionStore()
    session.playerId = HOST_ID
    session.page = 'lobby'
    const requestFullscreen = vi.fn().mockResolvedValue(undefined)
    const stage = document.createElement('section')
    stage.className = 'game-stage'
    stage.requestFullscreen = requestFullscreen
    document.body.append(stage)
    const prompt = mountComposable(useFullscreenPrompt)
    expect(prompt.showFullscreenPrompt.value).toBe(true)

    await prompt.confirm()
    expect(requestFullscreen).toHaveBeenCalledOnce()
    expect(prompt.showFullscreenPrompt.value).toBe(false)

    sessionStorage.clear()
    useLobbyStore().invites = [
      {
        id: '00000000-0000-4000-8000-000000000011',
        roomId: ROOM_ID,
        roomName: '邀请房',
        from: { id: GUEST_ID, nickname: '邀请者', avatarId: '02', status: 'idle' },
        expiresAt: Date.now() + 10_000,
      },
    ]
    await nextTick()
    expect(prompt.showFullscreenPrompt.value).toBe(false)
    prompt.dismiss()
    stage.remove()
  })
})

describe('填充会话的提交锁', () => {
  function createFillSession() {
    const revision = ref(1)
    const roundId = ref('round-a')
    const session = mountComposable(() =>
      useFillSession({ revision: () => revision.value, roundId: () => roundId.value }),
    )
    return { session, revision, roundId }
  }

  function accepted(drawingRevision: number) {
    return { ok: true, data: { drawingRevision } } as RequestResult<{ drawingRevision: number }>
  }

  // 渲染态（重放中）的计数与释放已随 ADR-0018 收进 DrawingReplayMachine，
  // 守卫迁移至 test/component/canvas-replay-machine.spec.ts 的渲染态用例组。

  it('提交锁只由对应修订追平或超时兜底释放', async () => {
    const { session, revision } = createFillSession()

    session.beginSubmit()
    expect(session.submitPending.value).toBe(true)
    session.settleSubmit(accepted(3), 'round-a')
    // ack 已到但修订未追平：保持锁定。
    expect(session.submitPending.value).toBe(true)
    session.syncRevision()
    expect(session.submitPending.value).toBe(true)

    revision.value = 3
    session.syncRevision()
    expect(session.submitPending.value).toBe(false)

    // 推送迟迟不追平：超时兜底释放，避免填充入口被永久禁用。
    session.beginSubmit()
    session.settleSubmit(accepted(9), 'round-a')
    await vi.advanceTimersByTimeAsync(APP_CONFIG.network.requestTimeoutMs)
    expect(session.submitPending.value).toBe(false)
  })

  it('失败 ack 立即解锁；解锁后的迟到确认不会重新上锁', () => {
    const { session } = createFillSession()

    session.beginSubmit()
    session.settleSubmit(
      { ok: false, failureKind: 'business', error: '服务端拒绝', timeout: false },
      'round-a',
    )
    expect(session.submitPending.value).toBe(false)

    session.settleSubmit(accepted(2), 'round-a')
    expect(session.submitPending.value).toBe(false)
  })

  it('回合切换作废在途提交与旧回合迟到 ack', () => {
    const { session, roundId } = createFillSession()

    session.beginSubmit()
    roundId.value = 'round-b'
    session.reset()
    expect(session.submitPending.value).toBe(false)

    // 旧回合的 ack 修订恰好等于本地修订：不得据此上锁或解锁新回合。
    session.settleSubmit(accepted(1), 'round-a')
    expect(session.submitPending.value).toBe(false)

    // 新回合的提交仍可正常确认与解锁。
    session.beginSubmit()
    expect(session.submitPending.value).toBe(true)
    session.settleSubmit(accepted(1), 'round-b')
    expect(session.submitPending.value).toBe(false)
  })
})

describe('邀请与快捷键 composables', () => {
  it('邀请可接受、拒绝，并在倒计时结束时自动拒绝', async () => {
    const lobby = useLobbyStore()
    const store = useGameStore()
    const respond = vi.spyOn(store, 'respondInvite').mockResolvedValue()
    lobby.invites = [
      {
        id: '00000000-0000-4000-8000-000000000012',
        roomId: ROOM_ID,
        roomName: '邀请房',
        from: { id: GUEST_ID, nickname: '邀请者', avatarId: '02', status: 'idle' },
        expiresAt: Date.now() + 10_000,
      },
    ]
    const queue = mountComposable(useInviteQueue)

    queue.accept()
    expect(respond).toHaveBeenCalledWith(lobby.invites[0]!.id, true)
    queue.decline()
    expect(respond).toHaveBeenCalledWith(lobby.invites[0]!.id, false)
    lobby.invites = [{ ...lobby.invites[0]!, id: '00000000-0000-4000-8000-000000000013' }]
    await nextTick()
    await vi.advanceTimersByTimeAsync(store.config.ui.inviteRejectCountdownSeconds * 1_000)
    expect(respond).toHaveBeenCalledTimes(3)
  })

  it('画家快捷键切工具并区分撤销、重做和可编辑元素', async () => {
    useRoomStore().room = createRoomFixture()
    useSessionStore().playerId = HOST_ID
    const store = useGameStore()
    const drawAction = vi.spyOn(store, 'drawAction').mockResolvedValue()
    const shortcuts = mountComposable(() => useShortcuts(store))

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }))
    expect(shortcuts.tool.value).toBe('eraser')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true }))
    expect(drawAction).toHaveBeenNthCalledWith(1, EVENTS.drawUndo)
    expect(drawAction).toHaveBeenNthCalledWith(2, EVENTS.drawRedo)
    expect(drawAction).toHaveBeenNthCalledWith(3, EVENTS.drawRedo)

    const input = document.createElement('input')
    document.body.append(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }))
    await nextTick()
    expect(shortcuts.tool.value).toBe('eraser')
    input.remove()
  })
})

describe('表格、选择与词库 composables', () => {
  const words: VocabularyWord[] = [
    {
      id: 'a',
      text: '苹果',
      aliases: ['红苹果'],
      category: '水果',
      difficulty: 1,
      drawability: 2,
      hint: '红红的水果',
    },
    {
      id: 'b',
      text: '巴士',
      aliases: ['公交车'],
      category: '交通',
      difficulty: 2,
      drawability: 3,
      hint: '马路上的交通工具',
    },
  ]
  const packages: VocabularyPackageInfo[] = [
    { id: 'p2', name: '进阶', wordCount: 20, description: '难词', version: '2', updatedAt: '2' },
    { id: 'p1', name: '基础', wordCount: 10, description: '常用', version: '1', updatedAt: '1' },
  ]

  it('排序、全选三态与只读选择分支保持一致', () => {
    const sort = useTableSort()
    sort.handleSort('name')
    expect(sort.sortDir.value).toBe('asc')
    sort.handleSort('name')
    expect(sort.sortDir.value).toBe('desc')

    let readOnly = false
    const selection = useVocabularySelection(() => readOnly)
    const rows = ref(words)
    const allState = useSelectAllState(rows, selection.selectedIds)
    expect(allState.value).toBe('none')
    selection.toggle('a')
    expect(allState.value).toBe('some')
    selection.toggleAll(words)
    expect(allState.value).toBe('all')
    selection.setSelection(['a'], false)
    expect(allState.value).toBe('some')
    readOnly = true
    selection.reset([])
    selection.toggle('a')
    expect(allState.value).toBe('none')
  })

  it('词条搜索、筛选、数值排序和清空搜索覆盖独立分支', async () => {
    const query = useVocabularyQuery({
      words: ref(words),
      packages: ref(packages),
      columns: ref([
        { key: 'text', label: '词语', sortable: true },
        { key: 'difficulty', label: '难度', sortable: true, sortValue: (word) => word.difficulty },
      ]),
      debounceMs: 10,
    })
    query.search.value = '公交'
    await vi.advanceTimersByTimeAsync(10)
    expect(query.filteredWords.value.map(({ id }) => id)).toEqual(['b'])
    query.clearSearch()
    query.updateFilter('category', ['水果'])
    expect(query.filteredWords.value.map(({ id }) => id)).toEqual(['a'])
    query.updateFilter('category', [])
    query.handleSort('difficulty')
    query.handleSort('difficulty')
    expect(query.wordRows.value.map(({ id }) => id)).toEqual(['b', 'a'])
    query.searchKeyword.value = '基础'
    expect(query.filteredPackages.value.map(({ id }) => id)).toEqual(['p1'])
    // clearSearch 覆盖原 reset 的可观察语义：作废在途防抖 + 清空输入与生效关键词
    //（reset 特有的「筛选项清空」分支已由上方 updateFilter('category', []) 触达）。
    query.search.value = '残词'
    // 先让 watch(search) 把「残词」排进防抖队列，再清空——构造真正的「在途」窗口。
    await nextTick()
    query.clearSearch()
    expect(query.search.value).toBe('')
    expect(query.searchKeyword.value).toBe('')
    // 推进防抖时钟也不该把被 cancel 的「残词」带回生效关键词（验证取消在途确实生效）。
    await vi.advanceTimersByTimeAsync(10)
    expect(query.searchKeyword.value).toBe('')
  })

  it('词库包切换处理排序、只读、成功与失败状态', async () => {
    let readOnly = false
    let succeed = true
    const onSelected = vi.fn()
    const packageState = useVocabularyPackages({
      packages: ref(packages),
      activePackageId: ref('p1'),
      isReadOnly: () => readOnly,
      select: vi.fn(async () => succeed),
      onSelected,
    })
    packageState.handleSort('wordCount')
    expect(packageState.rows.value.map(({ id }) => id)).toEqual(['p1', 'p2'])
    packageState.handleSort('wordCount')
    expect(packageState.rows.value.map(({ id }) => id)).toEqual(['p2', 'p1'])

    await packageState.select('p2')
    expect(onSelected).toHaveBeenCalledOnce()
    succeed = false
    await packageState.select('p2')
    expect(onSelected).toHaveBeenCalledOnce()
    readOnly = true
    await packageState.select('p2')
    packageState.resetPending()
    expect(packageState.pendingPackageId.value).toBeUndefined()
  })
})

describe('词库弹窗会话生命周期（useVocabularyDialogSession）', () => {
  const snapshot = { selectedIds: ['a'] } as unknown as VocabularySnapshot

  function harness() {
    const open = ref(false)
    const loading = ref(false)
    const onLoaded = vi.fn(async () => undefined)
    const cancelInFlight = vi.fn()
    const emitClose = vi.fn()
    const selectedIds = ref(new Set<string>())
    let readOnly = false
    const store = {
      vocabulary: undefined as VocabularySnapshot | undefined,
      loadVocabulary: vi.fn(async () => {
        store.vocabulary = snapshot
      }),
      saveVocabulary: vi.fn(async () => true),
      cancelVocabularyRequests: vi.fn(),
    }
    const session = mountComposable(() =>
      useVocabularyDialogSession({
        open,
        loading,
        store,
        selectedIds,
        isReadOnly: () => readOnly,
        cancelInFlight,
        emitClose,
        onLoaded,
      }),
    )
    // 挂载时 immediate 监听会按「未打开」执行一次取消/复位；清空断言基线。
    onLoaded.mockClear()
    cancelInFlight.mockClear()
    emitClose.mockClear()
    store.loadVocabulary.mockClear()
    store.saveVocabulary.mockClear()
    return {
      open,
      loading,
      store,
      selectedIds,
      onLoaded,
      cancelInFlight,
      emitClose,
      session,
      setReadOnly: (value: boolean) => (readOnly = value),
    }
  }

  /** 依次刷新微任务与 Vue 更新队列，覆盖「watch → await load → onLoaded」链路。 */
  async function flushAsync(): Promise<void> {
    for (let index = 0; index < 6; index += 1) {
      await Promise.resolve()
      await nextTick()
    }
  }

  it('打开即拉取；成功后复位加载态并回调 onLoaded', async () => {
    const h = harness()
    h.open.value = true
    await flushAsync()
    expect(h.store.loadVocabulary).toHaveBeenCalledOnce()
    expect(h.onLoaded).toHaveBeenCalledOnce()
    expect(h.loading.value).toBe(false)
  })

  it('关闭会作废迟到的加载结果，并取消在途', async () => {
    const h = harness()
    let resolveLoad!: () => void
    h.store.loadVocabulary.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveLoad = () => {
            h.store.vocabulary = snapshot
            resolve()
          }
        }),
    )
    h.open.value = true
    await flushAsync()

    h.open.value = false
    await flushAsync()
    expect(h.cancelInFlight).toHaveBeenCalledOnce()

    resolveLoad()
    await flushAsync()
    expect(h.onLoaded).not.toHaveBeenCalled()
    expect(h.loading.value).toBe(false)
  })

  it('加载失败（词库为空）时自动关闭并通知父层', async () => {
    const h = harness()
    h.store.loadVocabulary.mockImplementation(async () => undefined)
    h.open.value = true
    await flushAsync()
    expect(h.emitClose).toHaveBeenCalledOnce()
    expect(h.open.value).toBe(false)
    expect(h.onLoaded).not.toHaveBeenCalled()
  })

  it('保存：只读不提交，成功才关闭，失败保留弹窗', async () => {
    const h = harness()
    h.setReadOnly(true)
    await h.session.saveVocabulary()
    expect(h.store.saveVocabulary).not.toHaveBeenCalled()

    h.setReadOnly(false)
    h.selectedIds.value = new Set(['a', 'b'])
    h.store.saveVocabulary.mockResolvedValueOnce(false)
    await h.session.saveVocabulary()
    expect(h.emitClose).not.toHaveBeenCalled()

    h.store.saveVocabulary.mockResolvedValueOnce(true)
    await h.session.saveVocabulary()
    expect(h.store.saveVocabulary).toHaveBeenLastCalledWith(['a', 'b'])
    expect(h.emitClose).toHaveBeenCalledOnce()
    expect(h.open.value).toBe(false)
  })

  it('handleClose 取消在途、复位加载态并关闭', () => {
    const h = harness()
    h.session.handleClose()
    expect(h.cancelInFlight).toHaveBeenCalledOnce()
    expect(h.emitClose).toHaveBeenCalledOnce()
    expect(h.open.value).toBe(false)
    expect(h.loading.value).toBe(false)
  })
})
