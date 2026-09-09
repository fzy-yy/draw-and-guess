import { type Page, expect } from '@playwright/test'

export class LobbyPage {
  constructor(readonly page: Page) {}

  async openCreateRoom() {
    await this.page.getByRole('button', { name: /创建公开房间/ }).click()
    await expect(this.page.getByRole('dialog')).toBeVisible()
  }

  async createRoom(options?: {
    name?: string
    visibility?: 'public' | 'private'
    maxPlayers?: number
  }) {
    await this.openCreateRoom()
    if (options?.visibility === 'private') {
      await this.page.locator('label:has-text("私密") input[type="radio"]').check()
    }
    if (options?.name) {
      const nameInput = this.page.locator('div[role="dialog"] input[type="text"]').first()
      await nameInput.fill(options.name)
    }
    if (options?.maxPlayers) {
      const select = this.page.locator('div[role="dialog"] select').first()
      if (await select.count()) {
        await select.selectOption(String(options.maxPlayers))
      }
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
    await row.getByRole('button', { name: /加入/ }).click()
    await expect(this.page.locator('text=玩家席位')).toBeVisible({ timeout: 10_000 })
  }

  async joinNextGame(roomName: string) {
    const row = this.page.locator(`article:has-text("${roomName}")`)
    await expect(row).toBeVisible({ timeout: 10_000 })
    await row.getByRole('button', { name: '加入候场' }).click()
    await expect(
      this.page.getByLabel('玩家得分').getByText('等待下一局', { exact: true }),
    ).toBeVisible({ timeout: 10_000 })
  }

  async spectatePublicRoom(roomName: string) {
    const row = this.page.locator(`article:has-text("${roomName}")`)
    await expect(row).toBeVisible({ timeout: 10_000 })
    await row.getByRole('button', { name: '观战' }).click()
    await expect(this.page.locator('canvas[data-canvas-layer="display"]')).toBeVisible({
      timeout: 10_000,
    })
  }

  async goToSettings() {
    await this.page.getByRole('button', { name: '设置' }).click()
    await expect(this.page.getByRole('heading', { name: '游戏设置' })).toBeVisible({
      timeout: 10_000,
    })
  }
}
