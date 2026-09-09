import { type Page, expect } from '@playwright/test'

export class ProfilePage {
  constructor(readonly page: Page) {}

  async goto() {
    await this.page.addInitScript(() => {
      window.sessionStorage.setItem('draw-and-guess-fullscreen-prompt-v1', '1')
    })
    await this.page.goto('/')
    await this.page.waitForLoadState('domcontentloaded')
    await expect(this.page.locator('text=已连接')).toBeVisible({ timeout: 15_000 })
  }

  async setNickname(nickname: string) {
    const input = this.page.locator('input#nickname')
    await input.waitFor({ state: 'visible' })
    await input.fill(nickname)
  }

  async getNickname(): Promise<string> {
    return await this.page.locator('input#nickname').inputValue()
  }

  async clickRandomize() {
    await this.page.getByRole('button', { name: /重新随机|换一组/ }).click()
  }

  async openAvatarPicker() {
    await this.page.getByRole('button', { name: /打开.*头像|更换头像/ }).click()
    await expect(this.page.getByRole('dialog')).toBeVisible()
  }

  async selectAvatar(avatarId: string) {
    await this.openAvatarPicker()
    // 选择指定头像
    const avatarBtn = this.page.locator(`button:has(img[src*="${avatarId}"])`)
    if (await avatarBtn.count()) {
      await avatarBtn.first().click()
    } else {
      // 备用：点击弹窗中的某个头像按钮
      await this.page.locator('div[role="dialog"] button:has(img)').nth(3).click()
    }
  }

  async enterLobby() {
    const submitBtn = this.page.getByRole('button', { name: /^进入.*大厅$/ })
    await expect(submitBtn).toBeEnabled({ timeout: 10_000 })
    await submitBtn.click()
    // 等待大厅标题出现
    await expect(this.page.getByRole('heading', { name: /全部公开画室|在线大厅/ })).toBeVisible({
      timeout: 10_000,
    })
  }
}
