/**
 * 多词库选择：词库包名本身含分隔符「、」时的边界。
 *
 * 回归背景：快照的包名列表曾由合并展示名 `split('、')` 推导——包名自带「、」时会被拆成
 * 两个元素，与包 ID 列表长度都对不上（取舍见 docs/adr/0062-vocabulary-package-names-by-id.md）。
 * 这里用内存注册表构造一个名字含「、」的包，只经公开服务接口观察快照与系统通知。
 */
import { describe, expect, it } from 'vitest'
import type { VocabularyWord } from '@draw-guess/shared'
import type { VocabularyRegistry, VocabularyStore } from '../../apps/server/src/vocabulary/index.ts'
import { createGameHarness, testRoomSettings } from './helpers/game-harness.ts'

/** 构造词库包：词面唯一，便于断言包内词条。 */
function makeStore(packageId: string, packageName: string, texts: string[]): VocabularyStore {
  const items: VocabularyWord[] = texts.map((text, index) => ({
    id: `${packageId}:${index + 1}`,
    text,
    aliases: [],
    collection: '测试',
    packageId,
    packageName,
  }))
  return {
    items,
    byId: new Map(items.map((word) => [word.id, word])),
    version: `hash-${packageId}`,
    meta: {
      sourceId: 'sqlite',
      id: packageId,
      name: packageName,
      description: '',
      author: '',
      remark: '',
      fileVersion: '1.0.0',
      updatedAt: '2026-01-01',
      collections: ['测试'],
      wordCount: items.length,
    },
  }
}

const PACKAGE_A = makeStore('pkg_a', '水果、蔬菜', ['苹果', '香蕉'])
const PACKAGE_B = makeStore('pkg_b', '日常词库', ['椅子', '桌子'])

function registryOf(stores: VocabularyStore[]): VocabularyRegistry {
  const byId = new Map<string, VocabularyStore>(stores.map((store) => [store.meta.id ?? '', store]))
  const registry: VocabularyRegistry = {
    packages: stores.map((store) => ({
      id: store.meta.id ?? '',
      name: store.meta.name ?? '',
      wordCount: store.items.length,
      description: '',
      author: '',
      remark: '',
      version: '1',
      updatedAt: '',
    })),
    defaultPackageId: stores[0]?.meta.id ?? '',
    get: (id: string) => byId.get(id),
    getCombined: (ids: readonly string[]) => {
      const matched = ids
        .map((id) => byId.get(id))
        .filter((store): store is VocabularyStore => store !== undefined)
      const items = matched.flatMap((store) => store.items)
      return {
        items,
        byId: new Map(items.map((word) => [word.id, word])),
        version: 'combined',
        meta: {
          sourceId: 'combined',
          id: ids.join('+'),
          name: matched.map((store) => store.meta.name).join('、'),
          collections: ['测试'],
          wordCount: items.length,
        },
      }
    },
    getDefault: () => stores[0] as VocabularyStore,
    get items(): VocabularyWord[] {
      return (stores[0] as VocabularyStore).items
    },
  }
  return registry
}

function setup() {
  const harness = createGameHarness({ vocabulary: registryOf([PACKAGE_A, PACKAGE_B]) })
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

describe('词库包名含「、」时的边界', () => {
  it('快照的包名列表按包 ID 逐位给出，不因包名含分隔符而多出元素', () => {
    const { harness, host, room } = setup()
    harness.backend.roomVocabulary.selectPackages(
      host.playerId,
      ['pkg_a', 'pkg_b'],
      room.stateVersion,
    )

    const snapshot = harness.backend.snapshotter.snapshot(room, host.playerId)

    expect(snapshot.vocabularyPackageIds).toEqual(['pkg_a', 'pkg_b'])
    expect(snapshot.vocabularyPackageNames).toEqual(['水果、蔬菜', '日常词库'])
  })

  it('切包系统通知逐条列出所选的包名（含分隔符的包名保持完整）', () => {
    const { harness, host, room } = setup()
    const before = harness.ioEvents.length
    harness.backend.roomVocabulary.selectPackages(
      host.playerId,
      ['pkg_a', 'pkg_b'],
      room.stateVersion,
    )

    const texts = harness.ioEvents
      .slice(before)
      .filter((event) => event.event === 'system:notice')
      .map((event) => (event.payload as { data?: { text?: string } }).data?.text ?? '')

    expect(texts).toHaveLength(1)
    // 逐个包名成对包裹，而不是把拼接后的长串整体塞进一对引号里（那样无法分辨包的名与名）。
    expect(texts[0]).toContain('「水果、蔬菜」')
    expect(texts[0]).toContain('「日常词库」')
  })
})
