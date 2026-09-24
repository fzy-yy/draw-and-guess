/**
 * 音效系统统一出口。
 * 导出核心管理器、浏览器适配器、资源清单（可用性）、运行时组装、音效路由与类型。
 * 通用组件优先调用 playInteractionSound() 表达交互语义；只有全局领域反馈
 * 才直接使用具体 SoundName，避免资源键散落在视图层。
 */
export * from './types.ts'
export * from './contracts.ts'
export * from './assets.ts'
export * from './manifest.ts'
export * from './runtime.ts'
export * from './routing.ts'
export * from './manager.ts'
export * from './browser-adapter.ts'
