<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../api'
import { currentEnvId } from '../env-store'
import type { Environment } from '../../../shared/types'

const envs = ref<Environment[]>([])
const load = async () => (envs.value = await api.listEnvs())
async function remove(e: Environment) {
  if (!confirm(`确定删除环境“${e.name}”？历史运行里保存的环境快照不受影响。`)) return
  await api.deleteEnv(e.id)
  if (currentEnvId.value === e.id) currentEnvId.value = null
  await load()
}
onMounted(load)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>环境</h1>
        <div class="sub">同一套用例在不同环境运行：被测地址、变量、浏览器启动参数、权限、预置本地存储和超时都在这里配置。顶栏可切换当前环境。</div>
      </div>
      <RouterLink class="btn primary" to="/environments/new" data-test="new-env">+ 新建环境</RouterLink>
    </div>
    <div class="card flush">
      <table class="table" data-test="env-table">
        <thead><tr><th style="width: 56px">ID</th><th>名称</th><th>基础地址</th><th style="width: 260px">配置</th><th style="width: 200px"></th></tr></thead>
        <tbody>
          <tr class="muted">
            <td>—</td>
            <td>默认（内置演示站点）</td>
            <td class="num" style="font-size: 12px">无，用例可用 <code v-pre>{{DEMO}}</code> / <code v-pre>{{DEMO_API}}</code></td>
            <td></td>
            <td><div class="actions"><button class="btn sm" :disabled="currentEnvId === null" @click="currentEnvId = null">设为当前</button></div></td>
          </tr>
          <tr v-for="e in envs" :key="e.id" data-test="env-row">
            <td class="num muted">#{{ e.id }}</td>
            <td>
              {{ e.name }} <span v-if="currentEnvId === e.id" class="tag running">当前</span>
              <div class="muted" style="font-size: 12px" v-if="e.description">{{ e.description }}</div>
            </td>
            <td class="num" style="font-size: 12px; word-break: break-all">{{ e.baseUrl || '—' }}</td>
            <td style="font-size: 12px">
              <span class="tag" v-if="Object.keys(e.vars).length">变量 {{ Object.keys(e.vars).length }}</span>
              <span class="tag" v-if="e.launchArgs.length">启动参数 {{ e.launchArgs.length }}</span>
              <span class="tag" v-for="p in e.permissions" :key="p">{{ p }}</span>
              <span class="tag" v-if="Object.keys(e.localStorage).length">本地存储 {{ Object.keys(e.localStorage).length }}</span>
              <span class="tag" v-if="e.stepTimeoutMs">超时 {{ e.stepTimeoutMs / 1000 }}s</span>
            </td>
            <td>
              <div class="actions">
                <button class="btn sm" :disabled="currentEnvId === e.id" @click="currentEnvId = e.id" data-test="use-env">设为当前</button>
                <RouterLink class="btn sm" :to="`/environments/${e.id}/edit`">编辑</RouterLink>
                <button class="btn sm danger" @click="remove(e)">删除</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
