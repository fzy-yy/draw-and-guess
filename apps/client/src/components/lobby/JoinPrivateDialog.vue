<!--
  大厅私密房间码加入弹窗（JoinPrivateDialog）：
  支持输入服务端生成的私密房间短码并加入。
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { KeyRound } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { PrivateRoomCodeSchema } from '@draw-guess/shared'
import BaseDialog from '@/components/common/BaseDialog.vue'
import AppButton from '@/components/common/AppButton.vue'
import AppInput from '@/components/common/AppInput.vue'
import { useGameStore } from '@/stores/game'

const open = defineModel<boolean>('open', { default: false })
const store = useGameStore()
const privateCode = ref('')

const privateCodeValid = computed(() => PrivateRoomCodeSchema.safeParse(privateCode.value).success)

async function submitJoin(): Promise<void> {
  if (!privateCodeValid.value) return
  const ok = await store.joinPrivateRoom(privateCode.value)
  if (!ok) return
  privateCode.value = ''
  open.value = false
}
</script>

<template>
  <BaseDialog
    v-model:open="open"
    width-class="w-[42cqw]"
    labelledby="join-private-title"
    :close-aria="strings.lobby.privateJoinCloseAria"
  >
    <template #header>
      <p class="eyebrow-light">{{ strings.lobby.privateJoinLabel }}</p>
      <h2 id="join-private-title">{{ strings.lobby.privateJoinTitle }}</h2>
    </template>

    <div class="grid justify-items-center gap-[1.5cqh] px-[4cqw] py-[4cqh] text-center">
      <KeyRound class="h-[7cqh] w-[7cqh] text-blue" />
      <p class="text-muted">{{ strings.lobby.privateJoinBody }}</p>
      <div class="w-[22cqw]">
        <AppInput
          v-model="privateCode"
          align="center"
          input-class="font-bold uppercase tracking-[0.3em] font-mono text-fs-20"
          :maxlength="store.config.room.privateCodeLength + 2"
          :placeholder="strings.lobby.privateCodePlaceholder"
          :aria-label="strings.lobby.privateCodeAria"
          @enter="submitJoin"
        />
      </div>
    </div>

    <template #footer>
      <AppButton variant="secondary" type="button" @click="open = false">
        {{ strings.common.cancel }}
      </AppButton>
      <AppButton type="button" :disabled="!privateCodeValid" @click="submitJoin">
        {{ strings.lobby.joinPrivateConfirm }}
      </AppButton>
    </template>
  </BaseDialog>
</template>
