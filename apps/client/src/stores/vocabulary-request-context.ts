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

  accepts(
    context: VocabularyRequestContext,
    state: VocabularyContextState,
    responsePackageId: string,
  ): boolean {
    return (
      context.operationId === this.operationId &&
      context.sessionGeneration === state.sessionGeneration &&
      context.roomId === state.roomId &&
      (!context.packageId || context.packageId === responsePackageId)
    )
  }

  invalidate(): void {
    this.operationId += 1
  }
}
