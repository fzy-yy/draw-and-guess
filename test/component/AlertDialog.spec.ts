import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import AlertDialog from '@/components/common/AlertDialog.vue'

describe('AlertDialog 交互与契约测试', () => {
  it('正确渲染标题、说明与操作按钮，点击操作触发 action 事件', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    render(AlertDialog, {
      props: {
        open: true,
        title: '版本已更新',
        body: '请刷新以加载最新协议。',
        actionLabel: '刷新页面',
        onAction,
      },
    })

    expect(screen.getByText('版本已更新')).toBeTruthy()
    expect(screen.getByText('请刷新以加载最新协议。')).toBeTruthy()

    const button = screen.getByRole('button', { name: '刷新页面' })
    await user.click(button)

    expect(onAction).toHaveBeenCalledOnce()
  })

  it('非 dismissible 阻断状态下不渲染关闭按钮', () => {
    render(AlertDialog, {
      props: {
        open: true,
        title: '服务断开中',
        body: '正在尝试重连服务…',
        dismissible: false,
      },
    })

    expect(screen.getByText('服务断开中')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /关闭/ })).toBeNull()
  })
})
