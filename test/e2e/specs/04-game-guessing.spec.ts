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
      // 玩家面板是常驻左栏，没有顶栏开关。
      await expect(guesser.page.getByLabel('对局顶栏')).not.toContainText('提示')
      await expect(guesser.page.getByRole('toolbar', { name: '绘图工具栏' })).toHaveCount(0)
      await expect(guesser.game.playersPanel).toBeVisible()
      await expect(guesser.page.getByRole('button', { name: '玩家面板' })).toHaveCount(0)

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

      // 3. 消息条数超过一屏后，聊天浮层必须给消息列表可滚动的高度，输入区仍在面板内可见。
      // 回归：浮层面板槽位曾把网格行高交给内容决定（隐式 auto 行），消息越多整块越高，
      // 消息列表自身永远拿不到滚动高度：既不出现滚动条，猜词输入还被挤出可见区。
      const guessInput = guesser.page.locator('input#guess-input')
      for (let index = 0; index < 20; index += 1) {
        await guessInput.fill(`干扰猜测第${index}条这是一段足够长的错误答案`)
        await guessInput.press('Enter')
        // 猜词事件限频 5 次/秒：放慢到 230ms 一条，避免服务端把消息按限频丢弃。
        await guesser.page.waitForTimeout(230)
      }
      const chatLayout = await guesser.page.evaluate(() => {
        const list = document.querySelector('div[aria-live="polite"]')
        const panel = list?.closest('section')
        const input = document.querySelector('input#guess-input')
        if (!(list instanceof HTMLElement) || !panel || !(input instanceof HTMLElement))
          return undefined
        const listBounds = list.getBoundingClientRect()
        const panelBounds = panel.getBoundingClientRect()
        const inputBounds = input.getBoundingClientRect()
        return {
          scrollable: list.scrollHeight > list.clientHeight,
          listBeyondPanel: Math.round(listBounds.bottom - panelBounds.bottom),
          inputBeyondPanel: Math.round(inputBounds.bottom - panelBounds.bottom),
          followedLatest: list.scrollHeight - list.scrollTop - list.clientHeight < 32,
        }
      })
      expect(chatLayout?.scrollable).toBe(true)
      expect(chatLayout?.listBeyondPanel).toBeLessThanOrEqual(0)
      expect(chatLayout?.inputBeyondPanel).toBeLessThanOrEqual(0)
      // 仍保持「新消息到达即跟随到底部」的阅读锚点
      expect(chatLayout?.followedLatest).toBe(true)

      // 4. 猜词者输入正确题目完成猜中
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
