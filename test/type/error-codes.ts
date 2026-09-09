import { expectTypeOf } from 'vitest'
import { ERROR_CODES, type Ack, type ErrorCode } from '@draw-guess/shared'
import { serverErrorMessages } from '@draw-guess/strings'
import { GameError } from '../../apps/server/src/errors.ts'
import type { RequestResult } from '../../apps/client/src/stores/request.ts'

expectTypeOf<(typeof ERROR_CODES)[keyof typeof ERROR_CODES]>().toEqualTypeOf<ErrorCode>()
expectTypeOf(serverErrorMessages).toMatchTypeOf<Record<ErrorCode, string>>()

const failureAck: Ack<never> = {
  ok: false,
  error: { code: ERROR_CODES.UNAUTHORIZED, message: '身份已失效' },
  requestId: 'request-1',
}
void failureAck

new GameError(ERROR_CODES.INVALID_PHASE)

const invalidAck: Ack<never> = {
  ok: false,
  error: {
    // @ts-expect-error 未登记错误码不能进入线上 ack
    code: 'NOT_REGISTERED',
    message: 'invalid',
  },
  requestId: 'request-2',
}
void invalidAck

// @ts-expect-error GameError 只接受共享注册表中的错误码
new GameError('NOT_REGISTERED')

const invalidRequestResult: RequestResult<never> = {
  ok: false,
  failureKind: 'business',
  error: 'invalid',
  // @ts-expect-error 客户端合成失败也必须先登记错误码
  code: 'NOT_REGISTERED',
  timeout: false,
}
void invalidRequestResult
