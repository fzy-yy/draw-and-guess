/**
 * 词库包表格视图：行首勾选只上抛一条选择事件。
 *
 * 回归背景：行勾选曾同时 emit('select') 与 emit('toggle')，而宿主把两条都绑到同一个切换处理，
 * 一次点击会被执行两次；当前只是被「请求进行中禁止再次切换」的守卫挡住，守卫一改就会变成
 * 连点抖动（取舍见 docs/adr/0062-vocabulary-package-names-by-id.md）。
 */
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import { strings } from '@draw-guess/strings'
import VocabPackageTableView from '@/components/room/VocabPackageTableView.vue'

function pkg(id: string, name: string) {
  return {
    id,
    name,
    wordCount: 3,
    description: '',
    author: '',
    remark: '',
    version: '1',
    updatedAt: '',
  }
}

/** happy-dom 没有布局尺寸：撑开滚动容器并触发一次重测，虚拟行才会挂载。 */
async function renderTable(rows: ReturnType<typeof pkg>[], selected: string[]) {
  const view = render(VocabPackageTableView, {
    props: {
      rows,
      selectedPackageIds: new Set(selected),
      sortKey: null,
      sortDir: 'asc' as const,
    },
  })
  const scroller = view.container.querySelector('.overflow-y-auto') as HTMLElement
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 800 })
  Object.defineProperty(scroller, 'offsetHeight', { configurable: true, value: 800 })
  await nextTick()
  window.dispatchEvent(new Event('resize'))
  await screen.findByRole('checkbox', {
    name: strings.a11y.room.vocabPackageSelectAria('进阶词库'),
  })
  return view
}

/** 宿主监听过的全部事件名（`onToggle` 等监听器属性不会被记入 emitted，只用组件自身上抛的事件）。 */
function emittedNames(view: ReturnType<typeof render>): string[] {
  return Object.keys(view.emitted())
}

describe('词库包表格的行勾选事件', () => {
  it('点击一行复选框：只上抛一条切换事件，且带回该行 ID', async () => {
    const user = userEvent.setup()
    const view = await renderTable(
      [pkg('basic', '基础词库'), pkg('advanced', '进阶词库')],
      ['basic'],
    )

    const advanced = (await screen.findByRole('checkbox', {
      name: strings.a11y.room.vocabPackageSelectAria('进阶词库'),
    })) as HTMLInputElement
    await user.click(advanced)

    const names = emittedNames(view)
    // 旧实现同时上抛 `select` 与 `toggle`，宿主两条都绑同一个切换处理 → 一次点击执行两次。
    expect(names).toContain('toggle')
    expect(names).not.toContain('select')
    expect(view.emitted('toggle')).toEqual([['advanced']])
  })
})
