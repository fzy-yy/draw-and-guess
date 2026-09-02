<!--
  多选筛选弹层组件（可复用，基于 ActionPopover 外壳）。
  职责：一个「触发按钮 + 多选弹层」的受控筛选器——
  - 词库管理的「显示字段」（列显隐）与「分类/难度/语言」筛选均由本组件承载；
  - 触发按钮展示当前标签 + 已选数量徽章（选中数 > 0 时高亮）；
  - 弹层内提供全选/清空快捷操作与滚动复选列表，点选即时上抛（父组件持有选中集合）。
  通用性：options 由调用方给定（值 + 展示文案），组件不感知业务字段含义，
  任何「枚举值多选」场景（如将来的战绩筛选）都可直接复用。
-->
<script setup lang="ts">
import { computed } from 'vue'
import { Check, ChevronDown, Filter } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import ActionPopover from '@/components/ActionPopover.vue'

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
    disabled?: boolean
  }>(),
  { disabled: false },
)

const emit = defineEmits<{
  /** 选中集合变化：返回新的完整数组（由父组件写回受控状态） */
  'update:selected': [values: string[]]
}>()

// 已选数量（用于触发按钮徽章）
const selectedCount = computed(() => props.selected.length)

/** 切换单个选项：保持父组件集合语义不变，仅增删一项。 */
function toggleOption(value: string): void {
  const next = props.selected.includes(value)
    ? props.selected.filter((item) => item !== value)
    : [...props.selected, value]
  emit('update:selected', next)
}

/** 全选：直接采用完整选项值列表（避免父组件自行拼装）。 */
function selectAll(): void {
  emit(
    'update:selected',
    props.options.map((option) => option.value),
  )
}

/** 清空：回到「不筛选」状态。 */
function clearAll(): void {
  emit('update:selected', [])
}
</script>

<template>
  <ActionPopover
    :trigger-label="strings.room.vocabFilterAria(label)"
    :panel-aria-label="label"
    :disabled="disabled"
    align="start"
  >
    <template #trigger>
      <span class="flex items-center gap-[0.3em]">
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
        <!-- 快捷操作：全选 / 清空 -->
        <div
          class="flex items-center justify-between gap-[0.4em] border-b-[0.14cqh] border-b-line pb-[0.5cqh]"
        >
          <button
            type="button"
            class="rounded-[0.4em] bg-line px-[0.55em] py-[0.25cqh] text-[0.62em] font-extrabold text-blue hover:bg-sky"
            @click="selectAll"
          >
            {{ strings.room.vocabSelectAllShort }}
          </button>
          <button
            type="button"
            class="rounded-[0.4em] bg-line px-[0.55em] py-[0.25cqh] text-[0.62em] font-extrabold text-muted hover:bg-line"
            @click="clearAll"
          >
            {{ strings.room.vocabClearAllShort }}
          </button>
        </div>
        <!-- 复选列表：选项较多时限高滚动（如 40 个分类） -->
        <div
          class="flex max-h-[30cqh] flex-col gap-[0.2cqh] overflow-y-auto pr-[0.2em] [scrollbar-gutter:stable]"
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
            <Check
              v-if="props.selected.includes(option.value)"
              class="h-[1.5cqh] w-[1.5cqh] text-blue"
              aria-hidden="true"
            />
          </label>
        </div>
        <!-- 关闭弹层（不改变已选内容；点选即时生效，无需确认按钮） -->
        <button
          type="button"
          class="min-h-[3cqh] rounded-[0.5em] bg-blue px-[0.8em] text-[0.66em] font-black text-white"
          @click="close()"
        >
          {{ strings.room.vocabPanelDone }}
        </button>
      </div>
    </template>
  </ActionPopover>
</template>
