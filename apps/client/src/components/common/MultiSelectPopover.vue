<!--
  多选筛选弹层组件（可复用，基于 ActionPopover 外壳）。
  职责：一个「纯图标触发按钮 + 多选弹层」的受控筛选器——
  词库管理弹窗的分类字段筛选由本组件承载。
  触发按钮只展示图标：语义通过悬浮 title（选中时含「标签 · 数量」）与无障碍标签表达；
  选中数 > 0 且调用方启用 highlight 时图标高亮，表示筛选生效中。
  弹层内提供「全选/全不选」切换按钮与滚动复选列表，点选即时上抛（父组件持有选中集合）。
  通用性：options 与全部文案/语义标签由调用方给定（值 + 展示文案），组件不感知业务字段含义，
  任何「枚举值多选」场景（如将来的战绩筛选）都可直接复用。
-->
<script setup lang="ts">
import { computed, type Component } from 'vue'
import { Filter } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { playInteractionSound } from '@/audio'
import ActionPopover from '@/components/common/ActionPopover.vue'

/** 单个可选项：value 为业务值（受控集合内唯一），label 为展示文案 */
export interface MultiSelectOption {
  value: string
  label: string
}

const props = withDefaults(
  defineProps<{
    /** 弹层与分组的语义标签（如「分类」），也是悬浮提示的展示基底 */
    label: string
    /** 可选项列表 */
    options: MultiSelectOption[]
    /** 当前选中值集合（受控：父组件持有并回传，组件不做内部状态） */
    selected: string[]
    /** 触发按钮的无障碍标签（如「按分类筛选」），语义由调用方注入 */
    triggerAria: string
    /** 弹层「全选」按钮文案 */
    selectAllLabel: string
    /** 弹层「全不选」按钮文案（已全选时点击切换为全不选） */
    deselectAllLabel: string
    disabled?: boolean
    /** 触发按钮图标；缺省用通用筛选图标 */
    icon?: Component
    /** 图标是否高亮（选中数 > 0 时表示筛选生效中） */
    highlight?: boolean
    /** 弹出方向：缺省向上；位于对话框/页面顶部时传 'bottom' 避免被裁剪（见 ActionPopover） */
    placement?: 'top' | 'bottom'
    /** 触发按钮形态：round 为默认圆形，pill 为图文胶囊 */
    variant?: 'round' | 'pill'
    /** 触发按钮文本（通常配合 pill 变体展示可见文字） */
    triggerText?: string
  }>(),
  {
    disabled: false,
    icon: undefined,
    highlight: false,
    placement: 'top',
    variant: 'round',
    triggerText: undefined,
  },
)

const emit = defineEmits<{
  /** 选中集合变化：返回新的完整数组（由父组件写回受控状态） */
  'update:selected': [values: string[]]
}>()

// 已选数量：驱动悬浮 title 的「标签 · 数量」文案与图标高亮判定（受控集合的长度，无本地徽章）。
const selectedCount = computed(() => props.selected.length)

/** 当前是否已选中全部选项：决定「全选/全不选」切换按钮的文案与行为 */
const allSelected = computed(
  () => props.options.length > 0 && props.selected.length === props.options.length,
)

// 悬浮提示文案：纯图标触发按钮靠它承载完整语义（如「分类 · 2」），未选中时仅展示标签。
const triggerTitle = computed(() =>
  selectedCount.value
    ? strings.ui.common.countBadge(props.label, selectedCount.value)
    : props.label,
)

/** 切换单个选项：保持父组件集合语义不变，仅增删一项。 */
function toggleOption(value: string): void {
  const next = props.selected.includes(value)
    ? props.selected.filter((item) => item !== value)
    : [...props.selected, value]
  emit('update:selected', next)
  playInteractionSound('select')
}

/**
 * 全选/全不选切换：已全选时一次点击清空，否则选中全部选项。
 * 单一按钮承载两个状态，替代原先「全选 + 清空」两个按钮。
 */
function toggleSelectAll(): void {
  emit('update:selected', allSelected.value ? [] : props.options.map((option) => option.value))
  playInteractionSound('select')
}
</script>

<template>
  <ActionPopover
    :trigger-label="props.triggerAria"
    :panel-aria-label="label"
    :disabled="disabled"
    :placement="placement"
    :trigger-title="triggerTitle"
    :variant="variant"
  >
    <template #trigger>
      <span
        class="inline-flex items-center gap-[0.4em]"
        :class="
          highlight && selectedCount ? 'text-blue' : variant === 'pill' ? 'text-navy' : 'text-muted'
        "
      >
        <component
          :is="props.icon ?? Filter"
          class="h-[2.2cqh] w-[2.2cqh] shrink-0 text-blue"
          aria-hidden="true"
        />
        <span v-if="triggerText" class="text-fs-12 font-bold leading-none">{{ triggerText }}</span>
      </span>
    </template>
    <template #default>
      <div class="flex flex-col gap-[0.5cqh]" role="group" :aria-label="label">
        <!-- 快捷操作：全选/全不选切换（已全选时点击即全不选，反之亦然） -->
        <div class="flex items-center border-b-[0.14cqh] border-b-line pb-[0.5cqh]">
          <button
            type="button"
            class="rounded-[0.4em] bg-line px-[0.55em] py-[0.25cqh] text-fs-10 font-bold text-blue hover:bg-sky"
            @click="toggleSelectAll"
          >
            {{ allSelected ? props.deselectAllLabel : props.selectAllLabel }}
          </button>
        </div>
        <!-- 复选列表：选项较多时限高滚动（如 40 个分类） -->
        <div
          class="flex max-h-[30cqh] flex-col gap-[0.2cqh] overflow-y-auto pr-[0.2em] scrollbar-gutter-stable"
        >
          <label
            v-for="option in options"
            :key="option.value"
            class="flex min-h-[2.6cqh] cursor-pointer items-center gap-[0.45em] rounded-[0.4em] px-[0.45em] py-[0.2cqh] text-fs-12 font-bold text-navy hover:bg-sky"
          >
            <input
              type="checkbox"
              class="h-[max(1.5cqh,16px)] w-[max(1.5cqh,16px)] accent-blue"
              :checked="props.selected.includes(option.value)"
              @change="toggleOption(option.value)"
            />
            <span class="min-w-0 flex-1 truncate">{{ option.label }}</span>
          </label>
        </div>
      </div>
    </template>
  </ActionPopover>
</template>
