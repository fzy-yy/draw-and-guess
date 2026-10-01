import { test, expect, createPlayer, startTwoPlayerGame } from '../fixtures/test-base'
import { readLogicalRaster } from '../fixtures/canvas-probe'

test.describe('06 - 跨浏览器、DPR 与后台标签页', () => {
  test('固定逻辑画布在不同 DPR/尺寸下保持填充语义，后台恢复后倒计时追平', async ({
    browser,
  }, testInfo) => {
    const host = await createPlayer(browser, `兼容房主-${testInfo.project.name}`)
    const guest = await createPlayer(browser, `兼容客人-${testInfo.project.name}`)
    const observer = await createPlayer(browser, `兼容观察者-${testInfo.project.name}`)
    try {
      const roomName = `兼容-${Date.now()}`
      const { drawer } = await startTwoPlayerGame(host, guest, roomName, { joinPolicy: 'spectate' })
      await drawer.game.chooseWord(0)
      await observer.lobby.spectatePublicRoom(roomName)
      const canvas = drawer.page.locator('canvas.bg-white')
      const guestCanvas = guest.page.locator('canvas.bg-white')
      const observerCanvas = observer.page.locator('canvas.bg-white')
      await expect(canvas).toBeVisible()
      const canvasSize = await canvas.evaluate((element) => ({
        width: element.width,
        height: element.height,
        cssWidth: element.getBoundingClientRect().width,
        cssHeight: element.getBoundingClientRect().height,
        dpr: devicePixelRatio,
        smoothing: element.getContext('2d')?.imageSmoothingEnabled,
        logicalWidth: (element as HTMLCanvasElement & { __logicalCanvas?: HTMLCanvasElement })
          .__logicalCanvas?.width,
        logicalHeight: (element as HTMLCanvasElement & { __logicalCanvas?: HTMLCanvasElement })
          .__logicalCanvas?.height,
      }))
      const logicalScale = 720 / Math.max(1, Math.min(canvasSize.cssWidth, canvasSize.cssHeight))
      const displayScale = Math.min(canvasSize.dpr, 2)
      expect(canvasSize.logicalHeight).toBe(
        Math.max(1, Math.round(canvasSize.cssHeight * logicalScale)),
      )
      expect(
        Math.abs((canvasSize.logicalWidth ?? 0) - canvasSize.cssWidth * logicalScale),
      ).toBeLessThanOrEqual(0.5)
      expect(canvasSize.width).toBe(Math.max(1, Math.round(canvasSize.cssWidth * displayScale)))
      expect(canvasSize.height).toBe(Math.max(1, Math.round(canvasSize.cssHeight * displayScale)))
      expect(canvasSize.smoothing).toBe(false)
      if (canvasSize.dpr > 1) {
        expect(canvasSize.width).toBeGreaterThan(canvasSize.cssWidth)
        expect(canvasSize.height).toBeGreaterThan(canvasSize.cssHeight)
      }

      await drawer.game.drawStroke([
        { x: 0.5, y: 0.05 },
        { x: 0.5, y: 0.95 },
        { x: 0.05, y: 0.95 },
        { x: 0.05, y: 0.05 },
        { x: 0.5, y: 0.05 },
      ])
      await drawer.page.waitForTimeout(700)
      // 色块由 ColorSwatchButton 渲染为 role=button 的 label（统一选中环），不再是原生 button
      await drawer.page.locator('[role="button"][aria-label*="#EF4444"]').click()
      await drawer.game.selectTool('fill')
      await drawer.game.clickCanvas({ x: 0.2, y: 0.5 })
      await drawer.page.waitForTimeout(300)
      const samples = await canvas.evaluate((element) => {
        const context = element.getContext('2d')!
        const pixel = (x: number, y: number) => [
          ...context.getImageData(
            Math.round(element.width * x),
            Math.round(element.height * y),
            1,
            1,
          ).data,
        ]
        const center = context.getImageData(
          Math.round(element.width * 0.5) - 3,
          Math.round(element.height * 0.5) - 3,
          7,
          7,
        )
        let darkPixels = 0
        for (let index = 0; index < center.data.length; index += 4) {
          if (
            center.data[index]! < 80 &&
            center.data[index + 1]! < 80 &&
            center.data[index + 2]! < 90 &&
            center.data[index + 3] === 255
          )
            darkPixels += 1
        }
        return { left: pixel(0.2, 0.5), darkPixels, right: pixel(0.8, 0.5) }
      })
      expect(samples.left).toEqual([239, 68, 68, 255])
      expect(samples.darkPixels).toBeGreaterThan(0)
      expect(samples.right[3]).toBe(0)

      const logicalRasters = await Promise.all([
        readLogicalRaster(canvas),
        readLogicalRaster(guestCanvas),
        readLogicalRaster(observerCanvas),
      ])
      expect(logicalRasters[0]).toEqual(logicalRasters[1])
      expect(logicalRasters[0]).toEqual(logicalRasters[2])
      // 固定采样行（左中 / 中 / 右中）语义：左中是被填充的红色，中点是保住的墨线（深浅随
      // DPR 与画布尺寸略有抗锯齿差异，故只断言「有像素且为深色」，不锁死具体 RGB），
      // 右中在封闭边界之外必须保持透明。画布铺满后逻辑宽度变化，逐像素定值会随 Chromium/Firefox
      // 的抗锯齿实现漂移。
      const parseChannel = (hex: string) => ({
        r: Number.parseInt(hex.slice(0, 2), 16),
        g: Number.parseInt(hex.slice(2, 4), 16),
        b: Number.parseInt(hex.slice(4, 6), 16),
        a: Number.parseInt(hex.slice(6, 8), 16),
      })
      const [fillSample, inkSample, outsideSample] = logicalRasters[0]!.stableSampleHash
        .split('-')
        .map(parseChannel)
      expect(fillSample!.a).toBe(255)
      expect(fillSample!.r).toBeGreaterThan(200)
      expect(fillSample!.g).toBeLessThan(120)
      expect(fillSample!.b).toBeLessThan(120)
      expect(inkSample!.a).toBeGreaterThan(0)
      expect(inkSample!.r).toBeLessThan(90)
      expect(inkSample!.g).toBeLessThan(90)
      expect(inkSample!.b).toBeLessThan(110)
      expect(outsideSample!.a).toBe(0)

      const timer = drawer.page.locator('span:has-text("秒")').first().locator('..').locator('b')
      const before = Number(await timer.textContent())
      const background = await drawer.page.context().newPage()
      await background.goto('about:blank')
      await background.bringToFront()
      await background.waitForTimeout(1_500)
      await drawer.page.bringToFront()
      const after = Number(await timer.textContent())
      expect(after).toBeLessThan(before)
      await background.close()
    } finally {
      await host.close()
      await guest.close()
      await observer.close()
    }
  })
})
