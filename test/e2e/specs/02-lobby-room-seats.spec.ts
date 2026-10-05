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

  test('房主保存规则后，全员准备状态由服务端统一失效', async ({ browser }) => {
    const host = await createPlayer(browser, '规则房主')
    const guest = await createPlayer(browser, '规则客人')

    try {
      const roomName = `规则失效-${Date.now()}`
      await host.lobby.createRoom({ name: roomName, visibility: 'public' })
      await guest.lobby.joinPublicRoom(roomName)
      await guest.room.toggleReady()
      await expect(host.page.getByRole('button', { name: /开始游戏/ })).toBeEnabled()

      await host.room.updateSecondsRule('选词时间', 20)

      await expect(host.page.getByRole('button', { name: /开始游戏/ })).toBeDisabled()
      await expect(guest.page.getByRole('button', { name: /我准备好了/ })).toBeVisible()
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

  test('词库管理与多词库包视图切换', async ({ browser }) => {
    const host = await createPlayer(browser, '词库房主')

    try {
      const roomName = `词库测试-${Date.now()}`
      await host.lobby.createRoom({ name: roomName, visibility: 'public' })

      // 1. 打开词库弹窗
      await host.page.getByRole('button', { name: /^本局词库/ }).click()
      const dialog = host.page.getByRole('dialog')
      await expect(dialog).toBeVisible({ timeout: 10_000 })

      // 验证默认处于词条管理列表（包含词面列）
      await expect(dialog.getByText('词面')).toBeVisible()

      // 5,000 行虚拟表格：滚到末尾后筛选必须回到顶部；连续两个相同结果数的搜索也必须刷新。
      await expect(dialog.getByText(/全部\s*5000/)).toBeVisible()
      const wordScroller = dialog.locator('table').first().locator('..')
      await wordScroller.evaluate((element) => {
        element.scrollTop = element.scrollHeight
      })
      await expect(dialog.getByText('测试词5000', { exact: true })).toBeVisible()
      const search = dialog.getByRole('textbox', { name: /搜索词条/ })
      await search.fill('测试词4999')
      await expect(dialog.getByText('测试词4999', { exact: true })).toBeVisible()
      await search.fill('测试词5000')
      await expect(dialog.getByText('测试词5000', { exact: true })).toBeVisible()
      await expect
        .poll(() => wordScroller.evaluate((element) => element.scrollTop))
        .toBeLessThan(100)
      await search.clear()

      // 三个工具入口保持统一的圆形图标按钮交互；分类弹层不应再为外层滚动槽预留空白条
      // （筛选字段的语义标签是「合集」，无障碍名为 `按${label}筛选`，见 ADR-0053 的用词收敛）
      const categoryFilter = dialog.getByRole('button', { name: '按合集筛选' })
      await categoryFilter.click()
      const categoryPopover = dialog.getByRole('dialog', { name: '合集' })
      await expect(categoryPopover).toBeVisible()
      await expect(categoryPopover).toHaveCSS('scrollbar-gutter', 'auto')
      await host.page.keyboard.press('Escape')
      await expect(categoryPopover).toBeHidden()
      await expect(categoryFilter).toBeFocused()

      // 2. 点击搜索框旁边的圆形切换按钮，切换至词库包选择视图
      const toggleBtn = dialog.getByRole('button', { name: '切换词库选择' })
      await toggleBtn.click()

      // 3. 验证表格 5 列顺序与字段：词库名称、词数、词库描述、版本号、更新日期
      await expect(dialog.getByText('词库名称')).toBeVisible()
      await expect(dialog.getByText('词数')).toBeVisible()
      await expect(dialog.getByText('词库描述')).toBeVisible()
      await expect(dialog.getByText('版本号')).toBeVisible()
      await expect(dialog.getByText('更新日期')).toBeVisible()

      // 行首单选按钮同时负责选择与当前状态提示：行内不再有额外状态徽标或逐行操作按钮
      await expect(dialog.getByText('draw_guess_words')).toBeVisible()
      const defaultPackageRow = dialog.locator('tr:has-text("draw_guess_words")')
      const defaultPackageRadio = dialog.getByRole('radio', {
        name: '选择词库 draw_guess_words',
      })
      await expect(defaultPackageRadio).toBeChecked()
      await expect(defaultPackageRow.getByRole('radio')).toHaveCount(1)
      await expect(defaultPackageRow.getByRole('button')).toHaveCount(0)

      // 4. 使用第二行单选按钮切换词库，选中状态应成为唯一的当前状态提示
      const testWordsRow = dialog.locator('tr:has-text("test_words")')
      await expect(testWordsRow).toBeVisible()
      const testWordsRadio = testWordsRow.getByRole('radio', { name: '选择词库 test_words' })
      await testWordsRadio.check()
      await expect(testWordsRadio).toBeChecked()
      await expect(defaultPackageRadio).not.toBeChecked()

      // 5. 点击返回词条列表
      await dialog.getByRole('button', { name: '返回词条列表' }).first().click()
      await expect(dialog.getByText('词面')).toBeVisible()

      // 6. 点击确认选择，验证弹窗自动关闭
      await dialog.getByRole('button', { name: /确认选择/ }).click()
      await expect(dialog).toBeHidden({ timeout: 10_000 })

      // 关闭后重开不会接受上一轮 debounce/pending UI 写回。
      await host.page.getByRole('button', { name: /^本局词库/ }).click()
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('textbox', { name: /搜索词条/ })).toHaveValue('')
      await dialog.getByRole('button', { name: /关闭词库/ }).click()
    } finally {
      await host.close()
    }
  })
})
