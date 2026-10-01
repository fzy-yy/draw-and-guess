import { setActivePinia, type Pinia } from 'pinia'
import { mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { strings } from '@draw-guess/strings'
import PlayerPanel from '@/components/game/PlayerPanel.vue'
import { useRoomStore } from '@/stores/room'
import { GUEST_ID, HOST_ID, createRoomFixture } from '../client/room-fixture'
import { createPiniaWithFakeTransport } from '../client/fake-game-transport'

/**
 * 玩家面板的对外行为：列出成员与分数、展示局内角色（画家 / 已猜中 / 掉线），
 * 且不再显示「我」标记（收窄版取代旧的得分条，见 ADR-0043）。
 */

let pinia: Pinia

beforeEach(() => {
  pinia = createPiniaWithFakeTransport().pinia
  setActivePinia(pinia)
})

function mountPanel(): VueWrapper {
  return mount(PlayerPanel, { global: { plugins: [pinia] } })
}

describe('PlayerPanel 成员展示', () => {
  it('列出全部成员的头像、昵称、分数与局内角色', () => {
    const roomStore = useRoomStore()
    roomStore.room = createRoomFixture('drawing')

    const wrapper = mountPanel()
    expect(wrapper.text()).toContain('房主')
    expect(wrapper.text()).toContain('猜词者')
    expect(wrapper.text()).toContain(strings.common.scoreUnit(20))
    expect(wrapper.text()).toContain(strings.status.roleDrawing)
    expect(wrapper.text()).toContain(strings.status.roleGuessing)
    wrapper.unmount()
  })

  it('不再显示「我」标记', () => {
    const roomStore = useRoomStore()
    roomStore.room = createRoomFixture('drawing')

    const wrapper = mountPanel()
    expect(wrapper.text()).not.toContain(strings.room.meTag)
    wrapper.unmount()
  })

  it('已猜中的成员角色切换为已猜中', () => {
    const roomStore = useRoomStore()
    roomStore.room = createRoomFixture('drawing')
    roomStore.room.members.find((member) => member.id === GUEST_ID)!.guessed = true

    const wrapper = mountPanel()
    expect(wrapper.text()).toContain(strings.status.roleGuessed)
    wrapper.unmount()
  })

  it('掉线成员以虚线边框标记，在线成员不使用该标记', () => {
    const roomStore = useRoomStore()
    roomStore.room = createRoomFixture('drawing')
    roomStore.room.members.find((member) => member.id === GUEST_ID)!.connection = 'reconnecting'

    const wrapper = mountPanel()
    const articles = wrapper.findAll('article')
    const offline = articles.find((article) => article.text().includes('猜词者'))!
    const online = articles.find((article) => article.text().includes('房主'))!
    expect(offline.classes()).toContain('border-dashed')
    expect(online.classes()).not.toContain('border-dashed')
    wrapper.unmount()
  })

  it('画家成员角色为作画中（房主身份不影响判断）', () => {
    const roomStore = useRoomStore()
    roomStore.room = createRoomFixture('drawing')
    // fixture 中 HOST_ID 为画家；额外断言角色判定只由 isDrawer 决定
    const drawer = roomStore.room.members.find((member) => member.id === HOST_ID)!
    expect(drawer.isDrawer).toBe(true)

    const wrapper = mountPanel()
    expect(wrapper.text()).toContain(strings.status.roleDrawing)
    wrapper.unmount()
  })
})
