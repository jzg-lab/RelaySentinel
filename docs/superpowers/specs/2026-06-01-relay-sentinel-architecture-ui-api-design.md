# RelaySentinel 后端、前端风格与接口设计

日期：2026-06-01
状态：待项目主人审阅

## 设计判断

RelaySentinel 最适合做成“轻量哨兵服务 + 安卓 PWA 控制台”。不要上来拆微服务，也不要做成依赖某个平台的插件。这个项目的核心价值是：服务端 24 小时巡检，手机端随时处理。

推荐技术方向：

- 后端：Python FastAPI 或 Go。
- 数据库：SQLite 起步，后续可切 PostgreSQL。
- 前端：React + TypeScript + Vite，做成移动端优先 PWA。
- UI：iOS 风格的安卓手机控制台。
- 部署：Docker Compose。

我的推荐是 FastAPI + SQLite + React PWA。理由是 V1 主要是调度、HTTP 适配器、规则判断、通知推送和移动端处理动作，Python 写起来更快，测试成本低。后续如果并发和单二进制分发成为关键，再考虑 Go。

后端仍然有必要存在。PWA 是手机上的控制台，不能稳定承担每 10 分钟巡检、1.5 小时额度预测和后台通知。真正干活的必须是服务器上的轻量哨兵服务。

## 后端模块

### API 层

负责登录、配置管理、实例管理、监控目标、通知渠道、手动检查、移动端工作台数据和告警处理动作。

移动端需要的动作包括：

- 立即复查。
- 标记已处理。
- 暂停提醒。
- 恢复提醒。
- 打开续费链接。
- 复制或展示联系群主信息。

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

### PWA 支持

后端需要额外提供：

- Web App Manifest。
- Service Worker 静态资源缓存。
- 移动端会话登录。
- CSRF 或同等请求保护。
- HTTPS 部署说明。
- 版本号和更新提示接口。

V1 不依赖浏览器 Push 作为核心通知，因为安卓环境和国内网络环境不稳定。核心通知仍走企业微信、Telegram、飞书、钉钉、ServerChan 或自定义 webhook。

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
- `mobile_sessions`：移动端登录会话和设备信息。
- `alert_actions`：移动端处理动作记录，例如已处理、暂停提醒、立即复查。

## 接口草案

### 工作台

- `GET /api/dashboard/summary`
- `GET /api/dashboard/alerts`
- `GET /api/mobile/home`
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
- `POST /api/alerts/{id}/resolve`
- `POST /api/alerts/{id}/rerun`
- `POST /api/alerts/{id}/snooze`

### PWA

- `GET /manifest.webmanifest`
- `GET /service-worker.js`
- `GET /api/app/version`
- `GET /api/mobile/bootstrap`

## 前端风格

用户喜欢 iOS 风格，且主要使用安卓手机，所以前端应该像“iOS 设置 + 健康 App + 手机运维控制台”的结合，而不是传统电脑后台管理系统。

视觉原则：

- 浅色优先，深色后续再加。
- 大面积柔和背景。
- 半透明毛玻璃顶栏和底部导航。
- 圆角分层卡片，但不要卡片套卡片套到失控。
- 状态色克制：蓝色主操作、绿色正常、橙色预警、红色严重。
- 信息密度适中，老板一眼看到风险。
- 动效轻，不要影响工作效率。

排版原则：

- 第一屏是手机工作台，不是营销页。
- 底部导航：工作台、上游、号池、通知、设置。
- 工作台顶部先显示“当前最需要处理的风险”。
- 告警卡片必须有直接动作：立即复查、已处理、暂停提醒、打开续费方式。
- 上游续费页按“需要处理、正常、已暂停”分组。
- 号池页先展示成功/失败账号数，再展示 5H/7D 可用时长。
- 桌面端只是宽屏增强，不是主体验。

动画原则：

- 页面进入使用轻微上浮和淡入。
- 卡片 hover 只做 1px 上移或阴影变化。
- 告警状态可以用小圆点光晕，不用大面积闪烁。
- 额度环形图后续可做平滑进度动画。
- 禁止复杂粒子、炫彩背景和影响阅读的动效。

PWA 体验原则：

- 安卓 Chrome 可添加到桌面。
- 全屏打开时不要依赖浏览器地址栏。
- 底部导航和主要按钮适合单手操作。
- 表单少填，尽量用扫描、粘贴、测试连接来降低配置负担。
- 关键页面在弱网下仍能看到最近一次快照。
- 重要通知不依赖 PWA Push，仍以 webhook 到通讯软件为主。

## HTML 原型

原型文件：

`docs/prototypes/relay-sentinel-ios-dashboard.html`

移动端优先原型文件：

`docs/prototypes/relay-sentinel-android-pwa.html`

它展示：

- 桌面增强版 iOS 风格工作台。
- 安卓 PWA 手机主界面。
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

### 产品形态

推荐：PWA 优先，原生 App 后置。

可选：

- PWA：开发快，安卓可添加桌面，适合 V1 验证。
- 原生 App：体验上限更高，但开发、签名、推送和维护成本明显更高。

## 奥卡姆剃刀审视

这套方案避免了四个早期陷阱：

- 不拆微服务。
- 不做插件优先。
- 不把 V1 做成全量监控平台。
- 不先做原生 App。

保留的复杂度只服务于一个目标：稳定地查额度、预测还能撑多久、把续费或补号提醒发出去。
