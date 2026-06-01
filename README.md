# RelaySentinel 使用说明书

RelaySentinel V1 是一个 FastAPI + SQLite 服务，用来监控两类对象：

- 外部上游中转：你向别人购买的 `new_api` / `sub2api` 服务，重点看余额是否会断供。
- 自己的中转站/号池：你自己运营的 `new_api` / `sub2api` 号池，重点看账号健康和 5H/7D 额度还能撑多久。

V1 明确不做自动支付、自动续费、自动充值、余额修改，也不把 CLIProxyAPI/CPA 当作外部上游。CLIProxyAPI/CPA 只能作为号池的高级额度来源挂载。

## 1. 本地准备

建议使用 Python 3.10+。当前测试环境也兼容 Python 3.8。

```bash
cd /mnt/e/my_github/relaysentinel
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

前端需要 Node.js 和 npm：

```bash
cd web
npm install
```

## 2. 测试

后端测试：

```bash
cd /mnt/e/my_github/relaysentinel
pytest tests/backend -q
```

前端测试：

```bash
cd /mnt/e/my_github/relaysentinel/web
npm test
```

前端生产构建：

```bash
cd /mnt/e/my_github/relaysentinel/web
npm run build
```

当前已验证结果：

- `pytest tests/backend -q`：39 passed
- `npm test`：6 passed
- `npm run build`：构建成功

## 3. 本地启动后端

开发启动：

```bash
cd /mnt/e/my_github/relaysentinel
source .venv/bin/activate
export RELAY_SENTINEL_DATABASE_URL="sqlite:///./data/relay_sentinel.db"
export RELAY_SENTINEL_SECRET_KEY="replace-with-a-long-random-secret"
export RELAY_SENTINEL_NOTIFICATION_DRY_RUN="true"
uvicorn relay_sentinel.asgi:app --host 0.0.0.0 --port 8000 --reload
```

打开接口文档：

- Swagger UI: `http://127.0.0.1:8000/docs`
- OpenAPI JSON: `http://127.0.0.1:8000/openapi.json`

环境变量：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `RELAY_SENTINEL_DATABASE_URL` | `sqlite:///./data/relay_sentinel.db` | SQLite 数据库路径 |
| `RELAY_SENTINEL_SECRET_KEY` | `change-me-before-production` | 凭证封存密钥，生产必须替换 |
| `RELAY_SENTINEL_DISABLE_SCHEDULER` | `true` | V1 暂不启动后台调度 |
| `RELAY_SENTINEL_NOTIFICATION_DRY_RUN` | `true` | webhook 测试只 dry-run，不真实发送 |

## 4. 启动前端预览

```bash
cd /mnt/e/my_github/relaysentinel/web
npm run dev
```

Vite 会输出本地访问地址，通常是：

```text
http://127.0.0.1:5173
```

注意：当前前端主要是 PWA/移动端体验预览，使用 mock 数据；后端 API 已经可用，但前端还没有完整接入真实后端。

## 5. 基本使用流程

下面用 `curl` 演示。假设后端运行在 `http://127.0.0.1:8000`。

### 5.1 添加外部上游

```bash
curl -sS -X POST http://127.0.0.1:8000/api/upstreams \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "词元 fast",
    "platform": "sub2api",
    "base_url": "https://ciyuan.fast",
    "credential": {
      "kind": "login",
      "email": "owner@example.com",
      "password": "secret-password"
    },
    "threshold": {
      "metric": "balance",
      "operator": "lt",
      "value": 10,
      "unit": "USD"
    },
    "renewal": {
      "kind": "contact_owner",
      "instructions": "群内 @owner，最低充值 $20"
    }
  }'
```

响应里不会返回明文密码。记下返回的 `id`，后面手动检查会用到。

### 5.2 手动检查上游

```bash
curl -sS -X POST http://127.0.0.1:8000/api/upstreams/上游ID/test
curl -sS -X POST http://127.0.0.1:8000/api/upstreams/上游ID/run-balance-check
```

V1 的手动检查是只读动作，不会充值、付款或修改余额。

### 5.3 添加自己的号池

```bash
curl -sS -X POST http://127.0.0.1:8000/api/pools \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "自营 Sub2API 号池",
    "platform": "sub2api",
    "base_url": "https://self.example.com",
    "credential": {
      "kind": "admin_token",
      "token": "secret-admin-token"
    },
    "quota_alert_threshold_hours": 5
  }'
```

### 5.4 给号池挂 CLIProxyAPI/CPA 额度来源

```bash
curl -sS -X POST http://127.0.0.1:8000/api/pools/号池ID/quota-sources \
  -H 'Content-Type: application/json' \
  -d '{
    "kind": "cliproxyapi",
    "base_url": "https://cpa.example.com",
    "credential": {
      "kind": "token",
      "token": "secret-cpa-token"
    }
  }'
```

### 5.5 手动检查号池

```bash
curl -sS -X POST http://127.0.0.1:8000/api/pools/号池ID/test
curl -sS -X POST http://127.0.0.1:8000/api/pools/号池ID/run-health-check
curl -sS -X POST http://127.0.0.1:8000/api/pools/号池ID/run-quota-check
```

### 5.6 查看移动端首页数据

```bash
curl -sS http://127.0.0.1:8000/api/mobile/home
```

返回会把 `upstreams` 和 `pools` 分开。

### 5.7 添加 webhook 通知渠道

```bash
curl -sS -X POST http://127.0.0.1:8000/api/notification-channels \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "值班群",
    "kind": "webhook",
    "enabled": true,
    "url": "https://notify.example.com/bot/secret-webhook-token",
    "template": "default"
  }'
```

测试通知：

```bash
curl -sS -X POST http://127.0.0.1:8000/api/notification-channels/渠道ID/test \
  -H 'Content-Type: application/json' \
  -d '{"text": "RelaySentinel dry-run: 余额低于阈值"}'
```

如果 `RELAY_SENTINEL_NOTIFICATION_DRY_RUN=true`，返回 `dry_run`，不会真实发 webhook。

### 5.8 创建和处理告警事件

```bash
curl -sS -X POST http://127.0.0.1:8000/api/alerts/events \
  -H 'Content-Type: application/json' \
  -d '{
    "target_id": "上游ID",
    "target_kind": "upstream",
    "rule_id": "upstream-low-balance",
    "severity": "warning",
    "title": "上游余额不足",
    "message": "当前 4.1 USD，低于 10 USD",
    "created_at": "2026-06-01T12:00:00Z"
  }'
```

处理告警：

```bash
curl -sS -X POST http://127.0.0.1:8000/api/alerts/events/告警ID/ack \
  -H 'Content-Type: application/json' \
  -d '{"note": "我知道了"}'

curl -sS -X POST http://127.0.0.1:8000/api/alerts/events/告警ID/snooze \
  -H 'Content-Type: application/json' \
  -d '{"until": "2026-06-01T18:00:00Z"}'

curl -sS -X POST http://127.0.0.1:8000/api/alerts/events/告警ID/resolve \
  -H 'Content-Type: application/json' \
  -d '{"note": "已处理"}'
```

查看告警：

```bash
curl -sS http://127.0.0.1:8000/api/alerts/events
curl -sS http://127.0.0.1:8000/api/alerts/events/告警ID/actions
```

## 6. 单机部署建议

V1 最现实的部署方式是单机 systemd + SQLite。下面假设部署在 Linux 服务器 `/opt/relay-sentinel`。

```bash
sudo mkdir -p /opt/relay-sentinel
sudo chown "$USER":"$USER" /opt/relay-sentinel
cd /opt/relay-sentinel
git clone <你的仓库地址> .
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
mkdir -p data
```

创建环境文件：

```bash
sudo tee /etc/relay-sentinel.env >/dev/null <<'EOF'
RELAY_SENTINEL_DATABASE_URL=sqlite:////opt/relay-sentinel/data/relay_sentinel.db
RELAY_SENTINEL_SECRET_KEY=请替换成足够长的随机字符串
RELAY_SENTINEL_DISABLE_SCHEDULER=true
RELAY_SENTINEL_NOTIFICATION_DRY_RUN=true
EOF
```

创建 systemd 服务：

```bash
sudo tee /etc/systemd/system/relay-sentinel.service >/dev/null <<'EOF'
[Unit]
Description=RelaySentinel API
After=network.target

[Service]
WorkingDirectory=/opt/relay-sentinel
EnvironmentFile=/etc/relay-sentinel.env
ExecStart=/opt/relay-sentinel/.venv/bin/uvicorn relay_sentinel.asgi:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
```

启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now relay-sentinel
sudo systemctl status relay-sentinel
```

查看日志：

```bash
journalctl -u relay-sentinel -f
```

建议在前面放 Nginx/Caddy 做 HTTPS 反代，不建议直接把 `uvicorn` 暴露到公网。

## 7. 生产前必须知道的限制

这版已经能支撑 V1 合同测试，但还不是完整商业生产版：

- 凭证封存是测试级替身，不是生产级 KMS/密钥轮换。
- 后台 scheduler 还没有真正跑定时任务，当前以手动检查接口为主。
- webhook 真实发送路径很薄，生产前要补超时、重试、签名、投递审计。
- 没有用户登录和权限系统，不要直接暴露公网。
- SQLite 适合单机小规模，后续多实例部署要换成 PostgreSQL 或加锁策略。
- 前端当前仍偏 PWA 预览，未完整接入后端真实 API。

我的判断：下一步最值得做的是“真实后台调度 + webhook 投递审计 + 前端接后端”，而不是先做复杂权限或多租户。先让老板每天能稳定收到准确告警，这才是真正能变现的部分。

