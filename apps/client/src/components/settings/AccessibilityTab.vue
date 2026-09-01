<!--
  显示与操作设置页：动画 / 快捷键提示 / 自动聚焦 / 可被发现 / 接收邀请 共 5 个开关。
  复用 SettingSwitchRow，直接读写 store.settings 并在保存时调用 store.saveSettings。
-->
<script setup lang="ts">
import { Eye } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { useGameStore } from '@/stores/game'
import SettingSwitchRow from './SettingSwitchRow.vue'

const store = useGameStore()
</script>

<template>
  <section class="min-h-0 px-[9cqw] py-[3cqh]">
    <div class="flex items-center gap-[1.2em] mb-[2.5cqh]">
      <Eye class="h-[6cqh] w-[6cqh] rounded-[0.8em] bg-blue p-[1.2cqh] text-white" />
      <div>
        <h2>{{ strings.settings.accessibilityTitle }}</h2>
        <p class="mt-[0.5cqh] text-muted text-[0.72em]">
          {{ strings.settings.accessibilityIntro }}
        </p>
      </div>
    </div>
    <div class="grid grid-cols-2 gap-[1.2cqh_1em]">
      <SettingSwitchRow
        v-model="store.settings.animationsEnabled"
        class="border-l-[0.35cqh] border-slate-400"
        :title="strings.settings.animations"
        :hint="strings.settings.animationsHint"
        @save="store.saveSettings"
      />
      <SettingSwitchRow
        v-model="store.settings.showShortcuts"
        class="border-l-[0.35cqh] border-slate-400"
        :title="strings.settings.showShortcuts"
        :hint="strings.settings.showShortcutsHint"
        @save="store.saveSettings"
      />
      <SettingSwitchRow
        v-model="store.settings.autoFocusGuess"
        class="border-l-[0.35cqh] border-slate-400"
        :title="strings.settings.autoFocus"
        :hint="strings.settings.autoFocusHint"
        @save="store.saveSettings"
      />
      <SettingSwitchRow
        v-model="store.settings.discoverable"
        class="border-l-[0.35cqh] border-slate-400"
        :title="strings.settings.discoverable"
        :hint="strings.settings.discoverableHint"
        @save="store.saveSettings"
      />
      <SettingSwitchRow
        v-model="store.settings.acceptsInvites"
        class="border-l-[0.35cqh] border-slate-400"
        :title="strings.settings.acceptsInvites"
        :hint="strings.settings.acceptsInvitesHint"
        @save="store.saveSettings"
      />
    </div>
  </section>
</template>
