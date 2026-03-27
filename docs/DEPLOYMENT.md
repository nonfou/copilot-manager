# 生产环境部署指南

## 环境要求

- **Bun** >= 1.0.0
- **操作系统**: Linux (推荐 Ubuntu 20.04+), macOS, Windows Server
- **内存**: >= 512MB
- **磁盘**: >= 1GB

## 目录结构

```
copilot-manager/
├── data/                  # 数据目录（需要持久化）
│   ├── accounts.json      # 账号数据
│   ├── keys.json          # API 密钥
│   └── logs.json          # 请求日志
├── public/                # 静态 UI 文件
├── dist/                  # 编译产物
└── src/                   # 源代码
```

---

## 方案一：直接运行

适合快速部署、测试环境。

```bash
# 1. 安装 Bun
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc

# 2. 获取代码
git clone <repo-url> /opt/copilot-manager
cd /opt/copilot-manager

# 3. 安装依赖
bun install

# 4. 启动服务
bun run start --port 4242
```

---

## 方案二：编译后运行（推荐）

编译后启动更快，适合生产环境。

```bash
# 1. 构建
bun run build

# 2. 运行编译产物
bun run dist/main.js start --port 4242
```

---

## 方案三：PM2 进程管理（推荐生产环境）

PM2 提供进程守护、自动重启、日志管理、开机自启等功能。

### 安装 PM2

```bash
npm install -g pm2
```

### 创建配置文件

在项目根目录创建 `ecosystem.config.cjs`：

```javascript
module.exports = {
  apps: [{
    name: 'copilot-manager',
    script: 'dist/main.js',
    args: 'start --port 4242',
    cwd: '/opt/copilot-manager',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production'
    }
  }]
}
```

### 启动服务

```bash
# 构建应用
bun run build

# 启动
pm2 start ecosystem.config.cjs

# 查看状态
pm2 status

# 查看日志
pm2 logs copilot-manager

# 设置开机自启
pm2 save
pm2 startup
```

### 常用命令

```bash
pm2 restart copilot-manager   # 重启
pm2 stop copilot-manager      # 停止
pm2 delete copilot-manager    # 删除
pm2 logs copilot-manager      # 查看日志
pm2 monit                     # 监控面板
```

---

## 方案四：Docker 部署

### Dockerfile

```dockerfile
FROM oven/bun:1 AS base
WORKDIR /app

# 安装依赖
FROM base AS install
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# 构建
FROM base AS build
COPY --from=install /app/node_modules ./node_modules
COPY . .
RUN bun run build

# 运行
FROM base AS release
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./

ENV NODE_ENV=production
EXPOSE 4242

CMD ["bun", "run", "dist/main.js", "start"]
```

### docker-compose.yml

```yaml
version: '3.8'

services:
  copilot-manager:
    build: .
    container_name: copilot-manager
    restart: unless-stopped
    ports:
      - "4242:4242"
    volumes:
      - ./data:/app/data
    environment:
      - NODE_ENV=production
```

### 使用方法

```bash
# 构建并启动
docker-compose up -d --build

# 查看日志
docker-compose logs -f

# 停止
docker-compose down
```

---

## 方案五：Systemd 服务（Linux）

创建 `/etc/systemd/system/copilot-manager.service`：

```ini
[Unit]
Description=Copilot Manager
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/copilot-manager
ExecStart=/usr/local/bin/bun run dist/main.js start --port 4242
Restart=on-failure
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=copilot-manager
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

### 启动服务

```bash
# 重载配置
sudo systemctl daemon-reload

# 启动
sudo systemctl start copilot-manager

# 开机自启
sudo systemctl enable copilot-manager

# 查看状态
sudo systemctl status copilot-manager

# 查看日志
sudo journalctl -u copilot-manager -f
```

---

## 反向代理配置

### Nginx

```nginx
server {
    listen 80;
    server_name copilot.example.com;

    # 重定向到 HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name copilot.example.com;

    ssl_certificate /etc/letsencrypt/live/copilot.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/copilot.example.com/privkey.pem;

    # 安全配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;

    location / {
        proxy_pass http://127.0.0.1:4242;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Caddy（更简单）

```
copilot.example.com {
    reverse_proxy localhost:4242
}
```

---

## 数据备份

```bash
# 备份脚本 backup.sh
#!/bin/bash
BACKUP_DIR="/backup/copilot-manager"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR
cp -r /opt/copilot-manager/data $BACKUP_DIR/data_$DATE

# 保留最近 7 天的备份
find $BACKUP_DIR -name "data_*" -mtime +7 -delete

echo "Backup completed: $BACKUP_DIR/data_$DATE"
```

添加到 crontab（每天凌晨 3 点执行）：

```bash
0 3 * * * /opt/copilot-manager/backup.sh
```

---

## 更新部署

```bash
cd /opt/copilot-manager

# 拉取最新代码
git pull

# 安装依赖
bun install

# 重新构建
bun run build

# 重启服务
pm2 restart copilot-manager
# 或
sudo systemctl restart copilot-manager
```

---

## 健康检查

```bash
# 检查服务是否运行
curl http://localhost:4242/api/stats

# 检查进程
pm2 status
# 或
systemctl status copilot-manager
```

---

## 常见问题

### 1. 端口被占用

```bash
# 查看端口占用
lsof -i :4242

# 使用其他端口
bun run start --port 8080
```

### 2. 权限问题

```bash
# 确保 data 目录可写
chmod -R 755 /opt/copilot-manager/data
```

### 3. Bun 未找到

```bash
# 添加 Bun 到 PATH
export PATH="$HOME/.bun/bin:$PATH"

# 或使用绝对路径
/home/user/.bun/bin/bun run start
```
