import { test, expect, createPlayer, startTwoPlayerGame } from '../fixtures/test-base'

test.describe('05 - 对局控制、暂停与完整生命周期 (Game Lifecycle & Pause)', () => {
  test('房主暂停对局、冻结倒计时与恢复作画', async ({ browser }) => {
    const host = await createPlayer(browser, '控制房主')
    const guest = await createPlayer(browser, '被控客人')

    try {
      const roomName = `暂停生命周期-${Date.now()}`
      // 动态识别画家并选词
      const { drawer } = await startTwoPlayerGame(host, guest, roomName)
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
      // 动态识别画家并选词
      const { drawer } = await startTwoPlayerGame(host, guest, roomName)
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

      // 双客户端近同时点击：普通玩家只登记个人意愿，房主请求在最短展示期后全局生效。
      await Promise.all([guest.game.requestRematch(), host.game.returnToWaiting()])

      // 验证平稳回到房间等待阶段
      await expect(host.page.locator('text=玩家席位')).toBeVisible({ timeout: 10_000 })
      await expect(guest.page.locator('text=玩家席位')).toBeVisible({ timeout: 10_000 })
    } finally {
      await host.close()
      await guest.close()
    }
  })

  test('next_game 玩家中途候场，结算后转为普通未准备成员', async ({ browser }) => {
    const host = await createPlayer(browser, '候场局房主')
    const guest = await createPlayer(browser, '当前局玩家')
    const candidate = await createPlayer(browser, '下一局玩家')

    try {
      const roomName = `下一局候场-${Date.now()}`
      const { drawer } = await startTwoPlayerGame(host, guest, roomName, { maxPlayers: 3 })

      await drawer.game.chooseWord(0)

      await candidate.lobby.joinNextGame(roomName)
      const inGameCandidate = candidate.page
        .getByLabel('玩家', { exact: true })
        .locator('article:has-text("下一局玩家")')
      await expect(inGameCandidate.getByText('0 分', { exact: true })).toBeVisible()

      await host.game.pauseGame()
      await host.page.getByRole('button', { name: /提前结束/ }).click()
      const dialog = host.page.getByRole('dialog')
      await dialog.getByRole('button', { name: /确认结束/ }).click()
      await expect(candidate.page.getByText('最终排行')).toBeVisible({ timeout: 10_000 })
      await expect(candidate.page.getByText('下一局玩家', { exact: true })).toBeVisible()

      await host.game.returnToWaiting()
      await expect(candidate.page.getByText('玩家席位')).toBeVisible({ timeout: 10_000 })
      const candidateSeat = candidate.page.locator('article:has-text("下一局玩家")')
      await expect(candidateSeat.getByText('未准备', { exact: true })).toBeVisible()
      await candidate.room.toggleReady()
      await expect(candidateSeat.getByText('已准备', { exact: true })).toBeVisible()
    } finally {
      await host.close()
      await guest.close()
      await candidate.close()
    }
  })

  test('最终结算中房主断线后迁移，新房主可全局返回等待', async ({ browser }) => {
    const host = await createPlayer(browser, '断线结算房主')
    const guest = await createPlayer(browser, '接任结算房主')

    try {
      const roomName = `结算迁移-${Date.now()}`
      const { drawer } = await startTwoPlayerGame(host, guest, roomName)

      await drawer.game.chooseWord(0)
      await host.game.pauseGame()
      await host.page.getByRole('button', { name: /提前结束/ }).click()
      await host.page
        .getByRole('dialog')
        .getByRole('button', { name: /确认结束/ })
        .click()
      await expect(guest.page.getByText('最终排行')).toBeVisible({ timeout: 10_000 })

      await host.close()
      await expect(guest.page.getByRole('button', { name: '全员返回房间' })).toBeVisible({
        timeout: 10_000,
      })
      await guest.game.returnToWaiting()
      await expect(guest.page.getByText('玩家席位')).toBeVisible({ timeout: 10_000 })
    } finally {
      await host.close()
      await guest.close()
    }
  })
})
