import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { render, screen, waitFor } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { strings } from '@draw-guess/strings'
import { playInteractionSound } from '@/audio'
import ContextMenu from '@/components/common/ContextMenu.vue'
import { useContextMenu, type ContextMenuItem } from '@/composables/useContextMenu'

/** 图标只验证「有图标位就渲染」这条通路，用本地函数式桩避免测试依赖图标库实现。 */
const StubIcon = () => h('svg', { 'data-testid': 'menu-icon' })

// props 直传路径不挂 icon：Testing Library 会把 props 包成深层响应式，
// 组件对象过响应式代理会触发 Vue 告警；图标渲染改由单例路径（shallowReactive）覆盖。
const MENU_ITEMS: ContextMenuItem[] = [
  { id: 'copy', label: '复制文本' },
  { id: 'react', label: '快速回应', disabled: true },
  { id: 'kick', label: '移出房间', danger: true, separatorBefore: true },
]

/** happy-dom 不做布局：手工构造矩形与偏移尺寸，供定位夹取用例断言最终偏移。
 *  一律用实例级 defineProperty 覆盖（happy-dom 的这些成员在原型上，vi.spyOn 打不到实例）。 */
function stubRect(element: HTMLElement, rect: DOMRect): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => rect,
  })
}

function stubBoxSize(element: HTMLElement, width: number, height: number): void {
  Object.defineProperty(element, 'offsetWidth', { configurable: true, value: width })
  Object.defineProperty(element, 'offsetHeight', { configurable: true, value: height })
}

function activeItemText(): string | undefined {
  return document.activeElement?.textContent?.trim()
}

/** happy-dom 不做布局：手工构造矩形，供定位夹取用例断言最终偏移。 */
function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

describe('ContextMenu 受控渲染', () => {
  it('关闭时不渲染面板，打开后给出菜单语义、默认无障碍名与分组分隔线', async () => {
    const view = render(ContextMenu, { props: { open: false, items: MENU_ITEMS, x: 0, y: 0 } })
    expect(screen.queryByRole('menu')).toBeNull()

    await view.rerender({ open: true })

    expect(screen.getByRole('menu', { name: strings.common.contextMenuAria })).toBeTruthy()
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent?.trim())).toEqual([
      '复制文本',
      '快速回应',
      '移出房间',
    ])
    // 只有「移出房间」声明了 separatorBefore
    expect(screen.getByRole('separator')).toBeTruthy()
    expect(playInteractionSound).toHaveBeenCalledWith('open')
  })

  it('无菜单项时不渲染空面板，即使 open 为 true', () => {
    render(ContextMenu, { props: { open: true, items: [], x: 0, y: 0 } })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('ariaLabel 覆盖默认无障碍名，危险项与禁用项分别落在红色与不可用状态', async () => {
    const view = render(ContextMenu, {
      props: { open: false, items: MENU_ITEMS, x: 0, y: 0, ariaLabel: '成员操作菜单' },
    })
    await view.rerender({ open: true })

    expect(screen.getByRole('menu', { name: '成员操作菜单' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '移出房间' }).className).toContain('text-red')
    expect(screen.getByRole('menuitem', { name: '复制文本' }).className).toContain('text-navy')
    expect(screen.getByRole('menuitem', { name: '快速回应' }).hasAttribute('disabled')).toBe(true)
  })

  it('点击菜单项先收起菜单再交回选中项，父级回写后才播放收起音', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onUpdateOpen = vi.fn()
    const view = render(ContextMenu, {
      props: { open: true, items: MENU_ITEMS, x: 0, y: 0, onSelect, 'onUpdate:open': onUpdateOpen },
    })
    await waitFor(() => expect(activeItemText()).toBe('复制文本'))

    await user.click(screen.getByRole('menuitem', { name: '移出房间' }))

    expect(onSelect).toHaveBeenCalledOnce()
    expect(onSelect.mock.calls[0]?.[0]).toMatchObject({ id: 'kick' })
    // 可见性由父级持有：组件只声明收起意图
    expect(onUpdateOpen).toHaveBeenCalledWith(false)

    await view.rerender({ open: false })

    expect(screen.queryByRole('menu')).toBeNull()
    expect(playInteractionSound).toHaveBeenLastCalledWith('close')
  })

  it('禁用项不可点击，不产生选中事件', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(ContextMenu, { props: { open: true, items: MENU_ITEMS, x: 0, y: 0, onSelect } })

    await user.click(screen.getByRole('menuitem', { name: '快速回应' }))

    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('ContextMenu 键盘与关闭时机', () => {
  it('打开即聚焦首个可用项，方向键循环且跳过禁用项', async () => {
    const user = userEvent.setup()
    render(ContextMenu, { props: { open: true, items: MENU_ITEMS, x: 0, y: 0 } })

    await waitFor(() => expect(activeItemText()).toBe('复制文本'))
    // 禁用的「快速回应」被跳过
    await user.keyboard('{ArrowDown}')
    expect(activeItemText()).toBe('移出房间')
    await user.keyboard('{ArrowDown}')
    expect(activeItemText()).toBe('复制文本')
    await user.keyboard('{ArrowUp}')
    expect(activeItemText()).toBe('移出房间')
    await user.keyboard('{Home}')
    expect(activeItemText()).toBe('复制文本')
    await user.keyboard('{End}')
    expect(activeItemText()).toBe('移出房间')
  })

  it('Esc 收起菜单并就地终止键盘事件，不再冒泡去关下层弹窗', async () => {
    const user = userEvent.setup()
    const onUpdateOpen = vi.fn()
    const bubbled = vi.fn()
    render(ContextMenu, {
      props: { open: true, items: MENU_ITEMS, x: 0, y: 0, 'onUpdate:open': onUpdateOpen },
    })
    await waitFor(() => expect(activeItemText()).toBe('复制文本'))

    document.addEventListener('keydown', bubbled)
    await user.keyboard('{Escape}')
    document.removeEventListener('keydown', bubbled)

    expect(onUpdateOpen).toHaveBeenCalledWith(false)
    expect(bubbled).not.toHaveBeenCalled()
  })

  it('焦点项上按 Enter 即激活，效果与点击一致', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onUpdateOpen = vi.fn()
    render(ContextMenu, {
      props: { open: true, items: MENU_ITEMS, x: 0, y: 0, onSelect, 'onUpdate:open': onUpdateOpen },
    })
    await waitFor(() => expect(activeItemText()).toBe('复制文本'))

    await user.keyboard('{Enter}')

    expect(onSelect.mock.calls[0]?.[0]).toMatchObject({ id: 'copy' })
    expect(onUpdateOpen).toHaveBeenCalledWith(false)
  })

  it('全部项不可用时聚焦面板本身，无关按键不动菜单', async () => {
    const user = userEvent.setup()
    const onUpdateOpen = vi.fn()
    render(ContextMenu, {
      props: {
        open: true,
        items: [
          { id: 'a', label: '暂不可用', disabled: true },
          { id: 'b', label: '也不可用', disabled: true },
        ],
        x: 0,
        y: 0,
        'onUpdate:open': onUpdateOpen,
      },
    })
    await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('menu'))

    await user.keyboard('{ArrowDown}')
    await user.keyboard('x')

    expect(document.activeElement?.getAttribute('role')).toBe('menu')
    expect(onUpdateOpen).not.toHaveBeenCalled()
  })

  it('Tab 收起菜单，焦点交还页面', async () => {
    const user = userEvent.setup()
    const onUpdateOpen = vi.fn()
    render(ContextMenu, {
      props: { open: true, items: MENU_ITEMS, x: 0, y: 0, 'onUpdate:open': onUpdateOpen },
    })

    await user.keyboard('{Tab}')

    expect(onUpdateOpen).toHaveBeenCalledWith(false)
  })

  it('点击菜单以外的区域收起菜单', async () => {
    const user = userEvent.setup()
    const onUpdateOpen = vi.fn()
    render(ContextMenu, {
      props: { open: true, items: MENU_ITEMS, x: 0, y: 0, 'onUpdate:open': onUpdateOpen },
    })
    await waitFor(() => expect(activeItemText()).toBe('复制文本'))

    await user.click(document.body)

    expect(onUpdateOpen).toHaveBeenCalledWith(false)
  })

  it('窗口失焦与祖先容器滚动都会收起菜单，面板自身滚动除外', async () => {
    const onUpdateOpen = vi.fn()
    render(ContextMenu, {
      props: { open: true, items: MENU_ITEMS, x: 0, y: 0, 'onUpdate:open': onUpdateOpen },
    })
    const panel = screen.getByRole('menu')

    panel.dispatchEvent(new Event('scroll'))
    expect(onUpdateOpen).not.toHaveBeenCalled()

    document.dispatchEvent(new Event('scroll'))
    expect(onUpdateOpen).toHaveBeenCalledWith(false)

    window.dispatchEvent(new Event('blur'))
    expect(onUpdateOpen).toHaveBeenCalledTimes(2)
  })
})

describe('ContextMenu 舞台内定位', () => {
  it('右下越界时翻转到指针左上，动画原点随指针角落换边', async () => {
    const view = render(ContextMenu, { props: { open: true, items: MENU_ITEMS, x: 0, y: 0 } })
    const layer = view.container.firstElementChild as HTMLElement
    const panel = screen.getByRole('menu')
    stubRect(layer, rect(0, 0, 1267, 713))
    stubBoxSize(panel, 200, 300)

    await view.rerender({ x: 1200, y: 700 })

    await waitFor(() => expect(panel.style.left).toBe('1000px'))
    // 下边缘翻到指针上方后仍越过舞台留白，因此被夹到 713-300-14
    expect(panel.style.top).toBe('399px')
    expect(panel.style.transformOrigin).toBe('right bottom')
  })

  it('空间充足时菜单贴着指针右下展开，原点留在左上', async () => {
    const view = render(ContextMenu, { props: { open: true, items: MENU_ITEMS, x: 0, y: 0 } })
    const layer = view.container.firstElementChild as HTMLElement
    const panel = screen.getByRole('menu')
    stubRect(layer, rect(40, 20, 1267, 713))
    stubBoxSize(panel, 200, 300)

    await view.rerender({ x: 140, y: 120 })

    await waitFor(() => expect(panel.style.left).toBe('100px'))
    // 舞台原点偏移 40/20 也要扣掉
    expect(panel.style.top).toBe('100px')
    expect(panel.style.transformOrigin).toBe('left top')
  })
})

describe('右键菜单与单例状态层协同', () => {
  const menu = useContextMenu()

  beforeEach(() => {
    menu.state.open = false
    menu.state.items = []
    menu.state.ariaLabel = undefined
  })

  /** 用真实单例状态驱动 ContextMenu，模拟视图侧「右键目标 → 弹菜单 → 点项」的完整链路。 */
  function renderHost(scenarios: { key: string; items: ContextMenuItem[] }[]): {
    selected: string[]
  } {
    const selected: string[] = []
    const Host = defineComponent({
      setup() {
        return () =>
          h('div', [
            ...scenarios.map((scenario) =>
              h(
                'button',
                {
                  type: 'button',
                  'data-testid': `target-${scenario.key}`,
                  onContextmenu: (event: MouseEvent) => menu.open(event, scenario.items),
                },
                scenario.key,
              ),
            ),
            h(ContextMenu, {
              open: menu.state.open,
              items: menu.state.items,
              x: menu.state.x,
              y: menu.state.y,
              'aria-label': menu.state.ariaLabel,
              'onUpdate:open': (value: boolean) => {
                menu.state.open = value
              },
              onSelect: (item: ContextMenuItem) => {
                selected.push(item.id)
                menu.activate(item)
              },
            }),
          ])
      },
    })
    render(Host)
    return { selected }
  }

  it('右键不同场景弹出不同列表，点击项执行对应动作', async () => {
    const user = userEvent.setup()
    const copy = vi.fn()
    const kick = vi.fn()
    const { selected } = renderHost([
      { key: 'message', items: [{ id: 'copy', label: '复制文本', icon: StubIcon, action: copy }] },
      { key: 'seat', items: [{ id: 'kick', label: '移出房间', danger: true, action: kick }] },
    ])

    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('target-message') })
    await waitFor(() => expect(screen.getByRole('menuitem', { name: '复制文本' })).toBeTruthy())
    expect(screen.queryByRole('menuitem', { name: '移出房间' })).toBeNull()
    // 带 icon 的项渲染出图标位
    expect(screen.getByTestId('menu-icon')).toBeTruthy()

    // 同一手势换场景：菜单原地换成另一份列表，不需要先关再开
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('target-seat') })
    await waitFor(() => expect(screen.getByRole('menuitem', { name: '移出房间' })).toBeTruthy())
    expect(screen.queryByRole('menuitem', { name: '复制文本' })).toBeNull()

    await user.click(screen.getByRole('menuitem', { name: '移出房间' }))

    expect(kick).toHaveBeenCalledOnce()
    expect(copy).not.toHaveBeenCalled()
    expect(selected).toEqual(['kick'])
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  it('关闭后把焦点归还给打开前的元素', async () => {
    const user = userEvent.setup()
    renderHost([{ key: 'message', items: [{ id: 'copy', label: '复制文本' }] }])
    const target = screen.getByTestId('target-message')
    target.focus()

    await user.pointer({ keys: '[MouseRight]', target })
    await waitFor(() => expect(screen.getByRole('menuitem', { name: '复制文本' })).toBeTruthy())

    await user.keyboard('{Escape}')

    await waitFor(() => expect(document.activeElement).toBe(target))
  })
})

describe('useContextMenu 状态层', () => {
  const menu = useContextMenu()

  beforeEach(() => {
    menu.state.open = false
    menu.state.items = []
    menu.state.ariaLabel = undefined
  })

  it('打开时记录落点、阻止浏览器原生菜单并可指定无障碍名', () => {
    const event = new MouseEvent('contextmenu', { clientX: 12, clientY: 34, cancelable: true })

    menu.open(event, MENU_ITEMS, { ariaLabel: '成员操作菜单' })

    expect(event.defaultPrevented).toBe(true)
    expect(menu.state.open).toBe(true)
    expect(menu.state.x).toBe(12)
    expect(menu.state.y).toBe(34)
    expect(menu.state.ariaLabel).toBe('成员操作菜单')
    expect(menu.state.items).toHaveLength(MENU_ITEMS.length)
  })

  it('空列表视为无菜单可弹：不打开，并收起已打开的菜单', () => {
    menu.open(new MouseEvent('contextmenu'), MENU_ITEMS)
    expect(menu.state.open).toBe(true)

    menu.open(new MouseEvent('contextmenu'), [])

    expect(menu.state.open).toBe(false)
  })

  it('激活时才执行动作，禁用项与无动作项静默忽略', () => {
    const action = vi.fn()

    menu.activate({ id: 'copy', label: '复制文本', action })
    menu.activate({ id: 'kick', label: '移出房间', disabled: true, action })
    menu.activate({ id: 'plain', label: '无动作项' })

    expect(action).toHaveBeenCalledOnce()
  })

  it('关闭后保留菜单项列表，供离场动画继续渲染', () => {
    menu.open(new MouseEvent('contextmenu'), MENU_ITEMS)

    menu.close()

    expect(menu.state.open).toBe(false)
    expect(menu.state.items).toHaveLength(MENU_ITEMS.length)
  })
})
