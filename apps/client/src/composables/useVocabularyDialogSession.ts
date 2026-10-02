/**
 * 词库弹窗的会话生命周期：打开→拉取→失效校验→关闭→保存。
 *
 * 为什么存在：这段「打开即拉取、迟到结果按世代校验、关闭即废弃在途、保存成功才关闭」的
 * 竞态逻辑此前只存在于 `VocabularyDialog.vue`，只能靠挂载弹窗间接验证。抽成 composable 后
 * 可用 stub 协作者直测，对话框退为「词条 vs 词库包」的渲染编排。
 * 取舍见 docs/adr/0027-vocabulary-dialog-session.md。
 */
import { ref, watch, type Ref } from 'vue'
import type { VocabularySnapshot } from '@draw-guess/shared'

/** 会话需要的词库 Store 窄面（生产传 `useGameStore()`，测试可传 stub）。 */
interface VocabularyDialogStore {
  readonly vocabulary: VocabularySnapshot | undefined
  loadVocabulary(): Promise<void>
  saveVocabulary(ids: string[]): Promise<boolean>
  cancelVocabularyRequests(): void
}

interface VocabularyDialogSessionOptions {
  /** 弹窗显隐（v-model:open）。 */
  open: Ref<boolean>
  /** 父层展示的加载态（v-model:loading）。 */
  loading: Ref<boolean>
  store: VocabularyDialogStore
  /** 打开并加载成功后重置视图：选择集合 / 搜索 / 视图模式。 */
  onLoaded: () => void | Promise<void>
  /** 取消在途：查询防抖、词库请求与包切换 pending。 */
  cancelInFlight: () => void
  /** 关闭后通知父组件（emit close）。 */
  emitClose: () => void
  /** 只读（非房主）时不可保存。 */
  isReadOnly: () => boolean
  /** 当前选中的词条 ID（保存时提交）。 */
  selectedIds: Ref<Set<string>>
}

/**
 * 拥有弹窗的打开/拉取/关闭/保存生命周期。
 * 关闭与「打开后尚未加载完成」由世代计数作废迟到结果，避免重新打开已关闭的界面。
 */
export function useVocabularyDialogSession(options: VocabularyDialogSessionOptions) {
  const { open, loading, store, onLoaded, cancelInFlight, emitClose, isReadOnly, selectedIds } =
    options
  // 拉取中标记：防止重复打开并发拉取（与父层的 loading 分开，关闭时一并复位）。
  const vocabularyLoading = ref(false)
  let loadGeneration = 0

  /** 取消在途请求并复位加载标记。 */
  function cancelInFlightAndReset(): void {
    cancelInFlight()
    vocabularyLoading.value = false
    loading.value = false
  }

  /** 关闭弹窗：作废迟到加载、取消在途、复位标记并通知父层。 */
  function handleClose(): void {
    loadGeneration += 1
    cancelInFlightAndReset()
    open.value = false
    emitClose()
  }

  /** 保存词库选择；失败由统一请求层提示，并保留当前弹窗和选择供重试。 */
  async function saveVocabulary(): Promise<void> {
    if (isReadOnly()) return
    const ok = await store.saveVocabulary([...selectedIds.value])
    if (ok) handleClose()
  }

  watch(
    open,
    async (isOpen) => {
      const generation = ++loadGeneration
      if (!isOpen) {
        cancelInFlightAndReset()
        return
      }
      if (vocabularyLoading.value) return
      vocabularyLoading.value = true
      loading.value = true
      try {
        await store.loadVocabulary()
      } finally {
        vocabularyLoading.value = false
        loading.value = false
      }
      // 首次拉取失败时 store.vocabulary 为空：不显示弹窗，由父组件收下 close 供重试。
      if (generation !== loadGeneration || !open.value) return
      if (!store.vocabulary) {
        handleClose()
        return
      }
      await onLoaded()
    },
    { immediate: true },
  )

  return { handleClose, saveVocabulary }
}
