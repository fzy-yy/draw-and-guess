import { APP_CONFIG } from '@draw-guess/config'
import type { SoundName } from './types.ts'
import { discoverSoundAssets } from './assets.ts'
import {
  buildSoundManifest,
  reportManifestIssues,
  ASSET_DIR,
  type SoundManifest,
} from './manifest.ts'

/**
 * 音效清单运行时组装层：把「真实 assets 目录」与「配置清单」合成运行时 manifest，
 * 并提供面向播放器的资源查询与启动校验钩子。
 *
 * 这一层触及 Vite 语义（import.meta.glob / import.meta.env），与纯逻辑的 manifest.ts 分离，
 * 使后者可在 Node 下被单元测试（见 test/unit/sound-manifest.spec.ts）。
 */

/** 仅读取用到的 Vite 元信息字段；用局部类型收敛返回值形状（import.meta.env 已由 vite/client 类型化，无需再断言）。 */
interface ViteEnvShape {
  DEV?: boolean
  MODE?: string
}

function readViteEnv(): ViteEnvShape {
  return import.meta.env
}

/**
 * 判断当前是否处于「严格校验」环境。
 * 开发（vite dev/server）与测试（vitest，MODE === 'test'）启用；生产构建（vite build）关闭，
 * 生产环境只按可用性降级、绝不抛异常。
 */
function isStrictValidationEnv(): boolean {
  const env = readViteEnv()
  return env.DEV === true || env.MODE === 'test'
}

/** 基于真实 assets 目录 + 配置清单构建的运行时清单（模块级仅计算，不抛错）。 */
const runtimeManifest: SoundManifest = buildSoundManifest(
  discoverSoundAssets(),
  APP_CONFIG.audio.sounds,
)

/** 已提示过的缺失键集合，避免开发模式下重复告警刷屏。 */
const warnedMissingNames = new Set<string>()

/**
 * 获取指定音效键名的静态资源 URL；缺失时安全返回 undefined（不抛异常）。
 * 告警双通道：批量校验（initAudio）供启动期汇总，本函数的逐键 warn 供运行期兜底（发现新增缺失键）。
 */
export function getSoundUrl(name: SoundName | string): string | undefined {
  const normalized = name.toLowerCase()
  const url = runtimeManifest.entries.get(normalized)?.url
  if (!url && readViteEnv().DEV === true && !warnedMissingNames.has(normalized)) {
    warnedMissingNames.add(normalized)
    // 目录字面量单源于 manifest.ASSET_DIR，避免两处硬编码漂移
    console.warn(
      `[Audio] 暂未提供音效文件: ${normalized}.mp3 或 ${normalized}.wav（路径: ${ASSET_DIR}）`,
    )
  }
  return url
}

/**
 * 音效系统启动钩子：在开发/测试环境把清单问题醒目输出到控制台（可定位、不抛错），
 * 生产环境静默降级。严格失败语义（抛异常）由 assertSoundManifestIntegrity 在测试/构建期单独使用。
 * 告警双通道：本钩子的批量校验供启动期一次性汇总，getSoundUrl 的逐键 warn 供运行期兜底。
 */
export function initAudio(): void {
  if (!isStrictValidationEnv()) return
  reportManifestIssues(runtimeManifest)
}
