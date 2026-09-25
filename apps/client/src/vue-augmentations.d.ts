/**
 * vue-tsc `strictTemplates` 的透传属性放行声明。
 *
 * strictTemplates 会对「组件未声明的属性/事件」报编译错误，但本项目大量原语组件
 * （AppButton / BaseDialog / ConfirmDialog / IconButton…）的设计就是**透传包装**：
 * `aria-label`、`title`、`role`、`@click`、`@keydown` 等非声明属性经 $attrs 自动落到
 * 根元素，属合法惯用法（见 AGENTS「表单输入原语规范」与 ADR-0008 的浮层透传语义）。
 * 这里按 Vue 官方推荐方式扩展 ComponentCustomProps / HTMLAttributes 放行这些语义合法的
 * 透传，同时保留 strictTemplates 对**已声明 props 拼写、v-model 类型、未注册组件**等的
 * 严格校验（本次整改正是靠它抓出了 RulesDialog 的联合类型缺陷）。
 *
 * 文件必须是模块（含 export {}）：模块文件里的 `declare module 'x' {}` 才是「模块扩展」，
 * 脚本文件里同写法会变成整体替换该模块的「环境模块声明」，会遮蔽 vue 的真实类型。
 */

/** 自定义组件上允许透传的常见无障碍与交互属性（值类型取宽松并集，落点为根元素原生属性）。 */
declare module 'vue' {
  interface ComponentCustomProps {
    'aria-label'?: string
    'aria-labelledby'?: string
    'aria-describedby'?: string
    'aria-current'?: string | boolean
    'aria-expanded'?: boolean | string
    'aria-controls'?: string
    'aria-haspopup'?: boolean | string
    'aria-activedescendant'?: string
    'aria-selected'?: boolean | string
    'aria-pressed'?: boolean | string
    'aria-live'?: 'off' | 'polite' | 'assertive'
    'aria-hidden'?: boolean | string
    'aria-modal'?: boolean | string
    'aria-atomic'?: boolean | string
    'aria-sort'?: 'none' | 'ascending' | 'descending' | 'other'
    title?: string
    role?: string
    tabindex?: number | string
    onClick?: (event: MouseEvent) => void
    onKeydown?: (event: KeyboardEvent) => void
  }
}

/** 原生元素上允许 data-* 透传（strictTemplates 的已知痛点：HTMLAttributes 不含 data-* 索引）。 */
declare module '@vue/runtime-dom' {
  interface HTMLAttributes {
    [key: `data-${string}`]: unknown
  }
}

/** lucide 图标为函数式组件（props 不含 ReservedProps），v-for 的 :key 需在此放行。 */
declare module 'lucide-vue-next' {
  interface LucideProps {
    key?: string | number
  }
}

export {}
