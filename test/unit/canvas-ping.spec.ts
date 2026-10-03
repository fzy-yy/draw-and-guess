/**
 * 画布轻量微表情（👍 / ❓ / 🔥）广播与滑动窗口限频单测。
 * 验证：
 * 1. 房间规则 allowCanvasReactions === false 时拒绝请求 (FORBIDDEN)；
 * 2. 单人 1.5 秒滑动窗口限频保护 (RATE_LIMITED)；
 * 3. 合法微表情通过轻量广播推送给房间全员，不持久化、不影响笔画历史。
 */
import { describe, expect, it } from 'vitest'
import { EVENTS, SERVER_PUSH_SCHEMAS } from '@draw-guess/shared'
import { createGameHarness, startTwoPlayerGame, testRoomSettings } from './helpers/game-harness.ts'

describe('画布轻量微表情广播 (Ticket 04)', () => {
  it('当房间 allowCanvasReactions === true 时，合法微表情广播给房间所有连接且不追加笔画', () => {
    const harness = createGameHarness()
    const {
      host,
      guest: _guest,
      game,
    } = startTwoPlayerGame(harness, testRoomSettings({ allowCanvasReactions: true }))

    const initialRevision = game.drawingRevision
    const initialStrokesLen = game.strokes.length

    // 由 host 发送点赞表情
    harness.service.sendCanvasPing(host.playerId, 0.45, 0.65, 'thumbs_up')

    // 检查广播并按 push schema 校验
    const pingEvent = harness.ioEvents.find((e) => e.event === EVENTS.gameCanvasPing)
    expect(pingEvent).toBeDefined()
    const parsed = SERVER_PUSH_SCHEMAS[EVENTS.gameCanvasPing].safeParse(pingEvent?.payload)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.data).toEqual({
        x: 0.45,
        y: 0.65,
        type: 'thumbs_up',
        senderNickname: '房主',
      })
    }

    // 验证不落笔画历史，不推进画布修订
    expect(game.strokes.length).toBe(initialStrokesLen)
    expect(game.drawingRevision).toBe(initialRevision)
  })

  it('当房间规则关闭微表情 (allowCanvasReactions === false) 时拒绝处理 (FORBIDDEN)', () => {
    const harness = createGameHarness()
    const { host } = startTwoPlayerGame(harness, testRoomSettings({ allowCanvasReactions: false }))

    expect(() => {
      harness.service.sendCanvasPing(host.playerId, 0.5, 0.5, 'confused')
    }).toThrow()
  })

  it('单人在 1.5 秒内高频连续发送微表情触发限频拒绝 (RATE_LIMITED)', () => {
    const harness = createGameHarness()
    const { guest } = startTwoPlayerGame(harness, testRoomSettings({ allowCanvasReactions: true }))

    // 第一次发送成功
    harness.service.sendCanvasPing(guest.playerId, 0.2, 0.3, 'fire')

    // 立即再次发送，时间戳未前进 1.5s，应被拒绝
    expect(() => {
      harness.service.sendCanvasPing(guest.playerId, 0.2, 0.3, 'fire')
    }).toThrow()

    // 模拟时间前进 1500ms 后重新允许发送
    harness.runtime.advance(1500)
    expect(() => {
      harness.service.sendCanvasPing(guest.playerId, 0.2, 0.3, 'fire')
    }).not.toThrow()
  })
})
