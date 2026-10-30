# 部署到服务器（Docker + Nginx + HTTPS）

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
