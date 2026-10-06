<!--
  大厅建房弹窗（CreateRoomDialog）：
  顶部选择玩法模式（经典 / 接龙，建房时选定、房间内不可修改），再选公开/私密与房间名称；
  其余规则进房间后在规则弹窗细调。容量固定为协议常量（S61）、开局后不可加入，
  建房时不再有「最大人数」字段。
  旧「玩法预设」下拉已移除，初始设置取 @draw-guess/config 的唯一默认规则组。
-->
<script setup lang="ts">
import { reactive } from 'vue'
import { strings } from '@draw-guess/strings'
import type { GameMode, RoomSettings, RoomVisibility } from '@draw-guess/shared'
import { defaultRoomSettings } from '@draw-guess/config'
import { AppButton, AppInput, BaseDialog, RadioCardGroup } from '@/components/common'
import { useGameStore } from '@/stores/game'

const open = defineModel<boolean>('open', { default: false })
const store = useGameStore()

const createForm = reactive<{ name: string; visibility: RoomVisibility; gameMode: GameMode }>({
  name: store.config.room.defaultName,
  visibility: 'public',
  // 默认经典模式：与协议的缺省值同源，保持未切换时的现有行为（S27 / S28）
  gameMode: 'classic',
})

const roomSettings = reactive<RoomSettings>(defaultRoomSettings())

async function submitCreate(): Promise<void> {
  const ok = await store.createRoom({
    name: createForm.name,
    visibility: createForm.visibility,
    gameMode: createForm.gameMode,
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
    :close-aria="strings.a11y.lobby.createDialogCloseAria"
  >
    <template #header>
      <p class="eyebrow-light">{{ strings.ui.lobby.newRoomLabel }}</p>
      <h2 id="create-title">{{ strings.ui.lobby.createDialogTitle }}</h2>
    </template>

    <!-- 表单区在弹窗内自行滚动：低高度舞台下不会把底部操作按钮挤出可视区 -->
    <div
      class="grid min-h-0 grid-cols-2 gap-[1.8cqh_1.4em] overflow-y-auto px-[2em] py-[2.8cqh] overscroll-contain"
    >
      <!-- 房间名称输入项：置于首项，便于房主直接命名画室 -->
      <label class="col-span-full flex flex-col gap-[0.55cqh] font-bold text-fs-14">
        {{ strings.ui.lobby.roomNameField }}
        <AppInput
          v-model="createForm.name"
          :maxlength="store.config.player.roomNameMaxLength"
          input-class="font-bold"
        />
      </label>

      <!-- 玩法模式单选组：建房时选定、房间内不可修改（S27 / S28） -->
      <RadioCardGroup
        v-model="createForm.gameMode"
        :label="strings.ui.lobby.gameModeField"
        :options="[
          {
            value: 'classic',
            title: strings.ui.lobby.gameModeClassic,
            hint: strings.ui.lobby.gameModeClassicHint,
          },
          {
            value: 'relay',
            title: strings.ui.lobby.gameModeRelay,
            hint: strings.ui.lobby.gameModeRelayHint,
          },
        ]"
      />

      <!-- 可见性单选组 -->
      <RadioCardGroup
        v-model="createForm.visibility"
        :label="strings.ui.lobby.visibilityField"
        :options="[
          {
            value: 'public',
            title: strings.ui.lobby.visibilityPublic,
            hint: strings.ui.lobby.visibilityPublicHint,
          },
          {
            value: 'private',
            title: strings.ui.lobby.visibilityPrivate,
            hint: strings.ui.lobby.visibilityPrivateHint,
          },
        ]"
      />
      <p class="col-span-full m-0 text-muted text-fs-12 leading-[1.6]">
        {{
          createForm.visibility === 'public'
            ? strings.ui.lobby.publicNote
            : strings.ui.lobby.privateNote
        }}
      </p>
    </div>

    <template #footer>
      <AppButton variant="secondary" type="button" audio-feedback="close" @click="open = false">
        {{ strings.ui.common.cancel }}
      </AppButton>
      <AppButton type="button" :disabled="!createForm.name.trim()" @click="submitCreate">
        {{ strings.ui.lobby.createAndEnter }}
      </AppButton>
    </template>
  </BaseDialog>
</template>
