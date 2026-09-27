import { type Page, expect } from '@playwright/test'
import { joinPolicyLabels, selectDropdownOption } from './dropdown'

export class RoomPage {
  constructor(readonly page: Page) {}

  async getPrivateCode(): Promise<string> {
    const codeBtn = this.page.locator('button[aria-label*="私密房间码"] b')
    await expect(codeBtn).toBeVisible({ timeout: 10_000 })
    return (await codeBtn.textContent())?.trim() ?? ''
  }

  async toggleReady() {
    const readyBtn = this.page.getByRole('button', { name: /我准备好了|取消准备/ })
    await expect(readyBtn).toBeVisible({ timeout: 10_000 })
    await readyBtn.click()
  }

  async startGame() {
    const startBtn = this.page.getByRole('button', { name: /开始游戏/ })
    await expect(startBtn).toBeEnabled({ timeout: 15_000 })
    await startBtn.click()
  }

  async openRules() {
    await this.page.getByRole('button', { name: '编辑' }).click()
    await expect(this.page.getByRole('dialog')).toBeVisible({ timeout: 10_000 })
  }

  async updateMaxPlayers(maxPlayers: number) {
    await this.openRules()
    const dialog = this.page.getByRole('dialog')
    await selectDropdownOption(dialog, '最大玩家数', `${maxPlayers} 人`)
    await dialog.getByRole('button', { name: /保存规则/ }).click()
    await expect(dialog).toBeHidden({ timeout: 10_000 })
  }

  async updateChooseSeconds(seconds: number) {
    await this.openRules()
    const dialog = this.page.getByRole('dialog')
    await dialog.getByLabel('选词时间').fill(String(seconds))
    await dialog.getByRole('button', { name: /保存规则/ }).click()
    await expect(dialog).toBeHidden({ timeout: 10_000 })
  }

  async updateJoinPolicy(policy: 'forbid' | 'spectate' | 'next_game') {
    await this.openRules()
    const dialog = this.page.getByRole('dialog')
    await selectDropdownOption(dialog, '中途加入', joinPolicyLabels[policy])
    await dialog.getByRole('button', { name: /保存规则/ }).click()
    await expect(dialog).toBeHidden({ timeout: 10_000 })
  }

  async leaveRoom() {
    await this.page.getByRole('button', { name: '退出' }).click()
    const confirmDialog = this.page.getByRole('dialog')
    await expect(confirmDialog).toBeVisible({ timeout: 10_000 })
    await confirmDialog.getByRole('button', { name: /确认退出/ }).click()
    // 返回到大厅
    await expect(this.page.getByRole('heading', { name: /全部公开画室|在线大厅/ })).toBeVisible({
      timeout: 10_000,
    })
  }
}
