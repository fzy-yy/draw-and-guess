import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import type { Component } from 'vue'
import { strings } from '@draw-guess/strings'
import { playInteractionSound } from '@/audio'
import AvatarPickerDialog from '@/components/common/AvatarPickerDialog.vue'
import DataTable from '@/components/common/DataTable.vue'
import NetworkStatusButton from '@/components/common/NetworkStatusButton.vue'

describe('受控通用组件', () => {
  it('NetworkStatusButton 无 Pinia 时由 props 渲染连接质量和 ARIA', async () => {
    const view = render(NetworkStatusButton, {
      props: {
        connected: true,
        latency: 24,
        connectionLabel: strings.connection.connected,
        latencyGoodMs: 50,
      },
    })

    const button = screen.getByRole('button', {
      name: strings.common.networkStatusAria(strings.connection.connected, 24),
    })
    expect(button.textContent).toContain(strings.common.latencyShort(24))
    expect(button.classList.contains('text-success-on-dark')).toBe(true)

    await view.rerender({
      connected: false,
      latency: 24,
      connectionLabel: strings.connection.disconnected,
      latencyGoodMs: 50,
    })
    expect(button.classList.contains('text-danger-on-dark')).toBe(true)
  })

  it('NetworkStatusButton 将超长延迟按三位数封顶渲染，但配色仍按真实值判定', () => {
    render(NetworkStatusButton, {
      props: {
        connected: true,
        latency: 4321,
        connectionLabel: strings.connection.connected,
        latencyGoodMs: 50,
      },
    })

    const button = screen.getByRole('button', {
      name: strings.common.networkStatusAria(strings.connection.connected, 4321),
    })
    expect(button.textContent).toContain('999ms')
    expect(button.textContent).not.toContain('4321')
    // 展示封顶，但 4321ms 远超阈值，仍应显示为「较慢」的黄色档
    expect(button.classList.contains('text-yellow')).toBe(true)
  })

  it('AvatarPickerDialog 无 Pinia 时只展示注入白名单并上抛受控状态', async () => {
    const user = userEvent.setup()
    const updateAvatar = vi.fn()
    const updateOpen = vi.fn()
    const close = vi.fn()
    render(AvatarPickerDialog, {
      props: {
        modelValue: '01',
        open: true,
        avatarIds: ['01', '02'],
        'onUpdate:modelValue': updateAvatar,
        'onUpdate:open': updateOpen,
        onClose: close,
      },
    })

    expect(screen.getAllByRole('button', { name: /选择第 \d+ 号头像/u })).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: strings.profile.avatarOptionAria('02') }))

    expect(playInteractionSound).toHaveBeenCalledWith('select')
    expect(updateAvatar).toHaveBeenCalledWith('02')
    expect(updateOpen).toHaveBeenCalledWith(false)
    expect(close).toHaveBeenCalledOnce()
  })

  it('DataTable 无 Pinia 时可独立渲染受控列与空态', () => {
    render(DataTable as Component, {
      props: {
        columns: [{ key: 'name', label: '名称' }],
        rows: [],
        rowKey: 'id',
        selectAllAria: '选择全部',
        emptyText: '暂无数据',
      },
    })

    expect(screen.getByRole('button', { name: strings.common.sortByAria('名称') })).toBeTruthy()
    expect(screen.getByText('暂无数据')).toBeTruthy()
  })
})
