<!--
  资料与诊断设置页：修改大厅资料（头像 + 昵称）、查看并复制诊断信息、恢复默认设置与清除资料。
  诊断文本（diagnostic）由父层计算后以字符串传入；本组件负责选头像弹窗、改名保存与恢复/清除动作。
  复制动作上抛给父层（copy 事件），保持权限与提示逻辑集中在父层。
-->
<script setup lang="ts">
import { Clipboard, RotateCcw, Trash2 } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import AvatarImage from '@/components/AvatarImage.vue'
import AvatarPickerDialog from '@/components/AvatarPickerDialog.vue'
import AppButton from '@/components/AppButton.vue'
import { useGameStore } from '@/stores/game'

// 诊断文本、服务地址与头像弹窗开关均由父层下发；本组件上报复制与弹窗开关变更事件。
defineProps<{
  diagnostic: string
  serverAddress: string
  showAvatarPicker: boolean
}>()
const emit = defineEmits<{
  copy: []
  'update:showAvatarPicker': [value: boolean]
}>()

const store = useGameStore()

/** 打开/关闭内置头像选择弹窗，通过事件回写父层的 showAvatarPicker。 */
function onAvatarPickerOpenChange(open: boolean): void {
  emit('update:showAvatarPicker', open)
}
</script>

<template>
  <section
    class="min-h-0 px-[9cqw] py-[3cqh] grid grid-cols-[1fr_1.3fr] grid-rows-[1fr_auto] gap-[2cqh_2cqw]"
  >
    <div
      class="grid grid-cols-[auto_1fr] items-center gap-[1.5cqh_1em] border-t-[0.4cqh] border-blue bg-white p-[2cqh_1.5em]"
    >
      <button
        type="button"
        class="row-span-2 flex flex-col items-center gap-[0.7cqh] text-blue bg-transparent text-[0.72em] font-black"
        :aria-label="strings.profile.changeAvatarAria"
        @click="onAvatarPickerOpenChange(true)"
      >
        <AvatarImage
          :avatar-id="store.profile.avatarId"
          :label="strings.common.myAvatarAria"
          class="h-[14cqh] w-[14cqh]"
        />
        <span>{{ strings.settings.avatarField }}</span>
      </button>
      <label class="flex flex-col gap-[0.6cqh] font-extrabold"
        >{{ strings.settings.nicknameField
        }}<input
          v-model="store.profile.nickname"
          :maxlength="store.config.player.nicknameMaxLength"
          class="min-w-0 h-[5.2cqh] rounded-[0.7em] border-[0.2cqh] border-line bg-white px-[1em] font-bold text-ink"
      /></label>
      <AppButton variant="primary" type="button" class="col-start-2" @click="store.updateProfile">
        {{ strings.settings.saveProfile }}
      </AppButton>
    </div>
    <div class="border-t-[0.4cqh] border-blue bg-white p-[2cqh_1.5em]">
      <h2>{{ strings.settings.diagnosticsTitle }}</h2>
      <pre
        class="my-[1.4cqh] rounded-[0.6em] bg-navy p-[1.2cqh_1em] text-[#dbeafe] font-mono text-[0.7em] leading-[1.5] whitespace-pre-wrap"
        >{{ diagnostic }}</pre>
      <AppButton variant="secondary" type="button" @click="emit('copy')">
        <Clipboard />{{ strings.settings.copyDiagnostics }}
      </AppButton>
    </div>
    <div class="col-span-full flex justify-end gap-[0.8em]">
      <AppButton
        variant="secondary"
        type="button"
        class="!min-h-[5cqh] !px-[1em] !rounded-[0.6em] !gap-[0.5em]"
        @click="store.resetSettings"
      >
        <RotateCcw />{{ strings.settings.resetSettings }}</AppButton
      ><AppButton
        variant="danger"
        type="button"
        class="!min-h-[5cqh] !px-[1em] !rounded-[0.6em] !gap-[0.5em]"
        @click="store.clearProfile"
      >
        <Trash2 />{{ strings.settings.clearProfile }}
      </AppButton>
    </div>
  </section>

  <AvatarPickerDialog
    v-model="store.profile.avatarId"
    :open="showAvatarPicker"
    @close="onAvatarPickerOpenChange(false)"
  />
</template>
