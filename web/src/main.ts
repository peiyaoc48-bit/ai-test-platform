import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import CaseList from './pages/CaseList.vue'
import CaseEdit from './pages/CaseEdit.vue'
import RunDetail from './pages/RunDetail.vue'
import Reports from './pages/Reports.vue'
import Generate from './pages/Generate.vue'
import Suites from './pages/Suites.vue'
import SuiteEdit from './pages/SuiteEdit.vue'
import BatchDetail from './pages/BatchDetail.vue'
import Environments from './pages/Environments.vue'
import EnvironmentEdit from './pages/EnvironmentEdit.vue'
import './style.css'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/cases' },
    { path: '/cases', component: CaseList, meta: { nav: 'cases' } },
    { path: '/cases/new', component: CaseEdit, meta: { nav: 'cases' } },
    { path: '/cases/:id/edit', component: CaseEdit, props: true, meta: { nav: 'cases' } },
    { path: '/suites', component: Suites, meta: { nav: 'suites' } },
    { path: '/suites/new', component: SuiteEdit, meta: { nav: 'suites' } },
    { path: '/suites/:id/edit', component: SuiteEdit, props: true, meta: { nav: 'suites' } },
    { path: '/batches/:id', component: BatchDetail, props: true, meta: { nav: 'suites' } },
    { path: '/environments', component: Environments, meta: { nav: 'envs' } },
    { path: '/environments/new', component: EnvironmentEdit, meta: { nav: 'envs' } },
    { path: '/environments/:id/edit', component: EnvironmentEdit, props: true, meta: { nav: 'envs' } },
    { path: '/generate', component: Generate, meta: { nav: 'generate' } },
    { path: '/reports', component: Reports, meta: { nav: 'reports' } },
    { path: '/runs/:id', component: RunDetail, props: true, meta: { nav: 'reports' } },
  ],
})

createApp(App).use(router).mount('#app')
