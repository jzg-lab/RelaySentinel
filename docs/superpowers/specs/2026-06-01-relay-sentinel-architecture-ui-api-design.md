# RelaySentinel 后端、前端风格与接口设计

日期：2026-06-01
状态：待项目主人审阅

## 设计判断

RelaySentinel 最适合做成“私有部署单体服务 + 清晰模块边界”。不要上来拆微服务，也不要做成依赖某个平台的插件。这个项目的核心价值是稳定提醒，不是炫技架构。

推荐技术方向：

- 后端：Python FastAPI 或 Go。
- 数据库：SQLite 起步，后续可切 PostgreSQL。
- 前端：React + TypeScript + Vite。
- UI：iOS 风格的轻量运维台。
- 部署：Docker Compose。

我的推荐是 FastAPI + SQLite + React。理由是 V1 主要是调度、HTTP 适配器、规则判断、通知推送，Python 写起来更快，测试成本低。后续如果并发和单二进制分发成为关键，再考虑 Go。

## 后端模块

### API 层

负责登录、配置管理、实例管理、监控目标、通知渠道、手动检查和工作台数据。

### Scheduler 调度器

负责按不同节奏触发任务：

- 上游余额检查：按目标自定义间隔，默认 30 分钟。
- 账号健康数量巡检：每 10 分钟。
- 5H/7D 额度可用时长巡检：每 1.5 小时。

V1 可以用进程内调度器，后续再换成队列或分布式调度。

### Adapter 适配器

每个平台一个适配器：

- New API Adapter。
- Sub2API Adapter。
- CLIProxyAPI Adapter。

适配器只负责把平台响应转换成统一的 `QuotaSignal` 或 `PoolSnapshot`。规则引擎不应该知道各平台的原始字段。

### Quota Engine

负责统一处理：

- 余额/额度单位。
- 5H/7D 快照。
- 过去 1 小时消耗速度。
- 近 3 小时趋势。
- 预测可用时长。
- 0 消耗速度时的安全处理。

### Alert Engine

负责：

- 阈值判断。
- 首次触发。
- 冷却抑制。
- 恢复通知。
- 消息模板渲染。

账号健康失败数大于 0 可以提醒，但不能扩展成错误分类系统。

### Notifier 通知器

V1 支持：

- 企业微信机器人。
- 飞书/钉钉机器人。
- Telegram Bot。
- ServerChan。
- 自定义 webhook。

所有通知器使用同一个发送结果模型：成功、失败、重试次数、响应摘要。

## 核心数据表

- `instances`：平台实例，保存类型、地址、状态。
- `credentials`：加密凭证，独立存放，避免散落。
- `monitor_targets`：上游续费目标或号池巡检目标。
- `renewal_methods`：支付链接、联系群主、手动说明。
- `notification_channels`：通知渠道配置。
- `check_results`：每次检查结果。
- `pool_snapshots`：账号健康、5H/7D 剩余、消耗速度。
- `alert_events`：触发、冷却、发送、恢复。
- `audit_logs`：关键配置变更。

## 接口草案

### 工作台

- `GET /api/dashboard/summary`
- `GET /api/dashboard/alerts`
- `GET /api/events/stream`

### 实例

- `GET /api/instances`
- `POST /api/instances`
- `GET /api/instances/{id}`
- `PATCH /api/instances/{id}`
- `DELETE /api/instances/{id}`
- `POST /api/instances/{id}/test`

### 监控目标

- `GET /api/monitor-targets`
- `POST /api/monitor-targets`
- `GET /api/monitor-targets/{id}`
- `PATCH /api/monitor-targets/{id}`
- `DELETE /api/monitor-targets/{id}`
- `POST /api/monitor-targets/{id}/run`

### 号池巡检

- `GET /api/pools`
- `GET /api/pools/{id}/summary`
- `GET /api/pools/{id}/snapshots`
- `POST /api/pools/{id}/run-health-check`
- `POST /api/pools/{id}/run-quota-check`

### 上游续费

- `GET /api/upstreams`
- `GET /api/upstreams/{id}/summary`
- `POST /api/upstreams/{id}/run-balance-check`

### 通知

- `GET /api/notification-channels`
- `POST /api/notification-channels`
- `PATCH /api/notification-channels/{id}`
- `DELETE /api/notification-channels/{id}`
- `POST /api/notification-channels/{id}/test`

### 告警

- `GET /api/alerts/events`
- `POST /api/alerts/{id}/ack`
- `POST /api/alerts/{id}/mute`

## 前端风格

用户喜欢 iOS 风格，所以前端应该像“iOS 设置 + 健康 App + 运维工作台”的结合，而不是传统后台管理系统。

视觉原则：

- 浅色优先，深色后续再加。
- 大面积柔和背景。
- 半透明毛玻璃顶栏和侧栏。
- 圆角分层卡片，但不要卡片套卡片套到失控。
- 状态色克制：蓝色主操作、绿色正常、橙色预警、红色严重。
- 信息密度适中，老板一眼看到风险。
- 动效轻，不要影响工作效率。

排版原则：

- 第一屏是工作台，不是营销页。
- 左侧导航：工作台、上游续费、号池巡检、通知渠道、设置。
- 中间主区域：摘要指标、额度预测、监控目标列表、接口/模块说明。
- 右侧信息栏：通知预览、最近事件。
- 移动端改成顶部横向导航和单列卡片。

动画原则：

- 页面进入使用轻微上浮和淡入。
- 卡片 hover 只做 1px 上移或阴影变化。
- 告警状态可以用小圆点光晕，不用大面积闪烁。
- 额度环形图后续可做平滑进度动画。
- 禁止复杂粒子、炫彩背景和影响阅读的动效。

## HTML 原型

原型文件：

`docs/prototypes/relay-sentinel-ios-dashboard.html`

它展示：

- iOS 风格工作台。
- 上游续费和号池巡检的分区。
- 5H/7D 额度预测卡片。
- 通知消息预览。
- 后端模块流。
- REST 接口草案。

## 需要主人选择的事项

### 后端语言

推荐：FastAPI。

可选：

- FastAPI：开发快，适合 V1 快速验证。
- Go：部署漂亮，适合长期单二进制，但 V1 速度慢一些。

### 数据库

推荐：SQLite 起步。

可选：

- SQLite：私有部署简单，备份容易。
- PostgreSQL：更重，但更适合以后多用户或大数据量。

### 前端技术

推荐：React + TypeScript + Vite。

可选：

- React：生态强，组件和图表选择多。
- Vue：也可以，但后续若接更多仪表盘组件，React 选择面更大。

## 奥卡姆剃刀审视

这套方案避免了三个早期陷阱：

- 不拆微服务。
- 不做插件优先。
- 不把 V1 做成全量监控平台。

保留的复杂度只服务于一个目标：稳定地查额度、预测还能撑多久、把续费或补号提醒发出去。
