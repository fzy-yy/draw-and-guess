<!--
  大厅建房弹窗（CreateRoomDialog）：
  支持公开/私密房间单选、房间名称与最大玩家数设定；其余规则进房间后在规则弹窗细调。
  旧「玩法预设」下拉已移除，初始设置取 @draw-guess/config 的唯一默认规则组。
-->
<script setup lang="ts">
import { computed, reactive } from 'vue'
import { strings } from '@draw-guess/strings'
import type { RoomSettings, RoomVisibility } from '@draw-guess/shared'
import { defaultRoomSettings } from '@draw-guess/config'
import BaseDialog from '@/components/common/BaseDialog.vue'
import AppButton from '@/components/common/AppButton.vue'
import AppInput from '@/components/common/AppInput.vue'
import RuleSelectField, { type RuleSelectOption } from '@/components/common/RuleSelectField.vue'
import { useGameStore } from '@/stores/game'

const open = defineModel<boolean>('open', { default: false })
const store = useGameStore()

const createForm = reactive<{ name: string; visibility: RoomVisibility }>({
  name: store.config.room.defaultName,
  visibility: 'public',
})

const roomSettings = reactive<RoomSettings>(
  defaultRoomSettings(store.config.player.defaultMaxPlayers),
)

const playerOptions = computed<readonly RuleSelectOption<number>[]>(() => {
  const result: RuleSelectOption<number>[] = []
  for (
    let count = store.config.player.minPlayers;
    count <= store.config.player.maxPlayers;
    count += 1
  ) {
    result.push({ value: count, label: strings.common.playersUnit(count) })
  }
  return result
})

async function submitCreate(): Promise<void> {
  const ok = await store.createRoom({
    name: createForm.name,
    visibility: createForm.visibility,
    settings: { ...roomSettings },
  })
  if (ok) {
    open.value = false
  }
}
</script>

<template>
  <BaseDialog
    v-model:open="open"
    width-class="w-[58cqw]"
    labelledby="create-title"
    :close-aria="strings.lobby.createDialogCloseAria"
  >
    <template #header>
      <p class="eyebrow-light">{{ strings.lobby.newRoomLabel }}</p>
      <h2 id="create-title">{{ strings.lobby.createDialogTitle }}</h2>
    </template>

    <!-- 表单区在弹窗内自行滚动：低高度舞台下不会把底部操作按钮挤出可视区 -->
    <div
      class="grid min-h-0 grid-cols-2 gap-[1.8cqh_1.4em] overflow-y-auto px-[2em] py-[2.8cqh] overscroll-contain"
    >
      <!-- 可见性单选组 -->
      <fieldset class="col-span-full m-0 grid grid-cols-2 gap-[0.8em] border-0 p-0">
        <legend class="mb-[0.7cqh] font-bold">{{ strings.lobby.visibilityField }}</legend>
        <label
          v-for="option in [
            {
              value: 'public' as const,
              title: strings.lobby.visibilityPublic,
              hint: strings.lobby.visibilityPublicHint,
            },
            {
              value: 'private' as const,
              title: strings.lobby.visibilityPrivate,
              hint: strings.lobby.visibilityPrivateHint,
            },
          ]"
          :key="option.value"
          class="flex items-center gap-[0.7em] rounded-[0.7em] border-[0.18cqh] border-control bg-white px-[1em] py-[1cqh] cursor-pointer"
        >
          <input
            v-model="createForm.visibility"
            type="radio"
            :value="option.value"
            class="h-[2.2cqh] w-[2.2cqh] accent-blue"
          />
          <span class="flex flex-col">
            <b>{{ option.title }}</b>
            <small class="text-muted text-fs-12">{{ option.hint }}</small>
          </span>
        </label>
      </fieldset>

      <label class="flex flex-col gap-[0.55cqh] font-bold text-fs-14">
        {{ strings.lobby.roomNameField }}
        <AppInput
          v-model="createForm.name"
          :maxlength="store.config.player.roomNameMaxLength"
          input-class="font-bold"
        />
      </label>

      <RuleSelectField
        v-model="roomSettings.maxPlayers"
        :label="strings.lobby.maxPlayersField"
        :options="playerOptions"
      />

      <p class="col-span-full m-0 text-muted text-fs-12 leading-[1.6]">
        {{
          createForm.visibility === 'public' ? strings.lobby.publicNote : strings.lobby.privateNote
        }}
      </p>
    </div>

    <template #footer>
      <AppButton variant="secondary" type="button" audio-feedback="close" @click="open = false">
        {{ strings.common.cancel }}
      </AppButton>
      <AppButton type="button" :disabled="!createForm.name.trim()" @click="submitCreate">
        {{ strings.lobby.createAndEnter }}
      </AppButton>
    </template>
  </BaseDialog>
</template>
