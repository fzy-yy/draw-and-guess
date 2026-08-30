/**
 * 客户端安全 UUID 生成工具。
 *
 * 浏览器仅在“安全上下文”（HTTPS 或 localhost）中暴露 `crypto.randomUUID()`；
 * 本项目通过局域网 IP（http://192.168.x.x:5174）访问属于非安全上下文，该 API 不存在，
 * 会导致进入大厅时抛 `TypeError: crypto.randomUUID is not a function`。
 * 因此这里优先使用原生 API，缺失时回退到 `crypto.getRandomValues` 手工构造 RFC 4122 v4，
 * 最后才使用 `Math.random` 兜底，保证任何环境下都能生成合法 UUID。
 */

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

/** 极端环境兜底：非浏览器且无 Web Crypto 时使用随机数模板。 */
function uuidFallback(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (marker) => {
    const value = (Math.random() * 16) | 0
    return (marker === 'x' ? value : (value & 0x3) | 0x8).toString(16)
  })
}

/** 生成可在任意上下文中使用的 UUID v4。 */
export function createUuid(): string {
  if (hasNativeRandomUuid()) return globalThis.crypto.randomUUID()
  if (typeof globalThis.crypto?.getRandomValues === 'function') return uuidFromRandomValues()
  return uuidFallback()
}
