import { setActivePinia, type Pinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ERROR_CODES, EVENTS } from '@draw-guess/shared'
import { PUBLIC_CONFIG } from '@draw-guess/config'
import { strings } from '@draw-guess/strings'
import RelayAnswerPanel from '@/components/game/relay/RelayAnswerPanel.vue'
import DraggablePanelShell from '@/components/game/DraggablePanelShell.vue'
import { useRoomStore } from '@/stores/room'
import { useSessionStore } from '@/stores/session'
import { HOST_ID, STEP_ID, createLiveRelayRoomFixture } from '../client/room-fixture'
import { createPiniaWithFakeTransport, type FakeGameTransport } from '../client/fake-game-transport'

/**
 * 接龙作答浮层的组件面（工单 10；依据 S15 / S30 / S41 / S72 / S86）：
 * 提交通道（作答走 `relay:submitGuess`、作画走 `relay:submitDrawing`，都不碰聊天事件）、
 * 空提交禁用、输入上限与聊天一致、锁定 / 等待态跟随快照（含服务端代交）、换棒复位与默认停靠。
 * 拖动定位本身由共享外壳 `DraggablePanelShell` 的既有用例守护，这里只断言它的默认停靠类。
 */

let pinia: Pinia
let fakeTransport: FakeGameTransport

/** 另一个步骤 id：验证换棒后浮层复位（不得残留上一棒的锁定态）。 */
const NEXT_STEP_ID = '00000000-0000-4000-8000-0000000000ff'

beforeEach(() => {
  const installed = createPiniaWithFakeTransport()
  pinia = installed.pinia
  fakeTransport = installed.fakeTransport
  setActivePinia(pinia)
  fakeTransport.setConnected(true)
  useSessionStore().playerId = HOST_ID
  useRoomStore().room = createLiveRelayRoomFixture('relay_guess', { currentStep: 2 })
})

afterEach(() => {
  fakeTransport.transport.destroy()
})

/** 挂载作答浮层（真实 Pinia + 假传输），props 由用例按场景覆盖。 */
function mountPanel(
  overrides: Partial<{
    stepId: string
    mode: 'guess' | 'draw'
    submitted: boolean
    enabled: boolean
  }> = {},
): VueWrapper {
  return mount(RelayAnswerPanel, {
    props: { stepId: STEP_ID, mode: 'guess', submitted: false, enabled: true, ...overrides },
    global: { plugins: [pinia] },
  })
}

describe('RelayAnswerPanel 猜词提交', () => {
  it('本棒截止时间已过：提交入口锁住并提示「本棒已结束」（消除归零瞬间的误导性报错）', async () => {
    useRoomStore().room = createLiveRelayRoomFixture('relay_guess', {
      currentStep: 2,
      phaseEndsAt: Date.now() - 1_000,
    })
    const wrapper = mountPanel()
    expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain(strings.ui.game.relayStepEnded)
  })

  it('空与全空白时提交按钮置灰，输入后提交走 relay:submitGuess 且不进聊天事件', async () => {
    const wrapper = mountPanel()
    const submitButton = wrapper.find('button[type="submit"]')

    expect((submitButton.element as HTMLButtonElement).disabled).toBe(true)
    await wrapper.find('input').setValue('   ')
    expect((submitButton.element as HTMLButtonElement).disabled).toBe(true)

    await wrapper.find('input').setValue('长颈鹿')
    expect((submitButton.element as HTMLButtonElement).disabled).toBe(false)

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(fakeTransport.requests.at(-1)).toMatchObject({
      event: EVENTS.relaySubmitGuess,
      payload: { stepId: STEP_ID, text: '长颈鹿' },
    })
    // 作答走独立通道：聊天事件在整段交互里从未出现（S20 / S79）
    expect(fakeTransport.requests.some((request) => request.event === EVENTS.chatSay)).toBe(false)

    // ack 成功即锁定并换成等待态
    expect(wrapper.text()).toContain(strings.ui.game.relayWaitingOthers)
    expect(wrapper.find('input').exists()).toBe(false)
    wrapper.unmount()
  })

  it('输入上限与聊天一致（chatMaxLength）', () => {
    const wrapper = mountPanel()
    expect(wrapper.find('input').attributes('maxlength')).toBe(
      String(PUBLIC_CONFIG.player.chatMaxLength),
    )
    wrapper.unmount()
  })

  it('提交失败时保留草稿并保持可重试（不本地锁定）', async () => {
    fakeTransport.setResponder((_event, payload) => ({
      ok: false,
      requestId: String(payload.requestId),
      error: { code: ERROR_CODES.ALREADY_SUBMITTED, message: '本步已提交' },
    }))
    const wrapper = mountPanel()
    await wrapper.find('input').setValue('长颈鹿')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('长颈鹿')
    expect(wrapper.text()).not.toContain(strings.ui.game.relayWaitingOthers)
    wrapper.unmount()
  })
})

describe('RelayAnswerPanel 锁定态跟随快照', () => {
  it('快照判定已提交（服务端超时 / 掉线代交）时直接呈等待态，且不产生任何请求', async () => {
    const wrapper = mountPanel()
    await wrapper.find('input').setValue('苹果')

    await wrapper.setProps({ submitted: true })
    expect(wrapper.text()).toContain(strings.ui.game.relayWaitingOthers)
    expect(wrapper.find('input').exists()).toBe(false)
    // 界面只是跟随快照：不自行推断、也不补发请求
    expect(fakeTransport.requests).toHaveLength(0)
    wrapper.unmount()
  })

  it('换棒（新 stepId）后回到未提交态，草稿与锁定都不残留', async () => {
    const wrapper = mountPanel()
    await wrapper.find('input').setValue('长颈鹿')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain(strings.ui.game.relayWaitingOthers)

    await wrapper.setProps({ stepId: NEXT_STEP_ID, submitted: false })

    expect(wrapper.text()).toContain(strings.ui.game.relayAnswerSubmit)
    expect(wrapper.text()).not.toContain(strings.ui.game.relayWaitingOthers)
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('')
    wrapper.unmount()
  })
})

describe('RelayAnswerPanel 作画提交', () => {
  it('作画棒只提供完成提交，走 relay:submitDrawing 并锁定为等待', async () => {
    useRoomStore().room = createLiveRelayRoomFixture('relay_draw', {
      ownCanvas: { strokes: [], undoneStrokeIds: [], lastSequence: -1, drawingRevision: 0 },
    })
    const wrapper = mountPanel({ mode: 'draw' })

    expect(wrapper.text()).toContain(strings.ui.game.relayDrawingSubmit)
    expect(wrapper.find('input').exists()).toBe(false)
    await wrapper.find('button').trigger('click')
    await flushPromises()

    expect(fakeTransport.requests.at(-1)).toMatchObject({
      event: EVENTS.relaySubmitDrawing,
      payload: { stepId: STEP_ID },
    })
    expect(wrapper.text()).toContain(strings.ui.game.relayWaitingOthers)
    wrapper.unmount()
  })

  it('作画棒提交失败时不解锁等待态、按钮保持可重试', async () => {
    useRoomStore().room = createLiveRelayRoomFixture('relay_draw', {
      ownCanvas: { strokes: [], undoneStrokeIds: [], lastSequence: -1, drawingRevision: 0 },
    })
    fakeTransport.setResponder((_event, payload) => ({
      ok: false,
      requestId: String(payload.requestId),
      error: { code: ERROR_CODES.ALREADY_SUBMITTED, message: '本步已提交' },
    }))
    const wrapper = mountPanel({ mode: 'draw' })
    await wrapper.find('button').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain(strings.ui.game.relayDrawingSubmit)
    expect((wrapper.find('button').element as HTMLButtonElement).disabled).toBe(false)
    wrapper.unmount()
  })
})

describe('RelayAnswerPanel 外壳与无障碍', () => {
  it('拖动手柄的无障碍名与悬浮提示来自 strings.a11y，输入框同样有无障碍名', () => {
    const wrapper = mountPanel()
    const grip = wrapper.find(`[aria-label="${strings.a11y.game.dragAnswerPanelAria}"]`)
    expect(grip.exists()).toBe(true)
    expect(grip.attributes('title')).toBe(strings.a11y.game.dragAnswerPanelTitle)
    expect(wrapper.find(`[aria-label="${strings.a11y.game.answerInputAria}"]`).exists()).toBe(true)
    wrapper.unmount()
  })

  it('默认停靠：猜词贴底居中、作画贴顶居中（避开底部工具条）', () => {
    const guessPanel = mountPanel()
    const guessShell = guessPanel.findComponent(DraggablePanelShell)
    expect(guessShell.classes()).toContain('bottom-[1.2cqh]')
    guessPanel.unmount()

    const drawPanel = mountPanel({ mode: 'draw' })
    const drawShell = drawPanel.findComponent(DraggablePanelShell)
    expect(drawShell.classes()).toContain('top-[1.2cqh]')
    drawPanel.unmount()
  })
})
