# RelaySentinel Backend Implementation Contract

日期：2026-06-01

这份文档给后续实现后端的会话使用。它的目标不是重新设计产品，而是把当前已确认的产品边界、接口契约和测试意图写清楚。实现者应先让 `tests/backend/` 里的测试变绿，再扩展功能。

## 一句话目标

实现一个 FastAPI 后端，支撑 RelaySentinel 的 V1 最小闭环：

1. 手动添加外部上游中转。
2. 手动添加自己的中转站/号池。
3. 读取 New API/Sub2API 的余额或额度信号。
4. 预测号池 5H/7D 还能撑多久。
5. 低于阈值后通过 webhook 发提醒，提醒里带续费链接或联系群主说明。

## 不能混淆的产品边界

### 上游中转

上游中转是老板向别人购买的外部服务。V1 的上游添加入口只支持：

- `new_api`
- `sub2api`

上游用于回答：这个外部服务会不会因为余额不足而断供？

上游不能选择 `cliproxyapi` 或 `cpa`。CLIProxyAPI/CPA 不属于外部上游续费类型。

### 自己的中转站/号池

号池是老板自己的中转站、账号池或额度来源。V1 的号池添加入口默认支持：

- `new_api`
- `sub2api`

CLIProxyAPI/CPA 只能作为号池的高级额度来源，通过 `/api/pools/{id}/quota-sources` 挂到某个号池下面。它不出现在“添加上游”里。

## 已有测试

后端测试放在：

- `tests/backend/conftest.py`
- `tests/backend/helpers.py`
- `tests/backend/test_api_targets.py`
- `tests/backend/test_manual_checks_and_scheduler.py`
- `tests/backend/test_new_api_adapter.py`
- `tests/backend/test_notifications_and_alert_events.py`
- `tests/backend/test_persistence_and_security.py`
- `tests/backend/test_pool_health.py`
- `tests/backend/test_sub2api_adapter.py`
- `tests/backend/test_quota_and_alerts.py`

当前测试期望的后端入口是：

```python
relay_sentinel.app:create_app(settings: dict | None = None)
```

`create_app` 必须返回 FastAPI app。测试会传入：

```python
{
    "database_url": "sqlite:////tmp/.../relay_sentinel_test.db",
    "secret_key": "test-secret-key",
    "disable_scheduler": True,
    "notification_dry_run": True,
}
```

实现时可以先用内存或临时 SQLite，重点是 API 行为和领域函数正确。不要改测试去迎合实现，除非发现测试和本文档矛盾。

## 建议目录

建议按下面结构实现：

```text
relay_sentinel/
  __init__.py
  app.py
  models.py
  storage.py
  api/
    upstreams.py
    pools.py
    dashboard.py
  adapters/
    __init__.py
    errors.py
    sub2api.py
    new_api.py
  domain/
    alerts.py
    quota.py
    pool_health.py
    scheduler.py
  notifications/
    webhook.py
```

可以调整内部文件名，但公开入口和测试导入路径必须保留：

- `relay_sentinel.app.create_app`
- `relay_sentinel.adapters.sub2api.Sub2APIAdapter`
- `relay_sentinel.adapters.sub2api.detect_sub2api_site`
- `relay_sentinel.adapters.new_api.NewAPIAdapter`
- `relay_sentinel.adapters.errors.AdapterAuthError`
- `relay_sentinel.adapters.errors.AdapterAuthBlockedError`
- `relay_sentinel.domain.quota.predict_pool_quota`
- `relay_sentinel.domain.alerts.evaluate_alert`
- `relay_sentinel.domain.pool_health.summarize_account_health`
- `relay_sentinel.domain.scheduler.select_due_checks`
- `relay_sentinel.notifications.webhook.render_webhook_message`

## API 契约

### `POST /api/upstreams`

创建外部上游中转。

允许平台：

- `new_api`
- `sub2api`

禁止平台：

- `cliproxyapi`
- `cpa`
- 其他任意值

请求示例：

```json
{
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
  "check_interval_seconds": 1800,
  "renewal": {
    "kind": "payment_link",
    "label": "购买额度",
    "url": "https://ciyuan.fast/purchase"
  }
}
```

响应要求：

- 状态码 `201`。
- 返回 `kind: "upstream"`。
- 返回 `platform`。
- 返回 `renewal`。
- 未传 `check_interval_seconds` 时默认 `1800` 秒。
- 绝不能返回明文密码、token 或完整密钥。

还必须实现：

- `GET /api/upstreams`
- `GET /api/upstreams/{id}`
- `PATCH /api/upstreams/{id}`
- `DELETE /api/upstreams/{id}`，删除后详情返回 `404`。
- `POST /api/upstreams/{id}/test`，只做连通性/凭证探测。
- `POST /api/upstreams/{id}/run-balance-check`，手动触发余额检查。

校验要求：

- `base_url` 必须是有效 `http` 或 `https` URL。
- `threshold.value` 必须大于 `0`。
- `renewal.kind` 只允许 `manual`、`contact_owner`、`payment_link`。
- 不允许 `auto_pay`、`auto_renew` 或任何暗示自动支付的类型。

### `POST /api/pools`

创建自己的中转站或号池。

默认允许平台：

- `new_api`
- `sub2api`

请求示例：

```json
{
  "name": "自营 Sub2API 号池",
  "platform": "sub2api",
  "base_url": "https://self.example.com",
  "credential": {
    "kind": "login",
    "email": "owner@example.com",
    "password": "secret-password"
  },
  "health_check_interval_seconds": 600,
  "quota_check_interval_seconds": 5400,
  "quota_alert_threshold_hours": 5
}
```

响应要求：

- 状态码 `201`。
- 返回 `kind: "pool"`。
- 返回 `ownership: "owned"`。
- 未传 `health_check_interval_seconds` 时默认 `600` 秒。
- 未传 `quota_check_interval_seconds` 时默认 `5400` 秒。
- 绝不能返回明文 token。

还必须实现：

- `GET /api/pools`
- `GET /api/pools/{id}`
- `PATCH /api/pools/{id}`
- `DELETE /api/pools/{id}`，删除后详情返回 `404`，移动端首页不再返回该号池。
- `POST /api/pools/{id}/test`，只做连通性/凭证探测。
- `POST /api/pools/{id}/run-health-check`，手动触发账号成功/失败巡检。
- `POST /api/pools/{id}/run-quota-check`，手动触发 5H/7D 额度预测。

校验要求：

- 号池入口只允许 `new_api` 和 `sub2api`。
- `cliproxyapi`/`cpa` 不能直接作为号池平台创建，只能作为 quota source 挂载。
- `base_url` 必须是有效 `http` 或 `https` URL。
- `quota_alert_threshold_hours` 必须大于 `0`。

### `POST /api/pools/{pool_id}/quota-sources`

给号池添加高级额度来源。V1 只要求能保存并返回探测状态，不要求真的完成 CLIProxyAPI/CPA 读取。

请求示例：

```json
{
  "kind": "cliproxyapi",
  "base_url": "https://cpa.example.com",
  "credential": {
    "kind": "token",
    "token": "secret-cpa-token"
  }
}
```

响应要求：

- 状态码 `201`。
- 返回 `pool_id`。
- 返回 `kind: "cliproxyapi"`。
- `status` 必须是 `pending_probe`、`available`、`unavailable` 之一。
- 绝不能返回明文 token。

### `GET /api/mobile/home`

返回移动端首页数据。必须把上游和号池分开。

响应示例：

```json
{
  "default_business_view": "upstreams",
  "alerts": [],
  "upstreams": [
    {
      "id": "up_...",
      "kind": "upstream",
      "name": "外部 New API",
      "platform": "new_api"
    }
  ],
  "pools": [
    {
      "id": "pool_...",
      "kind": "pool",
      "name": "自己的 New API",
      "platform": "new_api",
      "ownership": "owned"
    }
  ]
}
```

## New API 适配器契约

`NewAPIAdapter` 用于读取 New API 管理端通道余额或等价余额信号。构造参数：

```python
NewAPIAdapter(base_url: str, admin_token: str)
```

测试期望它提供：

```python
await adapter.fetch_balance(http_client=http_client)
```

V1 测试使用的读取路径是：

```text
GET /api/channel/
Authorization: Bearer <admin_token>
```

响应示例：

```json
{
  "success": true,
  "data": [
    {"id": 1, "name": "gpt-4.1", "status": 1, "balance": 12.5},
    {"id": 2, "name": "claude", "status": 1, "balance": 7.0}
  ]
}
```

返回的信号对象至少需要这些属性：

- `target_kind == "upstream"`
- `platform == "new_api"`
- `metric == "balance"`
- `value == 19.5`
- `unit == "USD"`
- `confidence == "confirmed"`
- `raw["channel_count"] == 2`

401/403 的凭证错误应抛出 `AdapterAuthError`。如果 403 响应明显是 Cloudflare/challenge/forbidden 阻断，应抛出 `AdapterAuthBlockedError`。

## Sub2API 适配器契约

`Sub2APIAdapter` 用于通过用户登录读取余额。构造参数：

```python
Sub2APIAdapter(base_url: str, email: str, password: str)
```

测试期望它提供：

```python
await adapter.fetch_balance(http_client=http_client)
```

### 登录流程

适配器应按 Sub2API 前端已识别的接口调用：

1. `POST /api/v1/auth/login`
2. 从响应 `data.access_token` 取 Bearer token。
3. `GET /api/v1/auth/me`
4. 从用户信息中读取 `balance`，如果没有 `balance` 可尝试 `quota`。

成功登录响应形态：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "access_token": "access-token",
    "refresh_token": "refresh-token",
    "expires_in": 3600,
    "user": {
      "id": 7,
      "email": "owner@example.com"
    }
  }
}
```

`/auth/me` 响应形态：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 7,
    "email": "owner@example.com",
    "balance": 4.1,
    "quota": 4.1,
    "group": "default"
  }
}
```

返回的信号对象至少需要这些属性：

- `target_kind == "upstream"`
- `platform == "sub2api"`
- `metric == "balance"`
- `value == 4.1`
- `unit == "USD"`
- `confidence == "confirmed"`

可以用 dataclass、Pydantic model 或简单对象，但属性名要可访问。

### Cloudflare 阻断

真实测试 `https://ciyuan.fast` 时已观察到：

- `GET /api/v1/settings/public` 可以访问。
- 站点前端包明确使用 `/api/v1/auth/login` 和 `/api/v1/auth/me`。
- 直接脚本登录 `POST /api/v1/auth/login` 返回 403 Cloudflare 类错误。

因此适配器遇到 403 且响应包含 Cloudflare/challenge/forbidden 语义时，不应伪装成账号密码错误，也不应判断“站点不支持”。应抛出：

```python
AdapterAuthBlockedError
```

错误消息里应包含 `Cloudflare` 或可读阻断原因。UI 后续可以提示用户：该站点需要浏览器登录、站点放行服务器 IP、提供长期 token/API Key，或改用可访问的余额接口。

### 站点识别

实现：

```python
await detect_sub2api_site(base_url: str, http_client) -> dict
```

它应读取 `/api/v1/settings/public`。如果公开设置或前端约定显示 API base 为 `/api/v1`，且存在 Sub2API 相关标识，应返回：

```json
{
  "is_sub2api_like": true,
  "api_base": "/api/v1"
}
```

## 额度预测契约

实现：

```python
relay_sentinel.domain.quota.predict_pool_quota(current: dict, history: list[dict]) -> dict
```

输入快照字段：

- `checked_at`: timezone-aware `datetime`
- `five_hour_remaining_percent`: float
- `seven_day_remaining_percent`: float

计算规则：

- 过去 1 小时消耗速度 = 1 小时前剩余百分比 - 当前剩余百分比。
- 可用时长 = 当前剩余百分比 / 过去 1 小时消耗速度。
- 如果消耗速度小于等于 0，可用时长为 `float("inf")`，摘要里应包含“暂不可耗尽”。
- `five_hour` 或 `seven_day` 任一可用时长小于 5 小时，`should_alert` 为 `True`。
- 返回值中保留 1 小时速度、3 小时趋势、预测小时数和人类可读摘要。
- 可选参数 `account_health` 和 `display_timezone` 用于生成移动端推送摘要。摘要文案需能表达：
  - `概览`
  - `账号：44/45 成功，1 失败`
  - `时间：2026-05-31 18:00:33`
  - `5H额度`
  - `7D额度`
  - `预测`

测试中的关键数值：

- 5H 当前 18%，1 小时前 21.75%，速度 3.75%/小时，可用 4.8 小时，应告警。
- 7D 当前 86.7%，1 小时前 89.5%，速度 2.8%/小时，可用 30.96 小时。

## 告警冷却契约

实现：

```python
relay_sentinel.domain.alerts.evaluate_alert(
    target_id: str,
    rule_id: str,
    is_triggered: bool,
    now: datetime,
    previous_events: list[dict],
    cooldown_seconds: int,
) -> dict
```

行为：

- 第一次触发返回 `{"action": "send", ...}`。
- 冷却期内重复触发返回 `{"action": "cooldown_skip", ...}`。
- 超过冷却期再次触发返回 `{"action": "send", ...}`。
- V1 默认冷却期是 6 小时，即 `21600` 秒。

API 层还需要支持：

- `GET /api/alerts/events`
- `POST /api/alerts/events`
- `POST /api/alerts/events/{id}/ack`
- `POST /api/alerts/events/{id}/snooze`
- `POST /api/alerts/events/{id}/resolve`
- `POST /api/alerts/events/{id}/rerun`
- `GET /api/alerts/events/{id}/actions`
- `POST /api/alerts/evaluate`

重复低余额在冷却期内应记录 `cooldown_skip` 事件，方便老板知道系统不是没跑，而是按冷却规则跳过了重复推送。

## 号池健康契约

实现：

```python
relay_sentinel.domain.pool_health.summarize_account_health(
    checked_at: str,
    accounts: list[dict],
) -> dict
```

V1 只关心账号是否成功，不做报错分类。返回至少包含：

- `total`
- `success`
- `failed`
- `should_alert`
- `text`

当失败数大于 `0` 时 `should_alert` 为 `True`。摘要应使用类似：

```text
账号：44/45 成功，1 失败
```

不要在 V1 输出里扩展“报错分类”。

## 调度契约

实现：

```python
relay_sentinel.domain.scheduler.select_due_checks(now: datetime, targets: list[dict]) -> list[dict]
```

间隔要求：

- 上游余额检查默认每 `1800` 秒。
- 号池账号健康检查默认每 `600` 秒。
- 号池 5H/7D 额度检查默认每 `5400` 秒。

`create_app(settings={"disable_scheduler": True})` 时：

- `app.state.scheduler_enabled is False`
- 不启动后台任务。

测试只要求 due check 选择逻辑正确，不要求第一版真的启动 APScheduler/Celery。

## Webhook 消息契约

实现：

```python
relay_sentinel.notifications.webhook.render_webhook_message(alert: dict) -> dict
```

返回至少包含：

```json
{
  "text": "..."
}
```

上游余额告警文案必须包含：

- 目标名称。
- 当前值。
- 阈值。
- 续费方式。
- 如果续费方式是联系群主，必须出现“联系群主”和具体说明。
- 如果续费方式是支付链接，必须出现链接或链接标签。

不要把“联系群主”的站点伪装成一键支付。

## 通知渠道契约

V1 只要求 webhook 渠道。API 需要支持：

- `POST /api/notification-channels`
- `GET /api/notification-channels`
- `GET /api/notification-channels/{id}`
- `PATCH /api/notification-channels/{id}`
- `POST /api/notification-channels/{id}/test`

返回中必须隐藏 webhook URL 中的 secret token。`notification_dry_run=True` 时测试发送可以返回 `dry_run`，但响应里仍然要包含足够信息证明 payload 被构造。

## 安全约束

- API 响应、日志、错误消息中不要泄露明文密码、token、管理员 key。
- 测试会检查响应文本中不出现提交的明文 secret。
- SQLite 文件中不应出现明文密码、token 或原始 JSON 字段名 `"password"`/`"token"`。可以用加密、密封存储或测试环境可接受的加密替身，但不能裸存。
- V1 不做自动支付、自动充值、余额修改、账号删除、自动修复。
- 以下接口不应存在，应返回 `404`：
  - `/api/upstreams/{id}/pay`
  - `/api/upstreams/{id}/renew`
  - `/api/upstreams/{id}/recharge`
  - `/api/upstreams/{id}/modify-balance`
  - `/api/pools/{id}/recharge`
  - `/api/pools/{id}/modify-balance`
- 能用只读凭证时不要要求管理员凭证。

## 非目标

以下内容不要在第一版实现中扩展：

- 多租户 SaaS。
- 复杂角色权限和邀请系统。
- 报错分类、失败率、延迟、性能图表。
- 个人微信/QQ 机器人。
- 自动支付或自动续费。
- 把上游和号池合并成统一的“实例/监控目标”入口。

## 实现顺序建议

1. 创建 `relay_sentinel` 包和 `create_app`。
2. 实现内存或 SQLite 存储，先支持 `POST /api/upstreams`、`POST /api/pools`、`GET /api/mobile/home`。
3. 补齐上游/号池 CRUD、默认间隔、校验和手动检查接口。
4. 实现 `Sub2APIAdapter.fetch_balance`、`detect_sub2api_site`、`NewAPIAdapter.fetch_balance`，用 `httpx.AsyncClient`。
5. 实现 `predict_pool_quota`、`summarize_account_health`、`select_due_checks`。
6. 实现 `evaluate_alert`、告警事件生命周期和冷却事件记录。
7. 实现 `render_webhook_message` 和 webhook 通知渠道。
8. 做 SQLite 持久化和凭证加密/脱敏。
9. 跑 `pytest tests/backend` 到全绿。
10. 再考虑真正后台 scheduler、迁移工具、更多平台适配器。

## 验收命令

```bash
pytest tests/backend
```

当前前端测试仍然独立：

```bash
cd web
npm test
npm run build
```

后端实现完成前，`pytest tests/backend` 失败是正常的；失败原因应当是缺少 `relay_sentinel` 包或未实现对应函数，而不是测试语法错误。
