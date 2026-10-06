import { test, expect, createPlayer, startTwoPlayerGame } from '../fixtures/test-base'

test.describe('05 - 对局控制与完整生命周期 (Game Lifecycle)', () => {
  test('F08 · 回合结算与结束对局返回房间等待', async ({ browser }) => {
    const host = await createPlayer(browser, '终局房主')
    const guest = await createPlayer(browser, '终局客人')

    try {
      const roomName = `终局测试-${Date.now()}`
      // 动态识别画家并选词
      const { drawer } = await startTwoPlayerGame(host, guest, roomName)
      await drawer.game.chooseWord(0)

      // 房主提前结束本局
      await host.page.getByRole('button', { name: /提前结束/ }).click()
      // 确认弹窗
      const dialog = host.page.getByRole('dialog')
      await expect(dialog).toBeVisible({ timeout: 10_000 })
      await dialog.getByRole('button', { name: /确认结束/ }).click()

      // 双方看到最终结算排行
      await expect(host.page.locator('text=最终排行')).toBeVisible({ timeout: 10_000 })
      await expect(guest.page.locator('text=最终排行')).toBeVisible({ timeout: 10_000 })

      // 双客户端近同时点击：普通玩家只登记个人意愿，房主请求在最短展示期后全局生效。
      await Promise.all([guest.game.requestRematch(), host.game.returnToWaiting()])

      // 验证平稳回到房间等待阶段
      await expect(host.page.locator('text=玩家席位')).toBeVisible({ timeout: 10_000 })
      await expect(guest.page.locator('text=玩家席位')).toBeVisible({ timeout: 10_000 })
    } finally {
      await host.close()
      await guest.close()
    }
  })

  test('开局后大厅加入入口置灰并显示游戏中', async ({ browser }) => {
    const host = await createPlayer(browser, '置灰房主')
    const guest = await createPlayer(browser, '置灰客人')
    const latecomer = await createPlayer(browser, '迟到玩家')

    try {
      const roomName = `置灰入口-${Date.now()}`
      // 房主与客人开局后房间离开 waiting 阶段，进入对局
      const { drawer } = await startTwoPlayerGame(host, guest, roomName)
      await drawer.game.chooseWord(0)

      // 第三名玩家在大厅看到该房间行：加入入口置灰且文案为「游戏中」
      await latecomer.lobby.expectRoomJoinDisabled(roomName)
    } finally {
      await host.close()
      await guest.close()
      await latecomer.close()
    }
  })

  test('最终结算中房主断线后控制权迁移给在线成员，房间回到等待', async ({ browser }) => {
    // 本条要等两个 20 秒窗口（结算自动返回 + 房主迁移宽限），默认 60 秒不够。
    test.setTimeout(120_000)
    const host = await createPlayer(browser, '断线结算房主')
    const guest = await createPlayer(browser, '接任结算房主')

    try {
      const roomName = `结算迁移-${Date.now()}`
      const { drawer } = await startTwoPlayerGame(host, guest, roomName)

      await drawer.game.chooseWord(0)
      await host.page.getByRole('button', { name: /提前结束/ }).click()
      await host.page
        .getByRole('dialog')
        .getByRole('button', { name: /确认结束/ })
        .click()
      await expect(guest.page.getByText('最终排行')).toBeVisible({ timeout: 10_000 })

      await host.close()
      // 最终结算中房主断线：席位保留，控制权要等过「房主宽限」（服务端 hostReconnectGraceMs = 20 秒）
      // 才迁移给在线成员；房间本身也在结算上限后自动收敛回等待。
      // `开始游戏` 只对房主渲染（访客渲染的是「我准备好了」），因此它就是迁移已发生的用户可见证据。
      await expect(guest.page.getByRole('button', { name: /开始游戏/ })).toBeVisible({
        timeout: 45_000,
      })
    } finally {
      await host.close()
      await guest.close()
    }
  })
})
