import { test, expect, createPlayer } from '../fixtures/test-base'

test.describe('04 - 实时猜词与计分流转 (Guessing, Chat & Scoring)', () => {
  test('发送普通聊天、预设快捷短语与正确猜中计分', async ({ browser }) => {
    const host = await createPlayer(browser, '画师小美')
    const guest = await createPlayer(browser, '猜霸小李')

    try {
      const roomName = `猜词测试-${Date.now()}`
      await host.lobby.createRoom({ name: roomName })
      await guest.lobby.joinPublicRoom(roomName)
      await guest.room.toggleReady()
      await host.room.startGame()

      // 等待进入选词并动态识别画家
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
      const guesser = isHostDrawer ? guest : host

      // 画家选词并捕获所选题目
      const answer = await drawer.game.chooseWord(0)
      expect(answer).toBeTruthy()

      // 1. 发送普通错误猜词
      await guesser.game.sendGuess('这不是正确答案')
      await expect(
        guesser.page.locator('div[aria-live="polite"]:has-text("这不是正确答案")'),
      ).toBeVisible({ timeout: 10_000 })
      await expect(
        drawer.page.locator('div[aria-live="polite"]:has-text("这不是正确答案")'),
      ).toBeVisible({ timeout: 10_000 })

      // 2. 发送快捷预设短语（使用安全白名单短语“好难猜呀”）
      await guesser.game.sendPreset('好难猜呀')
      await expect(drawer.page.locator('div[aria-live="polite"]:has-text("好难猜呀")')).toBeVisible(
        { timeout: 10_000 },
      )

      // 3. 猜词者输入正确题目完成猜中
      await guesser.game.sendGuess(answer)
      // 验证系统下发猜中提示或得分增加
      await expect(
        guesser.page.locator('div[aria-live="polite"]:has-text("猜中了！")'),
      ).toBeVisible({ timeout: 10_000 })
      // 猜词者角色状态切换为已猜中
      await expect(guesser.page.locator('text=已猜中').first()).toBeVisible({ timeout: 10_000 })
    } finally {
      await host.close()
      await guest.close()
    }
  })
})
