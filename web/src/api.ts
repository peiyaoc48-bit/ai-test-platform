import type { BatchDetail, BatchSummary, Environment, EnvironmentInput, Suite, SuiteInput } from '../../shared/types'
import { currentEnvId } from './env-store'
import type { CaseInput, Stats, PlatformConfig, RunDetail, RunSummary, TestCase } from '../../shared/types'

export interface GenerateResult {
  drafts: CaseInput[]
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
  model: string
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(data.error || `请求失败（${res.status}）`), { code: data.code })
  return data as T
}

export const api = {
  config: () => request<PlatformConfig>('GET', '/api/config'),
  listCases: () => request<TestCase[]>('GET', '/api/cases'),
  getCase: (id: number) => request<TestCase>('GET', `/api/cases/${id}`),
  createCase: (c: CaseInput) => request<TestCase>('POST', '/api/cases', c),
  updateCase: (id: number, c: CaseInput) => request<TestCase>('PUT', `/api/cases/${id}`, c),
  deleteCase: (id: number) => request<void>('DELETE', `/api/cases/${id}`),
  runCaseIn: (id: number, envId: number | null) => request<{ runId: number }>('POST', `/api/cases/${id}/run`, { envId }),
  runCase: (id: number) => request<{ runId: number }>('POST', `/api/cases/${id}/run`, { envId: currentEnvId.value }),
  getRun: (id: number) => request<RunDetail>('GET', `/api/runs/${id}`),
  listRuns: (caseId?: number, limit = 50) =>
    request<RunSummary[]>('GET', `/api/runs?limit=${limit}${caseId ? `&caseId=${caseId}` : ''}`),
  generate: (requirement: string, url: string) => request<GenerateResult>('POST', '/api/generate', { requirement, url }),
  listSuites: () => request<Suite[]>('GET', '/api/suites'),
  getSuite: (id: number) => request<Suite>('GET', `/api/suites/${id}`),
  createSuite: (s: SuiteInput) => request<Suite>('POST', '/api/suites', s),
  updateSuite: (id: number, s: SuiteInput) => request<Suite>('PUT', `/api/suites/${id}`, s),
  deleteSuite: (id: number) => request<void>('DELETE', `/api/suites/${id}`),
  runSuite: (id: number) => request<{ batchId: number; runIds: number[] }>('POST', `/api/suites/${id}/run`, {}),
  runBatch: (caseIds: number[]) => request<{ batchId: number; runIds: number[] }>('POST', '/api/batches', { caseIds, envId: currentEnvId.value }),
  robustness: (id: number) => request<{ batchId: number; runIds: number[] }>('POST', `/api/cases/${id}/robustness`, { envId: currentEnvId.value }),
  listEnvs: () => request<Environment[]>('GET', '/api/environments'),
  getEnv: (id: number) => request<Environment>('GET', `/api/environments/${id}`),
  createEnv: (e: EnvironmentInput) => request<Environment>('POST', '/api/environments', e),
  updateEnv: (id: number, e: EnvironmentInput) => request<Environment>('PUT', `/api/environments/${id}`, e),
  deleteEnv: (id: number) => request<void>('DELETE', `/api/environments/${id}`),
  listBatches: () => request<BatchSummary[]>('GET', '/api/batches'),
  getBatch: (id: number) => request<BatchDetail>('GET', `/api/batches/${id}`),
  stats: (days: number, caseId?: number) =>
    request<Stats>('GET', `/api/stats?days=${days}${caseId ? `&caseId=${caseId}` : ''}`),
}
