<template>
  <div class="auth-shell">
    <aside class="brand-pane">
      <div class="brand-top">
        <span class="mark">KF</span>
        <div class="brand-id">
          <strong>KodaX Fabric</strong>
          <span>Token Hub</span>
        </div>
      </div>
      <div class="brand-copy">
        <h1>KodaX Fabric</h1>
        <p class="module">Token Hub</p>
        <p>企业模型调用的统一入口。上游渠道与调用审计收在一处。</p>
      </div>
      <ul class="points">
        <li>集中接入官方与自定义上游</li>
        <li>按团队统计用量</li>
        <li>OpenAI / Anthropic 原生转发</li>
      </ul>
    </aside>
    <main class="form-pane">
      <div class="form-card">
        <slot />
      </div>
    </main>
  </div>
</template>

<style scoped>
.auth-shell {
  display: grid;
  grid-template-columns: minmax(280px, 42%) minmax(0, 1fr);
  min-height: 100vh;
  background: #f4f6f8;
}

.brand-pane {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 36px 40px 32px;
  color: #e8edf5;
  background:
    radial-gradient(ellipse at 0% 100%, rgba(37, 99, 235, 0.18), transparent 46%),
    linear-gradient(180deg, #0b1220 0%, #111827 100%);
}

.brand-top {
  display: flex;
  align-items: center;
  gap: 12px;
}

.mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.brand-id {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.brand-id strong {
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.brand-id span {
  color: #93c5fd;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.brand-copy h1 {
  margin: 48px 0 8px;
  color: #fff;
  font-size: clamp(28px, 3.4vw, 36px);
  font-weight: 600;
  letter-spacing: -0.03em;
  line-height: 1.1;
}

.brand-copy .module {
  margin: 0 0 16px;
  color: #93c5fd;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.brand-copy p {
  max-width: 22em;
  margin: 0;
  color: #9aa8bc;
  font-size: 15px;
  line-height: 1.7;
}

.points {
  margin: 40px 0 0;
  padding: 0;
  list-style: none;
  color: #cbd5e1;
  font-size: 13px;
  line-height: 1.6;
}

.points li {
  position: relative;
  padding: 8px 0 8px 16px;
}

.points li::before {
  content: "";
  position: absolute;
  top: 15px;
  left: 0;
  width: 6px;
  height: 1px;
  background: #60a5fa;
}

.form-pane {
  display: grid;
  place-items: center;
  padding: 48px 24px;
}

.form-card {
  width: min(420px, 100%);
}

.form-card :deep(.el-form-item__label) {
  color: #334155;
  font-weight: 600;
}

.form-card :deep(.el-input__wrapper) {
  min-height: 44px;
  padding-left: 14px;
  padding-right: 14px;
  border-radius: 10px;
  box-shadow: 0 0 0 1px #e2e8f0 inset;
}

.form-card :deep(.el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px #cbd5e1 inset;
}

.form-card :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px #2563eb inset, 0 0 0 4px rgba(37, 99, 235, 0.12);
}

.form-card :deep(.el-button--primary) {
  height: 44px;
  border: none;
  border-radius: 10px;
  background: #0f172a;
  font-weight: 600;
}

.form-card :deep(.el-button--primary:hover),
.form-card :deep(.el-button--primary:focus) {
  background: #1e293b;
}

@media (max-width: 860px) {
  .auth-shell {
    align-content: start;
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }

  .brand-pane {
    justify-content: flex-start;
    padding: 18px 20px;
  }

  .brand-copy,
  .points {
    display: none;
  }

  .form-pane {
    align-items: start;
    padding: 28px 20px 40px;
  }
}
</style>
