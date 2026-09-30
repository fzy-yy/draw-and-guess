/** 词库异步操作上下文：阻止旧会话/旧房间/旧词库包响应回写当前 UI。 */
export interface VocabularyRequestContext {
  operationId: number
  sessionGeneration: number
  roomId: string
  packageId?: string
}

export interface VocabularyContextState {
  sessionGeneration: number
  roomId?: string
}

export class VocabularyRequestGuard {
  private operationId = 0

  begin(state: VocabularyContextState, packageId?: string): VocabularyRequestContext | undefined {
    if (!state.roomId) return undefined
    this.operationId += 1
    return {
      operationId: this.operationId,
      sessionGeneration: state.sessionGeneration,
      roomId: state.roomId,
      ...(packageId ? { packageId } : {}),
    }
  }

  /**
   * 迟到响应回写前的四重守卫：每条拦截不同的失效场景，缺一都会让旧响应污染当前 UI。
   */
  accepts(
    context: VocabularyRequestContext,
    state: VocabularyContextState,
    responsePackageId: string,
  ): boolean {
    return (
      // operationId：begin/invalidate 之外的同上下文并发——只认最后一次操作，
      // 更早发起、更晚返回的响应不得覆盖新操作的结果。
      context.operationId === this.operationId &&
      // 会话世代：operationId 已最新时仍必须独立校验——计数只在 begin/invalidate 推进，
      // 而注销、会话失效重置等状态变化可经快照推送等非 begin/invalidate 路径发生，
      // 此时计数器不变、世代已变，旧身份的迟到响应依然非法。
      context.sessionGeneration === state.sessionGeneration &&
      // 房间：换房后旧房间的响应不得写进当前房间的词库 UI（同理，房间经非本守卫路径变化）。
      context.roomId === state.roomId &&
      // 包 ID：请求绑定了具体词库包时，响应回显的包与请求目标不一致说明串线或已切换。
      (!context.packageId || context.packageId === responsePackageId)
    )
  }

  invalidate(): void {
    this.operationId += 1
  }
}
