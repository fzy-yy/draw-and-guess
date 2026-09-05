<!--
  显示与操作设置页：动画 / 快捷键提示 / 自动聚焦 / 可被发现 / 接收邀请 / 画家默认显示答案 共 6 个开关。
  复用 SettingSwitchRow，直接读写 store.settings 并在保存时调用 store.saveSettings。
-->
<script setup lang="ts">
import { Eye } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { useGameStore } from '@/stores/game'
import SettingSwitchRow from '@/components/common/SettingSwitchRow.vue'
import SettingsSectionHeader from '@/components/settings/SettingsSectionHeader.vue'

const store = useGameStore()
</script>

<template>
  <section class="min-h-0 px-[5cqw] py-[3cqh]">
    <SettingsSectionHeader
      :icon="Eye"
      :title="strings.settings.accessibilityTitle"
      :intro="strings.settings.accessibilityIntro"
    />
    <div class="grid grid-cols-2 gap-[1.2cqh_1em]">
      <SettingSwitchRow
        v-model="store.settings.animationsEnabled"
        class="border-l-[0.35cqh] border-line"
        :title="strings.settings.animations"
        :hint="strings.settings.animationsHint"
        @save="store.saveSettings"
      />
      <SettingSwitchRow
        v-model="store.settings.showShortcuts"
        class="border-l-[0.35cqh] border-line"
        :title="strings.settings.showShortcuts"
        :hint="strings.settings.showShortcutsHint"
        @save="store.saveSettings"
      />
      <SettingSwitchRow
        v-model="store.settings.autoFocusGuess"
        class="border-l-[0.35cqh] border-line"
        :title="strings.settings.autoFocus"
        :hint="strings.settings.autoFocusHint"
        @save="store.saveSettings"
      />
      <SettingSwitchRow
        v-model="store.settings.discoverable"
        class="border-l-[0.35cqh] border-line"
        :title="strings.settings.discoverable"
        :hint="strings.settings.discoverableHint"
        @save="store.saveSettings"
      />
      <SettingSwitchRow
        v-model="store.settings.acceptsInvites"
        class="border-l-[0.35cqh] border-line"
        :title="strings.settings.acceptsInvites"
        :hint="strings.settings.acceptsInvitesHint"
        @save="store.saveSettings"
      />
      <SettingSwitchRow
        v-model="store.settings.drawerDefaultReveal"
        class="border-l-[0.35cqh] border-line"
        :title="strings.settings.drawerDefaultReveal"
        :hint="strings.settings.drawerDefaultRevealHint"
        @save="store.saveSettings"
      />
    </div>
  </section>
</template>
