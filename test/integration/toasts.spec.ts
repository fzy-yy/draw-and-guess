import { afterEach, describe, expect, it, vi } from 'vitest'
import { APP_CONFIG } from '@draw-guess/config'
import { dismiss, notify, onBump, useToasts } from '@/composables/useToasts'

describe('Toast 状态层集成', () => {
  afterEach(() => {
    for (const toast of [...useToasts().toasts]) dismiss(toast.id)
    vi.useRealTimers()
  })

  it('相同类型与文案去重，并通知现有 Toast 执行反馈动画', () => {
    vi.useFakeTimers()
    const bump = vi.fn()
    const stop = onBump(bump)

    notify('保存成功')
    const first = useToasts().toasts[0]
    notify('保存成功')

    expect(useToasts().toasts).toHaveLength(1)
    // 去重命中恰好广播一次弹跳（等价于旧 bumpTick===1 的「只自增一次」语义：
    // 既证明回调触发过，也约束次数不超发）。
    expect(bump).toHaveBeenCalledTimes(1)
    expect(bump).toHaveBeenCalledWith(first?.id)
    stop()
  })

  it('到达配置时限后自动移除 Toast', () => {
    vi.useFakeTimers()
    notify('操作完成', 'warning')

    vi.advanceTimersByTime(APP_CONFIG.ui.toastDurationMs)

    expect(useToasts().toasts).toHaveLength(0)
  })
})
