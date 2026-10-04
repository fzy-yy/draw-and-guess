import { defineComponent, h } from 'vue'
import { setActivePinia, type Pinia } from 'pinia'
import { render, screen, waitFor } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultRoomSettings } from '@draw-guess/config'
import { strings } from '@draw-guess/strings'
import RulesDialog from '@/components/room/RulesDialog.vue'
import VocabularyDialog from '@/components/room/VocabularyDialog.vue'
import { useRoomStore } from '@/stores/room'
import { useSessionStore } from '@/stores/session'
import { EVENTS, type VocabularySnapshot } from '@draw-guess/shared'
import { createPiniaWithFakeTransport, type FakeGameTransport } from '../client/fake-game-transport'
import { GUEST_ID, HOST_ID, createRoomFixture } from '../client/room-fixture'

let pinia: Pinia
let fakeTransport: FakeGameTransport

beforeEach(() => {
  const installed = createPiniaWithFakeTransport()
  pinia = installed.pinia
  fakeTransport = installed.fakeTransport
  setActivePinia(pinia)
})

function vocabularyFixture(packageId = 'basic'): VocabularySnapshot {
  const items = Array.from({ length: 60 }, (_, index) => ({
    id: `word-${index + 1}`,
    text: index === 0 ? '苹果' : `词语${index + 1}`,
    aliases: index === 0 ? ['红苹果'] : [],
    collection: index === 0 ? '水果' : '常识',
  }))
  return {
    packageId,
    packages: [
      {
        id: 'basic',
        name: '基础词库',
        wordCount: 60,
        description: '常用词',
        version: '1',
        updatedAt: '2026-09-12',
      },
      {
        id: 'advanced',
        name: '进阶词库',
        wordCount: 60,
        description: '进阶词',
        version: '1',
        updatedAt: '2026-09-12',
      },
    ],
    items,
    selectedIds: items.map(({ id }) => id),
    version: '1',
    collections: ['水果', '常识'],
  }
}

/**
 * happy-dom 没有可用布局尺寸，虚拟表格不会挂载数据行；这里仅替换表格渲染边界，
 * 保留 VocabularyDialog、Pinia、请求门禁与包切换 composable 的真实实现。
 */
const VocabularyPackageTableStub = defineComponent({
  name: 'VocabPackageTableView',
  inheritAttrs: false,
  props: {
    rows: { type: Array, required: true },
    selectedPackageId: { type: String, required: true },
    isReadOnly: Boolean,
    selectionPending: Boolean,
  },
  emits: ['select'],
  setup(props, { emit, expose }) {
    expose({ scrollToTop: () => undefined })
    return () =>
      h(
        'div',
        (props.rows as VocabularySnapshot['packages']).map((item) =>
          h('input', {
            type: 'radio',
            checked: item.id === props.selectedPackageId,
            disabled: props.isReadOnly || props.selectionPending,
            'aria-label': strings.a11y.room.vocabPackageSelectAria(item.name),
            onChange: () => emit('select', item.id),
          }),
        ),
      )
  },
})

function renderVocabularyDialog(): ReturnType<typeof render> {
  return render(VocabularyDialog, {
    props: { open: true },
    global: {
      plugins: [pinia],
      stubs: { VocabPackageTableView: VocabularyPackageTableStub },
    },
  })
}

describe('RulesDialog 完整规则字段', () => {
  it('全部字段都有可访问名称，并把用户编辑后的完整草稿提交给父组件', async () => {
    const user = userEvent.setup()
    const draft = defaultRoomSettings()
    const onSave = vi.fn()
    render(RulesDialog, {
      props: { open: true, draft, onSave },
      global: { plugins: [pinia] },
    })

    const expectedLabels = [
      strings.ui.common.roundsField,
      strings.ui.room.chooseTimeField,
      strings.ui.room.optionCountField,
      strings.ui.room.toggleAllowCustomWord,
      strings.ui.room.togglePlayerInvite,
      strings.ui.room.toggleAllowWordReroll,
      strings.ui.room.drawSecondsField,
      strings.ui.room.toggleShowWordLength,
      strings.ui.room.toggleProgressiveHints,
      strings.ui.room.togglePause,
    ]
    for (const label of expectedLabels)
      expect(screen.getByLabelText(new RegExp(label))).toBeTruthy()

    // 手写下拉（SelectDropdown）：点 combobox 展开 → 点 option 选中
    await user.click(screen.getByLabelText(strings.ui.common.roundsField))
    await user.click(await screen.findByRole('option', { name: strings.ui.common.roundsUnit(3) }))
    await user.click(screen.getByLabelText(strings.ui.room.togglePause))
    await user.click(screen.getByRole('button', { name: strings.ui.room.saveRules }))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        roundsPerPlayer: 3,
        allowPause: !draft.allowPause,
      }),
    )
  })
})

describe('VocabularyDialog 权限与竞态', () => {
  it('非房主可搜索查看，但没有词条选择框、切包能力或保存动作', async () => {
    const user = userEvent.setup()
    const room = useRoomStore()
    room.room = { ...createRoomFixture('waiting'), vocabularyPackageId: 'basic' }
    useSessionStore().playerId = GUEST_ID
    const snapshot = vocabularyFixture()
    fakeTransport.setResponder((_event, payload) => ({
      ok: true,
      requestId: String(payload.requestId),
      data: snapshot,
    }))

    renderVocabularyDialog()

    const dialog = await screen.findByRole('dialog', { name: strings.ui.room.vocabTitleReadonly })
    expect(screen.getByText(strings.ui.room.vocabReadonlyHint)).toBeTruthy()
    expect(screen.queryByRole('button', { name: strings.ui.room.confirmSelection })).toBeNull()
    const selectAllCheckbox = screen.getByRole('checkbox', {
      name: strings.a11y.room.vocabToggleAllAria,
    })
    expect((selectAllCheckbox as HTMLInputElement).disabled).toBe(true)

    await user.type(screen.getByLabelText(strings.a11y.room.vocabSearchAria), '苹果')
    await waitFor(() =>
      expect(
        (screen.getByLabelText(strings.a11y.room.vocabSearchAria) as HTMLInputElement).value,
      ).toBe('苹果'),
    )
    expect(dialog).toBeTruthy()

    await user.click(screen.getByRole('button', { name: strings.a11y.room.vocabSwitchToPackages }))
    const packageChoice = await screen.findByRole('radio', {
      name: strings.a11y.room.vocabPackageSelectAria('进阶词库'),
    })
    expect((packageChoice as HTMLInputElement).disabled).toBe(true)
  })

  it('关闭弹窗会废弃迟到加载结果，不重新打开已关闭的界面', async () => {
    const room = useRoomStore()
    room.room = { ...createRoomFixture('waiting'), vocabularyPackageId: 'basic' }
    useSessionStore().playerId = HOST_ID
    let resolveLoad!: (snapshot: VocabularySnapshot) => void
    fakeTransport.setResponder(
      (_event, payload) =>
        new Promise((resolve) => {
          resolveLoad = (snapshot) =>
            resolve({ ok: true, requestId: String(payload.requestId), data: snapshot })
        }),
    )

    const view = renderVocabularyDialog()
    await waitFor(() => expect(fakeTransport.requests).toHaveLength(1))

    await view.rerender({ open: false })
    resolveLoad(vocabularyFixture())
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('词库包切换进行中禁用其它选择，避免并发响应覆盖新状态', async () => {
    const user = userEvent.setup()
    const room = useRoomStore()
    room.room = { ...createRoomFixture('waiting'), vocabularyPackageId: 'basic' }
    useSessionStore().playerId = HOST_ID
    const snapshot = vocabularyFixture()
    let resolveSwitch!: () => void
    fakeTransport.setResponder((event, payload) => {
      if (event === EVENTS.roomSelectVocabularyPackage) {
        return new Promise((resolve) => {
          resolveSwitch = () =>
            resolve({
              ok: true,
              requestId: String(payload.requestId),
              data: vocabularyFixture('advanced'),
            })
        })
      }
      return { ok: true, requestId: String(payload.requestId), data: snapshot }
    })

    renderVocabularyDialog()
    await screen.findByRole('dialog', { name: strings.ui.room.vocabTitle })
    await user.click(screen.getByRole('button', { name: strings.a11y.room.vocabSwitchToPackages }))
    const advanced = await screen.findByRole('radio', {
      name: strings.a11y.room.vocabPackageSelectAria('进阶词库'),
    })
    await user.click(advanced)

    await waitFor(() => expect((advanced as HTMLInputElement).disabled).toBe(true))
    expect(
      fakeTransport.requests.filter(({ event }) => event === EVENTS.roomSelectVocabularyPackage),
    ).toHaveLength(1)
    resolveSwitch()
    await waitFor(() => expect((advanced as HTMLInputElement).disabled).toBe(false))
  })
})
