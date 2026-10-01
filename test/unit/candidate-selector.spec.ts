import { describe, expect, it } from 'vitest'
import { selectDiverseCandidates } from '../../apps/server/src/domain/vocabulary/candidate-selector.ts'
import type { VocabularyWord } from '@draw-guess/shared'

const pool: VocabularyWord[] = Array.from({ length: 10 }, (_, index) => ({
  id: String(index),
  text: `词${index}`,
  aliases: [],
  category: `类${index % 5}`,
}))

describe('CandidateSelector 纯函数契约', () => {
  it.each([3, 4, 5])('候选数 %i 优先选择不同分类且不重复词条', (count) => {
    const before = structuredClone(pool)
    const first = selectDiverseCandidates({ pool, count })
    expect(first).toEqual(selectDiverseCandidates({ pool, count }))
    expect(first).toHaveLength(count)
    expect(new Set(first.map((word) => word.id)).size).toBe(count)
    expect(new Set(first.map((word) => word.category)).size).toBe(count)
    expect(pool).toEqual(before)
  })
  it('词池不足返回副本，同分类时按词池原顺序补齐', () => {
    expect(selectDiverseCandidates({ pool: [], count: 3 })).toEqual([])
    const small = pool.slice(0, 2)
    expect(selectDiverseCandidates({ pool: small, count: 3 })).toEqual(small)
    expect(selectDiverseCandidates({ pool: small, count: 3 })).not.toBe(small)
    const singleCategory = pool.map((word) => ({ ...word, category: '同类' }))
    expect(
      selectDiverseCandidates({ pool: singleCategory, count: 3 }).map((word) => word.id),
    ).toEqual(['0', '1', '2'])
  })
  it('候选数多于分类数时，剩余名额按词池原顺序补齐', () => {
    // 前 6 条只有 5 个不同分类（类0 重复一次），第 6 个名额应从剩余词里按顺序补
    const limited = pool.slice(0, 6)
    expect(selectDiverseCandidates({ pool: limited, count: 6 }).map((word) => word.id)).toEqual([
      '0',
      '1',
      '2',
      '3',
      '4',
      '5',
    ])
  })
})
