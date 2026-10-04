import { type Page, expect } from '@playwright/test'
import { selectDropdownOption } from './dropdown'

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

  async updateChooseSeconds(seconds: number) {
    await this.openRules()
    const dialog = this.page.getByRole('dialog')
    // 选词时间已合并成单个下拉（默认「不限时」）：选具体秒数即同时开启限时（见 ADR-0045、ADR-0051）
    await selectDropdownOption(dialog, '选词时间', `${seconds} 秒`)
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
