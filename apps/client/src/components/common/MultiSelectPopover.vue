<!--
  多选筛选弹层组件（可复用，基于 ActionPopover 外壳）。
  职责：一个「触发按钮 + 多选弹层」的受控筛选器——
  - 词库管理的「显示字段」（列显隐）与「分类/难度」筛选均由本组件承载；
  - 触发按钮默认展示当前标签 + 已选数量徽章（选中数 > 0 时高亮）；
    也支持 iconOnly 模式：只展示图标，语义通过悬浮 title 与无障碍标签表达；
  - 弹层内提供「全选/全不选」切换按钮与滚动复选列表，点选即时上抛（父组件持有选中集合）。
  通用性：options 与全部文案/语义标签由调用方给定（值 + 展示文案），组件不感知业务字段含义，
  任何「枚举值多选」场景（如将来的战绩筛选）都可直接复用。
-->
<script setup lang="ts">
import { computed, type Component } from 'vue'
import { ChevronDown, Filter } from 'lucide-vue-next'
import ActionPopover from '@/components/common/ActionPopover.vue'

/** 单个可选项：value 为业务值（受控集合内唯一），label 为展示文案 */
export interface MultiSelectOption {
  value: string
  label: string
}

const props = withDefaults(
  defineProps<{
    /** 触发按钮与弹层的语义标签（如「全部分类」「显示字段」） */
    label: string
    /** 可选项列表 */
    options: MultiSelectOption[]
    /** 当前选中值集合（受控：父组件持有并回传，组件不做内部状态） */
    selected: string[]
    /** 触发按钮的无障碍标签（如「按分类筛选」「显示字段」），语义由调用方注入 */
    triggerAria: string
    /** 弹层「全选」按钮文案 */
    selectAllLabel: string
    /** 弹层「全不选」按钮文案（已全选时点击切换为全不选） */
    deselectAllLabel: string
    /** 弹层关闭按钮文案 */
    doneLabel: string
    disabled?: boolean
    /** 纯图标触发模式：只显示图标，语义由悬浮 title 与 aria 标签表达 */
    iconOnly?: boolean
    /** 纯图标模式下展示的图标；缺省用通用筛选图标 */
    icon?: Component
    /** 图标是否高亮（选中数 > 0 时表示筛选生效中） */
    highlight?: boolean
    /** 弹出方向：缺省向上；位于对话框/页面顶部时传 'bottom' 避免被裁剪（见 ActionPopover） */
    placement?: 'top' | 'bottom'
  }>(),
  { disabled: false, iconOnly: false, icon: undefined, highlight: false, placement: 'top' },
)

const emit = defineEmits<{
  /** 选中集合变化：返回新的完整数组（由父组件写回受控状态） */
  'update:selected': [values: string[]]
}>()

// 已选数量（用于触发按钮徽章）
const selectedCount = computed(() => props.selected.length)

/** 当前是否已选中全部选项：决定「全选/全不选」切换按钮的文案与行为 */
const allSelected = computed(
  () => props.options.length > 0 && props.selected.length === props.options.length,
)

// 悬浮提示文案：iconOnly 模式下承载完整语义（如「分类 · 2」），有文字时仅作补充说明。
const triggerTitle = computed(() =>
  selectedCount.value ? `${props.label} · ${selectedCount.value}` : props.label,
)

/** 切换单个选项：保持父组件集合语义不变，仅增删一项。 */
function toggleOption(value: string): void {
  const next = props.selected.includes(value)
    ? props.selected.filter((item) => item !== value)
    : [...props.selected, value]
  emit('update:selected', next)
}

/**
 * 全选/全不选切换：已全选时一次点击清空，否则选中全部选项。
 * 单一按钮承载两个状态，替代原先「全选 + 清空」两个按钮。
 */
function toggleSelectAll(): void {
  emit('update:selected', allSelected.value ? [] : props.options.map((option) => option.value))
}
</script>

<template>
  <ActionPopover
    :trigger-label="props.triggerAria"
    :panel-aria-label="label"
    :disabled="disabled"
    :placement="placement"
    :trigger-title="triggerTitle"
    align="start"
  >
    <template #trigger>
      <!-- iconOnly：只展示图标（悬浮说明见触发按钮 title）；常规：图标 + 文字 + 箭头 -->
      <span
        v-if="props.iconOnly"
        class="flex items-center"
        :class="highlight && selectedCount ? 'text-blue' : 'text-muted'"
      >
        <component :is="props.icon ?? Filter" class="h-[1.6cqh] w-[1.6cqh]" aria-hidden="true" />
      </span>
      <span v-else class="flex items-center gap-[0.3em]">
        <Filter class="h-[1.35cqh] w-[1.35cqh]" aria-hidden="true" />
        <!-- 未选中时展示默认文案（如「全部分类」），选中后展示「分类 · 2」强调生效中 -->
        <span class="max-w-[9cqw] truncate">{{
          selectedCount ? `${label} · ${selectedCount}` : label
        }}</span>
        <ChevronDown class="h-[1.2cqh] w-[1.2cqh]" aria-hidden="true" />
      </span>
    </template>
    <template #default="{ close }">
      <div class="flex flex-col gap-[0.5cqh]" role="group" :aria-label="label">
        <!-- 快捷操作：全选/全不选切换（已全选时点击即全不选，反之亦然） -->
        <div class="flex items-center border-b-[0.14cqh] border-b-line pb-[0.5cqh]">
          <button
            type="button"
            class="rounded-[0.4em] bg-line px-[0.55em] py-[0.25cqh] text-[0.62em] font-extrabold text-blue hover:bg-sky"
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
            class="flex min-h-[2.6cqh] cursor-pointer items-center gap-[0.45em] rounded-[0.4em] px-[0.45em] py-[0.2cqh] text-[0.66em] font-bold text-navy hover:bg-sky"
          >
            <input
              type="checkbox"
              class="h-[1.5cqh] w-[1.5cqh] accent-blue"
              :checked="props.selected.includes(option.value)"
              @change="toggleOption(option.value)"
            />
            <span class="min-w-0 flex-1 truncate">{{ option.label }}</span>
          </label>
        </div>
        <!-- 关闭弹层（不改变已选内容；点选即时生效，无需确认按钮） -->
        <button
          type="button"
          class="min-h-[3cqh] rounded-[0.5em] bg-blue px-[0.8em] text-[0.66em] font-black text-white"
          @click="close()"
        >
          {{ props.doneLabel }}
        </button>
      </div>
    </template>
  </ActionPopover>
</template>
