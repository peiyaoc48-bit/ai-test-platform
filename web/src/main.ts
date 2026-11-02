import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import Dashboard from './pages/Dashboard.vue'
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
import Login from './pages/Login.vue'
import Requirements from './pages/workshop/Requirements.vue'
import RequirementPage from './pages/workshop/RequirementPage.vue'
import GenBatchPage from './pages/workshop/GenBatchPage.vue'
import ReviewBench from './pages/workshop/ReviewBench.vue'
import BatchComparePage from './pages/workshop/BatchComparePage.vue'
import { loadSession } from './session'
import './style.css'

const CASES = { label: '用例管理', to: '/cases' }
const SUITES = { label: '用例集', to: '/suites' }
const ENVS = { label: '环境', to: '/environments' }
const REPORTS = { label: '测试报告', to: '/reports' }
const WORKSHOP = { label: '用例工坊', to: '/workshop' }

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/login', component: Login, meta: { bare: true } },
    { path: '/dashboard', component: Dashboard, meta: { nav: 'dashboard', crumbs: [{ label: '概览' }] } },
    { path: '/cases', component: CaseList, meta: { nav: 'cases', crumbs: [CASES] } },
    { path: '/cases/new', component: CaseEdit, meta: { nav: 'cases', crumbs: [CASES, { label: '新建用例' }] } },
    { path: '/cases/:id/edit', component: CaseEdit, props: true, meta: { nav: 'cases', crumbs: [CASES, { label: '编辑用例' }] } },
    { path: '/suites', component: Suites, meta: { nav: 'suites', crumbs: [SUITES] } },
    { path: '/suites/new', component: SuiteEdit, meta: { nav: 'suites', crumbs: [SUITES, { label: '新建用例集' }] } },
    { path: '/suites/:id/edit', component: SuiteEdit, props: true, meta: { nav: 'suites', crumbs: [SUITES, { label: '编辑用例集' }] } },
    { path: '/batches/:id', component: BatchDetail, props: true, meta: { nav: 'suites', crumbs: [SUITES, { label: '批次详情' }] } },
    { path: '/environments', component: Environments, meta: { nav: 'envs', crumbs: [ENVS] } },
    { path: '/environments/new', component: EnvironmentEdit, meta: { nav: 'envs', crumbs: [ENVS, { label: '新建环境' }] } },
    { path: '/environments/:id/edit', component: EnvironmentEdit, props: true, meta: { nav: 'envs', crumbs: [ENVS, { label: '编辑环境' }] } },
    { path: '/workshop', component: Requirements, meta: { nav: 'workshop', crumbs: [WORKSHOP] } },
    { path: '/workshop/requirements/:id', component: RequirementPage, props: true, meta: { nav: 'workshop', crumbs: [WORKSHOP, { label: '需求详情' }] } },
    { path: '/workshop/batches/:id', component: GenBatchPage, props: true, meta: { nav: 'workshop', crumbs: [WORKSHOP, { label: '生成批次' }] } },
    { path: '/workshop/batches/:id/review', component: ReviewBench, props: true, meta: { nav: 'workshop', crumbs: [WORKSHOP, { label: '审核工作台' }] } },
    { path: '/workshop/compare', component: BatchComparePage, meta: { nav: 'workshop', crumbs: [WORKSHOP, { label: '批次对比' }] } },
    { path: '/generate', component: Generate, meta: { nav: 'generate', crumbs: [{ label: '快速生成' }] } },
    { path: '/reports', component: Reports, meta: { nav: 'reports', crumbs: [REPORTS] } },
    { path: '/runs/:id', component: RunDetail, props: true, meta: { nav: 'reports', crumbs: [REPORTS, { label: '运行详情' }] } },
  ],
  scrollBehavior: () => ({ top: 0 }),
})

// 先确定访问身份，再渲染（只读访客看不到编辑入口）
loadSession().finally(() => createApp(App).use(router).mount('#app'))
