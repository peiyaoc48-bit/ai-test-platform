import { ref, watch } from 'vue'

// 顶栏选择的“当前环境”，单个用例运行和勾选批量运行都使用它；记在本地，刷新后保留
const KEY = 'atp-env-id'
const read = () => {
  try {
    const v = Number(localStorage.getItem(KEY))
    return Number.isInteger(v) && v > 0 ? v : null
  } catch {
    return null
  }
}

export const currentEnvId = ref<number | null>(read())
watch(currentEnvId, (v) => {
  try {
    if (v) localStorage.setItem(KEY, String(v))
    else localStorage.removeItem(KEY)
  } catch {
    /* 无痕模式等场景忽略 */
  }
})
