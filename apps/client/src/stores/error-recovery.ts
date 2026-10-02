/**
 * 错误码 → 客户端恢复动作映射登记表（stores 层的跨域共享裁决表）。
 *
 * 只有需要**改变客户端恢复策略**（升级拦截 / 选择性补弹 Toast）的错误码才进入本表；
 * 其余错误码一律返回 undefined，由调用方沿用服务端安全文案的默认处理。
 * 新增特殊错误码时：先在 shared 的 ERROR_CODES 登记，再加入本文件的
 * SPECIAL_ERROR_CODES 清单并补齐 getErrorRecoveryAction 的 case（漏 case 由
 * assertNever 在运行时兜底、由编译期穷尽检查在开发期拦截）。
 */
import { ERROR_CODES, type ErrorCode } from '@draw-guess/shared'

const SPECIAL_ERROR_CODES = [
  ERROR_CODES.PROTOCOL_MISMATCH,
  ERROR_CODES.DRAW_BUDGET_EXCEEDED,
  ERROR_CODES.DRAW_HISTORY_LIMIT_REACHED,
] as const satisfies readonly ErrorCode[]

type SpecialErrorCode = (typeof SPECIAL_ERROR_CODES)[number]
/**
 * warn-drawing-limit 只决定「容量类拒绝（点数/单笔/填充预算与命令数上限）是否由调用方
 * 补弹一次 Toast」；重试与否与这里无关——重试由调用方 request options 显式声明，
 * 且业务失败本来就不走传输重试。
 */
type ErrorRecoveryAction = 'require-upgrade' | 'warn-drawing-limit'

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
    case ERROR_CODES.DRAW_HISTORY_LIMIT_REACHED:
      return 'warn-drawing-limit'
    default:
      // 运行时不可达：isSpecialErrorCode 已把 code 收窄进 SPECIAL_ERROR_CODES，
      // 上方 case 全覆盖该联合；保留此分支只为防登记表增员而漏加 case 时静默吞掉。
      return assertNever(code)
  }
}
