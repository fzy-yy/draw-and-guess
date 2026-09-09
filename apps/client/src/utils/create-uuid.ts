/**
 * 客户端安全 UUID 生成工具（改为依赖 nanoid）。
 *
 * 浏览器仅在“安全上下文”（HTTPS 或 localhost）中暴露 `crypto.randomUUID()`；
 * 本项目通过局域网 IP（http://192.168.x.x:5174）访问属于非安全上下文，该 API 不存在，
 * 之前因此手写了 `getRandomValues` 构造与 Math.random 兜底。
 * nanoid 内部使用 `crypto.getRandomValues`（在非安全上下文同样可用）且自带健壮随机源，
 * 可直接替代上述手写逻辑，无需再维护兜底分支。
 *
 * 注意：服务端对 `requestId`/`roomId` 使用 Zod `z.string().uuid()` 严格校验，
 * 而 nanoid 默认 `nanoid()` 输出为 21 位 URL 安全字符串（非 UUID），会触发校验失败。
 * 因此这里用 nanoid 的 hex 字母表生成随机十六进制串，再按 RFC 4122 v4 位点
 * （版本位固定为 4、变体位固定为 8~b）插入连字符，得到合法且能通过服务端校验的 UUID。
 */
import { customAlphabet } from 'nanoid'

/** nanoid 的十六进制字母表生成器：产出 32 位随机十六进制串（对应 16 字节）。 */
const hexId = customAlphabet('0123456789abcdef', 32)

/**
 * 生成可在任意上下文中使用、且能通过服务端 UUID 校验的 RFC 4122 版本 4 UUID。
 * 保持 `export function createUuid(): string` 签名不变，调用方无需感知底层实现差异。
 */
export function createUuid(): string {
  const source = hexId()
  // 固定版本位（下标 12 置为 4）与变体位（下标 16 置为 8），再按 8-4-4-4-12 插入连字符。
  const uuidHex = `${source.slice(0, 12)}4${source.slice(13, 16)}8${source.slice(17)}`
  return `${uuidHex.slice(0, 8)}-${uuidHex.slice(8, 12)}-${uuidHex.slice(12, 16)}-${uuidHex.slice(16, 20)}-${uuidHex.slice(20)}`
}
