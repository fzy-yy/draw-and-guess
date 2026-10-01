import { test, expect, createPlayer, startTwoPlayerGame } from '../fixtures/test-base'

test.describe('04 - 实时猜词与计分流转 (Guessing, Chat & Scoring)', () => {
  test('发送普通聊天、预设快捷短语与正确猜中计分', async ({ browser }) => {
    const host = await createPlayer(browser, '画师小美')
    const guest = await createPlayer(browser, '猜霸小李')

    try {
      const roomName = `猜词测试-${Date.now()}`
      // 等待进入选词并动态识别画家
      const { drawer, guesser } = await startTwoPlayerGame(host, guest, roomName)

      // 画家选词并捕获所选题目
      const answer = await drawer.game.chooseWord(0)
      expect(answer).toBeTruthy()

      // 新浮层布局：猜词者顶栏不含任何提示文案（结构化提示已移除），且非画家没有底部工具条；
      // 浮层玩家面板可由顶栏开关收起 / 重新打开。
      await expect(guesser.page.getByLabel('对局顶栏')).not.toContainText('提示')
      await expect(guesser.page.getByRole('toolbar', { name: '绘图工具栏' })).toHaveCount(0)
      await expect(guesser.game.playersPanel).toBeVisible()
      await guesser.game.togglePlayersPanel()
      await expect(guesser.game.playersPanel).toBeHidden()
      await guesser.game.togglePlayersPanel()
      await expect(guesser.game.playersPanel).toBeVisible()

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
      // 最后一名猜词者（本局唯一猜词者）猜中即结束本回合，服务端会在同一份快照里把阶段切到
      // round_result；此时礼花仍应触发，且必须**真的绘制出像素**（主线程渲染，画布可读）。
      // 回归点：若退回 canvas-confetti 默认的 Blob Worker，CSP `script-src 'self'` 会拦掉 Worker，
      // 画布被 transferControlToOffscreen 后既不显示也无法回退。
      await guesser.page.waitForFunction(
        () => {
          const canvas = [...document.querySelectorAll('canvas')].find(
            (element): element is HTMLCanvasElement =>
              element instanceof HTMLCanvasElement && !element.closest('.game-stage'),
          )
          if (!canvas || !canvas.width || !canvas.height) return false
          try {
            const context = canvas.getContext('2d')
            if (!context) return false
            const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
            for (let index = 3; index < data.length; index += 4) {
              if ((data[index] ?? 0) > 0) return true
            }
            return false
          } catch {
            // 画布控制权已被转移（Worker 路径）：视为未绘制
            return false
          }
        },
        undefined,
        { polling: 200, timeout: 10_000 },
      )
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
