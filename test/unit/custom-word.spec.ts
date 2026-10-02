import { describe, expect, it } from 'vitest'
import { APP_CONFIG } from '@draw-guess/config'
import { buildCustomWord } from '../../apps/server/src/domain/vocabulary/custom-word.ts'
import { createGameHarness, testRoomSettings, type GameHarness } from './helpers/game-harness.ts'

/** 起一局双人对局，返回画家与对局秘密状态（可选是否开启自定义题目）。 */
function startGame(harness: GameHarness, allowCustomWord: boolean) {
  const host = harness.register('房主')
  const guest = harness.register('客人')
  const room = harness.service.createRoom(host.playerId, {
    name: '测试房间',
    visibility: 'public',
    settings: testRoomSettings({ allowCustomWord }),
  })
  harness.service.joinRoom(guest.playerId, room.id)
  const ready = harness.service.setReady(guest.playerId, true)
  harness.service.startGame(host.playerId, ready.stateVersion)
  harness.runtime.advance(APP_CONFIG.game.startingCountdownSeconds * 1_000)
  const secret = harness.service.rooms.get(room.id)
  if (!secret?.game) throw new Error('对局未启动')
  return { host, guest, room: secret, game: secret.game }
}

const customWordId = (index = 1) =>
  `custom:00000000-0000-4000-8000-${String(index).padStart(12, '0')}`

describe('自定义词的词面校验（纯函数）', () => {
  it('折叠空白并保留原文，合集标记为「自定义」', () => {
    expect(buildCustomWord({ rawText: '  屋顶  上的猫 ', wordId: customWordId() })).toEqual({
      id: customWordId(),
      text: '屋顶 上的猫',
      aliases: [],
      collection: '自定义',
    })
  })

  it.each([
    ['空输入', '   '],
    ['纯标点', '！？。'],
    ['纯空白', '\t \n'],
    ['超过 12 个字', '一二三四五六七八九十十一十二十三'],
    ['emoji', '猫🐱'],
    ['零宽连接符组合序列', '👩‍💻'],
  ])('%s 被拒绝', (_label, rawText) => {
    expect(() => buildCustomWord({ rawText, wordId: customWordId() })).toThrow()
  })

  it('恰好 12 个字通过（边界）', () => {
    const text = '一二三四五六七八九十十一'
    expect(buildCustomWord({ rawText: text, wordId: customWordId() }).text).toBe(text)
  })
})

describe('画家自定义题目（端到端领域行为）', () => {
  it('开关开启时画家提交合法词，立即进入作画且答案是规范化后的词', () => {
    const harness = createGameHarness()
    const { room, game } = startGame(harness, true)
    harness.service.chooseCustomWord(game.drawerId, game.roundId, '  屋顶  上的猫 ')

    expect(room.phase).toBe('drawing')
    expect(game.answer?.text).toBe('屋顶 上的猫')
    // 回合时长只认房间档位，与词库词同构
    expect(game.roundDurationMs).toBe(room.settings.drawSeconds * 1_000)
    // 猜词者看到的仍是遮罩，而不是明文
    const guesserId = room.members.find((member) => member.playerId !== game.drawerId)?.playerId
    const view = guesserId ? harness.service.snapshotForPlayer(guesserId)?.game : undefined
    expect(view?.answer).toBeUndefined()
    expect(view?.answerMask).not.toBe('屋顶 上的猫')
  })

  it('开关关闭时拒绝（FORBIDDEN）', () => {
    const harness = createGameHarness()
    const { game } = startGame(harness, false)
    expect(() =>
      harness.service.chooseCustomWord(game.drawerId, game.roundId, '屋顶上的猫'),
    ).toThrowError(/未开启自定义题目功能/)
  })

  it('非画家提交被拒绝', () => {
    const harness = createGameHarness()
    const { guest, game } = startGame(harness, true)
    expect(() =>
      harness.service.chooseCustomWord(guest.playerId, game.roundId, '屋顶上的猫'),
    ).toThrowError(/只有当前画家/)
  })

  it('与本回合候选词重复时拒绝，且规范化后相同即算重复', () => {
    const harness = createGameHarness()
    const { game } = startGame(harness, true)
    const candidate = game.candidates[0]
    if (!candidate) throw new Error('测试词库未生成候选词')
    expect(() =>
      harness.service.chooseCustomWord(game.drawerId, game.roundId, candidate.text),
    ).toThrowError(/已经出现过/)
  })

  it('提交后阶段提交被拒（同一回合不能再次自定义）', () => {
    const harness = createGameHarness()
    const { room, game } = startGame(harness, true)
    harness.service.chooseCustomWord(game.drawerId, game.roundId, '屋顶上的猫')
    expect(room.phase).toBe('drawing')
    expect(() =>
      harness.service.chooseCustomWord(game.drawerId, game.roundId, '另一只猫'),
    ).toThrowError(/只有当前画家/)
  })
})
