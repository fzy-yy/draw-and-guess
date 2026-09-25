/// <reference types="vite/client" />

/**
 * Vite 环境类型的唯一扩展点。
 *
 * vite/client 自带的 ImportMetaEnv 含 `[key: string]: any` 索引签名——直接读取自定义旗标
 * 会让值变成 any（启用 type-checked ESLint 后即报 no-unsafe-*）。在此显式声明项目实际使用的
 * 旗标后，具名属性优先于索引签名，读取处获得精确类型，无需再写 `import.meta as unknown as ...`。
 */
interface ImportMetaEnv {
  /** E2E/隔离构建注入 =1：暴露逻辑画布栅格哈希探针（默认生产构建不含该探针）。 */
  readonly VITE_EXPOSE_LOGICAL_CANVAS?: string
}
