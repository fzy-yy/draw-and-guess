import { test, expect } from '../fixtures/test-base'
import { ProfilePage } from '../pages/profile.page'
import { LobbyPage } from '../pages/lobby.page'

test.describe('01 - 资料设定与会话管理 (Profile & Session)', () => {
  test('玩家可以设置昵称、随机更换、挑选内置头像并进入大厅', async ({ page }) => {
    const profile = new ProfilePage(page)
    await profile.goto()

    // 1. 验证默认有昵称或可以随机更换
    const initialName = await profile.getNickname()
    expect(initialName.length).toBeGreaterThanOrEqual(1)
    await profile.clickRandomize()
    const randomizedName = await profile.getNickname()
    expect(randomizedName.length).toBeGreaterThanOrEqual(1)

    // 2. 自定义输入合法昵称
    await profile.setNickname('测试画家小王')
    expect(await profile.getNickname()).toBe('测试画家小王')

    // 3. 打开头像弹窗并选择头像
    await profile.openAvatarPicker()
    await page.locator('div[role="dialog"] button:has(img)').first().click()
    await expect(page.getByRole('dialog')).toBeHidden()

    // 4. 成功进入大厅
    await profile.enterLobby()
    await expect(page.locator('strong:has-text("测试画家小王")')).toBeVisible()
  })

  test('F10 · 清除本地资料后无需刷新页面，同一连接立即以全新身份注册进入', async ({ page }) => {
    const profile = new ProfilePage(page)
    const lobby = new LobbyPage(page)
    await profile.goto()

    // 首次注册身份 A
    await profile.setNickname('玩家甲')
    await profile.enterLobby()
    await expect(page.locator('strong:has-text("玩家甲")')).toBeVisible()

    // 前往设置 -> 资料与诊断
    await lobby.goToSettings()
    await page.getByRole('button', { name: /资料与诊断/ }).click()

    // 点击清除资料并确认
    await page.getByRole('button', { name: /清除.*资料/ }).click()
    const confirmDialog = page.getByRole('dialog')
    await expect(confirmDialog).toBeVisible()
    await confirmDialog.getByRole('button', { name: /确认清除/ }).click()

    // 验证立即回到 ProfileView，不需要手动刷新页面
    await expect(page.getByRole('heading', { name: /准备好你的角色/ })).toBeVisible()

    // 在同一页面连接上输入全新的昵称
    await profile.setNickname('全新的玩家乙')
    await profile.enterLobby()

    // 验证成功以新身份进入大厅，不再被识别为旧玩家甲
    await expect(page.locator('strong:has-text("全新的玩家乙")')).toBeVisible()
    await expect(page.locator('strong:has-text("玩家甲")')).toBeHidden()
  })
})
