# 平台镜像：基于 Playwright 官方镜像（已包含 Chromium 及其系统依赖、Node.js）
FROM mcr.microsoft.com/playwright:v1.64.0-noble

WORKDIR /app
COPY package.json package-lock.json .npmrc ./
# 构建前端（vite）和运行服务端（tsx）都需要 devDependencies
RUN npm ci --include=dev && npm cache clean --force
COPY . .
RUN npx vite build

# 容器内用 Playwright 自带的 Chromium；监听所有网卡，由宿主机的 Nginx 反向代理
ENV NODE_ENV=production \
    BROWSER_CHANNEL= \
    HOST=0.0.0.0 \
    PORT=3100 \
    DATA_DIR=/data
VOLUME /data
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3100/api/session').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["npx", "tsx", "server/index.ts"]
