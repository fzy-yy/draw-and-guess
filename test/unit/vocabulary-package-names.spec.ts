/**
 * 多词库选择：房间快照里「词库包 ID 列表」与「词库包名列表」必须逐位对应。
 *
 * 回归背景：包名曾由合并词库的展示名 `split('、')` 推导，其顺序来自注册表的扫描顺序，
 * 与用户勾选顺序无关；一旦用户按不同顺序勾选，两个列表就会错位（ADR-0062）。
 * 用例用真实双库（base_words + fzyyy_words）并故意反序勾选，只经公开服务接口观察快照。
 */
import { describe, expect, it } from 'vitest'
import { loadVocabulary } from '../../apps/server/src/vocabulary/index.ts'
import { createGameHarness, testRoomSettings } from './helpers/game-harness.ts'

async function createRoomWithHarness() {
  const registry = await loadVocabulary()
  const harness = createGameHarness({ vocabulary: registry })
  const host = harness.register('房主')
  const snapshot = harness.backend.room.createRoom(host.playerId, {
    name: '多词库房',
    visibility: 'public',
    settings: testRoomSettings(),
  })
  const room = harness.backend.rooms.get(snapshot.id)
  if (!room) throw new Error('房间未创建')
  return { harness, host, room }
}

describe('多词库选择的包名与包 ID 对应关系', () => {
  it('按与扫描顺序相反的顺序勾选两个词库时，包名仍与包 ID 逐位对应', async () => {
    const { harness, host, room } = await createRoomWithHarness()
    // 真实目录按文件名扫描：base_words 在前、fzyyy_words 在后；这里故意反序勾选。
    harness.backend.roomVocabulary.selectPackages(
      host.playerId,
      ['fzyyy_words', 'base_words'],
      room.stateVersion,
    )

    const vocab = harness.backend.roomVocabulary.get(host.playerId)
    const snapshot = harness.backend.snapshotter.snapshot(room, host.playerId)

    expect(snapshot.vocabularyPackageIds).toEqual(['fzyyy_words', 'base_words'])
    // 期望值独立来自词库快照的包清单（id → name），不重算服务端的推导方式。
    const expectedNames = snapshot.vocabularyPackageIds.map(
      (id) => vocab.packages.find((pkg) => pkg.id === id)?.name,
    )
    expect(snapshot.vocabularyPackageNames).toEqual(expectedNames)
  })

  it('单选一个词库时，包名列表只含该词库', async () => {
    const { harness, host, room } = await createRoomWithHarness()
    harness.backend.roomVocabulary.selectPackages(host.playerId, ['fzyyy_words'], room.stateVersion)

    const snapshot = harness.backend.snapshotter.snapshot(room, host.playerId)

    expect(snapshot.vocabularyPackageIds).toEqual(['fzyyy_words'])
    expect(snapshot.vocabularyPackageNames).toEqual(['fzyyy的词库'])
  })
})
