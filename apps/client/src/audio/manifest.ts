import type { soundCatalog } from '@draw-guess/config'
import type { SoundName } from './types.ts'

/**
 * 音效资源清单纯逻辑：把「配置声明的键（soundCatalog）」与「assets 目录实际存在资源」做对齐，
 * 得到每个键的可用性（available / missing）、是否有重复扩展名冲突，以及可定位的校验问题。
 *
 * - 键的唯一合法来源是 @draw-guess/config 的 soundCatalog；assets 目录只会被「发现」，不会定义键。
 * - 本模块为纯函数/纯类型，不触碰 Vite（import.meta.glob）、import.meta.env 或配置运行时对象
 *   （soundCatalog 仅以 import type 做类型级形状派生，编译后零残留），
 *   以便在 Node 下直接被单元测试；需要读取运行时清单 / 环境的逻辑放在 runtime.ts。
 */

/** 素材目录（清单诊断与运行期告警共用的唯一来源；非 UI 文案）。 */
export const ASSET_DIR = 'apps/client/src/assets/audio/'

/** 一个已被 Vite 收集到的音效资源（由 assets.ts 产出，这里只定义结构）。 */
export interface DiscoveredSound {
  /** 小写键名（由文件名去扩展名得到，例如 `correct.mp3` → `correct`）。 */
  name: string
  /** 构建后的静态资源 URL。 */
  url: string
  /** 资源格式。 */
  ext: 'mp3' | 'wav'
}

/** soundCatalog 条目的类型（类型级从 @draw-guess/config 派生，import type 不引入运行时依赖）。 */
type CatalogEntry = (typeof soundCatalog)[keyof typeof soundCatalog]

/** 把 as const 的字面量类型加宽回基础类型，让清单机制能接受任意合法形状的目录（含自定义目录）。 */
type WidenLiteral<T> = T extends boolean
  ? boolean
  : T extends number
    ? number
    : T extends string
      ? string
      : T

/**
 * 单个配置键的元数据：字段名与形状由 @draw-guess/config 的 soundCatalog 类型派生（单一来源，
 * 手抄接口会随配置增删漂移）；字面量值经 WidenLiteral 加宽——清单是纯函数，必须能接受
 * 未来自定义目录（如 required:false 的可选键）而非仅内置 12 键的字面量形状。
 */
export type SoundMeta = { readonly [K in keyof CatalogEntry]: WidenLiteral<CatalogEntry[K]> }

/** 键的可用性状态。 */
export type SoundAvailability = 'available' | 'missing'

/** 清单中单个键的条目。 */
export interface SoundManifestEntry {
  key: string
  required: boolean
  availability: SoundAvailability
  /** 选中使用的资源 URL（available 时有值）。 */
  url: string | undefined
  /** 选中资源的格式。 */
  ext: 'mp3' | 'wav' | undefined
  /** 同一键同时存在 .mp3 与 .wav 时，未被选中的那个 URL（仅用于诊断）。 */
  duplicateUrl: string | undefined
}

/** 清单校验发现的问题。 */
export interface SoundManifestIssue {
  kind: 'required-missing' | 'optional-missing' | 'duplicate-extension'
  key: string
  /** 可直接定位到缺失/冲突文件的描述。 */
  detail: string
}

/** 完整的音效资源清单。 */
export interface SoundManifest {
  entries: ReadonlyMap<string, SoundManifestEntry>
  issues: readonly SoundManifestIssue[]
  /**
   * 是否存在需要开发/测试期阻断的问题（必需缺失或重复扩展名）。
   * 这是消费侧（assertSoundManifestIntegrity 等）的唯一判定口径。
   */
  hasFatalIssues: boolean
}

/**
 * 同一键同时存在 mp3 与 wav 时，确定性地选择其一。
 * 短音效约定优先 wav（轻量、短促），与 assets/audio/README.md 一致。
 */
function resolveDuplicate(matches: readonly DiscoveredSound[]): {
  selected: DiscoveredSound
  duplicate?: DiscoveredSound
} {
  const preferred = 'wav'
  // 调用方已保证 matches.length ≥ 1（空匹配在上游走 missing 分支）；此处以显式守卫替代 `matches[0]!`
  const selected = matches.find((match) => match.ext === preferred) ?? matches[0]
  if (!selected) throw new Error('resolveDuplicate 需要一个非空匹配数组')
  const duplicate = matches.find((match) => match !== selected)
  return { selected, duplicate }
}

/**
 * 由「资源发现列表 + 配置清单」构建带可用性信息的 manifest（纯函数，可独立单测）。
 * 键以 catalog 为准；每个键缺失/可用/重复的判定与问题收集都在这里完成。
 */
export function buildSoundManifest(
  discovered: readonly DiscoveredSound[],
  catalog: Readonly<Record<string, SoundMeta>>,
): SoundManifest {
  const entries = new Map<string, SoundManifestEntry>()
  const issues: SoundManifestIssue[] = []

  for (const [key, meta] of Object.entries(catalog)) {
    // 键大小写不变量：资源发现（assets.ts 对文件名 toLowerCase）与查询
    // （isManifestEntryAvailable / runtime.getSoundUrl）都以小写为键，入表前先归一；
    // 否则未来 catalog 引入大写键时 entries 会与查询口径静默失联。
    // 当前内置 12 键全部小写，归一属零行为变化的防御。
    const entryKey = key.toLowerCase()
    const matches = discovered.filter((sound) => sound.name === entryKey)

    if (matches.length === 0) {
      // 完全缺失：区分必需（会阻断）与可选（仅降级、播放时静默跳过）
      entries.set(entryKey, {
        key: entryKey,
        required: meta.required,
        availability: 'missing',
        url: undefined,
        ext: undefined,
        duplicateUrl: undefined,
      })
      issues.push(
        meta.required
          ? {
              kind: 'required-missing',
              key: entryKey,
              detail: `必需音效「${entryKey}」缺失资源文件，请将 ${entryKey}.mp3 或 ${entryKey}.wav 放入 ${ASSET_DIR}`,
            }
          : {
              // 刻意扩展位：内置 soundCatalog 当前全部 required:true，
              // 自定义词库/目录音效未来可标 required:false——可选缺失仅记录诊断、永不判失败
              kind: 'optional-missing',
              key: entryKey,
              detail: `可选音效「${entryKey}」暂缺资源文件（不阻断，播放时静默跳过）：${entryKey}.mp3 / ${entryKey}.wav`,
            },
      )
      continue
    }

    const { selected, duplicate } = resolveDuplicate(matches)
    entries.set(entryKey, {
      key: entryKey,
      required: meta.required,
      availability: 'available',
      url: selected.url,
      ext: selected.ext,
      duplicateUrl: duplicate?.url,
    })

    if (duplicate) {
      issues.push({
        kind: 'duplicate-extension',
        key: entryKey,
        detail: `同一音效「${entryKey}」同时存在 ${selected.ext} 与 ${duplicate.ext}，已优先使用 ${entryKey}.${selected.ext}，建议仅保留一种格式`,
      })
    }
  }

  const hasRequiredMissing = issues.some((issue) => issue.kind === 'required-missing')
  const hasDuplicate = issues.some((issue) => issue.kind === 'duplicate-extension')
  const hasFatalIssues = hasRequiredMissing || hasDuplicate

  return {
    entries,
    issues,
    hasFatalIssues,
  }
}

/** 把清单问题格式化成可定位的多行诊断文本（供控制台与抛错复用，非 UI 文案）。 */
export function formatManifestIssues(manifest: SoundManifest): string {
  const group = (kind: SoundManifestIssue['kind']): string[] =>
    manifest.issues.filter((issue) => issue.kind === kind).map((issue) => `  - ${issue.detail}`)

  const sections = [
    ['必需资源缺失', group('required-missing')],
    ['重复扩展名冲突', group('duplicate-extension')],
    ['可选资源缺失（仅降级）', group('optional-missing')],
  ] as const

  const body = sections
    .filter(([, lines]) => lines.length > 0)
    .map(([title, lines]) => `【${title}】\n${lines.join('\n')}`)
    .join('\n\n')

  return `[音效资源清单校验] 发现 ${manifest.issues.length} 处待处理项：\n${body}`
}

/**
 * 严格断言：必需资源缺失或重复扩展名时抛出可定位错误（仅供单元测试 fail-fast）。
 * 可选资源缺失永不判失败；strict 关闭时静默通过。
 * 生产运行时不调用本函数，而是由 runtime.ts 按可用性安全降级（绝不抛异常）。
 */
export function assertSoundManifestIntegrity(
  manifest: SoundManifest,
  options: { strict?: boolean } = {},
): void {
  const { strict = true } = options
  if (!strict || !manifest.hasFatalIssues) return
  throw new Error(formatManifestIssues(manifest))
}

/** 把清单问题输出到控制台（不抛错），用于开发期在运行时醒目提示缺失资源。 */
export function reportManifestIssues(manifest: SoundManifest): void {
  if (manifest.issues.length === 0) return
  console.error(formatManifestIssues(manifest))
}

/** 检查指定清单中某个键是否可播放（存在可用资源）；纯查询，仅供单元测试消费。 */
export function isManifestEntryAvailable(
  manifest: SoundManifest,
  name: SoundName | string,
): boolean {
  return manifest.entries.get(name.toLowerCase())?.availability === 'available'
}
