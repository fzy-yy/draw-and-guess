import { type Locator, type Page, expect } from '@playwright/test'
import { strings } from '../../../packages/strings/src/index.ts'

export class GamePage {
  constructor(readonly page: Page) {}

  async chooseWord(index = 0): Promise<string> {
    const wordBtns = this.page.locator('.game-stage button.bg-yellow:has(span)')
    await expect(wordBtns.first()).toBeVisible({ timeout: 15_000 })
    const targetBtn = wordBtns.nth(index)
    const text = (await targetBtn.locator('span').first().textContent())?.trim() ?? ''
    await targetBtn.click()
    return text
  }

  /** 底部绘图工具条（浮层布局版）；对画家常驻不可隐藏，无顶栏开关（见 ADR-0054）。 */
  get toolbar() {
    return this.page.getByRole('toolbar', { name: '绘图工具栏' })
  }

  /** 常驻玩家左栏（aria-label 来自玩家面板标题；不参与开关）。 */
  get playersPanel() {
    return this.page.getByLabel('玩家', { exact: true })
  }

  /** 常驻聊天右栏。 */
  get chatPanel() {
    return this.page.locator('aside:has(form:has(#guess-input))')
  }

  async toggleChatPanel() {
    await this.page.getByRole('button', { name: '聊天面板' }).click()
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
    const canvas = this.page.locator('canvas').first()
    await canvas.click({ button: 'right' })
    await this.page.locator(`button:has-text("${phrase}")`).click()
  }

  async returnToWaiting() {
    const returnBtn = this.page.getByRole('button', { name: /返回房间/ })
    await expect(returnBtn).toBeVisible({ timeout: 20_000 })
    await returnBtn.click()
    await expect(this.page.locator('text=玩家席位')).toBeVisible({ timeout: 10_000 })
  }

  /** 房主提前结束本局（顶栏按钮 + 确认弹窗）；结算与入账仍由服务端裁决。 */
  async endEarly() {
    await this.page.getByRole('button', { name: strings.a11y.game.endEarlyAria }).click()
    const dialog = this.page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await dialog.getByRole('button', { name: strings.ui.game.confirmEnd }).click()
  }

  /** 对局内退出本局：设置页右上角「退出游戏」→ 确认弹窗（保留成绩卡并回到大厅）。 */
  async leaveGame() {
    await this.page.getByRole('button', { name: strings.a11y.game.settingsAria }).click()
    await this.page.getByRole('button', { name: strings.ui.game.leaveGame }).click()
    const dialog = this.page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await dialog.getByRole('button', { name: strings.ui.game.confirmLeaveGame }).click()
  }

  /**
   * 终局战报必须真实浮到屏幕上——这是「房主已结束但对局页卡死」缺陷的用户可见判据：
   * 服务端 phase 已进 game_result，客户端若丢弃了该快照就会一直停在对局页（画家画不了、发不出消息）。
   * 断言只用**所有角色共有**的标记：终局榜标题与「退出房间」按钮
   *（「返回房间」类文案只出现在房主且过了最短展示期的那颗按钮上，非房主是「再来一局」，不能当通用判据）。
   */
  async expectFinalResult() {
    await expect(
      this.page.getByRole('heading', { name: strings.ui.game.finalRanking }),
    ).toBeVisible({ timeout: 20_000 })
    await expect(
      this.page.getByRole('button', { name: strings.ui.game.leaveRoom, exact: true }),
    ).toBeVisible({ timeout: 10_000 })
  }

  /**
   * 终局战报卡片（OverlayCard）作用域：昵称在终局页会同时命中顶栏、左侧席位与 Toast，
   * 榜单行断言必须收在本卡片内（取「包含终局榜标题的最内层容器」）。
   */
  get finalResultCard() {
    return this.page
      .locator('div')
      .filter({ has: this.page.getByRole('heading', { name: strings.ui.game.finalRanking }) })
      .last()
  }

  /** 聊天 / 作答共用同一输入框：接龙房走独立聊天频道，经典房走猜词（语义由父组件分流）。 */
  async sendChat(text: string) {
    const input = this.page.locator('input#guess-input')
    await expect(input).toBeEnabled({ timeout: 10_000 })
    await input.fill(text)
    await input.press('Enter')
  }

  async requestRematch() {
    const rematchBtn = this.page.getByRole('button', { name: '再来一局' })
    await expect(rematchBtn).toBeVisible({ timeout: 20_000 })
    await rematchBtn.click()
    await expect(this.page.getByRole('button', { name: '已选择再来一局' })).toBeDisabled()
  }

  // ---------------------------------------------------------------------------
  // 接龙模式（10-relay-mode.spec.ts 的端到端验收；依据工单 13 / spec 的 Testing Decisions）
  // ---------------------------------------------------------------------------

  /** 对局顶栏（`GameHud` 的 header）：接龙的阶段 / 棒次 / 链条进度胶囊都在这里。 */
  get topBar(): Locator {
    return this.page.locator(`header[aria-label="${strings.a11y.game.topBarAria}"]`)
  }

  /**
   * 接龙顶栏的「第 N 棒 / 共 4 棒」胶囊：定位方式是与大号数字同格的 `/ 4 棒` 尾巴，
   * 再读它前一个兄弟 `b` 的棒次数字——同一阶段（作画 / 猜词）会出现两棒，必须靠它区分。
   */
  async expectRelayStep(step: number, total = 4): Promise<void> {
    const pill = this.topBar
      .locator(`div:has(> small:text-is("${strings.ui.game.relayStepTotal(total)}"))`)
      .last()
    await expect(pill.locator('b')).toHaveText(String(step))
  }

  /** 接龙作画棒：工具条末尾的「完成提交」（S30 / Image 1，交的是画布上已有笔画）。 */
  async relaySubmitDrawing(): Promise<void> {
    const submit = this.page.getByRole('button', {
      name: strings.ui.game.relayDrawingSubmit,
      exact: true,
    })
    await expect(submit).toBeEnabled({ timeout: 20_000 })
    await submit.click()
    // 提交后按钮改为等待态；全员提交时则秒切离开作画阶段。
    await expect(submit).toBeHidden({ timeout: 15_000 })
  }

  /** 接龙猜词棒：在作答浮层写答案并提交（空答案前端即禁止提交，S15）。 */
  async relaySubmitGuess(text: string): Promise<void> {
    const input = this.page.getByLabel(strings.a11y.game.answerInputAria)
    await expect(input).toBeEnabled({ timeout: 20_000 })
    await input.fill(text)
    const submit = this.page.getByRole('button', {
      name: strings.ui.game.relayAnswerSubmit,
      exact: true,
    })
    await expect(submit).toBeEnabled()
    await submit.click()
    await expect(submit).toBeHidden({ timeout: 15_000 })
  }

  /**
   * 接龙投票卡（S78）：赞同 / 不赞同，点下即锁定（本地立刻置灰，重复投票服务端也会拒绝）。
   * 等待时必须跨得过该链复盘的轮播窗口才轮到投票，故给足超时；点完再断言已锁定，
   * 逐链循环才能靠「先置灰再等下一次可用」安全推进。
   */
  async relayVote(choice: 'agree' | 'disagree', waitTimeoutMs = 30_000): Promise<void> {
    const label =
      choice === 'agree' ? strings.ui.game.relayVoteAgree : strings.ui.game.relayVoteDisagree
    const button = this.page.getByRole('button', { name: label, exact: true })
    await expect(button).toBeEnabled({ timeout: waitTimeoutMs })
    await button.click()
    await expect(button).toBeDisabled({ timeout: 10_000 })
  }
}
