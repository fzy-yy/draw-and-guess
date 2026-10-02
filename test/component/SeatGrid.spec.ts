import { mount, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, type Pinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { strings } from '@draw-guess/strings'
import SeatGrid from '@/components/room/SeatGrid.vue'
import { useContextMenu } from '@/composables/useContextMenu'
import { useRoomStore } from '@/stores/room'
import { useSessionStore } from '@/stores/session'
import { GUEST_ID, HOST_ID, createRoomFixture } from '../client/room-fixture'
import { createPiniaWithFakeTransport } from '../client/fake-game-transport'

let pinia: Pinia

/**
 * 席位右键菜单验收（角标按钮已移除，菜单是唯一操作入口）：
 * 仅「房主 + 他人席位」弹出「移交房主 / 移除玩家」，激活项经确认弹窗二次确认；
 * 自己席位、空位与非房主一律不弹。
 */
beforeEach(() => {
  pinia = createPiniaWithFakeTransport().pinia
  setActivePinia(pinia)
})

afterEach(() => {
  useContextMenu().close()
  document.body.innerHTML = ''
})

function mountSeats(playerId: string) {
  const roomStore = useRoomStore()
  roomStore.room = createRoomFixture('waiting')
  useSessionStore().playerId = playerId
  return mount(SeatGrid, { global: { plugins: [pinia] }, attachTo: document.body })
}

function seatOf(wrapper: VueWrapper, nickname: string) {
  return wrapper.findAll('article').find((seat) => seat.text().includes(nickname))!
}

/** 以真实 MouseEvent 派发 contextmenu（携带视口坐标，供菜单定位）。 */
function rightClick(target: { element: HTMLElement }): void {
  target.element.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }),
  )
}

describe('SeatGrid 席位右键菜单', () => {
  it('房主右键他人席位弹出「移交房主 / 移除玩家」菜单', () => {
    const wrapper = mountSeats(HOST_ID)
    rightClick(seatOf(wrapper, '猜词者'))
    const { state } = useContextMenu()
    expect(state.open).toBe(true)
    expect(state.items.map((item) => item.label)).toEqual([
      strings.a11y.room.transferHostAria,
      strings.a11y.room.kickAria,
    ])
    expect(state.items[1]?.danger).toBe(true)
    wrapper.unmount()
  })

  it('右键自己的席位或非房主右键他人均不弹菜单', () => {
    const hostWrapper = mountSeats(HOST_ID)
    rightClick(seatOf(hostWrapper, '房主'))
    expect(useContextMenu().state.open).toBe(false)
    hostWrapper.unmount()

    const guestWrapper = mountSeats(GUEST_ID)
    rightClick(seatOf(guestWrapper, '房主'))
    expect(useContextMenu().state.open).toBe(false)
    guestWrapper.unmount()
  })

  it('席位计数按占席口径：离局占位不计容量，但成绩卡仍展示', () => {
    const roomStore = useRoomStore()
    roomStore.room = createRoomFixture('waiting')
    roomStore.room.members[1]!.leftGame = true
    useSessionStore().playerId = HOST_ID
    const wrapper = mount(SeatGrid, { global: { plugins: [pinia] } })

    // 两张卡片里 1 人已离局：计数 1/6，与大厅人数、服务端容量校验同口径
    expect(wrapper.text()).toContain(
      strings.ui.room.seatCount(1, roomStore.room.settings.maxPlayers),
    )
    // 离局者仍保留卡片（成绩属于本局历史），计数与卡片数刻意不一致
    const seats = wrapper.findAll('article')
    expect(seats.filter((seat) => seat.text().includes('猜词者')).length).toBe(1)
    wrapper.unmount()
  })

  it('激活「移除玩家」菜单项弹出确认框（不直接执行破坏性操作）', async () => {
    const wrapper = mountSeats(HOST_ID)
    rightClick(seatOf(wrapper, '猜词者'))
    const menu = useContextMenu()
    const kickItem = menu.state.items.find((item) => item.id === 'kick')
    expect(kickItem).toBeTruthy()
    menu.activate(kickItem!)
    // 等待 BaseDialog 的 open 监听与焦点陷阱激活（nextTick + 宏任务）完成后再断言，
    // 避免在陷阱挂载前 unmount 造成 focus-trap 竞态报错
    await new Promise((resolve) => setTimeout(resolve, 0))
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain(strings.ui.room.kickTitle)
    wrapper.unmount()
  })
})
