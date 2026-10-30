import { randomBytes } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'

// 演示站点的后端接口（内存存储）：登录拿 token，带 token 增删改查待办。
// 每个 token 有独立的待办数据，接口用例之间互不干扰。

interface Todo {
  id: number
  text: string
  done: boolean
}
interface Session {
  username: string
  todos: Todo[]
  nextId: number
  createdAt: number
}

const USERS: Record<string, string> = { demo: 'demo123' }
const SESSION_TTL_MS = 2 * 60 * 60 * 1000
const MAX_SESSIONS = 1000

const httpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode })

export async function demoApi(app: FastifyInstance) {
  const sessions = new Map<string, Session>()

  const auth = (req: FastifyRequest): Session => {
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '')
    const s = m && sessions.get(m[1])
    if (!s || Date.now() - s.createdAt > SESSION_TTL_MS) throw httpError(401, '未登录或 token 已失效')
    return s
  }
  const findTodo = (s: Session, id: string) => {
    const todo = s.todos.find((t) => t.id === Number(id))
    if (!todo) throw httpError(404, '待办不存在')
    return todo
  }
  const checkText = (text: unknown) => {
    if (typeof text !== 'string' || !text.trim()) throw httpError(400, '待办内容不能为空')
    if (text.trim().length > 100) throw httpError(400, '待办内容不能超过 100 个字符')
    return text.trim()
  }
  const summary = (s: Session) => ({
    items: s.todos,
    total: s.todos.length,
    done: s.todos.filter((t) => t.done).length,
  })

  app.post('/login', async (req) => {
    const { username, password } = (req.body ?? {}) as Record<string, unknown>
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      throw httpError(400, '请输入用户名和密码')
    }
    if (USERS[username] !== password) throw httpError(401, '用户名或密码错误')
    if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value!)
    const token = randomBytes(16).toString('hex')
    sessions.set(token, {
      username,
      createdAt: Date.now(),
      nextId: 3,
      todos: [
        { id: 1, text: '阅读 Playwright 文档', done: true },
        { id: 2, text: '写一条自动化用例', done: false },
      ],
    })
    return { token, username, expiresIn: SESSION_TTL_MS / 1000 }
  })

  app.get('/me', async (req) => ({ username: auth(req).username }))

  app.get('/todos', async (req) => summary(auth(req)))

  app.post('/todos', async (req, reply) => {
    const s = auth(req)
    const todo = { id: s.nextId++, text: checkText((req.body as any)?.text), done: false }
    s.todos.push(todo)
    reply.status(201).send(todo)
  })

  app.patch('/todos/:id', async (req) => {
    const s = auth(req)
    const todo = findTodo(s, (req.params as { id: string }).id)
    const body = (req.body ?? {}) as Record<string, unknown>
    if (body.done !== undefined) {
      if (typeof body.done !== 'boolean') throw httpError(400, 'done 必须是布尔值')
      todo.done = body.done
    }
    if (body.text !== undefined) todo.text = checkText(body.text)
    return todo
  })

  app.delete('/todos/:id', async (req, reply) => {
    const s = auth(req)
    const todo = findTodo(s, (req.params as { id: string }).id)
    s.todos.splice(s.todos.indexOf(todo), 1)
    reply.status(204).send()
  })

  app.post('/logout', async (req, reply) => {
    auth(req)
    sessions.delete(req.headers.authorization!.split(/\s+/)[1])
    reply.status(204).send()
  })
}
