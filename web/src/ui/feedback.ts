import { reactive } from 'vue'

// 全局反馈：右上角轻提示 + 确认弹窗（替代浏览器自带的 alert / confirm，样式统一且不阻塞页面）

export interface Toast {
  id: number
  kind: 'success' | 'error' | 'info'
  text: string
}
export const toasts = reactive<Toast[]>([])
let seq = 0
export function toast(text: string, kind: Toast['kind'] = 'success', ms = 3200) {
  const t = { id: ++seq, kind, text }
  toasts.push(t)
  setTimeout(() => {
    const i = toasts.indexOf(t)
    if (i >= 0) toasts.splice(i, 1)
  }, ms)
}

export const confirmState = reactive({
  open: false,
  title: '',
  body: '',
  okText: '确定',
  danger: false,
  resolve: null as null | ((ok: boolean) => void),
})
export function confirmDialog(opts: { title: string; body?: string; okText?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    Object.assign(confirmState, { open: true, body: '', okText: '确定', danger: false, ...opts, resolve })
  })
}
export function closeConfirm(ok: boolean) {
  confirmState.resolve?.(ok)
  Object.assign(confirmState, { open: false, resolve: null })
}
