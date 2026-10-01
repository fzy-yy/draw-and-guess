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

      // 3. 新浮层布局：底部工具条与浮层面板均可由顶栏开关收起 / 重新打开
      await expect(drawer.game.toolbar).toBeVisible()
      await drawer.game.toggleToolbar()
      await expect(drawer.game.toolbar).toBeHidden()
      await drawer.game.toggleToolbar()
      await expect(drawer.game.toolbar).toBeVisible()

      // 玩家面板是常驻左栏：没有顶栏开关，始终可见
      await expect(drawer.game.playersPanel).toBeVisible()
      await expect(drawer.page.getByRole('button', { name: '玩家面板' })).toHaveCount(0)

      // 4. 画家使用画笔在画布绘制线段
      await drawer.game.drawStroke([
        { x: 0.2, y: 0.2 },
        { x: 0.4, y: 0.4 },
        { x: 0.6, y: 0.2 },
      ])

      // 5. 画家切换为橡皮擦并擦除一部分
      await drawer.game.selectTool('eraser')
      await drawer.game.drawStroke([
        { x: 0.35, y: 0.35 },
        { x: 0.45, y: 0.45 },
      ])

      // 6. 撤销与重做
      await drawer.game.undo()
      await drawer.game.redo()

      // 7. 清空画板（顺带回归光标落点）
      // 回归：pointerenter 只置「可见」不落点时，清空确认弹窗关闭后浏览器只补发 pointerenter、
      // 不补发 pointermove，跟随光标的圆点会停在离开画布前的旧位置（也就是清除按钮上方），
      // 而此刻原生光标已被 cursor-none 隐藏 —— 玩家看到的就是「鼠标瞬移到了清除工具按钮旁边」。
      const canvasLocator = drawer.page.locator('canvas[data-canvas-layer="display"]')
      const cursorDot = canvasLocator.locator('xpath=../i')
      const canvasBox = await canvasLocator.boundingBox()
      if (!canvasBox) throw new Error('画布不可见')
      // 先把指针停在画布左上区域：它就是「离开画布前的旧位置」，与确认按钮相距很远
      // 同时记录真实指针坐标：断言「圆点必须在指针下」，而不是依赖按钮动画中的测量值。
      await drawer.page.evaluate(() => {
        const state = { x: -1, y: -1 }
        Object.defineProperty(window, '__cursorProbe', { value: state, configurable: true })
        window.addEventListener(
          'pointerdown',
          (event) => {
            state.x = event.clientX
            state.y = event.clientY
          },
          true,
        )
      })
      await drawer.page.mouse.move(
        canvasBox.x + canvasBox.width * 0.25,
        canvasBox.y + canvasBox.height * 0.25,
      )
      await drawer.page.getByRole('button', { name: /清空/ }).click()
      const clearDialog = drawer.page.getByRole('dialog')
      const confirmClear = clearDialog.getByRole('button', { name: /确认清空/ })
      await expect(confirmClear).toBeVisible({ timeout: 10_000 })
      await confirmClear.click()
      await expect(clearDialog).toBeHidden({ timeout: 10_000 })
      const pointer = await drawer.page.evaluate(
        () => (window as unknown as { __cursorProbe: { x: number; y: number } }).__cursorProbe,
      )
      // 确认后一动未动：圆点必须已经落在真实指针处（而不是旧位置）
      await expect
        .poll(
          async () => {
            const box = await cursorDot.boundingBox()
            if (!box) return Number.POSITIVE_INFINITY
            return Math.round(
              Math.hypot(box.x + box.width / 2 - pointer.x, box.y + box.height / 2 - pointer.y),
            )
          },
          { timeout: 5_000 },
        )
        .toBeLessThanOrEqual(2)
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
      // 色块由 ColorSwatchButton 渲染为 role=button 的 label（统一选中环），不再是原生 button
      await drawer.page.locator('[role="button"][aria-label*="#EF4444"]').click()
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
