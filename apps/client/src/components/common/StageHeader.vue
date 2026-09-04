<!--
  通用顶栏骨架：深色 navy 底 + 黄色底边的三段式（左/中/右），内容全部由具名插槽提供。
  大厅与房间等待页共用同一顶栏视觉（网络状态、退出等操作统一收进右侧槽位）；
  对局 HUD 栏目更多、需要进度条等专属布局，不复用本骨架。
-->
<template>
  <header
    class="col-span-full grid grid-cols-[1fr_auto_1fr] items-center border-b-[0.5cqh] border-yellow bg-navy px-[2cqw] text-white"
  >
    <div class="flex min-w-0 items-center gap-[0.8em] justify-self-start">
      <slot name="leading" />
    </div>
    <div class="justify-self-center">
      <slot name="center" />
    </div>
    <div class="flex items-center gap-[0.7em] justify-self-end">
      <slot name="trailing" />
    </div>
  </header>
</template>
