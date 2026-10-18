/**
 * 房间词库「选得中、开不了局」缺陷的回归守卫。
 *
 * 背景：加载门槛（APP_CONFIG.vocabulary.minWords=6）只保证词库可加载；
 * 作为房间词库还必须达到开局裁决线 MIN_SELECTED_VOCABULARY_WORDS（60）。
 * selectPackage 必须在写入房间状态之前拒绝词数不足的包（可读错误、状态不变），
 * 而不是放行到 startGame 才以 VOCABULARY_TOO_SMALL 失败。
 */
import { describe, expect, it } from 'vitest'
import { MIN_SELECTED_VOCABULARY_WORDS } from '@draw-guess/shared'
import { createGameHarness, testRoomSettings } from './helpers/game-harness.ts'
import { createMemoryVocabularyRegistry } from './helpers/mini-vocabulary.ts'

describe('房间词库包选中门槛', () => {
  it('词数低于开局裁决线的包在选中时即拒绝，且不改动房间词库状态', () => {
    const smallCount = MIN_SELECTED_VOCABULARY_WORDS - 1
    const harness = createGameHarness({
      vocabulary: createMemoryVocabularyRegistry(smallCount),
    })
    const host = harness.register('小词库房主')
    const created = harness.backend.room.createRoom(host.playerId, {
      name: '小词库房',
      visibility: 'public',
      settings: testRoomSettings(),
    })
    const room = harness.backend.rooms.get(created.id)
    if (!room) throw new Error('房间未创建')
    const versionBefore = room.stateVersion
    const selectedBefore = room.selectedWordIds

    expect(() =>
      harness.backend.roomVocabulary.selectPackage(host.playerId, 'base_words', versionBefore),
    ).toThrowError(/不足以开局/)

    // 校验先于任何状态写入：勾选集合引用与 stateVersion 均保持不变
    //（若 selectPackage 放行写入，会替换 Set 并递增版本号）。
    expect(room.vocabularyPackageId).toBe('base_words')
    expect(room.selectedWordIds).toBe(selectedBefore)
    expect(room.selectedWordIds.size).toBe(smallCount)
    expect(room.stateVersion).toBe(versionBefore)
  })
})
