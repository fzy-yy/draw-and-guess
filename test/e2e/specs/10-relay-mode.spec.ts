import { APP_CONFIG } from '../../../packages/config/src/index.ts'
import { RELAY_MIN_PLAYERS } from '../../../packages/shared/src/protocol/constants.ts'
import { strings } from '../../../packages/strings/src/index.ts'
import { test, expect, createPlayer } from '../fixtures/test-base'

/**
 * 10 - 接龙模式（传话接龙）端到端验收（工单 13 / spec 的 Testing Decisions 第 7 条）。
 *
 * 一条真实用例走完服务端权威的完整生命周期：4 人建房（接龙）→ 四步链（选词 → 画 → 猜 → 画 → 猜）
 * → 复盘逐链轮播 → 逐链投票 → 终局战报。房间、词库与数据库都由 launcher 在系统临时目录隔离创建
 * （见 test/e2e/launcher.mts），本用例绝不触碰真实 game.db 与真实词库。
 *
 * **时长预算**：复盘轮播的每链 14s（3s 重播 + 1s 停顿 + 3s 揭晓 ×2 半场）与投票的 10s 全部由
 * 服务端权威计时、客户端不能缩短（S21 / S43），4 条链合计约 96s；四步动手期因为「全员提交即秒切」
 * （S40）通常只要几秒。用例因此放宽自身超时，并**一律等 UI 状态**（阶段胶囊 / 投票卡可点）
 * 而不是 sleep 固定时长。
 */

/** 接龙开局门槛即本用例的参与人数：4 人 ⇒ 4 条平行链。 */
const PLAYER_COUNT = RELAY_MIN_PLAYERS
/** 链数＝人数（S9）：每人发起一条链，环状顺延让每人参与全部 4 条链。 */
const CHAIN_COUNT = PLAYER_COUNT
/** 每链「复盘 14s + 投票 10s」的服务端权威时长（S21 / S43 / S70）。 */
const PER_CHAIN_MS = 24_000
/** 全员赞同下每名玩家的累计赞同票：参与 4 条链 × 每条 4 票（S24 不做归一化）。 */
const FULL_AGREE_VOTES = CHAIN_COUNT * PLAYER_COUNT
/** 全员赞同下每名玩家的总分：赞同票数 × scorePerAgreeVote（S13）。 */
const FULL_AGREE_SCORE = FULL_AGREE_VOTES * APP_CONFIG.relay.scorePerAgreeVote
/** 画布上的两笔：都落在画布中部，避开顶部/底部的作答浮层与工具条（归一化坐标）。 */
const FIRST_STROKE = [
  { x: 0.25, y: 0.35 },
  { x: 0.5, y: 0.6 },
  { x: 0.75, y: 0.4 },
]
const SECOND_STROKE = [
  { x: 0.3, y: 0.6 },
  { x: 0.5, y: 0.35 },
  { x: 0.7, y: 0.65 },
]

test.describe('10 - 接龙模式全流程', () => {
  test('4 人建房（接龙）→ 四步走完 → 复盘逐链轮播 → 逐链投票 → 终局战报', async ({ browser }) => {
    // 复盘 + 投票由服务端权威计时、不可缩短（约 96s），再加建房、四步动手、页面装配与终局断言
    test.setTimeout(CHAIN_COUNT * PER_CHAIN_MS + 180_000)

    const host = await createPlayer(browser, '接龙1号')
    const guests = [
      await createPlayer(browser, '接龙2号'),
      await createPlayer(browser, '接龙3号'),
      await createPlayer(browser, '接龙4号'),
    ]
    const players = [host, ...guests]

    try {
      const roomName = `接龙全流程-${Date.now()}`

      // ---- 建房与开局门禁（S27 / S28 / S47 / S61 / S62 / S80）----
      await host.lobby.createRoom({ name: roomName, gameMode: 'relay' })
      await host.room.expectModeBadge(strings.ui.room.modeRelay)

      // 在线可玩只有 2 人：开始按钮置灰，并给出「至少 4 名在线玩家」的原因
      await guests[0]!.lobby.joinPublicRoom(roomName)
      await host.room.expectRelayStartGated(PLAYER_COUNT, 2)

      // 凑满 4 人但尚未全员准备：原因换成「等待其他玩家全部准备」
      await guests[1]!.lobby.joinPublicRoom(roomName)
      await guests[2]!.lobby.joinPublicRoom(roomName)
      await host.room.expectWaitingAllReady()

      // 房主由服务端隐式置为已准备（S6），因此只需三位客人准备；全员准备后开始
      for (const guest of guests) await guest.room.toggleReady()
      await host.room.startGame()

      // ---- 步 1 · 选词：全员同时各自从自己的候选里挑一个（S12 / S13）----
      for (const player of players) {
        await expect(
          player.game.topBar.getByText(strings.ui.game.relayPhaseChoose, { exact: true }),
        ).toBeVisible({ timeout: 20_000 })
        await player.game.chooseWord()
      }

      // ---- 步 1 · 作画：各画自己选的题，工具条末尾完成提交（S30）；全员提交即秒切下一棒（S16 / S40）----
      for (const player of players) {
        await expect(
          player.game.topBar.getByText(strings.ui.game.relayPhaseDraw, { exact: true }),
        ).toBeVisible({ timeout: 20_000 })
        await player.game.expectRelayStep(1)
        await player.game.drawStroke(FIRST_STROKE)
        await player.game.relaySubmitDrawing()
      }

      // ---- 步 2 · 猜词：看上一家的画写下答案（S14 / S15）----
      for (const [index, player] of players.entries()) {
        await expect(
          player.game.topBar.getByText(strings.ui.game.relayPhaseGuess, { exact: true }),
        ).toBeVisible({ timeout: 20_000 })
        await player.game.expectRelayStep(2)
        await expect(player.page.getByText(strings.ui.game.relayAnswerHint)).toBeVisible()
        await player.game.relaySubmitGuess(`第2棒答案-${index + 1}`)
      }

      // ---- 步 3 · 再作画：按上家猜出的文本画第二幅，再由工具条提交（S9 / S74）----
      for (const player of players) {
        await expect(
          player.game.topBar.getByText(strings.ui.game.relayPhaseDraw, { exact: true }),
        ).toBeVisible({ timeout: 20_000 })
        await player.game.expectRelayStep(3)
        await player.game.drawStroke(SECOND_STROKE)
        await player.game.relaySubmitDrawing()
      }

      // ---- 步 4 · 再猜词：四步链的最后一棒，交完进入复盘 ----
      for (const [index, player] of players.entries()) {
        await expect(
          player.game.topBar.getByText(strings.ui.game.relayPhaseGuess, { exact: true }),
        ).toBeVisible({ timeout: 20_000 })
        await player.game.expectRelayStep(4)
        await player.game.relaySubmitGuess(`第4棒答案-${index + 1}`)
      }

      // ---- 复盘：按链发起人席位顺序逐条轮播（S11 / S43），每条链展示完后进入该链投票（S21）----
      const voteRow = host.page.getByRole('list', { name: strings.a11y.game.relayVoteRowAria })
      for (let chain = 1; chain <= CHAIN_COUNT; chain += 1) {
        // 轮播切到第 k 条链：顶栏紧跟在最左标签之后出现「第 k / N 条链」（S75）
        for (const player of players) {
          await expect(
            player.game.topBar.getByText(strings.ui.game.relayChainProgress(chain, CHAIN_COUNT), {
              exact: true,
            }),
          ).toBeVisible({ timeout: 40_000 })
        }

        // 该链的 10s 投票窗口一到就全员投赞同：点下即锁定（S13 / S14）
        for (const player of players) await player.game.relayVote('agree')

        // 匿名票行按到达顺序实时插入、不带归属：4 人都投完后行内恰好 4 枚选择标记（S42 / S82）
        await expect(voteRow.getByRole('listitem')).toHaveCount(PLAYER_COUNT, { timeout: 5_000 })
      }

      // ---- 终局战报（S33 / S77）：排名 + 分数 + 接龙口径统计，且不显示荣誉称号 ----
      const statsText = strings.ui.game.relayPlayerStats(CHAIN_COUNT, FULL_AGREE_VOTES)
      const scoreText = strings.ui.common.scoreUnit(FULL_AGREE_SCORE)
      for (const player of players) {
        await expect(player.page.getByText(strings.ui.game.gameResultLabel)).toBeVisible({
          timeout: 20_000,
        })
        await expect(player.page.getByText(strings.ui.game.finalRanking)).toBeVisible()
        // 接龙口径统计只出现在终局榜行内（左侧玩家面板不显示它）：4 名玩家各一行、口径完全一致
        const resultRows = player.page.locator('article', { hasText: statsText })
        await expect(resultRows).toHaveCount(PLAYER_COUNT)
        // 行内分数＝赞同票数 × 分值；全员赞同且人人参与 4 条链，因此四行同分（左侧面板也显示分数，
        // 故断言必须收在终局榜行内，而不是全页计数）
        await expect(resultRows.first().getByText(scoreText)).toHaveCount(1)
        // 接龙不显示荣誉称号：称号徽章的无障碍名一律不出现（S33）
        await expect(player.page.locator('[aria-label*="荣誉称号"]')).toHaveCount(0)
      }
    } finally {
      for (const player of players) await player.close()
    }
  })
})
