<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { CheckCircle2, Info, XCircle } from 'lucide-vue-next'
import { closeConfirm, confirmState, toasts } from './feedback'

const onKey = (e: KeyboardEvent) => {
  if (!confirmState.open) return
  if (e.key === 'Escape') closeConfirm(false)
  if (e.key === 'Enter') closeConfirm(true)
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="toasts" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="t.kind" data-test="toast">
        <CheckCircle2 v-if="t.kind === 'success'" :size="16" />
        <XCircle v-else-if="t.kind === 'error'" :size="16" />
        <Info v-else :size="16" />
        <span>{{ t.text }}</span>
      </div>
    </TransitionGroup>
  </div>
  <Transition name="fade">
    <div v-if="confirmState.open" class="modal-mask" @click.self="closeConfirm(false)">
      <div class="modal" role="dialog" aria-modal="true" data-test="confirm">
        <h3>{{ confirmState.title }}</h3>
        <p v-if="confirmState.body" class="muted">{{ confirmState.body }}</p>
        <div class="modal-actions">
          <button class="btn" @click="closeConfirm(false)" data-test="confirm-cancel">取消</button>
          <button class="btn" :class="confirmState.danger ? 'danger-solid' : 'primary'" @click="closeConfirm(true)" data-test="confirm-ok">{{ confirmState.okText }}</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.toasts { position: fixed; top: 16px; right: 16px; z-index: 50; display: flex; flex-direction: column; gap: 8px; }
.toast { display: flex; align-items: center; gap: 8px; min-width: 220px; max-width: 420px; padding: 10px 14px; border-radius: 8px; background: #fff; border: 1px solid var(--border); box-shadow: var(--shadow-lg); font-size: 13px; }
.toast.success svg { color: var(--pass); }
.toast.error svg { color: var(--fail); }
.toast.info svg { color: var(--brand); }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(-6px); }
.toast-enter-active, .toast-leave-active { transition: all .18s ease; }
.modal-mask { position: fixed; inset: 0; background: rgba(15, 30, 61, .36); display: grid; place-items: center; z-index: 40; }
.modal { width: min(420px, calc(100vw - 32px)); background: #fff; border-radius: 10px; padding: 20px 22px 16px; box-shadow: var(--shadow-lg); }
.modal h3 { margin: 0 0 6px; font-size: 15px; }
.modal p { margin: 0; font-size: 13px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.fade-enter-active, .fade-leave-active { transition: opacity .15s; }
</style>
