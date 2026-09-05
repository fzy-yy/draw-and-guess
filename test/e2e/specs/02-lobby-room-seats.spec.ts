import { test, expect, createPlayer } from '../fixtures/test-base'

test.describe('02 - 大厅房间与席位网格 (Lobby, Room & Seats)', () => {
  test('公开房间创建、大厅发现、加入与准备切换', async ({ browser }) => {
    const host = await createPlayer(browser, '房主小强')
    const guest = await createPlayer(browser, '客态小刚')

    try {
      // 1. 房主创建公开房间
      const roomName = `联机测试房-${Date.now()}`
      await host.lobby.createRoom({ name: roomName, visibility: 'public' })

      // 2. 客人从大厅列表发现并加入
      await guest.lobby.joinPublicRoom(roomName)

      // 3. 验证双方都已在房间席位中
      await expect(host.page.locator('article:has-text("客态小刚")')).toBeVisible()
      await expect(guest.page.locator('article:has-text("房主小强")')).toBeVisible()

      // 4. 客人准备，房主看到全员准备就绪（开始按钮可用）
      await guest.room.toggleReady()
      await expect(host.page.getByRole('button', { name: /开始游戏/ })).toBeEnabled()

      // 5. 客人取消准备
      await guest.room.toggleReady()
      await expect(host.page.getByRole('button', { name: /开始游戏/ })).toBeDisabled()
    } finally {
      await host.close()
      await guest.close()
    }
  })

  test('私密房间生成专属短码，外部玩家凭借房间码成功加入', async ({ browser }) => {
    const host = await createPlayer(browser, '私密房主')
    const guest = await createPlayer(browser, '输入码客人')

    try {
      // 1. 创建私密房间
      await host.lobby.createRoom({ name: '私密局', visibility: 'private' })

      // 2. 房主读取生成的 6 位私密房间码
      const code = await host.room.getPrivateCode()
      expect(code).toMatch(/^[A-Z0-9]{6}$/)

      // 3. 客人在大厅输入房间码加入
      await guest.lobby.joinPrivateRoom(code)

      // 4. 双方互相可见
      await expect(host.page.locator('article:has-text("输入码客人")')).toBeVisible()
      await expect(guest.page.locator('article:has-text("私密房主")')).toBeVisible()
    } finally {
      await host.close()
      await guest.close()
    }
  })

  test('F02 & F09 · 房间缩容后剩余席位玩家完整保留，离局不占可用容量', async ({ browser }) => {
    const host = await createPlayer(browser, '容量房主')
    const p2 = await createPlayer(browser, '玩家二号')
    const p3 = await createPlayer(browser, '玩家三号')

    try {
      const roomName = `缩容测试-${Date.now()}`
      // 初始容量 3
      await host.lobby.createRoom({ name: roomName, visibility: 'public', maxPlayers: 3 })
      await p2.lobby.joinPublicRoom(roomName)
      await p3.lobby.joinPublicRoom(roomName)

      // 验证 3 名玩家均入座
      await expect(host.page.locator('article:has-text("玩家二号")')).toBeVisible()
      await expect(host.page.locator('article:has-text("玩家三号")')).toBeVisible()

      // 玩家二号离房
      await p2.room.leaveRoom()
      await expect(host.page.locator('article:has-text("玩家二号")')).toBeHidden()

      // F02 验证：房主修改容量为 2 人（缩容）
      await host.room.updateMaxPlayers(2)

      // 关键断言：房主和玩家三号必须完整呈现，绝不能因为 seatIndex 差异而消失
      await expect(host.page.locator('article:has-text("容量房主")')).toBeVisible()
      await expect(host.page.locator('article:has-text("玩家三号")')).toBeVisible()
      await expect(p3.page.locator('article:has-text("容量房主")')).toBeVisible()
      await expect(p3.page.locator('article:has-text("玩家三号")')).toBeVisible()

      // F09 验证：玩家二号离开后，大厅显示 2/2，此时新玩家无法再加入（已满）
      const p4 = await createPlayer(browser, '候补玩家')
      try {
        const roomRow = p4.page.locator(`article:has-text("${roomName}")`)
        await expect(roomRow.getByRole('button', { name: /加入/ })).toBeDisabled()
      } finally {
        await p4.close()
      }
    } finally {
      await host.close()
      await p2.close()
      await p3.close()
    }
  })
})
