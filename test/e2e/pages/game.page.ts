import { type Page, expect } from '@playwright/test'

export class GamePage {
  constructor(readonly page: Page) {}

  async waitForChoosingWord() {
    await expect(this.page.locator('text=轮到你作画了')).toBeVisible({ timeout: 20_000 })
  }

  async chooseWord(index = 0): Promise<string> {
    const wordBtns = this.page.locator('.game-stage button.bg-yellow:has(span)')
    await expect(wordBtns.first()).toBeVisible({ timeout: 15_000 })
    const targetBtn = wordBtns.nth(index)
    const text = (await targetBtn.locator('span').first().textContent())?.trim() ?? ''
    await targetBtn.click()
    return text
  }

  async selectTool(tool: 'pen' | 'eraser' | 'fill') {
    const toolMap = {
      pen: '画笔',
      eraser: '橡皮擦',
      fill: '填充',
    }
    await this.page.getByRole('button', { name: new RegExp(toolMap[tool]) }).click()
  }

  async drawStroke(points: Array<{ x: number; y: number }>) {
    const canvas = this.page.locator('canvas.bg-white')
    await expect(canvas).toBeVisible()
    const box = await canvas.boundingBox()
    if (!box) throw new Error('Canvas not visible')

    const first = points[0]!
    await this.page.mouse.move(box.x + first.x * box.width, box.y + first.y * box.height)
    await this.page.mouse.down()
    for (let i = 1; i < points.length; i++) {
      const pt = points[i]!
      await this.page.mouse.move(box.x + pt.x * box.width, box.y + pt.y * box.height, { steps: 5 })
    }
    await this.page.mouse.up()
  }

  async clickCanvas(normalizedPoint: { x: number; y: number }) {
    const canvas = this.page.locator('canvas.bg-white')
    await expect(canvas).toBeVisible()
    const box = await canvas.boundingBox()
    if (!box) throw new Error('Canvas not visible')
    await this.page.mouse.click(
      box.x + normalizedPoint.x * box.width,
      box.y + normalizedPoint.y * box.height,
    )
  }

  async undo() {
    await this.page.getByRole('button', { name: /撤销/ }).click()
  }

  async redo() {
    await this.page.getByRole('button', { name: /重做/ }).click()
  }

  async clearCanvas() {
    await this.page.getByRole('button', { name: /清空/ }).click()
    const confirmDialog = this.page.getByRole('dialog')
    await expect(confirmDialog).toBeVisible({ timeout: 10_000 })
    await confirmDialog.getByRole('button', { name: /确认清空/ }).click()
  }

  async sendGuess(text: string) {
    const input = this.page.locator('input#guess-input')
    await expect(input).toBeEnabled({ timeout: 10_000 })
    await input.fill(text)
    await input.press('Enter')
  }

  async sendPreset(phrase: string) {
    await this.page.locator('button[aria-label="选择快捷短语"]').click()
    await this.page.locator(`button[title="${phrase}"]`).click()
  }

  async pauseGame() {
    await this.page.getByRole('button', { name: /暂停游戏/ }).click()
    await expect(this.page.locator('text=游戏已安全暂停')).toBeVisible({ timeout: 10_000 })
  }

  async resumeGame() {
    await this.page
      .getByRole('button', { name: /继续游戏/ })
      .last()
      .click()
    await expect(this.page.locator('text=游戏已安全暂停')).toBeHidden({ timeout: 10_000 })
  }

  async returnToWaiting() {
    const returnBtn = this.page.getByRole('button', { name: /返回房间/ })
    await expect(returnBtn).toBeVisible({ timeout: 20_000 })
    await returnBtn.click()
    await expect(this.page.locator('text=玩家席位')).toBeVisible({ timeout: 10_000 })
  }
}
