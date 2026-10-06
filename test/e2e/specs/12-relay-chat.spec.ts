import { strings } from '../../../packages/strings/src/index.ts'
import { test, expect, createPlayer } from '../fixtures/test-base.ts'

/**
 * 缺陷回归：接龙房的聊天必须**在所有阶段都能发、且发出去立刻看得见**。
 *
 * 症状（修复前）：接龙聊天区永远刷不出自己发的消息；更严重的是，聊天写入的消息 id 不符合协议
 * （`Date.now()-base36` 而非 UUID），客户端严格解码整份 roomSnapshot 失败并整包丢弃——
 * 于是「第二棒最后一名玩家提交后卡在猜词阶段、左侧仍显示未提交」也一并发生。
 * 本用例覆盖两件事：
 * ① 作画期聊天可发送并出现在聊天区（`canGuess` 不再错误门禁聊天输入）；
 * ② 聊天之后四步照常推进到复盘（快照没有被聊天消息污染）。
 */
test.describe('接龙独立聊天', () => {
  test('作画期即可聊天并可见，且聊天不影响后续棒次推进', async ({ browser }) => {
    const host = await createPlayer(browser, '聊天房主')
    const guest1 = await createPlayer(browser, '聊天客人一')
    const guest2 = await createPlayer(browser, '聊天客人二')
    const guest3 = await createPlayer(browser, '聊天客人三')
    try {
      const roomName = `接龙聊天房-${Date.now()}`
      await host.lobby.createRoom({ name: roomName, gameMode: 'relay' })
      await guest1.lobby.joinPublicRoom(roomName)
      await guest2.lobby.joinPublicRoom(roomName)
      await guest3.lobby.joinPublicRoom(roomName)
      await guest1.room.toggleReady()
      await guest2.room.toggleReady()
      await guest3.room.toggleReady()
      await host.room.startGame()

      const all = [host, guest1, guest2, guest3]
      for (const client of all) await client.game.chooseWord()
      await host.game.expectRelayStep(1)

      // ① 作画棒（`canGuess` 为假）也必须能聊天，且消息立刻出现在聊天区
      const chatter = guest1
      const message = '作画棒也能聊天'
      await chatter.game.sendChat(message)
      await expect(chatter.page.getByText(message)).toBeVisible({ timeout: 10_000 })
      // 同房其他玩家同样看得见（房间级聊天流）
      await expect(host.page.getByText(message)).toBeVisible({ timeout: 10_000 })

      // ② 聊天之后照常推进：作画 → 猜词 → 作画 → 猜词，最后落到复盘
      for (const client of all) await client.game.relaySubmitDrawing()
      await host.game.expectRelayStep(2)
      for (const client of all) await client.game.relaySubmitGuess('我猜是气球')
      await host.game.expectRelayStep(3)
      for (const client of all) await client.game.relaySubmitDrawing()
      await host.game.expectRelayStep(4)
      for (const client of all) await client.game.relaySubmitGuess('我猜是风筝')

      // 复盘开始：第 1 条链的轮播进度胶囊出现（证明「第二棒提交后卡住」的缺陷已消除）
      await expect(
        host.game.topBar.getByText(strings.ui.game.relayChainProgress(1, 4), { exact: true }),
      ).toBeVisible({ timeout: 40_000 })
    } finally {
      await host.close()
      await guest1.close()
      await guest2.close()
      await guest3.close()
    }
  })
})
