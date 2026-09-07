import type { DiscoveredSound } from './manifest.ts'

/**
 * 音效资源发现层：把 Vite 静态导入结果转成统一的「资源发现列表」。
 * 只负责收集文件，不携带可用性/校验语义；由 manifest.ts 依据配置清单计算可用性。
 * DiscoveredSound 结构定义在 manifest.ts（清单纯逻辑），本模块复用避免重复声明。
 */
const audioModules = import.meta.glob<string>('../assets/audio/*.{mp3,wav}', {
  eager: true,
  import: 'default',
  query: '?url',
})

/**
 * 将 Vite 静态导入结果转换为可供清单机制校验的资源发现列表。
 * 键名一律转为全小写，避免大小写不一致导致匹配失败；无法解析出键名的路径被丢弃。
 */
export function discoverSoundAssets(): DiscoveredSound[] {
  return Object.entries(audioModules)
    .map(([path, url]) => {
      const match = path.match(/\/([^/]+)\.(mp3|wav)$/u)
      const name = match?.[1]?.toLowerCase()
      const ext = match?.[2]
      if (!name || (ext !== 'mp3' && ext !== 'wav')) return null
      return { name, url, ext } as DiscoveredSound
    })
    .filter((entry): entry is DiscoveredSound => entry !== null)
}
