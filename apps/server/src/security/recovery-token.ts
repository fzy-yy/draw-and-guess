import { createHash } from 'node:crypto'

/** 数据库只保存不可逆摘要；原始恢复令牌仅存在于服务端内存并返回给客户端。 */
export function digestRecoveryToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}
