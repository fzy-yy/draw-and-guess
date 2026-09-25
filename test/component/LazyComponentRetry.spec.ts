import { describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import { render, screen, fireEvent } from '@testing-library/vue'
import { strings } from '@draw-guess/strings'
import { defineLazyComponent } from '@/utils/lazy-component'

/** 函数式组件：避免测试文件触发 vue/one-component-per-file 规则 */
const StubTarget = () => h('div', { class: 'stub-target' }, '目标模块已就绪')

/**
 * 懒加载失败重试验收（ADR-0014 附带缺陷修复）：
 * 旧实现基于 defineAsyncComponent——它不向 errorComponent 注入 retry、且 fail() 后
 * 重试无法恢复当前实例，导致失败兜底永远渲染不出重试按钮。
 * 现改为自管理包装组件：断言失败态「有」重试按钮，点击后重跑 loader 并成功渲染目标。
 */
describe('defineLazyComponent 失败重试', () => {
  it('首次加载失败渲染错误兜底；点击「重试」重跑 loader 并成功渲染', async () => {
    let attempts = 0
    const loader = vi.fn(async () => {
      attempts += 1
      if (attempts === 1) throw new Error('模拟首拉失败')
      return { default: StubTarget }
    })
    const Lazy = defineLazyComponent(loader)

    // 与真实用法一致：懒组件挂在普通父容器内（函数式宿主，不新建 SFC）
    render(() => h('div', { class: 'host' }, [h(Lazy)]))

    // 失败兜底：红字文案与「重试」按钮必须同时存在（修复前按钮永不渲染）
    await screen.findByText(strings.common.moduleLoadFailed)
    const retryButton = screen.getByRole('button', { name: strings.common.retry })
    expect(loader).toHaveBeenCalledTimes(1)

    // 点击重试：loader 被再次执行，成功结果替换错误兜底
    fireEvent.click(retryButton)
    await screen.findByText('目标模块已就绪')
    expect(loader).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(strings.common.moduleLoadFailed)).toBeNull()
  })

  it('加载中超过延迟窗口显示占位；快速完成则不闪占位', async () => {
    // 慢 loader：越过 120ms 窗口应出现「模块加载中」占位
    let release: ((value: { default: typeof StubTarget }) => void) | undefined
    const Lazy = defineLazyComponent(
      () =>
        new Promise<{ default: typeof StubTarget }>((resolve) => {
          release = resolve
        }),
    )
    render(() => h('div', [h(Lazy)]))
    expect(screen.queryByText(strings.common.moduleLoading)).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 160))
    expect(screen.getByText(strings.common.moduleLoading)).toBeTruthy()

    // 完成加载后占位被目标组件替换
    release?.({ default: StubTarget })
    await screen.findByText('目标模块已就绪')
  })
})
