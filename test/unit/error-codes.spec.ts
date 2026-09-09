import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ERROR_CODES, type ErrorCode } from '@draw-guess/shared'
import { serverErrorMessages } from '@draw-guess/strings'
import { failure, GameError } from '../../apps/server/src/errors.ts'
import { getErrorRecoveryAction } from '../../apps/client/src/stores/error-recovery.ts'

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(?:ts|vue)$/u.test(entry.name) ? [path] : []
  })
}

function captures(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((match) => match[1]!).filter(Boolean)
}

describe('共享错误码注册表', () => {
  it('错误码唯一，且每个错误码都有非空安全默认文案', () => {
    const codes = Object.values(ERROR_CODES)
    expect(new Set(codes).size).toBe(codes.length)
    expect(Object.keys(serverErrorMessages).sort()).toEqual([...codes].sort())
    for (const code of codes) expect(serverErrorMessages[code].trim()).not.toBe('')
  })

  it('failure 保留登记的业务错误，并把未知异常收敛为 INTERNAL_ERROR', () => {
    expect(failure(new GameError(ERROR_CODES.INVALID_PHASE), 'business')).toEqual({
      ok: false,
      error: {
        code: ERROR_CODES.INVALID_PHASE,
        message: serverErrorMessages.INVALID_PHASE,
      },
      requestId: 'business',
    })
    expect(failure(new Error('包含内部路径 C:\\secret'), 'internal')).toEqual({
      ok: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: serverErrorMessages.INTERNAL_ERROR,
      },
      requestId: 'internal',
    })
  })

  it('客户端只为需要改变恢复策略的错误码返回特殊动作', () => {
    expect(getErrorRecoveryAction(ERROR_CODES.PROTOCOL_MISMATCH)).toBe('require-upgrade')
    expect(getErrorRecoveryAction(ERROR_CODES.DRAW_BUDGET_EXCEEDED)).toBe('warn-drawing-budget')
    expect(getErrorRecoveryAction(ERROR_CODES.UNAUTHORIZED)).toBeUndefined()
    expect(getErrorRecoveryAction(ERROR_CODES.INTERNAL_ERROR)).toBeUndefined()
  })

  it('生产源码中的字符串错误码全部已登记', () => {
    const roots = ['../../apps/server/src', '../../apps/client/src'].map((relative) =>
      fileURLToPath(new URL(relative, import.meta.url)),
    )
    const sources = roots.flatMap(sourceFiles).map((file) => readFileSync(file, 'utf8'))
    const stringCodes = sources.flatMap((source) => [
      ...captures(source, /new\s+GameError\(\s*'([A-Z][A-Z_]+)'/gu),
      ...captures(source, /\bcode:\s*'([A-Z][A-Z_]+)'/gu),
    ])
    const registered = new Set<ErrorCode>(Object.values(ERROR_CODES))
    expect(stringCodes.length).toBeGreaterThan(0)
    expect([...new Set(stringCodes)].filter((code) => !registered.has(code as ErrorCode))).toEqual(
      [],
    )
  })
})
