---
title: Vue 组件开发规范
description: 写或改任何 .vue 组件、composable、Vue + Tailwind 样式之前读本文。含规则表、复制即用模板、反例索引、交付自检清单。
stack: Vue 3.5+ / <script setup lang="ts"> / Composition API / Tailwind CSS v4 / class-variance-authority / tailwind-merge
applies_to:
  - '**/*.vue'
  - 'src/composables/**/*.ts'
  - 'src/lib/**/*.ts'
---

# Vue 组件开发规范

## 0. 怎么用这份文档

| 场景                       | 动作                                                              |
| -------------------------- | ----------------------------------------------------------------- |
| 新建或修改组件、composable | 先读第 1、2 节；模板直接复制第 4 节                               |
| 写 Tailwind 类名           | 额外读第 5 节                                                     |
| 交付前                     | 逐条过第 7 节自检清单，全勾才算完成；回复中说明「自检清单已通过」 |
| 对 API 有疑问              | 按第 8 节链接查官方文档，不凭记忆写                               |

术语（贯穿全文的锚点）：**契约**、**四个插座**、**五态**、**容器/展示**、**派生优于同步**、**类名字面量**、**class 合并**、**变体表**、**令牌**。

---

## 1. 硬性约束

### 1.1 MUST（违反即缺陷）

| 编号 | 规则                                                                                       | 理由                                                            |
| ---- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| M1   | 组件的对外接口只由**四个插座**构成：props、事件（含 `v-model`）、插槽、`defineExpose`      | 契约之外的一切都是实现细节，可随时替换                          |
| M2   | props 用 `defineProps<T>()` 逐字段声明类型与默认值；枚举写成联合类型                       | prop 定义即组件文档，用错在编辑器就报错                         |
| M3   | 子组件不写 `props.x = …`；改值一律经 `defineModel()` 或 `emit()` 交给父级                  | 单向数据流；两份真相源必然不同步                                |
| M4   | 用 `defineEmits<T>()` 声明全部事件并标注参数类型                                           | 未声明的事件监听器会透传到根元素，与根元素原生监听器同时触发    |
| M5   | 单根组件把 `class` 声明为 prop，用 `cn()` 合并；其余属性用 `v-bind="$attrs"` 落到根元素    | 外部 class 只能靠 twMerge 精确覆盖，透传合并只是字符串拼接      |
| M6   | 列表渲染必带稳定唯一 `key`（业务 id）；禁用 index 作 key                                   | 排序/过滤/删除时 DOM 复用错位，子组件内部状态串行               |
| M7   | Tailwind 类名一律写成完整字面量（`text-primary`），禁止拼接或插值（`` `text-${c}-600` ``） | Tailwind 把源码当纯文本扫描，拼出来的类名不会生成 CSS           |
| M8   | Tailwind 冲突用 `cn()` 解决；`!` 修饰符只用于覆盖第三方库样式                              | 冲突类「样式表里靠后者胜」，与 `class` 书写顺序无关             |
| M9   | SFC `<style>` 内使用 `@apply` / `@variant` 前必须 `@reference`                             | v4 的 `@apply` 不再全局可解析，否则构建报 unknown utility class |
| M10  | 定时器、订阅、请求等副作用在 `tryOnScopeDispose()` 或 `onWatcherCleanup()` 中清理          | 组件销毁后写入状态 = 内存泄漏 + 幽灵更新                        |
| M11  | 绝不在同一元素上同时使用 `v-if` 与 `v-for`                                                 | Vue 3 中 `v-if` 优先级更高，此时的循环变量还不存在              |
| M12  | 组件文件名与组件名均为多词 PascalCase；业务无关基础件用 `Base` 前缀                        | 避免与 HTML 元素冲突；排序后同类文件聚在一起                    |

### 1.2 SHOULD（默认遵守，例外需说明理由）

| 编号 | 规则                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------- |
| S1   | 扩展点优先级：**变体枚举 > 插槽 > 布尔 props**。布尔 props 超过 2 个即改为变体                                      |
| S2   | 结构可变的 UI 用组合式子组件（`BaseCard` + `BaseCardHeader`），不用 `title/extra/showFooter` 这类配置 props         |
| S3   | 能 `computed` 推出来的值不新增 `ref` 再 `watch` 同步（**派生优于同步**）                                            |
| S4   | 容器（取数/编排/副作用）与展示（`props → 模板`，无副作用）分开成两个组件                                            |
| S5   | 命名从高层词到修饰词：`SearchButtonClear` 而非 `ClearSearchButton`；强耦合子件带父名前缀 `TodoListItem`             |
| S6   | 接口返回的大对象用 `shallowRef`，不整棵响应式代理                                                                   |
| S7   | composable 用 options 对象收参数，便于向后兼容地新增选项；异步 composable 返回 `PromiseLike` 时可 `await`           |
| S8   | 含请求/校验/订阅的逻辑抽到 `src/composables/`，组件只负责渲染                                                       |
| S9   | 变体名语义化（`danger` 而非 `red`）；颜色/圆角/字号从 `@theme` 令牌出（`bg-primary`），不写 arbitrary value         |
| S10  | 交互态用 Tailwind 变体表达（`hover:` / `focus-visible:` / `disabled:` / `aria-*` / `data-*`），不用 JS 切状态 class |
| S11  | composable 内部 `watch` 的 `immediate` / `flush` 作为可配置项透出                                                   |
| S12  | 组件内不写 `console.log`；错误经插槽或状态向外表达                                                                  |

---

## 2. 心智模型

### 2.1 四个插座

| 插座           | 方向                | 用途                                     | 典型签名                                |
| -------------- | ------------------- | ---------------------------------------- | --------------------------------------- |
| props          | 父 → 子（只读）     | 数据入参                                 | `defineProps<T>()`                      |
| 事件 / v-model | 子 → 父             | 变更意图上行、双向绑定                   | `defineEmits<T>()` / `defineModel<T>()` |
| 插槽           | 父 → 子的模板       | 结构级扩展（唯一能改「长什么样」的插座） | `defineSlots<T>()`                      |
| expose         | 子 → 父的命令式调用 | focus / validate / reset 等少量逃生口    | `defineExpose({ focus })`               |

判断一个组件能不能扩展，就看这四个插座开得对不对。只开了 props，就是把组件做成了「配置项一堆、结构改不动」的死件。

### 2.2 契约优先

先写 `defineProps` / `defineEmits` / `defineSlots` 的类型块，再写模板和实现。类型块写完，调用方应当**不看实现**就能正确使用该组件。

### 2.3 五态齐全

任何数据驱动组件都要显式处理五态，且五态就地表达、互相排斥：

| 状态        | 表现                                                          |
| ----------- | ------------------------------------------------------------- |
| loading     | `role="status"` 占位，可被 `#loading` 插槽覆盖                |
| empty       | 空态文案/引导，可被 `#empty` 插槽覆盖                         |
| error       | 错误提示 + 重试入口                                           |
| data        | 正常内容                                                      |
| interactive | 禁用 / 加载中禁止提交等交互约束（在组件内合成，不交给调用点） |

---

## 3. 工作流（6 步，逐步给出完成判据）

1. **定类型**：判定这是基础件（`Base*`，无业务无全局状态）、展示组件还是容器组件。
   _完成判据_：能一句话说出它的单一职责，并明确回答「它是否允许有副作用」。
2. **定契约**：写 `defineProps<T>()`、`defineEmits<T>()`、`defineSlots<T>()`、`defineModel<T>()` 类型块。
   _完成判据_：类型块齐备，且没有任何一个「用于控制内部结构」的布尔 prop（有则改为插槽或变体）。
3. **抽逻辑**：含请求、定时器、订阅、校验时，抽到 `src/composables/`。
   _完成判据_：组件文件内不出现 `fetch` / `setInterval` / `addEventListener`，逻辑可脱离组件单测。
4. **写模板**：五态齐全，`key` 唯一稳定，默认渲染可被插槽覆盖，无 `v-if` + `v-for` 同元素。
   _完成判据_：五种状态都能在页面上实际触发并观察到。
5. **写样式**：变体表（`cva`）+ `cn()` + `class` prop 透传。
   _完成判据_：外部传任意 class 都能覆盖默认样式，全程无需 `!` 修饰符。
6. **验证**：类型检查通过（`vue-tsc --noEmit` 或项目等价命令），并逐条勾完第 7 节清单。
   _完成判据_：清单全勾 + 实际运行页面确认改动生效。

---

## 4. 模板库（复制即用）

### 4.0 目录与命名

```text
src/
├─ components/
│  ├─ base/                     # 基础件：只依赖 HTML 与其它 base 组件，无业务、无 store
│  │  ├─ BaseButton.vue
│  │  ├─ BaseCard.vue
│  │  ├─ BaseCardHeader.vue
│  │  └─ BaseDataList.vue
│  └─ user/                     # 业务组件
│     └─ UserList.vue
├─ composables/useAsyncTask.ts
├─ lib/utils.ts                 # cn()
└─ pages/UserListPage.vue       # 容器
```

### 4.1 `src/lib/utils.ts` — class 合并（一切样式的基础）

```ts
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * 合并 Tailwind 类名。
 * clsx 负责条件类名（对象/数组/假值），twMerge 负责消解同属性冲突（保留后者）。
 * 组件默认样式 + 使用方传入的 class 经它合并后，冲突时以使用方为准。
 * 版本配对：tailwind-merge v3 对应 Tailwind v4。
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
```

### 4.2 `components/base/BaseButton.vue`

```vue
<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * 变体表：所有类名都是完整字面量，Tailwind 扫描源码才能生成对应 CSS。
 * 基础段只放与 variant/size 无关的公共样式，避免变体之间互相覆盖。
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ' +
    'disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
        secondary: 'bg-surface-muted text-foreground hover:bg-surface-muted/80',
        ghost: 'bg-transparent text-foreground hover:bg-surface-muted',
        danger: 'bg-danger text-white hover:bg-danger/90',
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-6 text-base',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

/** 从变体表反推类型：新增变体时 props 类型自动同步，不手写联合类型 */
type ButtonVariantProps = VariantProps<typeof buttonVariants>

interface Props {
  /** 视觉变体，语义化命名（danger 而非 red） */
  variant?: ButtonVariantProps['variant']
  /** 尺寸 */
  size?: ButtonVariantProps['size']
  /** 占满父容器宽度 */
  block?: boolean
  /** 加载中：禁止交互并标记 aria-busy */
  loading?: boolean
  /** 禁用 */
  disabled?: boolean
  /** 原生 type，默认 button，避免在 form 中意外提交 */
  type?: 'button' | 'submit' | 'reset'
  /** 使用方追加的类名，冲突时覆盖组件默认样式 */
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  block: false,
  loading: false,
  disabled: false,
  type: 'button',
})

/** 类名三段式：变体 → 状态 → 外部 class（外部最后，冲突时胜出） */
const classes = computed(() =>
  cn(
    buttonVariants({ variant: props.variant, size: props.size }),
    props.block && 'w-full',
    props.class,
  ),
)

/** 交互约束在组件内合成，调用点不可能遗漏 */
const isDisabled = computed(() => props.disabled || props.loading)

/** 只暴露最小命令式 API，不泄漏内部状态与 DOM */
const el = useTemplateRef<HTMLButtonElement>('el')
defineExpose({ focus: () => el.value?.focus() })
</script>

<template>
  <!--
    单根节点：class 已声明为 prop（不走透传），其余属性经 $attrs 落到真实 button 上。
  -->
  <button
    ref="el"
    :type="type"
    :class="classes"
    :disabled="isDisabled"
    :aria-busy="loading || undefined"
    v-bind="$attrs"
  >
    <span
      v-if="loading"
      class="size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
      aria-hidden="true"
    />
    <slot />
  </button>
</template>
```

> **已知取舍（已实测）**：从 `cva` 变体表派生的类型（`VariantProps<typeof buttonVariants>`）**无法**被 SFC 编译器解析成运行时类型，编译产物是 `variant: { type: null }` / `size: { type: null }`（`@vue/compiler-sfc` 3.5.43 实测；变体表放同文件或独立 `.ts` 文件结果一致）；写成显式联合类型才得到 `type: String`。
> 这里选「类型派生」：调用点的错误由 TS 拦截，换来变体表单一真相源、零漂移。代价是基于类型的 props 声明不支持 `validator` —— 运行时校验与类型派生只能二选一，TS 项目选后者。

### 4.3 `components/base/BaseDataList.vue` — 泛型 + 作用域插槽

```vue
<script setup lang="ts" generic="T extends { id: string | number }">
import { cn } from '@/lib/utils'

/**
 * 泛型列表：只负责列表骨架与五态，每行长什么样交给使用方。
 * T 由 items 推断，使用方 #default 里的 item 具备完整类型提示。
 */
interface Props {
  /** 数据源 */
  items: T[]
  /** 是否加载中 */
  loading?: boolean
  /** 空态文案 */
  emptyText?: string
  /** 行 key 提取函数，默认取 item.id */
  rowKey?: (item: T) => string | number
  /** 使用方追加的类名 */
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  emptyText: '暂无数据',
})

const emit = defineEmits<{ rowClick: [item: T] }>()

/** 插槽类型声明：调用方写 #default 时获得 { item, index } 的类型与补全 */
defineSlots<{
  default?: (slotProps: { item: T; index: number }) => any
  empty?: () => any
}>()

const keyOf = (item: T) => props.rowKey?.(item) ?? item.id
</script>

<template>
  <div :class="cn('divide-y divide-border', props.class)">
    <!-- 五态就地表达：加载 / 空 / 数据三态互斥，避免 v-if 与 v-for 同元素 -->
    <div v-if="loading" role="status" class="p-6 text-center text-sm text-foreground/60">
      加载中…
    </div>

    <template v-else-if="items.length === 0">
      <slot name="empty">
        <div class="p-6 text-center text-sm text-foreground/60">{{ emptyText }}</div>
      </slot>
    </template>

    <template v-else>
      <div
        v-for="(item, index) in items"
        :key="keyOf(item)"
        class="cursor-pointer p-3 transition-colors hover:bg-surface-muted"
        @click="emit('rowClick', item)"
      >
        <slot :item="item" :index="index" />
      </div>
    </template>
  </div>
</template>
```

调用方渲染一种全新的行样式，只改调用点：

```vue
<BaseDataList :items="users" :loading="loading" @row-click="openUser">
  <template #default="{ item }">
    <div class="flex items-center gap-3">
      <img :src="item.avatar" :alt="item.name" class="size-8 rounded-full" />
      <span class="font-medium">{{ item.name }}</span>
    </div>
  </template>
</BaseDataList>
```

### 4.4 `src/composables/useAsyncTask.ts`

```ts
import { ref, shallowRef, tryOnScopeDispose } from 'vue'

/**
 * 通用异步任务：把请求、状态、竞态与清理从组件搬出来。
 * 收益：组件只管渲染；本函数可脱离组件单测；只接受最后一次请求的结果；
 *      作用域销毁时自动中止请求，不会向已销毁组件写入。
 */
export function useAsyncTask<TArgs extends unknown[], TData>(
  /** 任务实现：首参为 AbortSignal，便于真正取消请求 */
  task: (signal: AbortSignal, ...args: TArgs) => Promise<TData>,
) {
  // 接口大对象用 shallowRef，不做深度代理
  const data = shallowRef<TData>()
  const error = shallowRef<unknown>(null)
  const loading = ref(false)

  let seq = 0
  let controller: AbortController | undefined

  async function run(...args: TArgs): Promise<TData | undefined> {
    const current = ++seq
    controller?.abort() // 取消上一次未完成的请求
    controller = new AbortController()
    loading.value = true
    error.value = null
    try {
      const result = await task(controller.signal, ...args)
      if (current === seq) data.value = result // 过期结果直接丢弃
      return result
    } catch (e) {
      if (current === seq) error.value = e
      throw e
    } finally {
      if (current === seq) loading.value = false
    }
  }

  tryOnScopeDispose(() => controller?.abort())

  return { data, error, loading, run }
}
```

### 4.5 容器 / 展示分离

```vue
<!-- pages/UserListPage.vue —— 容器：取数、编排、路由副作用 -->
<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAsyncTask } from '@/composables/useAsyncTask'
import { fetchUsers, type User } from '@/api/user'
import UserList from '@/components/user/UserList.vue'

const router = useRouter()
const { data: users, loading, run } = useAsyncTask(fetchUsers)

onMounted(() => void run())

const openUser = (user: User) => router.push({ name: 'user-detail', params: { id: user.id } })
</script>

<template>
  <UserList :users="users ?? []" :loading="loading" @select="openUser" />
</template>
```

```vue
<!-- components/user/UserList.vue —— 展示：props → 模板，无副作用，可快照测试 -->
<script setup lang="ts">
import type { User } from '@/api/user'
import BaseDataList from '@/components/base/BaseDataList.vue'

const props = defineProps<{ users: User[]; loading?: boolean; class?: string }>()
const emit = defineEmits<{ select: [user: User] }>()
</script>

<template>
  <BaseDataList
    :items="props.users"
    :loading="props.loading"
    :class="props.class"
    @row-click="emit('select', $event)"
  >
    <template #default="{ item }">
      <span class="font-medium">{{ item.name }}</span>
      <span class="ml-2 text-sm text-foreground/60">{{ item.email }}</span>
    </template>
    <template #empty>还没有用户，去邀请一个吧</template>
  </BaseDataList>
</template>
```

### 4.6 组合式子组件（结构可变时用）

```vue
<!-- components/base/BaseCard.vue -->
<script setup lang="ts">
import { cn } from '@/lib/utils'
const props = defineProps<{ class?: string }>()
</script>

<template>
  <div :class="cn('rounded-xl border border-border bg-surface shadow-sm', props.class)">
    <slot />
  </div>
</template>
```

```vue
<!-- components/base/BaseCardHeader.vue -->
<script setup lang="ts">
import { cn } from '@/lib/utils'
const props = defineProps<{ class?: string }>()
</script>

<template>
  <header
    :class="
      cn('flex items-center justify-between gap-3 border-b border-border px-4 py-3', props.class)
    "
  >
    <slot />
  </header>
</template>
```

```vue
<!-- 调用：结构由调用点决定，新增需求不改组件 -->
<BaseCard class="max-w-md">
  <BaseCardHeader>
    <h2 class="text-base font-semibold">季度报告</h2>
    <BaseButton size="sm" variant="ghost" @click="exportReport">导出</BaseButton>
  </BaseCardHeader>
  <div class="px-4 py-3 text-sm text-foreground/70">…</div>
</BaseCard>
```

---

## 5. Vue + Tailwind 专项

### 5.1 装配（v4 为 CSS-first，无 `tailwind.config.js`）

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite' // v4 官方 Vite 插件，无需 postcss 配置

export default defineConfig({
  plugins: [vue(), tailwindcss()],
})
```

```css
/* src/assets/main.css */
@import 'tailwindcss';

/* 令牌集中在此：组件里只写 bg-primary / border-border，不散落 oklch(...) 与 arbitrary value */
@theme {
  --color-primary: oklch(0.55 0.18 255);
  --color-primary-foreground: oklch(0.99 0 0);
  --color-surface: oklch(1 0 0);
  --color-surface-muted: oklch(0.96 0.005 255);
  --color-border: oklch(0.9 0.01 255);
  --color-foreground: oklch(0.2 0.02 255);
  --color-danger: oklch(0.58 0.2 25);
}

/* 类名驱动的暗色模式（v4 写法）：<html class="dark"> */
@custom-variant dark (&:where(.dark, .dark *));
```

类名写在自动扫描范围之外（monorepo 的 UI 包）时追加：`@source "../packages/ui/src";`

### 5.2 为什么类名必须是字面量（M7 的机制）

Tailwind 把源码当纯文本扫描，**不理解字符串拼接**。拼接出的类名在生成阶段根本不存在，线上表现为样式整块丢失。

```vue
<!-- 类名字面量：变体表里的每一项都能被扫描到 -->
<script setup lang="ts">
const toneClass = {
  primary: 'text-primary',
  danger: 'text-danger',
} as const
</script>
<template>
  <span :class="toneClass[tone]" />
</template>
```

```css
/* src/assets/main.css —— 兜底：类名确实无法静态枚举时整行写出安全列表，而不是拼接 */
@source inline("bg-primary bg-danger text-white");
```

### 5.3 为什么必须用 twMerge（M8 的机制）

同属性冲突类同时存在时，胜负由**生成的样式表顺序**决定，与 `class` 属性的书写顺序无关。透传合并（父 class + 子 class 拼接）不做冲突消解，所以基础件的 `class` 必须声明为 prop 并用 `cn()` 合并：

```vue
<!-- 缺 class prop 时的破窗写法：使用方只能靠 ! 或 :deep() 改样式 -->
<BaseButton class="!p-2" />
```

### 5.4 SFC 内使用 `@apply`（M9）

```vue
<style scoped>
/* 引入主样式作为参考：不重复输出 CSS，只让 @apply 能解析到令牌与自定义工具类 */
@reference "../../assets/main.css";

.legacy-table {
  @apply w-full border-collapse text-sm;
}
</style>
```

`@apply` 的适用场景：覆盖第三方库的既有类。业务 UI 的复用走组件与插槽（S2），不走自定义类。

### 5.5 动态值：CSS 变量而非动态类名

颜色来自接口/主题时，用内联 CSS 变量 + `bg-(--x)` 语法：

```vue
<template>
  <div
    class="rounded-lg bg-(--brand) p-4 text-(--brand-fg)"
    :style="{ '--brand': theme.bg, '--brand-fg': theme.fg }"
  >
    品牌化卡片
  </div>
</template>
```

---

## 6. 反例索引（按症状查规则编号）

| 症状                                                       | 规则    | 正确写法                                                |
| ---------------------------------------------------------- | ------- | ------------------------------------------------------- |
| `props.list.push(x)` / `props.x = 1`                       | M3      | `defineModel()` 或 `emit('update:x', 1)`                |
| 事件类型写错、少传参数不报错                               | M4      | `defineEmits<{ change: [id: number] }>()`               |
| `<BaseButton class="!p-2" />`、满屏 `:deep()`              | M5 / M8 | 组件声明 `class` prop + `cn()`                          |
| 排序后输入框内容串行、动画错乱                             | M6      | `:key="item.id"`                                        |
| 线上样式整块丢失                                           | M7      | 类名字面量 + 变体表 / `@source inline()`                |
| 构建报 `Cannot apply unknown utility class`                | M9      | `<style>` 顶部 `@reference "…/main.css";`               |
| 切换路由后控制台仍打日志、旧请求覆盖新数据                 | M10     | `tryOnScopeDispose()` / `onWatcherCleanup()` + 请求序号 |
| 列表元素报错或过滤行为与直觉相反                           | M11     | 先 `computed` 过滤，再 `v-for`                          |
| 编辑器里 20 个同名 `index.vue`                             | M12     | 扁平化命名：`TodoList.vue` / `TodoListItem.vue`         |
| `<BaseButton is-primary is-danger is-loading />`           | S1      | `variant="danger" :loading="true"`                      |
| `<Card title extra :show-footer :footer-text />`           | S2      | `BaseCard` + `BaseCardHeader` + 插槽                    |
| `ref(props.items)` + `watch` 回写                          | S3 / M3 | `computed(() => props.items.filter(...))`               |
| 组件文件里 500 行 + `fetch` + 弹窗状态 + 三个页签 UI       | S4 / S8 | 容器 + composable + 展示组件                            |
| `getCurrentInstance().parent.exposed.submit()`             | M1 / M3 | 事件上行；确需命令式接口用 `defineExpose`               |
| 只处理了 data 态，加载/空/错误态散落各处                   | 2.3     | 五态在组件内就地表达，插槽可覆盖                        |
| `defineModel<number>({ default: 1 })` 且父级为 `undefined` | M2      | `{ required: true }`，或在父级给初值                    |
| 同一字符串内出现 `px-2 p-4` 冲突类                         | M8      | 冲突类交给 `cn()`，单字符串内只留唯一值                 |

---

## 7. 交付自检清单（全勾才算完成）

- [ ] props 逐字段有类型与默认值；枚举是联合类型或 `validator`
- [ ] 全部事件已声明且带参数类型
- [ ] 组件内没有对 props 的写入，没有 `$parent` / `getCurrentInstance().parent` 隐式通信
- [ ] 没有 index 作 `key`；没有 `v-if` 与 `v-for` 同元素
- [ ] 五态齐全，且默认渲染可被插槽覆盖
- [ ] 扩展点是变体/插槽，而非新增布尔 prop
- [ ] 请求、定时器、订阅在 composable 中，副作用有清理
- [ ] 派生值用 `computed`；接口大对象用 `shallowRef`
- [ ] 单根组件有 `class` prop + `cn()`，无需 `!` 修饰符即可覆盖样式
- [ ] 全部 Tailwind 类名为完整字面量，无拼接
- [ ] SFC `<style>` 内的 `@apply` 前有 `@reference`
- [ ] 命名符合多词 PascalCase + `Base` 前缀 + 词序约定
- [ ] 类型检查命令通过，且页面实际运行确认改动生效

---

## 8. 参考来源（存疑时查这些）

| 主题                                                              | 链接                                                           |
| ----------------------------------------------------------------- | -------------------------------------------------------------- |
| 风格指南（A 防错 / B 强烈推荐 / C 建议 / D 谨慎）                 | https://cn.vuejs.org/style-guide/                              |
| props 与响应式解构                                                | https://cn.vuejs.org/guide/components/props                    |
| 事件声明与校验                                                    | https://cn.vuejs.org/guide/components/events                   |
| 插槽（具名/作用域/条件）                                          | https://cn.vuejs.org/guide/components/slots                    |
| 组件 v-model 与 `defineModel`                                     | https://cn.vuejs.org/guide/components/v-model                  |
| 透传 attribute 与 `inheritAttrs`                                  | https://cn.vuejs.org/guide/components/attrs                    |
| Vue 3.5 新 API（`useId` / `useTemplateRef` / `onWatcherCleanup`） | https://blog.vuejs.org/posts/vue-3-5                           |
| composable 设计准则（Anthony Fu / VueUse）                        | https://vueuse.org/guidelines                                  |
| 工具类用法、去重策略、冲突处理                                    | https://tailwindcss.com/docs/styling-with-utility-classes      |
| `@theme` / `@reference` / `@source` / `@custom-variant`           | https://tailwindcss.com/docs/functions-and-directives          |
| 类名检测机制与 `@source inline()` 安全列表                        | https://tailwindcss.com/docs/detecting-classes-in-source-files |
