import { test, expect, createPlayer, startTwoPlayerGame } from '../fixtures/test-base'

test.describe('03 - 对局画板与绘图工具 (Game Drawing & Canvas)', () => {
  test('选词流程、画笔/橡皮擦、撤销重做与清空画板', async ({ browser }) => {
    const host = await createPlayer(browser, '画家房主')
    const guest = await createPlayer(browser, '猜词客人')

    try {
      const roomName = `画板测试-${Date.now()}`
      // 1. 动态判断首位当选画家并选词
      const { drawer, guesser } = await startTwoPlayerGame(host, guest, roomName)

      await drawer.game.chooseWord(0)

      // 2. 验证双方进入作画/观看阶段
      await expect(drawer.page.locator('canvas.bg-white')).toBeVisible()
      await expect(guesser.page.locator('canvas.bg-white')).toBeVisible()

      // 3. 画家使用画笔在画布绘制线段
      await drawer.game.drawStroke([
        { x: 0.2, y: 0.2 },
        { x: 0.4, y: 0.4 },
        { x: 0.6, y: 0.2 },
      ])

      // 4. 画家切换为橡皮擦并擦除一部分
      await drawer.game.selectTool('eraser')
      await drawer.game.drawStroke([
        { x: 0.35, y: 0.35 },
        { x: 0.45, y: 0.45 },
      ])

      // 5. 撤销与重做
      await drawer.game.undo()
      await drawer.game.redo()

      // 6. 清空画板
      await drawer.game.clearCanvas()
    } finally {
      await host.close()
      await guest.close()
    }
  })

  test('F04 · 洪泛填充封边不覆盖实心墨线 (像素级验证)', async ({ browser }) => {
    const host = await createPlayer(browser, '填充测试画家')
    const guest = await createPlayer(browser, '填充观察者')

    try {
      const roomName = `填充测试-${Date.now()}`
      const { drawer } = await startTwoPlayerGame(host, guest, roomName)

      await drawer.game.chooseWord(0)

      // 1. 在画布绘制一条竖直墨线 (x: 0.5, y: 0.1 -> 0.9)
      await drawer.game.selectTool('pen')
      await drawer.game.drawStroke([
        { x: 0.5, y: 0.1 },
        { x: 0.5, y: 0.5 },
        { x: 0.5, y: 0.9 },
      ])

      // 等待笔画渲染同步
      await drawer.page.waitForTimeout(500)

      // 2. 切换到红色色块并使用填充工具在左侧空白区 (x: 0.2, y: 0.5) 填充
      await drawer.page.locator('button[aria-label*="#EF4444"]').click()
      await drawer.game.selectTool('fill')
      await drawer.game.clickCanvas({ x: 0.2, y: 0.5 })

      // 等待填充渲染
      await drawer.page.waitForTimeout(500)

      // 3. F04 像素核查：验证墨线 (x: 0.5) 保持实心 (RGB ≈ 31, 41, 55, A=255)，未被填充色吞噬
      const isBlackPreserved = await drawer.page.evaluate(() => {
        const canvas = document.querySelector('canvas.bg-white') as HTMLCanvasElement | null
        if (!canvas) return false
        const ctx = canvas.getContext('2d')
        if (!ctx) return false
        const midX = Math.round(canvas.width * 0.5)
        const midY = Math.round(canvas.height * 0.5)
        // 采集中间墨线 5x5 像素区域
        const img = ctx.getImageData(midX - 2, midY - 2, 5, 5)
        // 至少有一个像素保持墨线颜色 (R < 60, G < 60, B < 70, A === 255)
        for (let i = 0; i < img.data.length; i += 4) {
          const r = img.data[i]!
          const g = img.data[i + 1]!
          const b = img.data[i + 2]!
          const a = img.data[i + 3]!
          if (a === 255 && r < 60 && g < 60 && b < 70) {
            return true
          }
        }
        return false
      })

      expect(isBlackPreserved).toBe(true)
    } finally {
      await host.close()
      await guest.close()
    }
  })
})
