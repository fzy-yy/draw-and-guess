/**
 * 权威词库加载模块。
 * 只有服务端会读取根目录 vocabulary.md；浏览器只能通过有权限的 Socket 事件取得词条。
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { APP_CONFIG } from '../../../config.ts'
import { normalizeAnswer, type VocabularyItem } from '@draw-guess/shared'

export interface VocabularyStore {
  items: VocabularyItem[]
  byId: Map<string, VocabularyItem>
  version: string
}

/** 解析一行一个词的正文，并按规范化词面去重。非法超长行会明确报错而非静默截断。 */
export function parseVocabulary(source: string): VocabularyStore {
  const unique = new Map<string, string>()
  for (const rawLine of source.replace(/\r\n?/gu, '\n').split('\n')) {
    const text = rawLine.trim()
    if (!text) continue
    if (Array.from(text).length > APP_CONFIG.vocabulary.maxWordLength) {
      throw new Error(
        `词条“${text.slice(0, 12)}…”超过 ${APP_CONFIG.vocabulary.maxWordLength} 个字符`,
      )
    }
    const normalized = normalizeAnswer(text)
    if (normalized) unique.set(normalized, unique.get(normalized) ?? text)
  }
  if (unique.size < APP_CONFIG.vocabulary.minWords) {
    throw new Error(`有效词条仅 ${unique.size} 个，至少需要 ${APP_CONFIG.vocabulary.minWords} 个`)
  }
  const items = [...unique.entries()].map(([normalized, text]) => ({
    id: createHash('sha256').update(normalized).digest('hex').slice(0, 12),
    text,
  }))
  const version = createHash('sha256')
    .update(items.map((item) => `${item.id}:${item.text}`).join('|'))
    .digest('hex')
    .slice(0, 12)
  return { items, byId: new Map(items.map((item) => [item.id, item])), version }
}

/** 从进程工作目录向上定位项目根目录，兼容根级与 workspace filter 启动。 */
export async function loadVocabulary(
  rootDirectory = path.resolve(process.cwd(), '../..'),
): Promise<VocabularyStore> {
  const preferred = path.resolve(rootDirectory, APP_CONFIG.vocabulary.filePath)
  const fallback = path.resolve(process.cwd(), APP_CONFIG.vocabulary.filePath)
  try {
    return parseVocabulary(await readFile(preferred, APP_CONFIG.vocabulary.encoding))
  } catch (error) {
    if (preferred !== fallback && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return parseVocabulary(await readFile(fallback, APP_CONFIG.vocabulary.encoding))
    }
    throw error
  }
}
