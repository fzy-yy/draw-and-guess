import { describe, expect, it } from 'vitest'
import { soundCatalog } from '@draw-guess/config'
import {
  assertSoundManifestIntegrity,
  buildSoundManifest,
  formatManifestIssues,
  isManifestEntryAvailable,
  type DiscoveredSound,
  type SoundManifest,
  type SoundMeta,
} from '../../apps/client/src/audio/manifest.ts'

/** 由文件名构造一条被发现资源，便于测试时可读。 */
function asset(name: string, ext: 'mp3' | 'wav'): DiscoveredSound {
  return { name, ext, url: `/assets/audio/${name}.${ext}` }
}

/** 便捷构造一个仅含指定键的微型配置清单，方便各用例聚焦目标键。 */
function catalog(
  keys: Record<string, Partial<SoundMeta> & { required: boolean }>,
): Record<string, SoundMeta> {
  const result: Record<string, SoundMeta> = {}
  for (const [key, meta] of Object.entries(keys)) {
    result[key] = { volumeMultiplier: 1.0, cooldownMs: 100, ...meta }
  }
  return result
}

/** 从清单里抽取指定的问题类型数量，便于断言。 */
function countIssues(
  manifest: SoundManifest,
  kind: SoundManifest['issues'][number]['kind'],
): number {
  return manifest.issues.filter((issue) => issue.kind === kind).length
}

describe('音效资源清单机制', () => {
  it('键缺失：配置清单中声明的必需键在 assets 目录无资源时被判为 missing 并给出可定位失败', () => {
    // 以真实配置清单（soundCatalog）为唯一合法键来源，assets 只发现 correct.mp3
    const manifest = buildSoundManifest([asset('correct', 'mp3')], soundCatalog)

    const click = manifest.entries.get('click')
    expect(click?.availability).toBe('missing')
    expect(click?.required).toBe(true)
    expect(countIssues(manifest, 'required-missing')).toBeGreaterThan(0)
    expect(formatManifestIssues(manifest)).toContain('click')
    expect(formatManifestIssues(manifest)).toContain('apps/client/src/assets/audio/')

    // 严格（开发/测试）环境会抛错：这是「可定位的失败信息」
    expect(() => assertSoundManifestIntegrity(manifest, { strict: true })).toThrowError(/click/)
    // 生产环境（strict=false）保持安全降级，不抛异常
    expect(() => assertSoundManifestIntegrity(manifest, { strict: false })).not.toThrow()
  })

  it('重复扩展名：同一键同时存在 .mp3 与 .wav 时判为冲突，并按约定格式确定性地选其一', () => {
    const manifest = buildSoundManifest(
      [asset('popup', 'mp3'), asset('popup', 'wav')],
      catalog({ popup: { required: true } }),
    )

    const popup = manifest.entries.get('popup')
    // SFX 约定优先 wav
    expect(popup?.availability).toBe('available')
    expect(popup?.ext).toBe('wav')
    expect(popup?.duplicateUrl).toBe('/assets/audio/popup.mp3')
    expect(countIssues(manifest, 'duplicate-extension')).toBe(1)
    expect(formatManifestIssues(manifest)).toContain('popup')

    // 重复扩展名属于需要阻断的冲突 → 严格环境抛错
    expect(() => assertSoundManifestIntegrity(manifest, { strict: true })).toThrowError(/popup/)
  })

  it('可选资源缺失：required=false 的键缺失仅降级、不判失败，也不阻断严格校验', () => {
    const manifest = buildSoundManifest(
      [asset('click', 'wav')],
      catalog({
        click: { required: true },
        reward: { required: false },
      }),
    )

    const optional = manifest.entries.get('reward')
    expect(optional?.availability).toBe('missing')
    expect(optional?.required).toBe(false)
    expect(countIssues(manifest, 'optional-missing')).toBe(1)
    expect(countIssues(manifest, 'required-missing')).toBe(0)
    expect(manifest.hasFatalIssues).toBe(false)

    // 可选资源缺失：即使严格环境也不抛错（缺失仅降级、播放时静默跳过）
    expect(() => assertSoundManifestIntegrity(manifest, { strict: true })).not.toThrow()

    // 可用性查询：不可用键 isManifestEntryAvailable 为 false
    expect(isManifestEntryAvailable(manifest, 'reward')).toBe(false)
  })

  it('可用性查询：无资源键返回 false，有资源键返回 true', () => {
    const manifest = buildSoundManifest(
      [asset('correct', 'mp3')],
      catalog({
        correct: { required: true },
        reward: { required: true },
      }),
    )

    // 有资源 → 可播放
    expect(isManifestEntryAvailable(manifest, 'correct')).toBe(true)
    // 无资源 → 不可播放（播放器据此静默跳过）
    expect(isManifestEntryAvailable(manifest, 'reward')).toBe(false)
  })
})
