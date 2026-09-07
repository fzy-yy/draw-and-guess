<!--
  资料与诊断设置页：修改大厅资料（头像 + 昵称）、查看并复制诊断信息、恢复默认设置与清除资料。
  诊断文本（diagnostic）由父层计算后以字符串传入；本组件负责选头像弹窗、改名保存与恢复/清除动作。
  复制动作上抛给父层（copy 事件），保持权限与提示逻辑集中在父层。
-->
<script setup lang="ts">
import { ref } from 'vue'
import { Clipboard, RotateCcw, Trash2 } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import AvatarImage from '@/components/common/AvatarImage.vue'
import AvatarPickerDialog from '@/components/common/AvatarPickerDialog.vue'
import AppButton from '@/components/common/AppButton.vue'
import AppInput from '@/components/common/AppInput.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import { useGameStore } from '@/stores/game'

const showAvatarPicker = defineModel<boolean>('showAvatarPicker', { default: false })

defineProps<{
  diagnostic: string
  profileEditingDisabled?: boolean
}>()
const emit = defineEmits<{
  copy: []
}>()

const store = useGameStore()
const showResetConfirm = ref(false)
const showClearProfileConfirm = ref(false)
</script>

<template>
  <section
    class="min-h-0 px-[5cqw] py-[3cqh] grid grid-cols-[1fr_1.3fr] grid-rows-[1fr_auto] gap-[2cqh_2cqw]"
  >
    <!-- 资料卡片 -->
    <div
      class="flex flex-col items-center justify-center gap-[1.2cqh] border-t-[0.4cqh] border-blue bg-white p-[2cqh_1.5em]"
      :class="{ 'opacity-50': profileEditingDisabled }"
    >
      <button
        type="button"
        class="flex flex-col items-center gap-[0.7cqh] text-blue bg-transparent text-fs-12 font-bold"
        :disabled="profileEditingDisabled"
        :aria-label="strings.profile.changeAvatarAria"
        @click="showAvatarPicker = true"
      >
        <AvatarImage
          :avatar-id="store.profile.avatarId"
          :label="strings.common.myAvatarAria"
          class="h-[13cqh] w-[13cqh]"
        />
        <span>{{ strings.settings.avatarField }}</span>
      </button>

      <label class="flex w-full flex-col items-center gap-[0.6cqh] font-bold text-fs-14">
        {{ strings.settings.nicknameField }}
        <div class="w-full">
          <AppInput
            v-model="store.profile.nickname"
            :maxlength="store.config.player.nicknameMaxLength"
            align="center"
            input-class="font-bold text-navy"
            :disabled="profileEditingDisabled"
            @enter="store.updateProfile"
          />
        </div>
      </label>

      <AppButton
        variant="primary"
        type="button"
        class="w-full"
        :disabled="profileEditingDisabled"
        @click="store.updateProfile"
      >
        {{ strings.settings.saveProfile }}
      </AppButton>
    </div>

    <!-- 诊断区 -->
    <div class="border-t-[0.4cqh] border-blue bg-white p-[2cqh_1.5em]">
      <h2>{{ strings.settings.diagnosticsTitle }}</h2>
      <pre
        class="my-[1.4cqh] rounded-[0.6em] bg-navy p-[1.2cqh_1em] text-sky font-mono text-fs-12 leading-normal whitespace-pre-wrap"
        >{{ diagnostic }}</pre>
      <AppButton variant="secondary" type="button" @click="emit('copy')">
        <Clipboard />{{ strings.settings.copyDiagnostics }}
      </AppButton>
    </div>

    <!-- 底部操作按钮 -->
    <div class="col-span-full flex justify-end gap-[0.8em]">
      <AppButton
        variant="secondary"
        type="button"
        class="min-h-[5cqh]! px-[1em]! rounded-[0.6em]! gap-[0.5em]!"
        :audio-feedback="null"
        @click="showResetConfirm = true"
      >
        <RotateCcw />{{ strings.settings.resetSettings }}
      </AppButton>
      <AppButton
        variant="danger"
        type="button"
        class="min-h-[5cqh]! px-[1em]! rounded-[0.6em]! gap-[0.5em]!"
        :disabled="profileEditingDisabled"
        :audio-feedback="null"
        @click="showClearProfileConfirm = true"
      >
        <Trash2 />{{ strings.settings.clearProfile }}
      </AppButton>
    </div>
  </section>

  <!-- 确认弹窗：恢复默认设置 -->
  <ConfirmDialog
    v-model:open="showResetConfirm"
    :title="strings.settings.resetSettingsTitle"
    :body="strings.settings.resetSettingsBody"
    :confirm-label="strings.settings.confirmResetSettings"
    :cancel-label="strings.common.cancel"
    confirm-variant="primary"
    :icon="RotateCcw"
    @confirm="store.resetSettings"
  />

  <!-- 确认弹窗：清除本地资料 -->
  <ConfirmDialog
    v-model:open="showClearProfileConfirm"
    :title="strings.settings.clearProfileTitle"
    :body="strings.settings.clearProfileBody"
    :confirm-label="strings.settings.confirmClearProfile"
    :cancel-label="strings.common.cancel"
    :icon="Trash2"
    @confirm="store.clearProfile"
  />

  <AvatarPickerDialog
    v-if="!profileEditingDisabled"
    v-model="store.profile.avatarId"
    v-model:open="showAvatarPicker"
  />
</template>
