import { test, expect, createPlayer } from '../fixtures/test-base'
import { readLogicalRaster } from '../fixtures/canvas-probe'

test.describe('06 - 跨浏览器、DPR、触屏与后台标签页', () => {
  test('固定逻辑画布在不同 DPR/尺寸下保持填充语义，触屏可落笔，后台恢复后倒计时追平', async ({
    browser,
  }, testInfo) => {
    const host = await createPlayer(browser, `兼容房主-${testInfo.project.name}`)
    const guest = await createPlayer(browser, `兼容客人-${testInfo.project.name}`)
    const observer = await createPlayer(browser, `兼容观察者-${testInfo.project.name}`)
    try {
      const roomName = `兼容-${Date.now()}`
      await host.lobby.createRoom({ name: roomName })
      await host.room.updateJoinPolicy('spectate')
      await guest.lobby.joinPublicRoom(roomName)
      await guest.room.toggleReady()
      await host.room.startGame()
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
      await drawer.page.locator('button[aria-label*="#EF4444"]').click()
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
      expect(logicalRasters[0]?.stableSampleHash).toBe('ef4444ff-1f2937ff-00000000')

      if (testInfo.project.name.includes('touch')) {
        await drawer.game.selectTool('pen')
        const box = await canvas.boundingBox()
        if (!box) throw new Error('画布不可见')
        await drawer.page.touchscreen.tap(box.x + box.width * 0.75, box.y + box.height * 0.25)
        await drawer.page.waitForTimeout(300)
        const alpha = await canvas.evaluate((element) => {
          const context = element.getContext('2d')!
          return context
            .getImageData(element.width * 0.75 - 4, element.height * 0.25 - 4, 8, 8)
            .data.some((value, index) => index % 4 === 3 && value > 0)
        })
        expect(alpha).toBe(true)
      }

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
