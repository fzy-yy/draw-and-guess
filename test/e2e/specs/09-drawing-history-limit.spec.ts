import { APP_CONFIG } from '../../../packages/config/src/index.ts'
import { serverStrings } from '../../../packages/strings/src/index.ts'
import { test, expect, createPlayer, startTwoPlayerGame } from '../fixtures/test-base'
import { readAuthoritativeCommandCount, readLogicalRaster } from '../fixtures/canvas-probe'

/**
 * 09 - 绘图历史上限（容量压力下的画布稳定性）
 *
 * 场景：早期画一条封闭边界 → 在边界内填充 → 之后把命令数推到上限并继续尝试提交。
 * 期望：超限提交被**确定性拒绝**（服务端错误码 + 中文提示），权威历史里早期边界与后续填充完好无损，
 * 且压力之后画布不再发生任何静默变化（逻辑栅格指纹与采样语义保持不变）。
 *
 * 为什么这条用例很慢：上限是 1500 条命令，只能逐次真实点击生成（每次点击 = 一条单点命令）；
 * e2e 词库 fixture 的时限特意放宽到 600s（见 apps/server/src/vocabulary/test-fixture.ts），
 * 以便慢 runner 也能在**同一回合内**推满——用默认 90s 时限会在推满前到期，是 main 间歇失败的主因。
 * 数据源：packages/config 的 drawing.maxHistoryCommands、packages/strings 的默认安全文案（勿在用例内硬编码）。
 */
/** 单次点击之间的等待（毫秒）：与 Playwright 点击自身开销合计约 25ms，即约 40 条/秒。 */
const CLICK_INTERVAL_MS = 15
/** 推送到上限的墙钟上限：需覆盖慢 runner 的真实点击吞吐（e2e 回合窗口为 600s）。 */
const PUSH_DEADLINE_MS = 540_000
/** 到达上限后额外提交的点击次数：用于确认新增被确定性拒绝（权威历史不再增长）。 */
const REJECT_PROBE_CLICKS = 30
/** 构造历史用的填充色（与工具栏色板一致）。 */
const FILL_COLOR = '#EF4444'

test.describe('09 - 绘图历史上限', () => {
  test('达到命令上限后拒绝新增，早期封闭边界与后续填充在压力后保持不变', async ({ browser }) => {
    test.setTimeout(720_000)
    const host = await createPlayer(browser, '容量房主')
    const guest = await createPlayer(browser, '容量客人')

    try {
      const roomName = `容量测试-${Date.now()}`
      const { drawer } = await startTwoPlayerGame(host, guest, roomName)
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
      // 色块由 ColorSwatchButton 渲染为 role=button 的 label（统一选中环），不再是原生 button
      await drawer.page.locator(`[role="button"][aria-label*="${FILL_COLOR}"]`).click()
      await drawer.game.selectTool('fill')
      await drawer.game.clickCanvas({ x: 0.2, y: 0.5 })
      await drawer.page.waitForTimeout(500)
      const filled = await readLogicalRaster(drawerCanvas)
      expect(filled.stableSampleHash).toBe('ef4444ff-1f2937ff-00000000')

      // 3. 用单点笔画把命令数推到上限：每点一次 = 一条命令（1 个点）。
      //    推进依据是「权威命令计数」（客户端镜像的 DrawingCommand 条数），而不是固定点击次数：
      //    CI 上点击可能被丢弃，按次数猜会在到达上限前就耗尽预算（此前的失败根因）。
      await drawer.game.selectTool('pen')
      const box = await drawerCanvas.boundingBox()
      if (!box) throw new Error('画布不可见')
      const clickPoint = { x: box.x + box.width * 0.65, y: box.y + box.height * 0.5 }
      const limitMessage = drawer.page.getByText(serverStrings.errors.DRAW_HISTORY_LIMIT_REACHED)
      const cap = APP_CONFIG.drawing.maxHistoryCommands
      let clicks = 0
      const startedAt = Date.now()
      let commandCount = await readAuthoritativeCommandCount(drawerCanvas)
      while (commandCount < cap && Date.now() - startedAt < PUSH_DEADLINE_MS) {
        await drawer.page.mouse.click(clickPoint.x, clickPoint.y)
        await drawer.page.waitForTimeout(CLICK_INTERVAL_MS)
        clicks += 1
        if (clicks % 25 === 0) commandCount = await readAuthoritativeCommandCount(drawerCanvas)
      }
      // 失败现场：把「点击次数 / 权威命令数 / 上限」写进断言消息，便于直接定位丢包或缺权。
      expect(
        commandCount,
        `点击 ${clicks} 次后权威命令计数 ${commandCount} 仍未达到上限 ${cap}` +
          `（用时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s）`,
      ).toBeGreaterThanOrEqual(cap)
      const countAtCap = commandCount

      // 达到上限后继续提交：必须被确定性拒绝——权威历史不再增长，且出现上限提示。
      for (let extra = 0; extra < REJECT_PROBE_CLICKS; extra += 1) {
        await drawer.page.mouse.click(clickPoint.x, clickPoint.y)
        await drawer.page.waitForTimeout(CLICK_INTERVAL_MS)
      }
      await expect(limitMessage).toBeVisible({ timeout: 15_000 })
      const countAfterReject = await readAuthoritativeCommandCount(drawerCanvas)
      expect(countAfterReject, '达到上限后新增命令必须被拒绝（权威历史不再增长）').toBe(countAtCap)
      console.log(
        `[绘图容量] ${clicks} 次点击（${((Date.now() - startedAt) / 1000).toFixed(1)}s）后权威命令达上限 ` +
          `maxHistoryCommands=${cap}；拒绝后计数保持 ${countAfterReject}`,
      )
      await host.game.pauseGame()

      // 4. 暂停后权威历史冻结：再次读取画布，早期边界与后续填充的指纹必须完好（无静默丢弃）。
      await drawer.page.waitForTimeout(600)
      const stabilised = await readLogicalRaster(drawerCanvas)
      expect(stabilised.stableSampleHash).toBe('ef4444ff-1f2937ff-00000000')

      // 5. 压力之后画布不再变化（没有发生静默丢弃）。
      await drawer.page.waitForTimeout(400)
      expect(await readLogicalRaster(drawerCanvas)).toEqual(stabilised)
    } finally {
      await host.close()
      await guest.close()
    }
  })
})
