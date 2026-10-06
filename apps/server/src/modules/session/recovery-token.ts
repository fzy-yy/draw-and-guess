/**
 * 玩家身份恢复令牌 SHA-256 摘要工具。
 *
 * 遵循《后端架构规范》安全约束：
 * 数据库仅存储不可逆的 SHA-256 摘要（token_digest），原始明文令牌仅存在于服务端内存并回传给当前连接的客户端，
 * 每次成功恢复必须 CAS 旋转令牌并使旧摘要失效。
 */
import { createHash } from 'node:crypto'

/**
 * 计算恢复令牌的 SHA-256 哈希十六进制摘要。
 *
 * @param token 明文恢复令牌
 * @returns 64 位十六进制 SHA-256 摘要
 */
export function digestRecoveryToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}
