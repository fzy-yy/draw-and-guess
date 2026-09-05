import { APP_CONFIG } from '@draw-guess/config'
import type { AvatarId } from '@draw-guess/shared'

/**
 * 由 Vite 在构建期收集全部内置 SVG，并以静态资源 URL 的形式加载。
 * 协议和 localStorage 只保存白名单编号，不保存构建哈希 URL，更不会渲染客户端提交的 SVG 正文。
 */
const avatarModules = import.meta.glob<string>('../assets/avatar/*.svg', {
  eager: true,
  import: 'default',
  query: '?url',
})

/** 将“../assets/avatar/01.svg”转换为“01 -> 构建后 URL”的只读索引。 */
const avatarUrlById = new Map<string, string>(
  Object.entries(avatarModules).flatMap(([path, url]) => {
    const id = path.match(/\/([^/]+)\.svg$/u)?.[1]
    return id ? [[id, url] as const] : []
  }),
)

/**
 * 取得白名单头像 URL。资源缺失或编号损坏时统一回退默认头像，避免页面出现破图。
 * 开发环境额外输出一次错误，便于在新增/删除头像资源时发现配置与文件不一致。
 */
export function getAvatarUrl(id: AvatarId | string | undefined): string {
  const fallback = avatarUrlById.get(APP_CONFIG.player.defaultAvatarId) ?? ''
  if (!id || !(APP_CONFIG.player.avatarIds as readonly string[]).includes(id)) return fallback
  const url = avatarUrlById.get(id)
  if (!url && import.meta.env.DEV) console.error(`缺少头像资源：${id}.svg`)
  return url ?? fallback
}
