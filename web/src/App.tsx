import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  createPool,
  createUpstream,
  getApiSettings,
  hasApiCredentials,
  listTargets,
  saveApiSettings,
  type ApiSettings,
  type BackendAlert,
  type BackendPool,
  type BackendUpstream,
  type CreatePoolPayload,
  type CreateUpstreamPayload,
  type Platform,
  type RenewalKind
} from './api';
import {
  initialAlerts,
  notificationChannels,
  pools as mockPools,
  upstreams as mockUpstreams,
  type AlertItem,
  type PoolItem,
  type UpstreamItem
} from './data/mockData';
import { isQuotaBelowThreshold, predictHoursRemaining } from './domain/quota';

type Tab = 'home' | 'upstreams' | 'pools' | 'notifications' | 'settings';
type DefaultBusinessView = 'upstreams' | 'pools';

const tabs: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'home', label: '工作台', icon: '⌂' },
  { id: 'upstreams', label: '上游', icon: '≡' },
  { id: 'pools', label: '号池', icon: '◎' },
  { id: 'notifications', label: '通知', icon: '◉' },
  { id: 'settings', label: '设置', icon: '⚙' }
];

function formatHours(hours: number): string {
  if (!Number.isFinite(hours)) return '暂不可耗尽';
  if (hours < 10) return `${hours.toFixed(1)}h`;
  return `${Math.round(hours)}h`;
}

function platformLabel(platform: Platform | string): string {
  return platform === 'new_api' ? 'New API' : platform === 'sub2api' ? 'Sub2API' : platform;
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    normal: '正常',
    active: '正常',
    pending_probe: '待巡检',
    warning: '预警',
    low_balance: '余额低',
    low_quota: '额度低',
    unhealthy: '异常',
    failed: '失败',
    blocked: '受阻',
    critical: '处理'
  };
  return labels[status] || status;
}

function normalizeStatus(status: string): 'normal' | 'warning' | 'critical' | string {
  if (status === 'active') return 'normal';
  if (['pending_probe', 'low_balance', 'low_quota', 'unhealthy'].includes(status)) return 'warning';
  if (['failed', 'blocked'].includes(status)) return 'critical';
  return status;
}

function StatusPill({ status }: { status: string }) {
  const normalized = normalizeStatus(status);
  return <span className={`status ${normalized}`}>{statusLabel(status)}</span>;
}

function TopBar({ title, subtitle, onRefresh }: { title: string; subtitle: string; onRefresh: () => void }) {
  return (
    <header className="top">
      <div className="top-row">
        <div>
          <p className="eyebrow">RelaySentinel</p>
          <h1>{title}</h1>
        </div>
        <button className="icon-button" onClick={onRefresh} aria-label="立即刷新">↻</button>
      </div>
      <div className="sync-line"><span className="dot orange" />{subtitle}</div>
    </header>
  );
}

function AlertCard({
  alert,
  onResolve,
  onSnooze,
  onRerun
}: {
  alert: AlertItem;
  onResolve: (id: string) => void;
  onSnooze: (id: string) => void;
  onRerun: (id: string) => void;
}) {
  return (
    <article className={`risk-card ${alert.severity}`}>
      <div className="risk-top">
        <div>
          <h2>{alert.title}</h2>
          <p>{alert.summary}</p>
        </div>
        <span className="badge">{alert.severity === 'critical' ? '需要处理' : '预警'}</span>
      </div>
      <div className="actions">
        <button className="action primary" onClick={() => onRerun(alert.id)}>复查</button>
        <button className="action" onClick={() => onResolve(alert.id)}>已处理</button>
        <button className="action" onClick={() => onSnooze(alert.id)}>暂停</button>
      </div>
    </article>
  );
}

function PoolQuotaCard({ pool }: { pool: PoolItem }) {
  const fiveHour = predictHoursRemaining(pool.fiveHourRemainingPercent, pool.fiveHourBurnRate);
  const sevenDay = predictHoursRemaining(pool.sevenDayRemainingPercent, pool.sevenDayBurnRate);
  const danger = isQuotaBelowThreshold(fiveHour, 5) || isQuotaBelowThreshold(sevenDay, 5);

  return (
    <article className="card quota-card">
      <div className="card-head">
        <div>
          <h3>{pool.name}</h3>
          <p>{pool.platform} · {pool.successAccounts}/{pool.totalAccounts} 成功，{pool.failedAccounts} 失败</p>
        </div>
        <StatusPill status={danger ? 'warning' : 'normal'} />
      </div>
      <div className="bar"><span style={{ width: `${Math.max(4, pool.fiveHourRemainingPercent)}%` }} /></div>
      <div className="kv"><span>5H 剩余</span><strong>{pool.fiveHourRemainingPercent}% · {formatHours(fiveHour)}</strong></div>
      <div className="kv"><span>7D 剩余</span><strong>{pool.sevenDayRemainingPercent}% · {formatHours(sevenDay)}</strong></div>
      <div className="kv"><span>过去 1 小时</span><strong>{pool.fiveHourBurnRate}%/小时</strong></div>
    </article>
  );
}

function UpstreamCard({ upstream }: { upstream: UpstreamItem | BackendUpstream }) {
  const isBackend = 'base_url' in upstream;
  const threshold = isBackend
    ? `${upstream.threshold?.value ?? '-'} ${upstream.threshold?.unit ?? ''}`.trim()
    : upstream.threshold;
  const renewal = isBackend ? renewalLabel(upstream.renewal?.kind || 'manual') : upstream.renewal;
  const status = isBackend ? upstream.status || 'pending_probe' : upstream.status;

  return (
    <article className="item-card">
      <div>
        <h3>{upstream.name}</h3>
        <p>
          {platformLabel(upstream.platform)}
          {isBackend ? ` · ${upstream.base_url} · 阈值 ${threshold}` : ` · 余额 ${upstream.balance}，阈值 ${threshold}`}
        </p>
      </div>
      <StatusPill status={status} />
      <button className="wide-button">{renewal}</button>
    </article>
  );
}

function BackendPoolCard({ pool }: { pool: BackendPool }) {
  return (
    <article className="item-card">
      <div>
        <h3>{pool.name}</h3>
        <p>{platformLabel(pool.platform)} · {pool.base_url} · 低于 {pool.quota_alert_threshold_hours ?? '-'}h 告警</p>
      </div>
      <StatusPill status={pool.status || 'pending_probe'} />
      <div className="wide-note">
        健康：{pool.last_health_checked_at || '待巡检'} · 额度：{pool.last_quota_checked_at || '待巡检'}
      </div>
    </article>
  );
}

function renewalLabel(kind: RenewalKind | string): string {
  const labels: Record<string, string> = {
    manual: '手动说明',
    contact_owner: '联系群主',
    payment_link: '支付链接'
  };
  return labels[kind] || '手动说明';
}

function SectionTitle({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      <span>{hint}</span>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <article className="empty-card subtle">
      <h2>{title}</h2>
      <p>{body}</p>
    </article>
  );
}

function HomePage({
  alerts,
  defaultBusinessView,
  upstreams,
  pools,
  realMode,
  onResolve,
  onSnooze,
  onRerun
}: {
  alerts: AlertItem[];
  defaultBusinessView: DefaultBusinessView;
  upstreams: Array<UpstreamItem | BackendUpstream>;
  pools: PoolItem[] | BackendPool[];
  realMode: boolean;
  onResolve: (id: string) => void;
  onSnooze: (id: string) => void;
  onRerun: (id: string) => void;
}) {
  const activeAlerts = alerts.filter((alert) => !alert.acknowledged && !alert.snoozed);
  const primaryAlert = activeAlerts[0];
  const showUpstreamsFirst = defaultBusinessView === 'upstreams';
  const upstreamWarningCount = upstreams.filter((item) => normalizeStatus(item.status || 'normal') !== 'normal').length;
  const poolWarningCount = pools.filter((pool) => {
    if ('failedAccounts' in pool) return pool.failedAccounts > 0;
    return normalizeStatus(pool.status || 'normal') !== 'normal';
  }).length;

  return (
    <>
      <section className="section">
        {primaryAlert ? (
          <AlertCard alert={primaryAlert} onResolve={onResolve} onSnooze={onSnooze} onRerun={onRerun} />
        ) : (
          <article className="empty-card">
            <h2>今天没有必须处理的事</h2>
            <p>哨兵服务仍会继续巡检，上游余额和号池额度低于阈值时会通知你。</p>
          </article>
        )}
      </section>

      <section className="section summary-grid">
        <div className="mini"><span>上游预警</span><strong>{upstreamWarningCount}</strong></div>
        <div className="mini"><span>号池预警</span><strong>{poolWarningCount}</strong></div>
        <div className="mini"><span>未处理</span><strong>{activeAlerts.length}</strong></div>
      </section>

      {showUpstreamsFirst ? (
        <>
          <SectionTitle title="上游中转" hint={realMode ? '真实后端数据' : '预览数据'} />
          <TargetList kind="upstreams" upstreams={upstreams} pools={pools} realMode={realMode} />
          <SectionTitle title="号池快照" hint={realMode ? '真实后端数据' : '每 1.5 小时预测'} />
          <TargetList kind="pools" upstreams={upstreams} pools={realMode ? (pools as BackendPool[]).slice(0, 1) : (pools as PoolItem[]).slice(0, 1)} realMode={realMode} compact />
        </>
      ) : (
        <>
          <SectionTitle title="号池快照" hint={realMode ? '真实后端数据' : '每 1.5 小时预测'} />
          <TargetList kind="pools" upstreams={upstreams} pools={pools} realMode={realMode} />
          <SectionTitle title="上游中转" hint={realMode ? '真实后端数据' : '余额低的优先处理'} />
          <TargetList kind="upstreams" upstreams={upstreams.slice(0, 2)} pools={pools} realMode={realMode} compact />
        </>
      )}
    </>
  );
}

function TargetList({
  kind,
  upstreams,
  pools,
  realMode,
  compact
}: {
  kind: 'upstreams' | 'pools';
  upstreams: Array<UpstreamItem | BackendUpstream>;
  pools: PoolItem[] | BackendPool[];
  realMode: boolean;
  compact?: boolean;
}) {
  if (kind === 'upstreams') {
    return (
      <div className={`list ${compact ? 'compact-list' : ''}`}>
        {upstreams.length ? upstreams.map((item) => <UpstreamCard key={item.id} upstream={item} />) : (
          <EmptyState title="还没有上游" body="配置真实后端后，可以在上游页添加外部中转。" />
        )}
      </div>
    );
  }

  return (
    <div className={`list ${compact ? 'compact-list' : ''}`}>
      {pools.length ? pools.map((pool) => (
        realMode
          ? <BackendPoolCard key={pool.id} pool={pool as BackendPool} />
          : <PoolQuotaCard key={pool.id} pool={pool as PoolItem} />
      )) : (
        <EmptyState title="还没有中转站" body="配置真实后端后，可以在号池页添加自己的中转站。" />
      )}
    </div>
  );
}

function UpstreamForm({
  settings,
  canSubmit,
  onCreated
}: {
  settings: ApiSettings;
  canSubmit: boolean;
  onCreated: (message: string) => Promise<void>;
}) {
  const [platform, setPlatform] = useState<Platform>('sub2api');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [adminToken, setAdminToken] = useState('');
  const [thresholdValue, setThresholdValue] = useState('10');
  const [thresholdUnit, setThresholdUnit] = useState('USD');
  const [renewalKind, setRenewalKind] = useState<RenewalKind>('contact_owner');
  const [renewalInstructions, setRenewalInstructions] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    const credential: Record<string, string> = platform === 'sub2api'
      ? { kind: 'login', email, password }
      : { kind: 'admin_token', token: adminToken };
    const payload: CreateUpstreamPayload = {
      name,
      platform,
      base_url: baseUrl,
      credential,
      threshold: {
        metric: 'balance',
        operator: 'lt',
        value: Number(thresholdValue),
        unit: thresholdUnit
      },
      renewal: renewalKind === 'payment_link'
        ? { kind: renewalKind, label: '购买额度', url: renewalInstructions }
        : { kind: renewalKind, instructions: renewalInstructions }
    };

    setSubmitting(true);
    try {
      await createUpstream(settings, payload);
      setPassword('');
      setAdminToken('');
      await onCreated('上游已保存，凭证不会在页面回显');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <article className="add-card">
      <div>
        <h3>添加上游</h3>
        <p>上游是你向别人购买的外部中转，支持 New API 和 Sub2API。</p>
      </div>
      <form className="target-form" onSubmit={handleSubmit}>
        <label>
          <span>平台</span>
          <select name="upstreamPlatform" value={platform} onChange={(event) => setPlatform(event.target.value as Platform)}>
            <option value="sub2api">Sub2API</option>
            <option value="new_api">New API</option>
          </select>
        </label>
        <label>
          <span>名称</span>
          <input name="upstreamName" value={name} onChange={(event) => setName(event.target.value)} placeholder="词元 fast" required />
        </label>
        <label>
          <span>地址</span>
          <input name="upstreamBaseUrl" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://example.com" required />
        </label>
        {platform === 'sub2api' ? (
          <div className="form-grid">
            <label>
              <span>邮箱</span>
              <input name="upstreamEmail" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="owner@example.com" required />
            </label>
            <label>
              <span>密码</span>
              <input name="upstreamPassword" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            </label>
          </div>
        ) : (
          <label>
            <span>管理 Token</span>
            <input name="upstreamAdminToken" type="password" value={adminToken} onChange={(event) => setAdminToken(event.target.value)} required />
          </label>
        )}
        <div className="form-grid">
          <label>
            <span>余额低于</span>
            <input name="upstreamThresholdValue" type="number" min="0.01" step="0.01" value={thresholdValue} onChange={(event) => setThresholdValue(event.target.value)} required />
          </label>
          <label>
            <span>单位</span>
            <input name="upstreamThresholdUnit" value={thresholdUnit} onChange={(event) => setThresholdUnit(event.target.value)} required />
          </label>
        </div>
        <label>
          <span>续费方式</span>
          <select name="upstreamRenewalKind" value={renewalKind} onChange={(event) => setRenewalKind(event.target.value as RenewalKind)}>
            <option value="contact_owner">联系群主</option>
            <option value="manual">手动说明</option>
            <option value="payment_link">支付链接</option>
          </select>
        </label>
        <label>
          <span>{renewalKind === 'payment_link' ? '购买链接' : '处理说明'}</span>
          <textarea
            name="upstreamRenewalInstructions"
            value={renewalInstructions}
            onChange={(event) => setRenewalInstructions(event.target.value)}
            placeholder={renewalKind === 'payment_link' ? 'https://example.com/buy' : '群内 @owner，最低充值 $20'}
            required
          />
        </label>
        {!canSubmit && <p className="form-warning">先到设置页保存后端地址和 API Key。</p>}
        <button className="submit-button" type="submit" disabled={!canSubmit || submitting}>
          {submitting ? '保存中' : '保存上游'}
        </button>
      </form>
    </article>
  );
}

function PoolForm({
  settings,
  canSubmit,
  onCreated
}: {
  settings: ApiSettings;
  canSubmit: boolean;
  onCreated: (message: string) => Promise<void>;
}) {
  const [platform, setPlatform] = useState<Platform>('sub2api');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [adminToken, setAdminToken] = useState('');
  const [quotaAlertThresholdHours, setQuotaAlertThresholdHours] = useState('5');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    const credential: Record<string, string> = platform === 'sub2api' && email && password
      ? { kind: 'login', email, password }
      : { kind: 'admin_token', token: adminToken };
    const payload: CreatePoolPayload = {
      name,
      platform,
      base_url: baseUrl,
      credential,
      quota_alert_threshold_hours: Number(quotaAlertThresholdHours)
    };

    setSubmitting(true);
    try {
      await createPool(settings, payload);
      setPassword('');
      setAdminToken('');
      await onCreated('中转站已保存，凭证不会在页面回显');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <article className="add-card">
      <div>
        <h3>添加自己的中转站</h3>
        <p>这是你自己运营的中转站资源，先保存凭证，再由后端调度器巡检。</p>
      </div>
      <form className="target-form" onSubmit={handleSubmit}>
        <label>
          <span>平台</span>
          <select name="poolPlatform" value={platform} onChange={(event) => setPlatform(event.target.value as Platform)}>
            <option value="sub2api">Sub2API</option>
            <option value="new_api">New API</option>
          </select>
        </label>
        <label>
          <span>名称</span>
          <input name="poolName" value={name} onChange={(event) => setName(event.target.value)} placeholder="自营 Sub2API 号池" required />
        </label>
        <label>
          <span>地址</span>
          <input name="poolBaseUrl" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://self.example.com" required />
        </label>
        {platform === 'sub2api' ? (
          <>
            <label>
              <span>管理 Token</span>
              <input name="poolAdminToken" type="password" value={adminToken} onChange={(event) => setAdminToken(event.target.value)} placeholder="优先填写后台 token" />
            </label>
            <div className="form-grid">
              <label>
                <span>邮箱</span>
                <input name="poolEmail" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="可选" />
              </label>
              <label>
                <span>密码</span>
                <input name="poolPassword" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="可选" />
              </label>
            </div>
          </>
        ) : (
          <label>
            <span>管理 Token</span>
            <input name="poolAdminToken" type="password" value={adminToken} onChange={(event) => setAdminToken(event.target.value)} required />
          </label>
        )}
        <label>
          <span>额度低于几小时告警</span>
          <input
            name="poolQuotaAlertThresholdHours"
            type="number"
            min="0.1"
            step="0.1"
            value={quotaAlertThresholdHours}
            onChange={(event) => setQuotaAlertThresholdHours(event.target.value)}
            required
          />
        </label>
        {!canSubmit && <p className="form-warning">先到设置页保存后端地址和 API Key。</p>}
        <button className="submit-button" type="submit" disabled={!canSubmit || submitting}>
          {submitting ? '保存中' : '保存中转站'}
        </button>
      </form>
    </article>
  );
}

function SettingsPanel({
  settings,
  defaultBusinessView,
  onSettingsSave,
  onDefaultBusinessViewChange
}: {
  settings: ApiSettings;
  defaultBusinessView: DefaultBusinessView;
  onSettingsSave: (settings: ApiSettings) => void;
  onDefaultBusinessViewChange: (view: DefaultBusinessView) => void;
}) {
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [apiKey, setApiKey] = useState(settings.apiKey);

  useEffect(() => {
    setBaseUrl(settings.baseUrl);
    setApiKey(settings.apiKey);
  }, [settings]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSettingsSave({ baseUrl, apiKey });
  }

  return (
    <>
      <SectionTitle title="设置" hint="私有部署优先" />
      <div className="list">
        <article className="item-card setting-card">
          <div>
            <h3>后端连接</h3>
            <p>保存后，前端会读取真实数据库并提交上游和中转站配置。</p>
          </div>
          <form className="target-form" onSubmit={handleSubmit}>
            <label>
              <span>后端地址</span>
              <input name="apiBaseUrl" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="http://localhost:8000" required />
            </label>
            <label>
              <span>API Key</span>
              <input name="apiKey" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} required />
            </label>
            <button className="submit-button" type="submit">保存连接</button>
          </form>
        </article>
        <article className="item-card setting-card">
          <div>
            <h3>默认首页</h3>
            <p>工作台第一组业务卡片默认显示：{defaultBusinessView === 'upstreams' ? '上游中转' : '号池巡检'}。</p>
          </div>
          <div className="segmented" aria-label="默认首页">
            <button
              className={defaultBusinessView === 'upstreams' ? 'selected' : ''}
              onClick={() => onDefaultBusinessViewChange('upstreams')}
            >
              上游
            </button>
            <button
              className={defaultBusinessView === 'pools' ? 'selected' : ''}
              onClick={() => onDefaultBusinessViewChange('pools')}
            >
              号池
            </button>
          </div>
        </article>
        <article className="item-card">
          <div>
            <h3>真实请求提醒</h3>
            <p>添加上游和中转站会写入正式数据库；通知测试仍请在后端谨慎操作。</p>
          </div>
          <StatusPill status={hasApiCredentials(settings) ? 'active' : 'pending_probe'} />
        </article>
      </div>
    </>
  );
}

function AppContent({
  tab,
  alerts,
  upstreams,
  pools,
  realMode,
  settings,
  defaultBusinessView,
  onSettingsSave,
  onDefaultBusinessViewChange,
  onCreated,
  onResolve,
  onSnooze,
  onRerun
}: {
  tab: Tab;
  alerts: AlertItem[];
  upstreams: Array<UpstreamItem | BackendUpstream>;
  pools: PoolItem[] | BackendPool[];
  realMode: boolean;
  settings: ApiSettings;
  defaultBusinessView: DefaultBusinessView;
  onSettingsSave: (settings: ApiSettings) => void;
  onDefaultBusinessViewChange: (view: DefaultBusinessView) => void;
  onCreated: (message: string) => Promise<void>;
  onResolve: (id: string) => void;
  onSnooze: (id: string) => void;
  onRerun: (id: string) => void;
}) {
  const canSubmit = hasApiCredentials(settings);

  if (tab === 'upstreams') {
    return (
      <>
        <SectionTitle title="上游续费" hint="余额低的优先" />
        <div className="list">
          <UpstreamForm settings={settings} canSubmit={canSubmit} onCreated={onCreated} />
          {upstreams.length ? upstreams.map((item) => <UpstreamCard key={item.id} upstream={item} />) : (
            <EmptyState title="还没有上游" body="保存第一个外部中转后，后端调度器会按阈值巡检余额。" />
          )}
        </div>
      </>
    );
  }

  if (tab === 'pools') {
    return (
      <>
        <SectionTitle title="号池巡检" hint="健康 10 分钟，额度 1.5 小时" />
        <div className="list">
          <PoolForm settings={settings} canSubmit={canSubmit} onCreated={onCreated} />
          {pools.length ? pools.map((pool) => (
            realMode
              ? <BackendPoolCard key={pool.id} pool={pool as BackendPool} />
              : <PoolQuotaCard key={pool.id} pool={pool as PoolItem} />
          )) : (
            <EmptyState title="还没有中转站" body="保存自己的中转站后，后端会记录健康和额度巡检结果。" />
          )}
        </div>
      </>
    );
  }

  if (tab === 'notifications') {
    return (
      <>
        <SectionTitle title="通知渠道" hint="核心提醒不依赖 PWA Push" />
        <div className="list">
          {notificationChannels.map((channel) => (
            <article className="item-card" key={channel.id}>
              <div>
                <h3>{channel.name}</h3>
                <p>状态：{channel.status} · 最近发送：{channel.lastSent}</p>
              </div>
              <button className="wide-button" disabled>后端配置</button>
            </article>
          ))}
        </div>
      </>
    );
  }

  if (tab === 'settings') {
    return (
      <SettingsPanel
        settings={settings}
        defaultBusinessView={defaultBusinessView}
        onSettingsSave={onSettingsSave}
        onDefaultBusinessViewChange={onDefaultBusinessViewChange}
      />
    );
  }

  return (
    <HomePage
      alerts={alerts}
      defaultBusinessView={defaultBusinessView}
      upstreams={upstreams}
      pools={pools}
      realMode={realMode}
      onResolve={onResolve}
      onSnooze={onSnooze}
      onRerun={onRerun}
    />
  );
}

function mapBackendAlerts(alerts: BackendAlert[]): AlertItem[] {
  return alerts.map((alert) => ({
    id: alert.id,
    type: alert.target_kind === 'pool' ? 'pool' : 'upstream',
    severity: alert.severity === 'critical' ? 'critical' : 'warning',
    title: alert.title || '后端告警',
    summary: alert.message || '等待进一步处理。',
    target: alert.target_id || '',
    actionLabel: '查看',
    acknowledged: alert.status !== 'open',
    snoozed: false
  }));
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [apiSettings, setApiSettings] = useState<ApiSettings>(() => getApiSettings());
  const [backendUpstreams, setBackendUpstreams] = useState<BackendUpstream[]>([]);
  const [backendPools, setBackendPools] = useState<BackendPool[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>(initialAlerts);
  const [defaultBusinessView, setDefaultBusinessView] = useState<DefaultBusinessView>('upstreams');
  const [toast, setToast] = useState('哨兵服务在线，2 分钟前同步');

  const realMode = hasApiCredentials(apiSettings);
  const visibleUpstreams = realMode ? backendUpstreams : mockUpstreams;
  const visiblePools = realMode ? backendPools : mockPools;

  async function refreshTargets(settings = apiSettings, message = '刚刚同步真实后端数据') {
    if (!hasApiCredentials(settings)) {
      setToast('未配置 API Key，当前显示预览数据');
      return;
    }

    try {
      const home = await listTargets(settings);
      setBackendUpstreams(home.upstreams || []);
      setBackendPools(home.pools || []);
      setAlerts(mapBackendAlerts(home.alerts || []));
      setDefaultBusinessView(home.default_business_view || 'upstreams');
      setToast(message);
    } catch (error) {
      setToast(error instanceof Error ? `后端连接失败：${error.message}` : '后端连接失败');
    }
  }

  useEffect(() => {
    if (realMode) {
      void refreshTargets(apiSettings, '已连接真实后端');
    }
  }, []);

  const title = useMemo(() => {
    return activeTab === 'home' ? '今天要处理'
      : activeTab === 'upstreams' ? '上游续费'
      : activeTab === 'pools' ? '号池巡检'
      : activeTab === 'notifications' ? '通知渠道'
      : '设置';
  }, [activeTab]);

  function updateAlert(id: string, patch: Partial<AlertItem>, message: string) {
    setAlerts((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
    setToast(message);
  }

  function handleSettingsSave(settings: ApiSettings) {
    const saved = saveApiSettings(settings);
    setApiSettings(saved);
    setToast('后端连接已保存');
    void refreshTargets(saved, '后端连接已保存');
  }

  async function handleCreated(message: string) {
    await refreshTargets(apiSettings, message);
  }

  return (
    <>
      <main className="app">
        <TopBar title={title} subtitle={toast} onRefresh={() => void refreshTargets(apiSettings)} />
        <AppContent
          tab={activeTab}
          alerts={alerts}
          upstreams={visibleUpstreams}
          pools={visiblePools}
          realMode={realMode}
          settings={apiSettings}
          defaultBusinessView={defaultBusinessView}
          onSettingsSave={handleSettingsSave}
          onDefaultBusinessViewChange={(view) => {
            setDefaultBusinessView(view);
            setToast(view === 'upstreams' ? '默认首页已切到上游中转' : '默认首页已切到号池巡检');
          }}
          onCreated={handleCreated}
          onResolve={(id) => updateAlert(id, { acknowledged: true }, '已标记处理，后续恢复时会通知')}
          onSnooze={(id) => updateAlert(id, { snoozed: true }, '已暂停提醒 6 小时')}
          onRerun={(id) => updateAlert(id, {}, '已发起复查，结果会写入事件流')}
        />
      </main>
      <nav className="bottom-nav" aria-label="主导航">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </nav>
    </>
  );
}
