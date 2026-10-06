/**
 * 词库元数据扩展（author/remark）及重词规则解禁专项单测。
 *
 * 覆盖点：
 * 1. VocabularyPackageInfoSchema 严格校验 author 与 remark 字段；
 * 2. 词库仅有 1 个词时，经典模式正常开局，并循环补足候选词至 optionCount；
 * 3. 跨回合选词允许抽到相同词（解除历史去重限制）；
 * 4. 画家自定义题目允许与历史已出现的题目相同（仅防当前回合候选撞词）。
 */
import { describe, expect, it } from 'vitest'
import {
  MIN_SELECTED_VOCABULARY_WORDS,
  VocabularyPackageInfoSchema,
  type VocabularyWord,
} from '@draw-guess/shared'
import { createGameHarness, testRoomSettings } from './helpers/game-harness.ts'
import type { VocabularyRegistry } from '../../apps/server/src/vocabulary/index.ts'

function createSingleWordRegistry(wordText = '苹果'): VocabularyRegistry {
  const packageId = 'single_word_pkg'
  const items: VocabularyWord[] = [
    {
      id: 'single_word_pkg:1',
      text: wordText,
      aliases: [],
      collection: '水果',
      packageId,
      packageName: '单词测试库',
    },
  ]
  const byId = new Map(items.map((word) => [word.id, word]))
  const store = {
    items,
    byId,
    version: 'single-word-hash',
    meta: {
      sourceId: 'sqlite',
      id: packageId,
      name: '单词测试库',
      description: '只有1个词的词库',
      author: '单测作者',
      remark: '单测备注',
      fileVersion: '1.0.0',
      updatedAt: '2026-10-06',
      collections: ['水果'],
      wordCount: 1,
    },
  }
  return {
    ...store,
    packages: [
      {
        id: packageId,
        name: '单词测试库',
        wordCount: 1,
        description: '只有1个词的词库',
        author: '单测作者',
        remark: '单测备注',
        version: '1.0.0',
        updatedAt: '2026-10-06',
      },
    ],
    defaultPackageId: packageId,
    get: (id: string) => (id === packageId ? store : undefined),
    getCombined: () => store,
    getDefault: () => store,
  } as unknown as VocabularyRegistry
}

describe('词库元数据扩展与重词规则解禁', () => {
  it('MIN_SELECTED_VOCABULARY_WORDS 常量为 1', () => {
    expect(MIN_SELECTED_VOCABULARY_WORDS).toBe(1)
  })

  it('VocabularyPackageInfoSchema 能够正确通过包含 author 和 remark 的元信息', () => {
    const pkg = {
      id: 'base_words',
      name: '基础词库',
      wordCount: 100,
      description: '综合词库',
      author: '官方',
      remark: '无备注',
      version: '1.1.0',
      updatedAt: '2026-10-06',
    }
    const parsed = VocabularyPackageInfoSchema.safeParse(pkg)
    expect(parsed.success).toBe(true)
  })

  it('单词词库可正常开局，且候选词能循环同词补足至 optionCount', () => {
    const harness = createGameHarness({
      vocabulary: createSingleWordRegistry('香蕉'),
    })
    const host = harness.register('房主')
    const guest = harness.register('玩家2')
    const created = harness.service.createRoom(host.playerId, {
      name: '单词测试房',
      visibility: 'public',
      settings: testRoomSettings({ optionCount: 3 }),
    })
    harness.service.joinRoom(guest.playerId, created.id)
    harness.service.setReady(guest.playerId, true)

    // 开局
    const room = harness.service.rooms.get(created.id)!
    expect(() => harness.service.startGame(host.playerId, room.stateVersion)).not.toThrow()

    // 推进倒计时进入 choosing_word 阶段
    harness.runtime.advance(4_000)
    expect(room.phase).toBe('choosing_word')
    expect(room.game).toBeDefined()
    // 候选词数量为 3，且均为“香蕉”
    expect(room.game!.candidates).toHaveLength(3)
    expect(room.game!.candidates.every((w) => w.text === '香蕉')).toBe(true)
  })

  it('多回合之间允许抽到相同候选词，不因往前回合出现而排除', () => {
    // 构造只有 3 个词的词库
    const packageId = 'three_words_pkg'
    const items: VocabularyWord[] = [
      {
        id: 'three_words_pkg:1',
        text: '词一',
        aliases: [],
        collection: '分类',
        packageId,
        packageName: '三词测试库',
      },
      {
        id: 'three_words_pkg:2',
        text: '词二',
        aliases: [],
        collection: '分类',
        packageId,
        packageName: '三词测试库',
      },
      {
        id: 'three_words_pkg:3',
        text: '词三',
        aliases: [],
        collection: '分类',
        packageId,
        packageName: '三词测试库',
      },
    ]
    const byId = new Map(items.map((word) => [word.id, word]))
    const store = {
      items,
      byId,
      version: 'v-3',
      meta: {
        sourceId: 'sqlite',
        id: packageId,
        name: '三词测试库',
        description: '三词词库',
        author: '作者',
        remark: '备注',
        fileVersion: '1.0.0',
        updatedAt: '2026-10-06',
        collections: ['分类'],
        wordCount: 3,
      },
    }
    const registry = {
      ...store,
      packages: [
        {
          id: packageId,
          name: '三词测试库',
          wordCount: 3,
          description: '三词词库',
          author: '作者',
          remark: '备注',
          version: '1.0.0',
          updatedAt: '2026-10-06',
        },
      ],
      defaultPackageId: packageId,
      get: (id: string) => (id === packageId ? store : undefined),
      getCombined: () => store,
      getDefault: () => store,
    } as unknown as VocabularyRegistry

    const harness = createGameHarness({ vocabulary: registry })
    const host = harness.register('房主')
    const guest = harness.register('玩家2')
    const created = harness.service.createRoom(host.playerId, {
      name: '重词测试房',
      visibility: 'public',
      settings: testRoomSettings({ optionCount: 3, roundsPerPlayer: 2 }),
    })
    harness.service.joinRoom(guest.playerId, created.id)
    harness.service.setReady(guest.playerId, true)

    const room = harness.service.rooms.get(created.id)!
    harness.service.startGame(host.playerId, room.stateVersion)
    harness.runtime.advance(4_000)
    expect(room.phase).toBe('choosing_word')

    // 第 1 回合选第 1 个词
    const round1Candidates = [...room.game!.candidates]
    const chosen = round1Candidates[0]!
    harness.service.chooseWord(host.playerId, room.game!.roundId, chosen.id)
    expect(room.phase).toBe('drawing')

    // 猜对结束本回合
    harness.service.submitGuess(guest.playerId, room.game!.roundId, chosen.text)
    // 推进结算进入第 2 回合
    harness.runtime.advance(10_000)

    // 第 2 回合再次抽取候选词：词库仍能抽满 3 个词，且依然包含上一回合的词
    expect(room.phase).toBe('choosing_word')
    expect(room.game!.candidates).toHaveLength(3)
    const round2Texts = room.game!.candidates.map((w) => w.text)
    expect(round2Texts).toContain(chosen.text)
  })

  it('画家自定义题目允许与历史已出现题目相同', () => {
    const harness = createGameHarness({
      vocabulary: createSingleWordRegistry('基础词'),
    })
    const host = harness.register('房主')
    const guest = harness.register('玩家2')
    const created = harness.service.createRoom(host.playerId, {
      name: '自定义重词房',
      visibility: 'public',
      settings: testRoomSettings({ allowCustomWord: true }),
    })
    harness.service.joinRoom(guest.playerId, created.id)
    harness.service.setReady(guest.playerId, true)

    const room = harness.service.rooms.get(created.id)!
    harness.service.startGame(host.playerId, room.stateVersion)
    harness.runtime.advance(4_000)
    expect(room.phase).toBe('choosing_word')

    // 画家输入一个自定义词
    harness.service.chooseCustomWord(host.playerId, room.game!.roundId, '历史自定义词')
    expect(room.phase).toBe('drawing')
    expect(room.game!.answer?.text).toBe('历史自定义词')

    // 猜对结束回合
    harness.service.submitGuess(guest.playerId, room.game!.roundId, '历史自定义词')
    harness.runtime.advance(10_000)

    // 下一回合：画家再次输入相同自定义词，应正常通过而不被拦截为 DUPLICATE
    expect(room.phase).toBe('choosing_word')
    expect(() =>
      harness.service.chooseCustomWord(guest.playerId, room.game!.roundId, '历史自定义词'),
    ).not.toThrow()
    expect(room.game!.answer?.text).toBe('历史自定义词')
  })

  it('支持同时选择多个词库并合并词条', () => {
    const pkg1Words: VocabularyWord[] = [
      {
        id: 'pkg1:1',
        text: '库1词1',
        aliases: [],
        collection: '分类A',
        packageId: 'pkg1',
        packageName: '词库一',
      },
    ]
    const pkg2Words: VocabularyWord[] = [
      {
        id: 'pkg2:1',
        text: '库2词1',
        aliases: [],
        collection: '分类B',
        packageId: 'pkg2',
        packageName: '词库二',
      },
    ]
    const store1 = {
      items: pkg1Words,
      byId: new Map(pkg1Words.map((w) => [w.id, w])),
      version: 'hash-pkg1',
      meta: {
        sourceId: 'sqlite',
        id: 'pkg1',
        name: '词库一',
        description: '',
        author: '',
        remark: '',
        collections: ['分类A'],
        wordCount: 1,
      },
    }
    const store2 = {
      items: pkg2Words,
      byId: new Map(pkg2Words.map((w) => [w.id, w])),
      version: 'hash-pkg2',
      meta: {
        sourceId: 'sqlite',
        id: 'pkg2',
        name: '词库二',
        description: '',
        author: '',
        remark: '',
        collections: ['分类B'],
        wordCount: 1,
      },
    }
    const storesMap = new Map([
      ['pkg1', store1],
      ['pkg2', store2],
    ])
    const registry: VocabularyRegistry = {
      packages: [
        {
          id: 'pkg1',
          name: '词库一',
          wordCount: 1,
          description: '',
          author: '',
          remark: '',
          version: '1',
          updatedAt: '',
        },
        {
          id: 'pkg2',
          name: '词库二',
          wordCount: 1,
          description: '',
          author: '',
          remark: '',
          version: '1',
          updatedAt: '',
        },
      ],
      defaultPackageId: 'pkg1',
      get: (id: string) => storesMap.get(id),
      getCombined: (ids: readonly string[]) => {
        const matched = ids.map((id) => storesMap.get(id)).filter(Boolean) as (typeof store1)[]
        const items = matched.flatMap((s) => s.items)
        return {
          items,
          byId: new Map(items.map((w) => [w.id, w])),
          version: 'combined-hash',
          meta: {
            sourceId: 'combined',
            id: ids.join('+'),
            name: matched.map((m) => m.meta.name).join('、'),
            collections: Array.from(new Set(items.map((w) => w.collection))),
            wordCount: items.length,
          },
        }
      },
      getDefault: () => store1,
      get items() {
        return store1.items
      },
    }

    const harness = createGameHarness({ vocabulary: registry })
    const host = harness.register('房主')
    const created = harness.service.createRoom(host.playerId, {
      name: '多词库房',
      visibility: 'public',
      settings: testRoomSettings(),
    })

    // 同时勾选两个词库
    const snapshot = harness.service.selectVocabularyPackages(host.playerId, ['pkg1', 'pkg2'])
    expect(snapshot.packageIds).toEqual(['pkg1', 'pkg2'])
    expect(snapshot.items).toHaveLength(2)
    expect(snapshot.items[0]!.packageName).toBe('词库一')
    expect(snapshot.items[1]!.packageName).toBe('词库二')
    expect(snapshot.selectedIds).toEqual(['pkg1:1', 'pkg2:1'])

    const room = harness.service.rooms.get(created.id)!
    expect(room.vocabularyPackageIds).toEqual(['pkg1', 'pkg2'])
  })
})
