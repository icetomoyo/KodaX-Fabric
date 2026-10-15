<template>
  <div class="channel-page-split">
    <aside class="list-pane">
      <slot name="products" />
    </aside>
    <main class="detail-pane">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.channel-page-split {
  display: grid;
  grid-template-columns: minmax(240px, 320px) minmax(0, 1fr);
  gap: 12px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.list-pane,
.detail-pane {
  min-width: 0;
  min-height: 0;
  height: 100%;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
}

.list-pane {
  display: flex;
  flex-direction: column;
  padding: 12px;
  overflow: hidden;
  background: #f8fafc;
}

.detail-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 12px 16px 16px;
  background: #fff;
  overflow: hidden;
}
</style>
