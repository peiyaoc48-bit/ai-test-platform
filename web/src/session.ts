import { computed, reactive } from 'vue'
import type { SessionInfo } from '../../shared/types'

// 当前访问身份：本地开发默认是管理员；公网部署时可能是只读访客
export const session = reactive<SessionInfo>({ role: 'admin', authRequired: false, publicDemo: false })
export const canEdit = computed(() => session.role === 'admin')

export async function loadSession() {
  const res = await fetch('/api/session')
  if (res.ok) Object.assign(session, await res.json())
}
