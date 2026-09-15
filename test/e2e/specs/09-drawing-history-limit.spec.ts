import { APP_CONFIG } from '../../../packages/config/src/index.ts'
import { serverStrings } from '../../../packages/strings/src/index.ts'
import { test, expect, createPlayer } from '../fixtures/test-base'
import { readLogicalRaster } from '../fixtures/canvas-probe'

/**
 * 09 - 绘图历史上限（容量压力下的跨客户端一致性）
 *
 * 场景：早期画一条封闭边界 → 在边界内填充 → 之后把命令数推到上限并继续尝试提交。
 * 期望：超限提交被**确定性拒绝**（服务端错误码 + 中文提示），权威历史里早期边界与后续填充完好无损，
 * 因此「一直在线者的增量画布」与「晚加入者的全量重放」逻辑栅格指纹必须完全一致。
 *
 * 为什么这条用例很慢：上限是 1500 条命令，而服务端对单玩家的绘图事件限频为 45/秒，
 * 所以只能按约 40 条/秒 推送，全流程固定耗时约 40~60 秒（这是**真实协议约束**，不是可以调小的时间预算）。
 * 数据源：packages/config 的 drawing.maxHistoryCommands、packages/strings 的默认安全文案（勿在用例内硬编码）。
 */
/** 单次点击之间的等待（毫秒）：与 Playwright 点击自身开销合计约 25ms，即约 40 条/秒。 */
const CLICK_INTERVAL_MS = 15
/** 点击上限：上限数 + 余量（限频丢包会多耗几次点击），超时即判定为「未拒绝」。 */
const MAX_CLICKS = APP_CONFIG.drawing.maxHistoryCommands + 80
/** 每隔若干次点击暂停/恢复一次，冻结回合计时，避免慢机器上回合作画时间先耗尽。 */
const PAUSE_EVERY_CLICKS = 500
/** 构造历史用的填充色（与工具栏色板一致）。 */
const FILL_COLOR = '#EF4444'

test.describe('09 - 绘图历史上限', () => {
  test('达到命令上限后拒绝新增，早期封闭边界与后续填充在跨客户端重放中保持一致', async ({
    browser,
  }) => {
    test.setTimeout(300_000)
    const host = await createPlayer(browser, '容量房主')
    const guest = await createPlayer(browser, '容量客人')
    const observer = await createPlayer(browser, '容量观察者')

    try {
      const roomName = `容量测试-${Date.now()}`
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
      const drawerCanvas = drawer.page.locator('canvas.bg-white')
      await drawer.game.chooseWord(0)
      await expect(drawerCanvas).toBeVisible()

      // 1. 早期封闭边界：一个封闭方框（与 06 的几何保持一致，便于复用采样点）。
      await drawer.game.selectTool('pen')
      await drawer.game.drawStroke([
        { x: 0.5, y: 0.05 },
        { x: 0.5, y: 0.95 },
        { x: 0.05, y: 0.95 },
        { x: 0.05, y: 0.05 },
        { x: 0.5, y: 0.05 },
      ])
      await drawer.page.waitForTimeout(700)

      // 2. 后续填充：只填方框内部；边界一旦丢失，同一条填充会吞掉整张画布。
      await drawer.page.locator(`button[aria-label*="${FILL_COLOR}"]`).click()
      await drawer.game.selectTool('fill')
      await drawer.game.clickCanvas({ x: 0.2, y: 0.5 })
      await drawer.page.waitForTimeout(500)
      const filled = await readLogicalRaster(drawerCanvas)
      expect(filled.stableSampleHash).toBe('ef4444ff-1f2937ff-00000000')

      // 3. 用单点笔画把命令数推到上限：每点一次 = 一条命令（1 个点）。
      await drawer.game.selectTool('pen')
      const box = await drawerCanvas.boundingBox()
      if (!box) throw new Error('画布不可见')
      const clickPoint = { x: box.x + box.width * 0.65, y: box.y + box.height * 0.5 }
      const limitMessage = drawer.page.getByText(serverStrings.errors.DRAW_HISTORY_LIMIT_REACHED)
      let limitReached = false
      let clicks = 0
      const startedAt = Date.now()
      while (clicks < MAX_CLICKS && !limitReached) {
        await drawer.page.mouse.click(clickPoint.x, clickPoint.y)
        await drawer.page.waitForTimeout(CLICK_INTERVAL_MS)
        clicks += 1
        if (clicks % PAUSE_EVERY_CLICKS === 0) {
          // 冻结回合计时（暂停期间不接受绘图输入），随后继续推送。
          await host.game.pauseGame()
          await host.game.resumeGame()
        }
        if (clicks % 25 === 0 && (await limitMessage.count()) > 0) limitReached = true
      }
      // 达到上限的当次提交被拒绝：这是「硬上限 + 拒绝新增」唯一的可见信号。
      expect(limitReached, `点击 ${clicks} 次后仍未收到画布命令上限提示`).toBe(true)
      console.log(
        `[绘图容量] ${clicks} 次点击（${((Date.now() - startedAt) / 1000).toFixed(1)}s）后到达 ` +
          `maxHistoryCommands=${APP_CONFIG.drawing.maxHistoryCommands} 并收到拒绝提示`,
      )
      await host.game.pauseGame()

      // 4. 晚加入者拿到权威全量快照：与一直在线者的增量画布必须完全一致。
      await observer.lobby.spectatePublicRoom(roomName)
      const observerCanvas = observer.page.locator('canvas.bg-white')
      await expect(observerCanvas).toBeVisible()
      await observer.page.waitForTimeout(600)
      const incremental = await readLogicalRaster(drawerCanvas)
      const replayed = await readLogicalRaster(observerCanvas)
      expect(replayed).toEqual(incremental)
      expect(incremental.stableSampleHash).toBe('ef4444ff-1f2937ff-00000000')

      // 5. 一直在线者与晚加入者的画布在压力之后都不再变化（没有发生静默丢弃）。
      await drawer.page.waitForTimeout(400)
      expect(await readLogicalRaster(drawerCanvas)).toEqual(incremental)
      expect(await readLogicalRaster(observerCanvas)).toEqual(replayed)
    } finally {
      await host.close()
      await guest.close()
      await observer.close()
    }
  })
})
