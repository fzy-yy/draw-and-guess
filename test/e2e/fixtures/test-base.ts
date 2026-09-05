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
