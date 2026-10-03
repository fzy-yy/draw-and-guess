/**
 * 单元测试：差一字私密提示与全员猜中提前结算。
 * 覆盖：
 * 1. Levenshtein 编辑距离与 isNearMissAnswer 纯函数边界判定（单字词恒为 false，>=2 字词距离为 1 触发，不限次数）；
 * 2. 差一字私密提示仅向猜词者独占视口下发，其他玩家与公屏绝对不泄漏答案线索；
 * 3. allowNearMissHint 开关关闭时，不产生差一字提示；
 * 4. 全部在线猜词者猜中时，立即取消倒计时定时器，切入 round_result 阶段（零等待提前结算）。
 */
import { describe, expect, it } from 'vitest'
import { APP_CONFIG } from '@draw-guess/config'
import { isNearMissAnswer, levenshteinDistance } from '@draw-guess/shared'
import { createGameHarness, testRoomSettings, type GameHarness } from './helpers/game-harness.ts'

describe('编辑距离与差一字判定纯函数', () => {
  it('levenshteinDistance 正确计算增、删、改距离', () => {
    expect(levenshteinDistance('', '')).toBe(0)
    expect(levenshteinDistance('a', '')).toBe(1)
    expect(levenshteinDistance('', 'abc')).toBe(3)
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3)
    expect(levenshteinDistance('苹果', '平果')).toBe(1)
    expect(levenshteinDistance('香蕉', '香蕉')).toBe(0)
    expect(levenshteinDistance('西瓜皮', '西瓜')).toBe(1)
    expect(levenshteinDistance('哈密瓜', '甜瓜')).toBe(2)
  })

  it('isNearMissAnswer 严格遵循单字不提醒与距离严格等于 1 规则', () => {
    // 单字词恒返回 false（防止盲猜无成本套线索）
    expect(isNearMissAnswer('猫', '狗')).toBe(false)
    expect(isNearMissAnswer('', '猫')).toBe(false)
    expect(isNearMissAnswer('大猫', '猫')).toBe(false)

    // 两字及以上词，距离为 1 时返回 true
    expect(isNearMissAnswer('平果', '苹果')).toBe(true)
    expect(isNearMissAnswer('红苹果', '苹果')).toBe(true)
    expect(isNearMissAnswer('西瓜皮', '西瓜')).toBe(true)

    // 完全相同距离为 0，返回 false（该情况属于完全猜中，不属于差一字）
    expect(isNearMissAnswer('苹果', '苹果')).toBe(false)

    // 距离 >= 2 返回 false
    expect(isNearMissAnswer('香蕉', '苹果')).toBe(false)
    expect(isNearMissAnswer('西红柿炒鸡蛋', '苹果')).toBe(false)

    // 大小写和全角规范化
    expect(isNearMissAnswer('apple', 'apples')).toBe(true)
    expect(isNearMissAnswer('  平果  ', '苹果')).toBe(true)
  })
})

describe('差一字私密通知与全员猜中提前结算端到端行为', () => {
  function startTestGame(harness: GameHarness, allowNearMissHint: boolean = true) {
    const host = harness.register('房主')
    const guest1 = harness.register('猜词者1')
    const guest2 = harness.register('猜词者2')

    const room = harness.service.createRoom(host.playerId, {
      name: '测试房间',
      visibility: 'public',
      settings: testRoomSettings({
        maxPlayers: 3,
        drawSeconds: 60,
        allowNearMissHint,
      }),
    })

    harness.service.joinRoom(guest1.playerId, room.id)
    harness.service.joinRoom(guest2.playerId, room.id)

    harness.service.setReady(guest1.playerId, true)
    const ready2 = harness.service.setReady(guest2.playerId, true)

    harness.service.startGame(host.playerId, ready2.stateVersion)
    harness.runtime.advance(APP_CONFIG.game.startingCountdownSeconds * 1_000)

    const secret = harness.service.rooms.get(room.id)
    if (!secret?.game) throw new Error('对局未启动')

    const candidate = secret.game.candidates[0]
    if (!candidate) throw new Error('未生成候选词')
    harness.service.chooseWord(secret.game.drawerId, secret.game.roundId, candidate.id)

    return { host, guest1, guest2, room: secret, game: secret.game }
  }
  it('差一字提示仅向当前猜词者下发，公屏与其他玩家绝不泄漏', () => {
    const harness = createGameHarness()
    const { host, guest1, guest2, room, game } = startTestGame(harness, true)

    // 确定画家与猜词者身份
    const drawerId = game.drawerId
    const guessers = [host, guest1, guest2].filter((p) => p.playerId !== drawerId)
    const guesserA = guessers[0]!
    const guesserB = guessers[1]!

    // 模拟题目为固定多字词
    game.answer = {
      id: 'test-word-1',
      text: '冰淇淋',
      aliases: ['冰激凌'],
      collection: 'food',
    }

    // 猜词者 A 发送差一个字的猜测「冰淇林」
    const result = harness.service.submitGuess(guesserA.playerId, game.roundId, '冰淇林')
    expect(result.correct).toBe(false)

    // 检查猜词者 A 收到的快照：包含差一字私密提示
    const snapshotA = harness.service.snapshotter.snapshot(room, guesserA.playerId)
    const messagesA = snapshotA.game?.messages ?? []
    const nearMissMsgA = messagesA.find((m) => m.type === 'near_miss')
    expect(nearMissMsgA).toBeDefined()
    expect(nearMissMsgA?.text).toContain('离答案只差一个字了')

    // 检查猜词者 B 与画家收到的快照：绝不包含 near_miss 私密提示，公屏无泄漏
    const snapshotB = harness.service.snapshotter.snapshot(room, guesserB.playerId)
    const messagesB = snapshotB.game?.messages ?? []
    expect(messagesB.some((m) => m.type === 'near_miss')).toBe(false)

    const snapshotDrawer = harness.service.snapshotter.snapshot(room, drawerId)
    const messagesDrawer = snapshotDrawer.game?.messages ?? []
    expect(messagesDrawer.some((m) => m.type === 'near_miss')).toBe(false)

    // 普通猜词「冰淇林」应当公开存在于所有人的消息流中
    expect(messagesB.some((m) => m.type === 'guess' && m.text === '冰淇林')).toBe(true)

    // 再次提交差一字猜测，不限提醒次数
    harness.service.submitGuess(guesserA.playerId, game.roundId, '冰淇凌')
    const snapshotA2 = harness.service.snapshotter.snapshot(room, guesserA.playerId)
    const nearMissCount = (snapshotA2.game?.messages ?? []).filter(
      (m) => m.type === 'near_miss',
    ).length
    expect(nearMissCount).toBe(2)
  })

  it('房间关闭 allowNearMissHint 时，不产生差一字提示', () => {
    const harness = createGameHarness()
    const { host, guest1, guest2, room, game } = startTestGame(harness, false)

    const drawerId = game.drawerId
    const guesserA = [host, guest1, guest2].find((p) => p.playerId !== drawerId)!

    game.answer = {
      id: 'test-word-2',
      text: '长颈鹿',
      aliases: [],
      collection: 'animal',
    }

    // 提交差一字答案「短颈鹿」
    harness.service.submitGuess(guesserA.playerId, game.roundId, '短颈鹿')

    const snapshotA = harness.service.snapshotter.snapshot(room, guesserA.playerId)
    const messagesA = snapshotA.game?.messages ?? []
    expect(messagesA.some((m) => m.type === 'near_miss')).toBe(false)
  })

  it('所有在线猜词者全部答对时，立即提前切入 round_result 阶段（零等待消除垃圾时间）', () => {
    const harness = createGameHarness()
    const { host, guest1, guest2, room, game } = startTestGame(harness, true)

    const drawerId = game.drawerId
    const guessers = [host, guest1, guest2].filter((p) => p.playerId !== drawerId)
    const guesser1 = guessers[0]!
    const guesser2 = guessers[1]!

    game.answer = {
      id: 'test-word-3',
      text: '哈密瓜',
      aliases: [],
      collection: 'food',
    }

    expect(room.phase).toBe('drawing')

    // 第一个猜词者答对：回合保持 drawing 阶段
    const res1 = harness.service.submitGuess(guesser1.playerId, game.roundId, '哈密瓜')
    expect(res1.correct).toBe(true)
    expect(room.phase).toBe('drawing')

    // 第二个猜词者（即最后一个在线猜词者）答对：立即提前结算切入 round_result
    const res2 = harness.service.submitGuess(guesser2.playerId, game.roundId, '哈密瓜')
    expect(res2.correct).toBe(true)
    expect(room.phase).toBe('round_result')
    expect(game.roundResult).toBeDefined()
    expect(game.roundResult?.answer).toBe('哈密瓜')
  })
})
