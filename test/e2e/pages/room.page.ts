import { type Page, expect } from '@playwright/test'
import { strings } from '../../../packages/strings/src/index.ts'
import { selectDropdownOption } from './dropdown'

export class RoomPage {
  constructor(readonly page: Page) {}

  /**
   * 房间头模式徽标（S80）：经典 / 接龙都显示，文案由建房时选定的 `gameMode` 决定、
   * 房间内不可修改。传 `strings.ui.room.modeRelay` 或 `strings.ui.room.modeClassic`。
   */
  async expectModeBadge(label: string): Promise<void> {
    await expect(this.page.getByText(label, { exact: true }).first()).toBeVisible({
      timeout: 10_000,
    })
  }

  /**
   * 接龙开局门禁（S47 / S62）：在线可玩人数不足门槛时「开始游戏」置灰并给出含当前人数的原因。
   * 经典房不渲染该原因，故本断言只用于接龙房。
   */
  async expectRelayStartGated(min: number, current: number): Promise<void> {
    await expect(
      this.page.getByText(strings.ui.room.relayGateNeedPlayers(min, current)),
    ).toBeVisible({ timeout: 10_000 })
    await expect(this.page.getByRole('button', { name: /开始游戏/ })).toBeDisabled()
  }

  /** 已凑够人数但尚未全员准备时的置灰原因（接龙与经典共用同一句话）。 */
  async expectWaitingAllReady(): Promise<void> {
    await expect(this.page.getByText(strings.ui.room.waitForGuestsReady)).toBeVisible({
      timeout: 10_000,
    })
    await expect(this.page.getByRole('button', { name: /开始游戏/ })).toBeDisabled()
  }

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
