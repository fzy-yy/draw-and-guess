import type { VocabularyWord } from '@draw-guess/shared'

/** 输入顺序由调用方提供；选择过程不读取随机源，也不修改词池。 */
export interface CandidateSelectorContext {
  pool: readonly VocabularyWord[]
  count: number
}

export function selectDiverseCandidates({
  pool,
  count,
}: CandidateSelectorContext): VocabularyWord[] {
  if (pool.length <= count) return [...pool]

  const shuffled = pool
  const selected: VocabularyWord[] = []
  const usedCategories = new Set<string>()
  const usedIds = new Set<string>()

  // 目标难度分布：尽量覆盖简单(1-2)、中等(3)、困难(4-5)
  const targetDifficulties: number[] = []
  if (count === 3) targetDifficulties.push(1, 3, 5)
  else if (count === 4) targetDifficulties.push(1, 2, 4, 5)
  else if (count === 5) targetDifficulties.push(1, 2, 3, 4, 5)
  else {
    for (let i = 0; i < count; i += 1) {
      targetDifficulties.push(Math.round(1 + (i * 4) / (count - 1)))
    }
  }

  for (const targetDiff of targetDifficulties) {
    // 1. 优先：难度接近（差值 <= 1）且分类未重复
    let candidate = shuffled.find(
      (w) =>
        !usedIds.has(w.id) &&
        Math.abs(w.difficulty - targetDiff) <= 1 &&
        !usedCategories.has(w.category),
    )
    // 2. 次选：任意难度但分类未重复
    if (!candidate) {
      candidate = shuffled.find((w) => !usedIds.has(w.id) && !usedCategories.has(w.category))
    }
    // 3. 兜底：难度最接近的未选词
    if (!candidate) {
      const remaining = shuffled.filter((w) => !usedIds.has(w.id))
      remaining.sort(
        (a, b) => Math.abs(a.difficulty - targetDiff) - Math.abs(b.difficulty - targetDiff),
      )
      candidate = remaining[0]
    }
    if (candidate) {
      selected.push(candidate)
      usedIds.add(candidate.id)
      if (candidate.category) usedCategories.add(candidate.category)
    }
  }

  // 若依然未填满 count，用剩余未选词补齐
  if (selected.length < count) {
    for (const w of shuffled) {
      if (!usedIds.has(w.id)) {
        selected.push(w)
        usedIds.add(w.id)
        if (selected.length >= count) break
      }
    }
  }

  return selected
}
