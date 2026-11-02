# 部署到服务器

## 实际采用的方式（1 核 / 1GB 小内存 VPS）

演示站 <https://test.yaojade.top> 实际是这样部署的：没有用 Docker，也没有开放任何入站端口。

| 环节 | 做法 |
|---|---|
| 运行环境 | Ubuntu 24.04，Node 20（NodeSource）、build-essential（现场编译 better-sqlite3），`npx playwright install --with-deps chromium`；浏览器放在 `/opt/ms-playwright`（`PLAYWRIGHT_BROWSERS_PATH`） |
| 内存 | 在原有 1G swap 的基础上加 1G swap 文件；systemd 限制 `MemoryMax=800M`；执行队列串行，访客排队上限 4 |
| 进程 | systemd 服务 `ai-test-platform`，以专用系统用户 `atp` 运行，`NoNewPrivileges`、`ProtectSystem=strict`，只能写 `/opt/ai-test-platform` |
| 对外访问 | Cloudflare Tunnel（cloudflared 系统服务），路由 `test.yaojade.top → http://localhost:3100`，平台只监听 `127.0.0.1`；服务器原有的 443 端口服务完全不受影响 |
| 运维 SSH | 同一条隧道再加一条路由 `ssh.yaojade.top → ssh://localhost:22222`，本机通过 `cloudflared access ssh` 作为 ProxyCommand 连接 |
| 配置 | `/opt/ai-test-platform/.env`：`HOST=127.0.0.1`、`PUBLIC_DEMO=true`，`ACCESS_CODE` 和 `SESSION_SECRET` 在部署时随机生成，只保存在服务器上 |

更新代码：

```bash
rsync -az --delete --exclude node_modules --exclude data --exclude dist --exclude .env --exclude .git ./ racknerd:/opt/ai-test-platform/
ssh racknerd 'cd /opt/ai-test-platform && npm ci --include=dev && npx vite build && chown -R atp:atp . && systemctl restart ai-test-platform'
```

---

## 另一种方式：Docker + Nginx + HTTPS


目标：`https://test.yaojade.top` 公开展示平台，访客只读浏览、运行示例用例；输入访问口令后可以编辑。

## 0. 部署前先确认 443 端口

服务器的 443 端口目前已经有服务在监听。先登录服务器确认是什么占用了它：

```bash
ss -ltnp | grep -E ':(80|443)\b'
```

- **没有占用，或者占用的就是 Nginx**：按下面的步骤正常部署。
- **被代理服务（如 xray、v2ray、trojan）占用**：不要直接改成 Nginx 监听 443，否则代理会断。有两种做法：
  1. **SNI 分流（推荐）**：Nginx 的 `stream` 模块监听 443，按域名转发。`test.yaojade.top` 转给本机另一个端口上的 HTTPS 站点，其他域名转给代理原来的端口。
  2. **换端口**：平台用 `https://test.yaojade.top:8443`，最简单，但链接里带端口，不太好看。

## 1. 解析子域名

在域名服务商处添加 A 记录：`test` → `23.238.64.78`。

## 2. 安装 Docker（Ubuntu）

```bash
curl -fsSL https://get.docker.com | sh
```

## 3. 上传代码并配置

```bash
git clone <仓库地址> /opt/ai-test-platform    # 或在本机 rsync 上传
cd /opt/ai-test-platform
cp deploy/env.production.example .env          # 填写 ACCESS_CODE、SESSION_SECRET（模型 key 可选）
docker compose up -d --build
curl -s http://127.0.0.1:3100/api/session      # 应返回 {"role":"viewer",...}
```

## 4. Nginx 与证书

```bash
apt install -y nginx certbot python3-certbot-nginx
cp deploy/nginx.conf /etc/nginx/conf.d/ai-test-platform.conf
# 首次签证书前，先注释掉 443 那个 server 块，certbot 会自动补全
certbot --nginx -d test.yaojade.top
nginx -t && systemctl reload nginx
```

## 5. 更新与维护

```bash
cd /opt/ai-test-platform && git pull && docker compose up -d --build
docker compose logs -f --tail=100        # 查看日志
```

数据（SQLite、截图、Midscene 报告）在 `./data`，备份这个目录即可。

## 安全说明

- 平台的“代码步骤”会在服务器上执行代码，所以公网部署必须设置 `ACCESS_CODE`，只有知道口令的人能新建或编辑用例。
- 访客只能运行已有用例，执行队列有上限（`PUBLIC_MAX_QUEUE`）。
- 容器端口只绑定 `127.0.0.1`，不直接暴露到公网。
- 模型 key 只放在服务器的 `.env` 里，不要提交到仓库。
