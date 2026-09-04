/**
 * 剪贴板复制 + 结果提示的组合式封装。
 * 收敛 @vueuse/core 的 useClipboard（优先原生 API，失败后自动 execCommand 降级），
 * 并把「成功/失败」映射为调用方传入的文案与提示类型；返回可直接调用的复制函数。
 * 调用方需要自行判断「无内容可复制」的前置条件（如房间码不存在时不复制）。
 */
import { useClipboard } from '@vueuse/core'

export function useCopyWithFeedback(options: {
  /** 复制内容的取值函数（调用时实时求值，避免闭包锁定旧值）。 */
  text: () => string
  /** 成功提示文案。 */
  success: string
  /** 失败提示文案。 */
  failure: string
  /** 提示回调（通常接 store.notify）。 */
  notify: (text: string, type?: 'success' | 'warning' | 'error') => void
}): () => Promise<void> {
  const { copy } = useClipboard({ legacy: true })
  return async () => {
    let copied: boolean
    try {
      await copy(options.text())
      copied = true
    } catch {
      copied = false
    }
    options.notify(copied ? options.success : options.failure, copied ? 'success' : 'warning')
  }
}
