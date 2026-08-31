/**
 * 权威词库加载模块。
 * 只有服务端会读取根目录 vocabulary.md；浏览器只能通过有权限的 Socket 事件取得词条。
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { APP_CONFIG } from '../../../config.ts'
import { normalizeAnswer, type VocabularyItem } from '@draw-guess/shared'

/** 词库装载结果：词条列表 + 按 ID 索引的 Map + 内容哈希版本。 */
export interface VocabularyStore {
  items: VocabularyItem[]
  byId: Map<string, VocabularyItem>
  version: string
}

/** 解析一行一个词的正文，并按规范化词面去重。非法超长行会明确报错而非静默截断。 */
export function parseVocabulary(source: string): VocabularyStore {
  // 以规范化词面为键去重：同一词面的不同写法只保留首次出现的原始正文
  const unique = new Map<string, string>()
  for (const rawLine of source.replace(/\r\n?/gu, '\n').split('\n')) {
    const text = rawLine.trim()
    if (!text) continue // 跳过空行
    // 超长词条直接报错，避免后续遮罩/提示逻辑被长词拖垮
    if (Array.from(text).length > APP_CONFIG.vocabulary.maxWordLength) {
      throw new Error(
        `词条“${text.slice(0, 12)}…”超过 ${APP_CONFIG.vocabulary.maxWordLength} 个字符`,
      )
    }
    const normalized = normalizeAnswer(text)
    if (normalized) unique.set(normalized, unique.get(normalized) ?? text)
  }
  // 词条过少时拒绝启动，保证选词阶段有足够候选项
  if (unique.size < APP_CONFIG.vocabulary.minWords) {
    throw new Error(`有效词条仅 ${unique.size} 个，至少需要 ${APP_CONFIG.vocabulary.minWords} 个`)
  }
  // 用规范化词面的 SHA-256 前 12 位生成稳定 ID，词库变更后 ID 也变
  const items = [...unique.entries()].map(([normalized, text]) => ({
    id: createHash('sha256').update(normalized).digest('hex').slice(0, 12),
    text,
  }))
  // 对整个词库内容做哈希，作为词库版本号供客户端对比
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
  // 先尝试根目录下的词库文件；找不到时回退到当前工作目录下的同路径文件
  const preferred = path.resolve(rootDirectory, APP_CONFIG.vocabulary.filePath)
  const fallback = path.resolve(process.cwd(), APP_CONFIG.vocabulary.filePath)
  try {
    return parseVocabulary(await readFile(preferred, APP_CONFIG.vocabulary.encoding))
  } catch (error) {
    // 仅当首选路径不存在（ENOENT）且与回退路径不同时才尝试回退，其他错误原样抛出
    if (preferred !== fallback && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return parseVocabulary(await readFile(fallback, APP_CONFIG.vocabulary.encoding))
    }
    throw error
  }
}
