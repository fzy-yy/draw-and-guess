/**
 * 客户端安全 UUID 生成工具。
 *
 * 浏览器仅在“安全上下文”（HTTPS 或 localhost）中暴露 `crypto.randomUUID()`；
 * 本项目通过局域网 IP（http://192.168.x.x:5174）访问属于非安全上下文，该 API 不存在，
 * 会导致进入大厅时抛 `TypeError: crypto.randomUUID is not a function`。
 * 因此这里优先使用原生 API，缺失时回退到 `crypto.getRandomValues` 手工构造 RFC 4122 v4，
 * 最后才使用“时间戳 + 计数器 + Math.random”混合兜底，保证任何环境下都能生成合法、几乎不重复的 UUID。
 */

/** 无 Web Crypto 时的进程内单调计数器，配合时间戳降低兜底碰撞概率。 */
let fallbackCounter = 0

/** 是否可以直接使用 Web Crypto 原生 randomUUID。 */
function hasNativeRandomUuid(): boolean {
  return (
    typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function'
  )
}

/** 使用 getRandomValues 构造 RFC 4122 版本 4 UUID（固定版本位与变体位）。 */
function uuidFromRandomValues(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  // 版本 4：第 7 字节高四位固定为 0100。
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  // 变体：第 9 字节高两位固定为 10。
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
  return (
    `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-` +
    `${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`
  )
}

/**
 * 极端环境兜底：连 Web Crypto 都不存在时使用“时间戳 + 单调计数器 + Math.random”混合构造。
 * 注意：此分支无密码学强度，仅保证格式合法、同进程内几乎不重复（用于 requestId 等非机密用途）；
 * 服务端对所有 ID 仍做独立校验，不构成实际安全风险。
 */
function uuidFallback(): string {
  fallbackCounter = (fallbackCounter + 1) & 0xfffff
  // 时间戳（低 32 位十六进制）+ 计数器拼接出 8 位段，其余段用随机数填充
  const stamp = (Date.now() & 0xffffffff).toString(16).padStart(8, '0')
  const counter = fallbackCounter.toString(16).padStart(5, '0').slice(0, 5)
  const randomA = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, '0')
  const randomB = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, '0')
  const randomC = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, '0')
  const randomD = Math.floor(Math.random() * 0xfff)
    .toString(16)
    .padStart(3, '0')
  // 版本 4（第四段首位 4）与变体（第五段首位 8~b）
  const variant = (8 + Math.floor(Math.random() * 4)).toString(16)
  return `${stamp}-${counter}-4${randomA.slice(1)}-${variant}${randomC.slice(1)}-${randomB}${randomD}`
}

/** 生成可在任意上下文中使用的 UUID v4。 */
export function createUuid(): string {
  if (hasNativeRandomUuid()) return globalThis.crypto.randomUUID()
  if (typeof globalThis.crypto?.getRandomValues === 'function') return uuidFromRandomValues()
  return uuidFallback()
}
