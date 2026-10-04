<!--
  画家自定义题目弹窗（CustomWordDialog）：
  选词阶段的第三条出口——输入想画的词并确认后立即开始作画。
  校验口径与服务端一致（去空白后 1~上限个 grapheme、拒绝 emoji 与控制字符），
  这里只做即时提示与确认钮禁用；最终裁决仍在服务端（错误码 INVALID_CUSTOM_WORD /
  CUSTOM_WORD_DUPLICATE，见 docs/adr/0045-custom-word-and-untimed-choosing.md）。
  中文输入法组合态期间的回车不触发提交。
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { PenLine } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { CUSTOM_WORD_MAX_LENGTH, countGraphemes } from '@draw-guess/shared'
import BaseDialog from '@/components/common/BaseDialog.vue'
import AppButton from '@/components/common/AppButton.vue'
import AppInput from '@/components/common/AppInput.vue'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{
  /** 确认按钮的忙碌态：提交在途时禁用，避免重复提交 */
  submitting: boolean
}>()
const emit = defineEmits<{
  /** 确认提交：由父组件调用商店动作并把成功与否回传（失败时保持弹窗打开） */
  confirm: [text: string]
}>()

const draft = ref('')
/** 折叠内部连续空白：与提交时服务端的规范化口径一致，长度按折叠后的文本计算 */
const normalized = computed(() => draft.value.trim().replace(/\s+/gu, ' '))
const length = computed(() => countGraphemes(normalized.value))
const tooLong = computed(() => length.value > CUSTOM_WORD_MAX_LENGTH)
const canSubmit = computed(() => normalized.value.length > 0 && !tooLong.value && !props.submitting)

// 每次打开都从空白开始：上一回合输了一半的词不该带到下一回合
watch(open, (isOpen) => {
  if (isOpen) draft.value = ''
})

function submit(): void {
  if (!canSubmit.value) return
  emit('confirm', normalized.value)
}

/** 输入法组合态（拼音未上屏）期间的回车只用于选字，不提交 */
function handleEnter(event: KeyboardEvent): void {
  if (event.isComposing) return
  submit()
}
</script>

<template>
  <BaseDialog
    v-model:open="open"
    width-class="w-[42cqw]"
    header-center
    labelledby="custom-word-title"
    :close-aria="strings.a11y.game.customWordCancel"
  >
    <template #header>
      <h2 id="custom-word-title" class="text-fs-18 font-bold">{{ strings.ui.game.customWord }}</h2>
    </template>

    <div class="grid justify-items-center gap-[1.5cqh] px-[3cqw] py-[3cqh] text-center">
      <PenLine class="h-[6cqh] w-[6cqh] text-blue" />
      <p class="text-muted">{{ strings.ui.game.customWordHint(CUSTOM_WORD_MAX_LENGTH) }}</p>
      <div class="w-[26cqw]">
        <AppInput
          v-model="draft"
          align="center"
          input-class="font-bold text-fs-20"
          :maxlength="CUSTOM_WORD_MAX_LENGTH * 4"
          :placeholder="strings.ui.game.customWordPlaceholder"
          :aria-label="strings.a11y.game.customWordTitle"
          @enter="handleEnter"
        />
      </div>
      <small class="font-bold" :class="tooLong ? 'text-red' : 'text-muted'">
        {{
          tooLong
            ? strings.ui.game.customWordTooLong(CUSTOM_WORD_MAX_LENGTH)
            : strings.ui.game.customWordLength(length, CUSTOM_WORD_MAX_LENGTH)
        }}
      </small>
    </div>

    <template #footer>
      <AppButton variant="secondary" type="button" audio-feedback="close" @click="open = false">
        {{ strings.ui.game.customWordCancel }}
      </AppButton>
      <AppButton type="button" :disabled="!canSubmit" @click="submit">
        {{ strings.ui.game.customWordConfirm }}
      </AppButton>
    </template>
  </BaseDialog>
</template>
