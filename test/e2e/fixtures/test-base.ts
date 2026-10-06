import { test as base, expect, type Browser, type Page } from '@playwright/test'
import { ProfilePage } from '../pages/profile.page'
import { LobbyPage } from '../pages/lobby.page'
import { RoomPage } from '../pages/room.page'
import { GamePage } from '../pages/game.page'

export interface PlayerClient {
  page: Page
  profile: ProfilePage
  lobby: LobbyPage
  room: RoomPage
  game: GamePage
  nickname: string
  close: () => Promise<void>
}

export async function createPlayer(browser: Browser, nickname: string): Promise<PlayerClient> {
  const context = await browser.newContext()
  const page = await context.newPage()
  const profile = new ProfilePage(page)
  const lobby = new LobbyPage(page)
  const room = new RoomPage(page)
  const game = new GamePage(page)

  await profile.goto()
  await profile.setNickname(nickname)
  await profile.enterLobby()

  return {
    page,
    profile,
    lobby,
    room,
    game,
    nickname,
    close: async () => {
      await context.close()
    },
  }
}

export const test = base
export { expect }

/**
 * 建立两人对局并识别首位画家：建房 →（可选房主规则配置）→ 加入 → 准备 → 开局 → 竞速等待「轮到你作画了」。
 * 房间容量固定为协议上限，建房时不再（也不能）调整人数或中途加入策略；开局后房间一律拒绝新成员。
 * `configureHost` 在客人入座前执行：规则变更会取消全员准备，故必须早于客人准备。
 * 返回画家与猜词者客户端，供各 spec 复用同一开局样板。
 * 07 响应式用例使用带 `.catch` 的宽松竞速，语义不同，仍由该用例自定义。
 */
export async function startTwoPlayerGame(
  host: PlayerClient,
  guest: PlayerClient,
  roomName: string,
  configureHost?: (host: PlayerClient) => Promise<void>,
): Promise<{ drawer: PlayerClient; guesser: PlayerClient }> {
  await host.lobby.createRoom({ name: roomName })
  if (configureHost) await configureHost(host)
  await guest.lobby.joinPublicRoom(roomName)
  await guest.room.toggleReady()
  await host.room.startGame()

  const isHostDrawer = await Promise.race([
    host.page
      .locator('text=轮到你作画了')
      .waitFor({ timeout: 15_000 })
      .then(() => true),
    guest.page
      .locator('text=轮到你作画了')
      .waitFor({ timeout: 15_000 })
      .then(() => false),
  ])
  return { drawer: isHostDrawer ? host : guest, guesser: isHostDrawer ? guest : host }
}
