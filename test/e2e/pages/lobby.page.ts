import { type Page, expect } from '@playwright/test'

export class LobbyPage {
  constructor(readonly page: Page) {}

  async openCreateRoom() {
    await this.page.getByRole('button', { name: /创建公开房间/ }).click()
    await expect(this.page.getByRole('dialog')).toBeVisible()
  }

  async createRoom(options?: { name?: string; visibility?: 'public' | 'private' }) {
    await this.openCreateRoom()
    if (options?.visibility === 'private') {
      await this.page.locator('label:has-text("私密") input[type="radio"]').check()
    }
    if (options?.name) {
      const nameInput = this.page.locator('div[role="dialog"] input[type="text"]').first()
      await nameInput.fill(options.name)
    }
    await this.page.getByRole('button', { name: /创建并进入/ }).click()
    // 等待进入房间页面
    await expect(this.page.locator('text=玩家席位')).toBeVisible({ timeout: 10_000 })
  }

  async openJoinPrivate() {
    await this.page.getByRole('button', { name: /加入私密房间/ }).click()
    await expect(this.page.getByRole('dialog')).toBeVisible()
  }

  async joinPrivateRoom(code: string) {
    await this.openJoinPrivate()
    const input = this.page.locator('div[role="dialog"] input').first()
    await input.fill(code)
    await this.page.getByRole('button', { name: /加入房间/ }).click()
    await expect(this.page.locator('text=玩家席位')).toBeVisible({ timeout: 10_000 })
  }

  async joinPublicRoom(roomName: string) {
    const row = this.page.locator(`article:has-text("${roomName}")`)
    await expect(row).toBeVisible({ timeout: 10_000 })
    // 开局中的房间入口置灰（文案切为「游戏中」）：先断言可点击，避免误点禁用态而非真正加入
    const joinButton = row.getByRole('button', { name: /加入|游戏中/ }).first()
    await expect(joinButton).toBeEnabled()
    await joinButton.click()
    await expect(this.page.locator('text=玩家席位')).toBeVisible({ timeout: 10_000 })
  }

  /** 断言指定房间行的加入入口已禁用，且行内显示「游戏中」（开局后不再接受中途加入）。 */
  async expectRoomJoinDisabled(roomName: string) {
    const row = this.page.locator(`article:has-text("${roomName}")`)
    await expect(row).toBeVisible({ timeout: 10_000 })
    await expect(row.getByRole('button', { name: /加入|游戏中/ }).first()).toBeDisabled()
    await expect(row.getByText('游戏中', { exact: true }).first()).toBeVisible()
  }

  async goToSettings() {
    await this.page.getByRole('button', { name: '设置' }).click()
    await expect(this.page.getByRole('heading', { name: '游戏设置' })).toBeVisible({
      timeout: 10_000,
    })
  }
}
