import { strings } from '../../../packages/strings/src/index.ts'
import { test, expect, createPlayer, type PlayerClient } from '../fixtures/test-base.ts'

const lobbyTitle = strings.ui.lobby.lobbyTitle

/** 房间名唯一化：对局房是纯内存权威、离开对局只保留成绩卡，固定名字会在重跑/重试之间互相污染。 */
function uniqueRoomName(prefix: string): string {
  return `${prefix}-${Date.now()}`
}

/** 经典房：竞速识别首位画家，并让画家选词进入作画（选词卡会盖住顶栏，必须先走掉）。 */
async function startClassicThreePlayer(players: [PlayerClient, PlayerClient, PlayerClient]) {
  const [host] = players
  // 三人局画家由服务端随机指定，必须**在全部客户端之间**竞速：
  // 只在两名里竞速时，若第三名当选画家就会双双超时（本用例曾因此偶发失败）。
  const drawerIndex = await Promise.any(
    players.map((client, index) =>
      client.page
        .getByText(strings.ui.game.yourTurn)
        .waitFor({ timeout: 30_000 })
        .then(() => index),
    ),
  )
  const drawer = players[drawerIndex]!
  await drawer.game.chooseWord()
  // 选词卡退场即进入作画：此后顶栏的「提前结束」才点得到
  await expect(drawer.page.getByText(strings.ui.game.yourTurn)).toBeHidden({ timeout: 20_000 })
  // 退出者取一名**非画家**的客人：画家仍在场才复现「画家画不了 + 别人发不出消息」
  const quitter = players.find((client) => client !== drawer && client !== host)!
  return { drawer, quitter, remaining: players.filter((client) => client !== quitter) }
}

/**
 * 缺陷回归：对局中有玩家退出后，房主提前结束本局必须**立即**浮出终局战报。
 *
 * 症状（修复前）：房主已结束比赛（服务端 phase=game_result），客户端却永远停在对局页——
 * 画家画不了、其他玩家也发不出消息；没有玩家退出时一切正常。根因是两条快照契约被破坏：
 * ① 经典终局榜多写了协议未声明的 `leftGame` 字段（仅在有人离局时非 undefined），
 *    客户端严格解码整份丢弃（JSON 会把 `undefined` 属性丢掉，这正是「无人退出时看起来正常」的原因）；
 * ② 接龙客户端门禁把「终局视图没有画布」读成「画布修订倒退」而丢弃终局快照。
 * 故这里只看用户可见结果：终局战报出现 + 退出者成绩卡保留。
 */
test.describe('玩家退出后提前结束本局', () => {
  test('经典：客人退出本局后，房主提前结束立即进入终局战报', async ({ browser }) => {
    const host = await createPlayer(browser, '经典房主')
    const guest1 = await createPlayer(browser, '经典客人一')
    const guest2 = await createPlayer(browser, '经典客人二')
    try {
      const roomName = uniqueRoomName('经典提前结束房')
      await host.lobby.createRoom({ name: roomName })
      await guest1.lobby.joinPublicRoom(roomName)
      await guest2.lobby.joinPublicRoom(roomName)
      await guest1.room.toggleReady()
      await guest2.room.toggleReady()
      await host.room.startGame()

      const { drawer, quitter, remaining } = await startClassicThreePlayer([host, guest1, guest2])

      // 画家先落一笔：修复前「画家不能画画」正是从这里开始的（服务端已在 game_result）
      await drawer.game.drawStroke([
        { x: 0.3, y: 0.3 },
        { x: 0.5, y: 0.5 },
      ])

      // 一名客人退出本局（保留成绩卡），随后房主提前结束
      await quitter.game.leaveGame()
      await host.game.endEarly()

      // 在场全员都必须立刻看到终局战报
      for (const client of remaining) await client.game.expectFinalResult()

      // 终局榜保留退出者的成绩卡（本局历史），且退出者已回到大厅
      await expect(host.game.finalResultCard.getByText(quitter.nickname).first()).toBeVisible()
      await expect(quitter.page.getByText(lobbyTitle)).toBeVisible({ timeout: 20_000 })
    } finally {
      await host.close()
      await guest1.close()
      await guest2.close()
    }
  })

  test('接龙：客人退出后房主提前结束立即进入终局战报（作画棒已落笔）', async ({ browser }) => {
    const host = await createPlayer(browser, '接龙房主')
    const guest1 = await createPlayer(browser, '接龙客人一')
    const guest2 = await createPlayer(browser, '接龙客人二')
    const guest3 = await createPlayer(browser, '接龙客人三')
    try {
      const roomName = uniqueRoomName('接龙提前结束房')
      await host.lobby.createRoom({ name: roomName, gameMode: 'relay' })
      await guest1.lobby.joinPublicRoom(roomName)
      await guest2.lobby.joinPublicRoom(roomName)
      await guest3.lobby.joinPublicRoom(roomName)
      await guest1.room.toggleReady()
      await guest2.room.toggleReady()
      await guest3.room.toggleReady()
      await host.room.startGame()

      // 第 1 棒全员选词 → 进入作画
      const all = [host, guest1, guest2, guest3]
      for (const client of all) await client.game.chooseWord()
      await host.game.expectRelayStep(1)
      await expect(
        host.game.topBar.getByText(strings.ui.game.relayPhaseDraw, { exact: true }),
      ).toBeVisible()

      // 房主落一笔：这正是修复前触发「终局快照被当成修订倒退丢弃」的最小条件
      await host.game.drawStroke([
        { x: 0.3, y: 0.3 },
        { x: 0.6, y: 0.6 },
      ])

      // 一名客人退出本局（接龙席位保留为成绩卡），随后房主提前结束
      await guest3.game.leaveGame()
      await host.game.endEarly()

      for (const client of [host, guest1, guest2]) await client.game.expectFinalResult()
      // 退出者的成绩卡仍在终局榜上
      await expect(host.game.finalResultCard.getByText(guest3.nickname).first()).toBeVisible()
    } finally {
      await host.close()
      await guest1.close()
      await guest2.close()
      await guest3.close()
    }
  })
})
