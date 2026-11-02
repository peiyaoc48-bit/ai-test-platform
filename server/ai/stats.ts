// 用例工坊的度量：比例与置信区间、两批采纳率的显著性、审核修改量。都是纯函数，便于单元测试

import type { EditStats, Proportion, Step } from '../../shared/types.js'

/** 95% Wilson 置信区间：小样本、比例接近 0 或 1 时比正态近似可靠 */
export function wilson(k: number, n: number, z = 1.96): [number, number] | null {
  if (n <= 0) return null
  const p = k / n
  const z2 = z * z
  const center = (p + z2 / (2 * n)) / (1 + z2 / n)
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n)
  return [Math.max(0, center - half), Math.min(1, center + half)]
}

export function proportion(k: number, n: number): Proportion {
  return { k, n, rate: n > 0 ? k / n : null, ci: wilson(k, n) }
}

const logFactorials: number[] = [0]
function logFactorial(n: number) {
  for (let i = logFactorials.length; i <= n; i++) logFactorials[i] = logFactorials[i - 1] + Math.log(i)
  return logFactorials[n]
}

/**
 * Fisher 精确检验（双侧）：两组的成功数 / 样本量，返回 p 值。
 * 双侧 p = 所有概率不大于观测表的 2×2 表（边际固定）的概率之和。
 */
export function fisherExact(k1: number, n1: number, k2: number, n2: number): number | null {
  if (n1 <= 0 || n2 <= 0) return null
  const K = k1 + k2
  const N = n1 + n2
  const logP = (a: number) => {
    const b = n1 - a
    const c = K - a
    const d = n2 - c
    return logFactorial(K) + logFactorial(N - K) + logFactorial(n1) + logFactorial(n2) - logFactorial(N) - logFactorial(a) - logFactorial(b) - logFactorial(c) - logFactorial(d)
  }
  const observed = logP(k1)
  let p = 0
  for (let a = Math.max(0, K - n2); a <= Math.min(K, n1); a++) {
    const lp = logP(a)
    if (lp <= observed + 1e-7) p += Math.exp(lp)
  }
  return Math.min(1, p)
}

/**
 * 审核修改量：原稿与终稿的步骤按“类型 + 内容”求最长公共子序列，
 * 未对齐的部分里，删一步加一步记为“改”一步，其余分别记为增 / 删。
 */
export function editStats(before: { name: string; steps: Step[] }, after: { name: string; steps: Step[] }): EditStats {
  const key = (s: Step) => `${s.type}\u0000${s.content.trim()}`
  const a = before.steps.map(key)
  const b = after.steps.map(key)
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const kept = dp[0][0]
  const removed = a.length - kept
  const added = b.length - kept
  const changed = Math.min(removed, added)
  return { kept, changed, added: added - changed, removed: removed - changed, nameChanged: before.name.trim() !== after.name.trim() }
}

export const editSize = (e: EditStats) => e.added + e.removed + e.changed
