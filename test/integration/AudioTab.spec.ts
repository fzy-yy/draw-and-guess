import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { createTestingPinia } from '@pinia/testing'
import AudioTab from '@/components/settings/AudioTab.vue'
import { useGameStore } from '@/stores/game'
import { installFakeGameTransport } from '../client/fake-game-transport'

describe('AudioTab 与 Pinia 集成', () => {
  it('用户切换静音后更新状态并调用 Facade 保存动作', async () => {
    const user = userEvent.setup()
    const pinia = createTestingPinia({ createSpy: vi.fn, stubActions: true })
    installFakeGameTransport(pinia)
    render(AudioTab, { global: { plugins: [pinia] } })
    const store = useGameStore(pinia)
    store.settings.muted = false

    await user.click(screen.getByRole('checkbox'))

    expect(store.settings.muted).toBe(true)
    await waitFor(() => expect(store.saveSettings).toHaveBeenCalledOnce())
  })
})
