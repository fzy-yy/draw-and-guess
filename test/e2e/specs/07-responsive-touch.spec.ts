import type { Browser } from '@playwright/test'
import { test, expect } from '../fixtures/test-base'
import { ProfilePage } from '../pages/profile.page'
import { LobbyPage } from '../pages/lobby.page'
import { RoomPage } from '../pages/room.page'
import { GamePage } from '../pages/game.page'
import {
  BASELINES,
  assertDenseTarget,
  assertFontAtLeast,
  assertNoOverflow,
  assertNotOccluded,
  assertStageFitsViewport,
  assertWithinStage,
  captureBaseline,
  heightRatioToStage,
  type Baseline,
} from '../pages/responsive.page'
import { responsive } from '../../../packages/config/src/settings.ts'

/**
 * 07 - 响应式缩放与可读验收（桌面网页端）
 *
 * 覆盖 AGENTS.md「响应式与触控验收标准」定义的桌面基准视口（1280×720）下的六类界面：
 * 资料 / 大厅 / 房间 / 游戏工具栏 / 设置 / 弹窗。
 * 本项目主要适配电脑网页端：不再对手机/平板横屏做特殊适配（紧凑布局已删除），
 * 竖屏拦截由 style/other.css 负责、不在本用例验收范围。
 *
 * 现行口径：控件随舞台等比缩放、不设像素下限（44px 触控契约已废除）；
 * 密集控件仅保留 minDenseTargetPx 视觉下限；字号保留可读下限。
 *
 * 基准内是一条串行流程（test.describe.configure({ mode: 'serial' })）：
 * 先在 beforeAll 建好主客两端浏览器上下文，再按界面拆成独立用例，
 * 便于失败定位与 `--grep` 局部重跑；任一用例失败会跳过后续界面（流程有先后依赖）。
 *
 * 断言四件事：
 * 1. 截图留档（随测试报告归档，便于人工复核视觉）；
 * 2. 关键分区不裁切（非滚动容器 scrollHeight ≤ clientHeight）、不遮挡；
 * 3. 密集控件视觉尺寸 ≥ minDenseTargetPx；关键交互（下拉/开关/滑块）功能可用；
 * 4. 正文 / 次级 / 微标签字号不低于可读阈值。
 *
 * 末尾另有一条跨窗口尺寸用例：显式 cqh 定高控件的「高度/舞台高度」比值恒定，
 * 作为「等比缩放」的回归守卫（像素保底会让比值在小窗口下显著偏大）。
 *
 * 阈值全部取自 packages/config/src/settings.ts 的 responsive，禁止在本文件硬编码数值。
 */

/**
 * 按基准视口创建客户端（不自动进入大厅，便于先验收资料页）。
 * reducedMotion: 'reduce' 让 style/animations.css 的过渡/动画瞬时完成，
 * 避免弹窗开合的 160ms 缩放（0.92 → 1）让 boundingBox 落在过渡中间值上，导致尺寸断言抖动。
 */
async function openClient(browser: Browser, baseline: Baseline) {
  const context = await browser.newContext({
    viewport: { width: baseline.width, height: baseline.height },
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  return {
    context,
    page,
    profile: new ProfilePage(page),
    lobby: new LobbyPage(page),
    room: new RoomPage(page),
    game: new GamePage(page),
  }
}

for (const baseline of BASELINES) {
  test.describe(`${baseline.label} ${baseline.width}×${baseline.height}`, () => {
    test.describe.configure({ mode: 'serial' })

    let host: Awaited<ReturnType<typeof openClient>>
    let guest: Awaited<ReturnType<typeof openClient>>
    let roomName = ''

    test.beforeAll(async ({ browser }) => {
      host = await openClient(browser, baseline)
      guest = await openClient(browser, baseline)
      await host.profile.goto()
    })

    test.afterAll(async () => {
      await host?.context.close()
      await guest?.context.close()
    })

    test('资料页与头像弹窗无裁切且控件可见', async ({ browser: _browser }, testInfo) => {
      const page = host.page

      // ---------- 1. 资料页 ----------
      await assertStageFitsViewport(page, baseline)
      const profilePanel = page.locator('main > section').nth(1)
      await assertNoOverflow(profilePanel, '资料页右侧资料区')
      await assertWithinStage(page, profilePanel, '资料页右侧资料区')
      await expect(page.getByRole('button', { name: /重新随机昵称/ })).toBeVisible()
      await expect(page.getByRole('button', { name: /进入在线大厅/ })).toBeVisible()
      await expect(page.getByRole('button', { name: /打开 SVG 头像选择/ })).toBeVisible()
      await assertNotOccluded(page.getByRole('button', { name: /进入在线大厅/ }), '资料页主按钮')
      await assertFontAtLeast(
        page.getByRole('heading', { name: /准备好你的角色/ }),
        '资料页标题',
        responsive.minBodyFontPx,
      )
      await assertFontAtLeast(
        page.locator('input#nickname'),
        '资料页昵称输入框',
        responsive.minBodyFontPx,
      )
      // 辅助说明：紧凑折叠已移除，常驻显示且字号达标
      await assertFontAtLeast(
        page.getByText(/个可见字符/),
        '资料页辅助说明',
        responsive.minSecondaryFontPx,
      )
      await captureBaseline(page, testInfo, baseline, '01-profile')

      // ---------- 2. 头像选择弹窗 ----------
      await host.profile.openAvatarPicker()
      const avatarDialog = page.getByRole('dialog')
      await assertWithinStage(page, avatarDialog, '头像弹窗')
      await assertNoOverflow(avatarDialog, '头像弹窗')
      await expect(avatarDialog.getByRole('button', { name: /关闭头像选择/ })).toBeVisible()
      await expect(avatarDialog.locator('button:has(img)').first()).toBeVisible()
      await captureBaseline(page, testInfo, baseline, '02-avatar-dialog')
      await page.keyboard.press('Escape')
      await expect(avatarDialog).toBeHidden()
    })

    test('大厅与建房弹窗无裁切、下拉框可交互', async ({ browser: _browser }, testInfo) => {
      const page = host.page

      // ---------- 3. 大厅 ----------
      await host.profile.setNickname(`响应式房主-${baseline.key}`)
      await host.profile.enterLobby()
      const lobbyLeft = page.locator('main > section').first()
      const lobbyAside = page.locator('main > aside').first()
      await assertNoOverflow(lobbyLeft, '大厅房间区')
      await assertNoOverflow(lobbyAside, '大厅玩家区')
      await expect(page.getByRole('button', { name: /创建公开房间/ })).toBeVisible()
      await expect(page.getByRole('button', { name: /加入私密房间/ })).toBeVisible()
      await expect(page.getByRole('button', { name: /^设置$/ })).toBeVisible()
      await expect(page.getByRole('button', { name: /延迟/ })).toBeVisible()
      await assertFontAtLeast(page.getByText(/个房间/), '大厅房间数', responsive.minSecondaryFontPx)
      // 局域网提示：常驻显示且字号达标（紧凑折叠已移除）
      await assertFontAtLeast(
        page.getByText(/局域网发现说明/),
        '大厅局域网提示',
        responsive.minSecondaryFontPx,
      )
      await captureBaseline(page, testInfo, baseline, '03-lobby')

      // ---------- 4. 建房弹窗 ----------
      await host.lobby.openCreateRoom()
      const createDialog = page.getByRole('dialog')
      await assertWithinStage(page, createDialog, '建房弹窗')
      await assertNoOverflow(createDialog, '建房弹窗')
      await expect(createDialog.getByRole('button', { name: /关闭创建房间弹窗/ })).toBeVisible()
      await expect(createDialog.getByRole('button', { name: /创建并进入/ })).toBeVisible()
      await expect(createDialog.getByRole('button', { name: /取消/ })).toBeVisible()
      // 功能回归守卫：最大人数手写下拉必须真正可交互（点 combobox 展开 → 点 option 选中）。
      // 旧缺陷：字段行 label 上的覆盖层（.touch-target::after）拦截指针事件，原生 select
      // 收不到点击无法展开；改手写组件后本守卫验证新交互链路——指针被拦截则面板不出现。
      const maxPlayersCombo = createDialog.getByLabel('最大人数')
      await maxPlayersCombo.click()
      await expect(createDialog.getByRole('listbox')).toBeVisible()
      await createDialog.getByRole('option', { name: '3 人', exact: true }).click()
      await expect(maxPlayersCombo).toContainText('3 人')
      await captureBaseline(page, testInfo, baseline, '04-create-dialog')
      await page.keyboard.press('Escape')
      await expect(createDialog).toBeHidden()
    })

    test('设置页开关与滑块功能回归通过', async ({ browser: _browser }, testInfo) => {
      const page = host.page

      // ---------- 5. 设置页 ----------
      await host.lobby.goToSettings()
      await expect(page.getByRole('button', { name: /返回大厅/ })).toBeVisible()
      await expect(page.getByRole('button', { name: /^声音$/ })).toBeVisible()

      // 功能回归守卫：开关行整行是命中区（原生 label 关联），点击仍须正确切换
      const switchRow = page.locator('label:has(input[type="checkbox"])').first()
      const switchInput = switchRow.locator('input[type="checkbox"]')
      const switchBefore = await switchInput.isChecked()
      await switchRow.click()
      await expect(switchInput).toBeChecked({ checked: !switchBefore })
      await switchRow.click()
      await expect(switchInput).toBeChecked({ checked: switchBefore })

      // 功能回归守卫：滑块命中区由自身承担（label 上挂覆盖层会挡住指针事件），点击轨道必须改值
      const volumeSlider = page.locator('input[type="range"]').first()
      const volumeBefore = await volumeSlider.inputValue()
      const sliderBox = await volumeSlider.boundingBox()
      if (!sliderBox) throw new Error('音量滑块不可见')
      // 点击轨道 20% 处（远离当前 0.8 对应的滑块拇指——点在拇指上只会开始拖拽、不会跳值）
      await page.mouse.click(
        sliderBox.x + sliderBox.width * 0.2,
        sliderBox.y + sliderBox.height / 2,
      )
      await expect.poll(() => volumeSlider.inputValue()).not.toBe(volumeBefore)
      await volumeSlider.evaluate((element, value) => {
        const input = element as HTMLInputElement
        input.value = value
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }, volumeBefore)
      await assertNoOverflow(page.locator('main > div').first(), '设置页主体')
      await assertFontAtLeast(
        page.getByText(/所有音量会乘以主音量/),
        '设置页分区说明',
        responsive.minSecondaryFontPx,
      )
      await captureBaseline(page, testInfo, baseline, '05-settings')
      await page.getByRole('button', { name: /返回大厅/ }).click()
    })

    test('房间页与词库/规则弹窗无裁切、密集控件达标', async ({ browser: _browser }, testInfo) => {
      const page = host.page

      // ---------- 6. 房间页 ----------
      // 房间名受配置长度上限约束，用短名保证列表文本可被精确定位
      roomName = `验收${Date.now().toString(36)}`
      await host.lobby.createRoom({ name: roomName })
      await expect(page.getByRole('button', { name: /退出/ })).toBeVisible()
      await expect(page.getByRole('button', { name: /编辑/ })).toBeVisible()
      await expect(page.getByRole('button', { name: /词库/ })).toBeVisible()
      await expect(page.getByRole('button', { name: /邀请/ })).toBeVisible()
      await expect(page.getByRole('button', { name: /开始游戏/ })).toBeVisible()
      await assertNoOverflow(page.locator('main > section').first(), '房间页席位区')
      await captureBaseline(page, testInfo, baseline, '06-room')

      // ---------- 7. 词库弹窗（含虚拟表格与密集控件） ----------
      await page.getByRole('button', { name: /词库/ }).click()
      const vocabDialog = page.getByRole('dialog')
      await expect(vocabDialog).toBeVisible({ timeout: 15_000 })
      await expect(vocabDialog.getByText('词面')).toBeVisible()
      await assertWithinStage(page, vocabDialog, '词库弹窗')
      await assertNoOverflow(vocabDialog, '词库弹窗')
      await expect(vocabDialog.locator('header button')).toBeVisible()
      await expect(vocabDialog.getByRole('button', { name: /切换词库选择/ })).toBeVisible()
      await expect(vocabDialog.getByRole('button', { name: /按分类筛选/ })).toBeVisible()
      await expect(vocabDialog.getByRole('button', { name: /确认选择/ })).toBeVisible()
      await assertDenseTarget(
        vocabDialog.locator('tbody input[type="checkbox"]').first(),
        '词库弹窗行复选框',
      )
      await captureBaseline(page, testInfo, baseline, '07-vocab-dialog')
      await page.keyboard.press('Escape')
      await expect(vocabDialog).toBeHidden()

      // ---------- 8. 规则弹窗 ----------
      await host.room.openRules()
      const rulesDialog = page.getByRole('dialog')
      await assertWithinStage(page, rulesDialog, '规则弹窗')
      await assertNoOverflow(rulesDialog, '规则弹窗')
      await expect(rulesDialog.getByRole('button', { name: /保存规则/ })).toBeVisible()
      // 功能回归守卫：规则弹窗的下拉手写组件同样必须可交互（与建房弹窗同一 SelectDropdown 链路）
      const rulesCombo = rulesDialog.getByLabel('最大玩家数')
      await rulesCombo.click()
      await expect(rulesDialog.getByRole('listbox')).toBeVisible()
      await rulesDialog.getByRole('option', { name: '5 人', exact: true }).click()
      await expect(rulesCombo).toContainText('5 人')
      await captureBaseline(page, testInfo, baseline, '08-rules-dialog')
      await page.keyboard.press('Escape')
      await expect(rulesDialog).toBeHidden()
    })

    test('对局工具栏无裁切、控件可见且密集色板达标', async ({ browser: _browser }, testInfo) => {
      const page = host.page

      // ---------- 9. 对局工具栏（需要第二名玩家开局） ----------
      await guest.profile.goto()
      await guest.profile.setNickname(`响应式客人-${baseline.key}`)
      await guest.profile.enterLobby()
      await guest.lobby.joinPublicRoom(roomName)
      // 功能回归守卫：右键他人席位卡弹出席位操作菜单（角标按钮已移除），
      // 「移除该玩家」仍可经确认弹窗流程打开并取消
      const guestSeat = page
        .locator('article')
        .filter({ hasText: `响应式客人-${baseline.key}` })
        .first()
      await guestSeat.click({ button: 'right' })
      const seatMenu = page.getByRole('menu', { name: /席位操作/ })
      await expect(seatMenu).toBeVisible()
      await expect(seatMenu.getByRole('menuitem', { name: /移交房主/ })).toBeVisible()
      await seatMenu.getByRole('menuitem', { name: /移除该玩家/ }).click()
      const kickConfirm = page.getByRole('dialog')
      await expect(kickConfirm).toBeVisible()
      await assertWithinStage(page, kickConfirm, '踢人确认弹窗')
      await assertNoOverflow(kickConfirm, '踢人确认弹窗')
      await expect(kickConfirm.getByRole('button', { name: /取消/ })).toBeVisible()
      await expect(kickConfirm.getByRole('button', { name: /确认移除/ })).toBeVisible()
      await kickConfirm.getByRole('button', { name: /取消/ }).click()
      await expect(kickConfirm).toBeHidden()
      await guest.room.toggleReady()
      await host.room.startGame()

      const isHostDrawer = await Promise.race([
        page
          .locator('text=轮到你作画了')
          .waitFor({ timeout: 20_000 })
          .then(() => true)
          .catch(() => false),
        guest.page
          .locator('text=轮到你作画了')
          .waitFor({ timeout: 20_000 })
          .then(() => false)
          .catch(() => true),
      ])
      const drawer = isHostDrawer ? host : guest
      // 选词遮罩留档：验收「纯色无修饰、只显示词面」的选词卡形态（难度星已随词库瘦身移除）
      await captureBaseline(drawer.page, testInfo, baseline, '09a-word-cards')
      await drawer.game.chooseWord(0)
      // 进入作画阶段：画家工具按钮恢复可用（此时阶段遮罩已卸载，工具栏不再被遮挡）
      await expect(drawer.page.getByRole('button', { name: /画笔/ })).toBeEnabled({
        timeout: 20_000,
      })

      const gamePage = drawer.page
      await assertStageFitsViewport(gamePage, baseline)
      const hud = gamePage.locator('main > header').first()
      await assertNoOverflow(hud, '对局 HUD')
      // 浮层布局：工具条是 role=toolbar，玩家/聊天面板是各自浮层内的 aside（不再固定在 main 网格列里）
      await assertNoOverflow(gamePage.getByRole('toolbar', { name: '绘图工具栏' }), '对局工具栏')
      await assertNoOverflow(gamePage.getByLabel('玩家', { exact: true }), '对局玩家面板')
      await assertNoOverflow(gamePage.locator('aside:has(form:has(#guess-input))'), '对局聊天面板')
      await assertWithinStage(gamePage, gamePage.locator('form:has(#guess-input)'), '猜词输入区')
      await expect(gamePage.getByRole('button', { name: /画笔/ })).toBeVisible()
      await expect(gamePage.getByRole('button', { name: /橡皮擦/ })).toBeVisible()
      await expect(gamePage.getByRole('button', { name: /填充/ })).toBeVisible()
      await expect(gamePage.getByRole('button', { name: /撤销/ })).toBeVisible()
      await expect(gamePage.getByRole('button', { name: /重做/ })).toBeVisible()
      await expect(gamePage.getByRole('button', { name: /清空/ })).toBeVisible()
      await expect(gamePage.getByRole('button', { name: /暂停/ })).toBeVisible()
      await expect(gamePage.getByRole('button', { name: /设置/ })).toBeVisible()
      await expect(gamePage.getByRole('button', { name: /全屏/ })).toBeVisible()
      await expect(gamePage.locator('form:has(#guess-input) button')).toBeVisible()
      // 画板色板属密集控件：视觉尺寸 ≥ minDenseTargetPx（其余情况随舞台等比缩放）。
      // 色块由 ColorSwatchButton 渲染为 role=button 的 label（统一选中环），不再是原生 button。
      await assertDenseTarget(
        gamePage.locator('[role="button"][aria-label*="#"]').first(),
        '画板色板',
      )
      await assertNotOccluded(gamePage.getByRole('button', { name: /画笔/ }), '工具栏画笔')
      await assertFontAtLeast(
        gamePage.locator('input#guess-input'),
        '猜词输入框',
        responsive.minBodyFontPx,
      )
      await assertFontAtLeast(
        gamePage.getByRole('button', { name: /画笔/ }),
        '工具栏画笔文字',
        responsive.minSecondaryFontPx,
      )
      await captureBaseline(gamePage, testInfo, baseline, '09-game-toolbar')
    })
  })
}

test.describe('控件等比缩放回归守卫', () => {
  /**
   * 两个纯桌面窗口尺寸（基准 1280×720 与缩小的 1024×576）下，
   * 显式以 cqh 定高的控件（大厅网络状态按钮 h-[4.4cqh]）的
   * 「控件高度 / 舞台高度」比值必须恒定：
   * - 等比缩放成立时比值 ≈ 4.4%；
   * - 若像素保底回归，小窗口下比值会显著偏大。
   * 同时断言绝对高度随窗口变小（「界面缩小时组件必须跟着缩小」的直接验收）。
   * 两个尺寸都只是桌面浏览器窗口，不代表任何移动设备基准。
   */
  const SMALL_DESKTOP_WINDOW = { width: 1024, height: 576 }

  test('同一 cqh 定高控件在两个桌面窗口尺寸下与舞台的比值恒定且绝对尺寸变小', async ({
    browser,
  }) => {
    const client = await openClient(browser, BASELINES[0]!)
    try {
      await client.profile.goto()
      await client.profile.setNickname('等比缩放守卫')
      await client.profile.enterLobby()
      const networkButton = client.page.getByRole('button', { name: /延迟/ })
      await expect(networkButton).toBeVisible()

      const ratios: number[] = []
      const heights: number[] = []
      for (const windowSize of [BASELINES[0]!, SMALL_DESKTOP_WINDOW]) {
        await client.page.setViewportSize({ width: windowSize.width, height: windowSize.height })
        await expect(networkButton).toBeVisible()
        ratios.push(await heightRatioToStage(client.page, networkButton))
        const box = await networkButton.boundingBox()
        if (!box) throw new Error('网络状态按钮无 boundingBox')
        heights.push(box.height)
      }

      // 比值恒定（等比缩放）：最大最小比值偏差不超过 10%
      const max = Math.max(...ratios)
      const min = Math.min(...ratios)
      expect(
        (max - min) / min,
        `控件/舞台高度比值应恒定（等比缩放），实际 ${ratios.map((r) => r.toFixed(4)).join(' / ')}`,
      ).toBeLessThan(0.1)
      // 绝对尺寸随窗口变小（像素保底会让两档钉在同一尺寸）
      expect(heights[1]!, '小窗口绝对高度应小于大窗口').toBeLessThan(heights[0]!)
    } finally {
      await client.context.close()
    }
  })
})
