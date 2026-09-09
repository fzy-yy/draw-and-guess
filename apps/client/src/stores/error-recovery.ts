import { ERROR_CODES, type ErrorCode } from '@draw-guess/shared'

const SPECIAL_ERROR_CODES = [
  ERROR_CODES.PROTOCOL_MISMATCH,
  ERROR_CODES.DRAW_BUDGET_EXCEEDED,
] as const satisfies readonly ErrorCode[]

type SpecialErrorCode = (typeof SPECIAL_ERROR_CODES)[number]
export type ErrorRecoveryAction = 'require-upgrade' | 'warn-drawing-budget'

function isSpecialErrorCode(code: ErrorCode | undefined): code is SpecialErrorCode {
  return code !== undefined && (SPECIAL_ERROR_CODES as readonly ErrorCode[]).includes(code)
}

function assertNever(value: never): never {
  throw new Error(`未处理的特殊错误码：${String(value)}`)
}

/** 只有需要改变客户端恢复策略的错误码进入穷尽分支；其余错误沿用服务端安全文案。 */
export function getErrorRecoveryAction(
  code: ErrorCode | undefined,
): ErrorRecoveryAction | undefined {
  if (!isSpecialErrorCode(code)) return undefined
  switch (code) {
    case ERROR_CODES.PROTOCOL_MISMATCH:
      return 'require-upgrade'
    case ERROR_CODES.DRAW_BUDGET_EXCEEDED:
      return 'warn-drawing-budget'
    default:
      return assertNever(code)
  }
}
