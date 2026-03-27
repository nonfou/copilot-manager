# 部署指南

## 安装 Bun

```bash
# 安装 unzip
sudo apt install unzip

# 安装 Bun
curl -fsSL https://bun.com/install | bash
source ~/.bashrc

# 验证
bun --version
```

---

## 直接运行

```bash
bun install
bun run build
bun run dist/main.js start --port 3000
```

---

## PM2 后台运行

```bash
# 安装 PM2
npm install -g pm2

# 克隆项目
git clone https://github.com/nonfou/copilot-manager.git
cd copilot-manager

# 安装依赖并构建
bun install
bun run build

# 后台启动
pm2 start dist/main.js --name copilot-manager -- start

# 开机自启
pm2 save && pm2 startup
```

**常用命令**

```bash
pm2 status                  # 状态
pm2 logs copilot-manager    # 日志
pm2 restart copilot-manager # 重启
pm2 stop copilot-manager    # 停止
```

---

## 反向代理

```bash
# 安装 Caddy
sudo apt install caddy

# 编辑配置
sudo nano /etc/caddy/Caddyfile
```

```
copilot.example.com {
    reverse_proxy localhost:4242
}
```

```bash
sudo systemctl restart caddy
```

---

## 更新

```bash
cd copilot-manager
git pull
bun install
bun run build
pm2 restart copilot-manager
```
