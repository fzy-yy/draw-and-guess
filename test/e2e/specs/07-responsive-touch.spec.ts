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
  assertTouchTarget,
  assertVisualSize,
  assertWithinStage,
  captureBaseline,
  isCompact,
  type Baseline,
} from '../pages/responsive.page'
import { responsive } from '../../../packages/config/src/settings.ts'

/**
 * 07 - 响应式与触控验收
 *
 * 覆盖 AGENTS.md「响应式与触控验收标准」定义的三个基准视口（桌面 1280×720、
 * 平板横屏 1024×768、手机横屏 844×390）下的六类界面：
 * 资料 / 大厅 / 房间 / 游戏工具栏 / 设置 / 弹窗。
 *
 * 每个基准断言四件事：
 * 1. 截图留档（随测试报告归档，便于人工复核视觉）；
 * 2. 关键分区不裁切（非滚动容器 scrollHeight ≤ clientHeight）；
 * 3. 关键控件不被遮挡且命中区 ≥ 44×44 CSS px（密集控件走 ≥20px 降级标准）；
 * 4. 正文 / 次级 / 微标签字号不低于可读阈值。
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
  test(`${baseline.label} ${baseline.width}×${baseline.height}：六类界面无裁切无遮挡且触控达标`, async ({
    browser,
  }, testInfo) => {
    const host = await openClient(browser, baseline)
    const guest = await openClient(browser, baseline)
    const page = host.page
    const compact = await (async () => {
      await host.profile.goto()
      return isCompact(page)
    })()

    try {
      // ---------- 1. 资料页 ----------
      await assertStageFitsViewport(page, baseline)
      const profilePanel = page.locator('main > section').nth(1)
      await assertNoOverflow(profilePanel, '资料页右侧资料区')
      await assertWithinStage(page, profilePanel, '资料页右侧资料区')
      await assertTouchTarget(
        page.getByRole('button', { name: /重新随机昵称/ }),
        '资料页「换一组」',
      )
      await assertTouchTarget(
        page.getByRole('button', { name: /进入在线大厅/ }),
        '资料页「进入在线大厅」',
      )
      await assertTouchTarget(
        page.getByRole('button', { name: /打开 SVG 头像选择/ }),
        '资料页头像按钮',
      )
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
      // 辅助说明：紧凑布局下折叠，非紧凑布局下字号达标
      // （先断言存在再断言隐藏：否则文案被改名/删除时 toBeHidden 会「假绿」）
      const nicknameHelp = page.getByText(/个可见字符/)
      if (compact) {
        await expect(nicknameHelp, '资料页辅助说明应存在').toHaveCount(1)
        await expect(nicknameHelp, '资料页辅助说明应在紧凑布局下折叠').toBeHidden()
      } else await assertFontAtLeast(nicknameHelp, '资料页辅助说明', responsive.minSecondaryFontPx)
      await captureBaseline(page, testInfo, baseline, '01-profile')

      // ---------- 2. 头像选择弹窗 ----------
      await host.profile.openAvatarPicker()
      const avatarDialog = page.getByRole('dialog')
      await assertWithinStage(page, avatarDialog, '头像弹窗')
      await assertNoOverflow(avatarDialog, '头像弹窗')
      await assertTouchTarget(
        avatarDialog.getByRole('button', { name: /关闭头像选择/ }),
        '头像弹窗关闭按钮',
      )
      await assertTouchTarget(avatarDialog.locator('button:has(img)').first(), '头像弹窗头像按钮')
      await captureBaseline(page, testInfo, baseline, '02-avatar-dialog')
      await page.keyboard.press('Escape')
      await expect(avatarDialog).toBeHidden()

      // ---------- 3. 大厅 ----------
      await host.profile.setNickname(`响应式房主-${baseline.key}`)
      await host.profile.enterLobby()
      const lobbyLeft = page.locator('main > section').first()
      const lobbyAside = page.locator('main > aside').first()
      await assertNoOverflow(lobbyLeft, '大厅房间区')
      await assertNoOverflow(lobbyAside, '大厅玩家区')
      await assertTouchTarget(
        page.getByRole('button', { name: /创建公开房间/ }),
        '大厅「创建公开房间」',
      )
      await assertTouchTarget(
        page.getByRole('button', { name: /加入私密房间/ }),
        '大厅「加入私密房间」',
      )
      await assertTouchTarget(page.getByRole('button', { name: /^设置$/ }), '大厅「设置」')
      await assertTouchTarget(page.getByRole('button', { name: /延迟/ }), '大厅网络状态按钮')
      await assertFontAtLeast(page.getByText(/个房间/), '大厅房间数', responsive.minSecondaryFontPx)
      const lanTip = page.getByText(/局域网发现说明/)
      if (compact) {
        await expect(lanTip, '大厅局域网提示应存在').toHaveCount(1)
        await expect(lanTip, '大厅局域网提示应在紧凑布局下折叠').toBeHidden()
      } else await assertFontAtLeast(lanTip, '大厅局域网提示', responsive.minSecondaryFontPx)
      await captureBaseline(page, testInfo, baseline, '03-lobby')

      // ---------- 4. 建房弹窗 ----------
      await host.lobby.openCreateRoom()
      const createDialog = page.getByRole('dialog')
      await assertWithinStage(page, createDialog, '建房弹窗')
      await assertNoOverflow(createDialog, '建房弹窗')
      await assertTouchTarget(
        createDialog.getByRole('button', { name: /关闭创建房间弹窗/ }),
        '建房弹窗关闭按钮',
      )
      await assertTouchTarget(
        createDialog.getByRole('button', { name: /创建并进入/ }),
        '建房弹窗主按钮',
      )
      await assertTouchTarget(
        createDialog.getByRole('button', { name: /取消/ }),
        '建房弹窗取消按钮',
      )
      await assertTouchTarget(
        createDialog.locator('label:has(input[type="radio"])').first(),
        '建房弹窗房间类型选项',
      )
      await captureBaseline(page, testInfo, baseline, '04-create-dialog')
      await page.keyboard.press('Escape')
      await expect(createDialog).toBeHidden()

      // ---------- 5. 设置页 ----------
      await host.lobby.goToSettings()
      await assertTouchTarget(page.getByRole('button', { name: /返回大厅/ }), '设置页返回按钮')
      await assertTouchTarget(page.getByRole('button', { name: /^声音$/ }), '设置页侧边导航项')
      await assertTouchTarget(
        page.locator('label:has(input[type="checkbox"])').first(),
        '设置页开关行',
      )
      await assertTouchTarget(
        page.getByRole('button', { name: /试听音效/ }).first(),
        '设置页音效试听按钮',
      )
      // 功能回归守卫：开关行整行是命中区（label + .touch-target），点击仍须正确切换
      const switchRow = page.locator('label:has(input[type="checkbox"])').first()
      const switchInput = switchRow.locator('input[type="checkbox"]')
      const switchBefore = await switchInput.isChecked()
      await switchRow.click()
      await expect(switchInput).toBeChecked({ checked: !switchBefore })
      await switchRow.click()
      await expect(switchInput).toBeChecked({ checked: switchBefore })

      // 功能回归守卫：滑块命中区由自身承担（label 上挂 .touch-target 会挡住指针事件），点击轨道必须改值
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
      // 紧凑布局下关键控件必须自身达到 44px（而非仅靠命中区外扩）
      if (compact) {
        await assertVisualSize(page.getByRole('button', { name: /返回大厅/ }), '紧凑模式返回按钮')
        await assertVisualSize(switchRow, '紧凑模式开关行')
      }
      await assertFontAtLeast(
        page.getByText(/所有音量会乘以主音量/),
        '设置页分区说明',
        responsive.minSecondaryFontPx,
      )
      await captureBaseline(page, testInfo, baseline, '05-settings')
      await page.getByRole('button', { name: /返回大厅/ }).click()

      // ---------- 6. 房间页 ----------
      // 房间名受配置长度上限约束，用短名保证列表文本可被精确定位
      const roomName = `验收${Date.now().toString(36)}`
      await host.lobby.createRoom({ name: roomName })
      await assertTouchTarget(page.getByRole('button', { name: /退出/ }), '房间页退出按钮')
      await assertTouchTarget(page.getByRole('button', { name: /编辑/ }), '房间页「编辑」规则')
      await assertTouchTarget(page.getByRole('button', { name: /词库/ }), '房间页词库入口')
      await assertTouchTarget(page.getByRole('button', { name: /邀请/ }), '房间页邀请按钮')
      await assertTouchTarget(page.getByRole('button', { name: /开始游戏/ }), '房间页开始游戏')
      await assertNoOverflow(page.locator('main > section').first(), '房间页席位区')
      await captureBaseline(page, testInfo, baseline, '06-room')

      // ---------- 7. 词库弹窗（含虚拟表格与密集控件） ----------
      await page.getByRole('button', { name: /词库/ }).click()
      const vocabDialog = page.getByRole('dialog')
      await expect(vocabDialog).toBeVisible({ timeout: 15_000 })
      await expect(vocabDialog.getByText('词面')).toBeVisible()
      await assertWithinStage(page, vocabDialog, '词库弹窗')
      await assertNoOverflow(vocabDialog, '词库弹窗')
      await assertTouchTarget(vocabDialog.locator('header button'), '词库弹窗关闭按钮')
      await assertTouchTarget(
        vocabDialog.getByRole('button', { name: /切换词库选择/ }),
        '词库弹窗视图切换按钮',
      )
      await assertTouchTarget(
        vocabDialog.getByRole('button', { name: /按分类筛选/ }),
        '词库弹窗筛选按钮',
      )
      await assertTouchTarget(
        vocabDialog.getByRole('button', { name: /确认选择/ }),
        '词库弹窗确认按钮',
      )
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
      await assertTouchTarget(
        rulesDialog.getByRole('button', { name: /保存规则/ }),
        '规则弹窗保存按钮',
      )
      await assertTouchTarget(
        rulesDialog.locator('label:has(input[type="checkbox"])').first(),
        '规则弹窗开关',
      )
      // select 是替换元素，不支持 ::after 外扩，命中区由其字段行（label）承担
      await assertTouchTarget(rulesDialog.locator('label:has(select)').first(), '规则弹窗下拉字段')
      // 滑块则必须自身 ≥44px：命中区不能挂在 label 上——伪元素会挡住 range 的指针事件（滑块将无法拖动）
      await assertVisualSize(rulesDialog.locator('input[type="range"]').first(), '规则弹窗滑块')
      await captureBaseline(page, testInfo, baseline, '08-rules-dialog')
      await page.keyboard.press('Escape')
      await expect(rulesDialog).toBeHidden()

      // ---------- 9. 对局工具栏（需要第二名玩家开局） ----------
      await guest.profile.goto()
      await guest.profile.setNickname(`响应式客人-${baseline.key}`)
      await guest.profile.enterLobby()
      await guest.lobby.joinPublicRoom(roomName)
      // 功能回归守卫：席位角上的踢人按钮（.touch-target 命中区）仍可点击并弹出确认框
      const kickButton = page.getByRole('button', { name: /移除该玩家/ })
      if (await kickButton.count()) {
        await kickButton.first().click()
        const kickConfirm = page.getByRole('dialog')
        await expect(kickConfirm).toBeVisible()
        await assertWithinStage(page, kickConfirm, '踢人确认弹窗')
        await assertNoOverflow(kickConfirm, '踢人确认弹窗')
        await assertTouchTarget(
          kickConfirm.getByRole('button', { name: /取消/ }),
          '踢人确认弹窗取消按钮',
        )
        await assertTouchTarget(
          kickConfirm.getByRole('button', { name: /确认移除/ }),
          '踢人确认弹窗确认按钮',
        )
        await kickConfirm.getByRole('button', { name: /取消/ }).click()
        await expect(kickConfirm).toBeHidden()
      }
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
      await drawer.game.chooseWord(0)
      // 进入作画阶段：画家工具按钮恢复可用（此时阶段遮罩已卸载，工具栏不再被遮挡）
      await expect(drawer.page.getByRole('button', { name: /画笔/ })).toBeEnabled({
        timeout: 20_000,
      })

      const gamePage = drawer.page
      await assertStageFitsViewport(gamePage, baseline)
      const hud = gamePage.locator('main > header').first()
      await assertNoOverflow(hud, '对局 HUD')
      await assertNoOverflow(gamePage.locator('main > footer').first(), '对局工具栏')
      await assertNoOverflow(gamePage.locator('main > aside').first(), '对局得分条')
      await assertNoOverflow(gamePage.locator('main > aside').last(), '对局聊天区')
      await assertWithinStage(gamePage, gamePage.locator('form:has(#guess-input)'), '猜词输入区')
      await assertTouchTarget(gamePage.getByRole('button', { name: /画笔/ }), '工具栏画笔')
      await assertTouchTarget(gamePage.getByRole('button', { name: /橡皮擦/ }), '工具栏橡皮擦')
      await assertTouchTarget(gamePage.getByRole('button', { name: /填充/ }), '工具栏填充')
      await assertTouchTarget(gamePage.getByRole('button', { name: /撤销/ }), '工具栏撤销')
      await assertTouchTarget(gamePage.getByRole('button', { name: /重做/ }), '工具栏重做')
      await assertTouchTarget(gamePage.getByRole('button', { name: /清空/ }), '工具栏清空')
      await assertTouchTarget(gamePage.getByRole('button', { name: /暂停/ }), 'HUD 暂停按钮')
      await assertTouchTarget(gamePage.getByRole('button', { name: /设置/ }), 'HUD 设置按钮')
      await assertTouchTarget(gamePage.getByRole('button', { name: /全屏/ }), 'HUD 全屏按钮')
      await assertTouchTarget(gamePage.locator('form:has(#guess-input) button'), '猜词发送按钮')
      // 画板色板属密集控件：视觉尺寸 ≥ 20px（命中区不重叠优先于 44px）
      await assertDenseTarget(gamePage.locator('button[aria-label*="#"]').first(), '画板色板')
      await assertNotOccluded(gamePage.getByRole('button', { name: /画笔/ }), '工具栏画笔')
      if (compact) {
        await assertVisualSize(gamePage.getByRole('button', { name: /画笔/ }), '紧凑模式工具栏画笔')
        await assertVisualSize(
          gamePage.getByRole('button', { name: /暂停/ }),
          '紧凑模式 HUD 暂停按钮',
        )
        await assertVisualSize(
          gamePage.locator('form:has(#guess-input) button'),
          '紧凑模式猜词发送按钮',
        )
      }
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
    } finally {
      await host.context.close()
      await guest.context.close()
    }
  })
}
