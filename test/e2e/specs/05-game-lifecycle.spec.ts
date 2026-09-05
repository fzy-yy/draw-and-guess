import { test, expect, createPlayer } from '../fixtures/test-base'

test.describe('05 - 对局控制、暂停与完整生命周期 (Game Lifecycle & Pause)', () => {
  test('房主暂停对局、冻结倒计时与恢复作画', async ({ browser }) => {
    const host = await createPlayer(browser, '控制房主')
    const guest = await createPlayer(browser, '被控客人')

    try {
      const roomName = `暂停生命周期-${Date.now()}`
      await host.lobby.createRoom({ name: roomName })
      await guest.lobby.joinPublicRoom(roomName)
      await guest.room.toggleReady()
      await host.room.startGame()

      // 动态识别画家并选词
      const isHostDrawer = await Promise.race([
        host.page
          .locator('text=轮到你作画了')
          .waitFor({ timeout: 15_000 })
          .then(() => true),
        guest.page
          .locator('text=轮到你作画了')
          .waitFor({ timeout: 15_000 })
          .then(() => false),
      ])
      const drawer = isHostDrawer ? host : guest
      await drawer.game.chooseWord(0)

      // 1. 房主暂停对局
      await host.game.pauseGame()

      // 双方都展示暂停遮罩
      await expect(host.page.locator('text=游戏已安全暂停')).toBeVisible({ timeout: 10_000 })
      await expect(guest.page.locator('text=游戏已安全暂停')).toBeVisible({ timeout: 10_000 })

      // 2. 房主恢复对局
      await host.game.resumeGame()

      // 暂停遮罩消失，恢复正常作画
      await expect(host.page.locator('text=游戏已安全暂停')).toBeHidden({ timeout: 10_000 })
      await expect(guest.page.locator('text=游戏已安全暂停')).toBeHidden({ timeout: 10_000 })
    } finally {
      await host.close()
      await guest.close()
    }
  })

  test('F08 · 回合结算与结束对局返回房间等待', async ({ browser }) => {
    const host = await createPlayer(browser, '终局房主')
    const guest = await createPlayer(browser, '终局客人')

    try {
      const roomName = `终局测试-${Date.now()}`
      await host.lobby.createRoom({ name: roomName })
      await guest.lobby.joinPublicRoom(roomName)
      await guest.room.toggleReady()
      await host.room.startGame()

      // 动态识别画家并选词
      const isHostDrawer = await Promise.race([
        host.page
          .locator('text=轮到你作画了')
          .waitFor({ timeout: 15_000 })
          .then(() => true),
        guest.page
          .locator('text=轮到你作画了')
          .waitFor({ timeout: 15_000 })
          .then(() => false),
      ])
      const drawer = isHostDrawer ? host : guest
      await drawer.game.chooseWord(0)

      // 房主暂停并提前结束本局
      await host.game.pauseGame()
      await host.page.getByRole('button', { name: /提前结束/ }).click()
      // 确认弹窗
      const dialog = host.page.getByRole('dialog')
      await expect(dialog).toBeVisible({ timeout: 10_000 })
      await dialog.getByRole('button', { name: /确认结束/ }).click()

      // 双方看到最终结算排行
      await expect(host.page.locator('text=最终排行')).toBeVisible({ timeout: 10_000 })
      await expect(guest.page.locator('text=最终排行')).toBeVisible({ timeout: 10_000 })

      // 点击返回房间
      await host.game.returnToWaiting()

      // 验证平稳回到房间等待阶段
      await expect(host.page.locator('text=玩家席位')).toBeVisible({ timeout: 10_000 })
      await expect(guest.page.locator('text=玩家席位')).toBeVisible({ timeout: 10_000 })
    } finally {
      await host.close()
      await guest.close()
    }
  })
})
