import { describe, expect, it } from 'vitest'
import { selectDiverseCandidates } from '../../apps/server/src/domain/vocabulary/candidate-selector.ts'
import type { VocabularyWord } from '@draw-guess/shared'

const pool: VocabularyWord[] = Array.from({ length: 10 }, (_, index) => ({
  id: String(index),
  text: `词${index}`,
  aliases: [],
  category: `类${index % 5}`,
  difficulty: (index % 5) + 1,
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
  it('词池不足返回副本，同分类时按难度补齐', () => {
    expect(selectDiverseCandidates({ pool: [], count: 3 })).toEqual([])
    const small = pool.slice(0, 2)
    expect(selectDiverseCandidates({ pool: small, count: 3 })).toEqual(small)
    expect(selectDiverseCandidates({ pool: small, count: 3 })).not.toBe(small)
    const singleCategory = pool.map((word) => ({ ...word, category: '同类' }))
    expect(
      selectDiverseCandidates({ pool: singleCategory, count: 3 }).map((word) => word.difficulty),
    ).toEqual([1, 3, 5])
  })
})
