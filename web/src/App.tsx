import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  createPool,
  createUpstream,
  deletePool,
  deleteUpstream,
  getApiSettings,
  hasApiCredentials,
  listTargets,
  runPoolHealthCheck,
  runPoolQuotaCheck,
  runUpstreamBalanceCheck,
  saveApiSettings,
  updatePool,
  updateUpstream,
  type ApiSettings,
  type BackendAlert,
  type BackendPool,
  type BackendUpstream,
  type CreatePoolPayload,
  type CreateUpstreamPayload,
  type Platform,
  type RenewalKind,
  type UpdatePoolPayload,
  type UpdateUpstreamPayload
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

function isActionableWarningStatus(status?: string): boolean {
  return ['warning', 'critical', 'low_balance', 'low_quota', 'unhealthy', 'failed', 'blocked'].includes(status || 'normal');
}

function StatusPill({ status }: { status: string }) {
  const normalized = normalizeStatus(status);
  return <span className={`status ${normalized}`}>{statusLabel(status)}</span>;
}

function maskSecret(value: string): string {
  if (!value) return '未保存';
  if (value.length <= 8) return '已保存';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
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

function UpstreamCard({
  upstream,
  managementMode = false,
  onUpdate,
  onDelete,
  onRunBalanceCheck
}: {
  upstream: UpstreamItem | BackendUpstream;
  managementMode?: boolean;
  onUpdate?: (id: string, payload: UpdateUpstreamPayload) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  onRunBalanceCheck?: (id: string) => Promise<void>;
}) {
  const isBackend = 'base_url' in upstream;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(upstream.name);
  const [baseUrl, setBaseUrl] = useState(isBackend ? upstream.base_url : '');
  const [thresholdValue, setThresholdValue] = useState(isBackend ? String(upstream.threshold?.value ?? 10) : '10');
  const [thresholdUnit, setThresholdUnit] = useState(isBackend ? upstream.threshold?.unit || 'USD' : 'USD');
  const [renewalKind, setRenewalKind] = useState<RenewalKind>(isBackend ? upstream.renewal?.kind || 'manual' : 'manual');
  const [renewalInstructions, setRenewalInstructions] = useState(
    isBackend ? upstream.renewal?.url || upstream.renewal?.instructions || '' : ''
  );
  const [credentialToken, setCredentialToken] = useState('');
  const [credentialEmail, setCredentialEmail] = useState('');
  const [credentialPassword, setCredentialPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [checkingBalance, setCheckingBalance] = useState(false);
  const threshold = isBackend
    ? `${upstream.threshold?.value ?? '-'} ${upstream.threshold?.unit ?? ''}`.trim()
    : upstream.threshold;
  const renewal = isBackend ? renewalLabel(upstream.renewal?.kind || 'manual') : upstream.renewal;
  const status = isBackend ? upstream.status || 'pending_probe' : upstream.status;

  const balanceText = isBackend
    ? (upstream.last_balance_value != null
        ? `${upstream.last_balance_value} ${upstream.last_balance_unit || ''}`.trim()
        : '待巡检')
    : upstream.balance;

  useEffect(() => {
    setEditing(false);
  }, [managementMode]);

  useEffect(() => {
    setName(upstream.name);
    if (isBackend) {
      setBaseUrl(upstream.base_url);
      setThresholdValue(String(upstream.threshold?.value ?? 10));
      setThresholdUnit(upstream.threshold?.unit || 'USD');
      setRenewalKind(upstream.renewal?.kind || 'manual');
      setRenewalInstructions(upstream.renewal?.url || upstream.renewal?.instructions || '');
      setCredentialToken('');
      setCredentialEmail('');
      setCredentialPassword('');
    }
  }, [isBackend, upstream]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isBackend || !onUpdate) return;

    const credential: Record<string, string> | undefined = upstream.platform === 'new_api'
      ? (credentialToken ? { kind: 'admin_token', token: credentialToken } : undefined)
      : (credentialEmail || credentialPassword
          ? { kind: 'login', email: credentialEmail, password: credentialPassword }
          : undefined);
    if (upstream.platform === 'sub2api' && (credentialEmail || credentialPassword) && !(credentialEmail && credentialPassword)) {
      return;
    }
    const payload: UpdateUpstreamPayload = {
      name,
      base_url: baseUrl,
      ...(credential ? { credential } : {}),
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
      await onUpdate(upstream.id, payload);
      setEditing(false);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRunBalanceCheck() {
    if (!isBackend || !onRunBalanceCheck) return;

    setCheckingBalance(true);
    try {
      await onRunBalanceCheck(upstream.id);
    } finally {
      setCheckingBalance(false);
    }
  }

  if (isBackend && managementMode && editing) {
    return (
      <article className="item-card edit-card">
        <form className="target-form" onSubmit={handleSave}>
          <label>
            <span>名称</span>
            <input name="editUpstreamName" value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <label>
            <span>地址</span>
            <input name="editUpstreamBaseUrl" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} required />
          </label>
          <div className="form-grid">
            <label>
              <span>余额低于</span>
              <input name="editUpstreamThresholdValue" type="number" min="0.01" step="0.01" value={thresholdValue} onChange={(event) => setThresholdValue(event.target.value)} required />
            </label>
            <label>
              <span>单位</span>
              <input name="editUpstreamThresholdUnit" value={thresholdUnit} onChange={(event) => setThresholdUnit(event.target.value)} required />
            </label>
          </div>
          <label>
            <span>续费方式</span>
            <select name="editUpstreamRenewalKind" value={renewalKind} onChange={(event) => setRenewalKind(event.target.value as RenewalKind)}>
              <option value="contact_owner">联系群主</option>
              <option value="manual">手动说明</option>
              <option value="payment_link">支付链接</option>
            </select>
          </label>
          <label>
            <span>{renewalKind === 'payment_link' ? '购买链接' : '处理说明'}</span>
            <textarea
              name="editUpstreamRenewalInstructions"
              value={renewalInstructions}
              onChange={(event) => setRenewalInstructions(event.target.value)}
              required
            />
          </label>
          {upstream.platform === 'new_api' ? (
            <label>
              <span>更新管理 Token</span>
              <input
                name="editUpstreamAdminToken"
                type="password"
                value={credentialToken}
                onChange={(event) => setCredentialToken(event.target.value)}
                placeholder="留空则不修改"
              />
            </label>
          ) : (
            <div className="form-grid">
              <label>
                <span>更新邮箱</span>
                <input
                  name="editUpstreamEmail"
                  value={credentialEmail}
                  onChange={(event) => setCredentialEmail(event.target.value)}
                  placeholder="留空则不修改"
                />
              </label>
              <label>
                <span>更新密码</span>
                <input
                  name="editUpstreamPassword"
                  type="password"
                  value={credentialPassword}
                  onChange={(event) => setCredentialPassword(event.target.value)}
                  placeholder="留空则不修改"
                />
              </label>
            </div>
          )}
          <div className="management-actions">
            <button className="submit-button" type="submit" disabled={submitting}>{submitting ? '保存中' : '保存修改'}</button>
            <button className="secondary-button" type="button" onClick={() => setEditing(false)}>取消</button>
          </div>
        </form>
      </article>
    );
  }

  return (
    <article className="item-card">
      <div>
        <h3>{upstream.name}</h3>
        <p>
          {platformLabel(upstream.platform)}
          {isBackend ? ` · ${upstream.base_url}` : ''} · 阈值 {threshold}
        </p>
      </div>
      <StatusPill status={status} />
      <div className={`balance-metric ${status === 'failed' || status === 'blocked' ? 'failed' : ''}`}>
        <span>余额</span>
        <strong>{balanceText}</strong>
      </div>
      <button
        className="wide-button"
        type="button"
        onClick={() => {
          if (isBackend && upstream.renewal?.kind === 'payment_link' && upstream.renewal.url) {
            window.open(upstream.renewal.url, '_blank', 'noopener,noreferrer');
          }
        }}
      >
        {isBackend ? upstream.renewal?.label || renewal : renewal}
      </button>
      {isBackend && (
        <button className="wide-button check-button" type="button" onClick={() => void handleRunBalanceCheck()} disabled={checkingBalance}>
          {checkingBalance ? '巡检中' : '查余额'}
        </button>
      )}
      {isBackend && managementMode && (
        <div className="management-actions">
          <button className="secondary-button" type="button" onClick={() => setEditing(true)}>编辑</button>
          <button className="danger-button" type="button" onClick={() => void onDelete?.(upstream.id)}>删除</button>
        </div>
      )}
    </article>
  );
}

function BackendPoolCard({
  pool,
  managementMode = false,
  onUpdate,
  onDelete,
  onRunHealthCheck,
  onRunQuotaCheck
}: {
  pool: BackendPool;
  managementMode?: boolean;
  onUpdate?: (id: string, payload: UpdatePoolPayload) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  onRunHealthCheck?: (id: string) => Promise<void>;
  onRunQuotaCheck?: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(pool.name);
  const [baseUrl, setBaseUrl] = useState(pool.base_url);
  const [quotaAlertThresholdHours, setQuotaAlertThresholdHours] = useState(String(pool.quota_alert_threshold_hours ?? 5));
  const [credentialToken, setCredentialToken] = useState('');
  const [credentialEmail, setCredentialEmail] = useState('');
  const [credentialPassword, setCredentialPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [checkingQuota, setCheckingQuota] = useState(false);
  const healthTime = pool.last_health_checked_at
    ? new Date(pool.last_health_checked_at).toLocaleString()
    : '待巡检';
  const quotaTime = pool.last_quota_checked_at
    ? new Date(pool.last_quota_checked_at).toLocaleString()
    : '待巡检';

  useEffect(() => {
    setEditing(false);
  }, [managementMode]);

  useEffect(() => {
    setName(pool.name);
    setBaseUrl(pool.base_url);
    setQuotaAlertThresholdHours(String(pool.quota_alert_threshold_hours ?? 5));
    setCredentialToken('');
    setCredentialEmail('');
    setCredentialPassword('');
  }, [pool]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onUpdate) return;

    const credential: Record<string, string> | undefined = pool.platform === 'new_api'
      ? (credentialToken ? { kind: 'admin_token', token: credentialToken } : undefined)
      : (credentialEmail || credentialPassword
          ? { kind: 'login', email: credentialEmail, password: credentialPassword }
          : undefined);
    if (pool.platform === 'sub2api' && (credentialEmail || credentialPassword) && !(credentialEmail && credentialPassword)) {
      return;
    }

    setSubmitting(true);
    try {
      await onUpdate(pool.id, {
        name,
        base_url: baseUrl,
        ...(credential ? { credential } : {}),
        quota_alert_threshold_hours: Number(quotaAlertThresholdHours)
      });
      setEditing(false);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRunHealthCheck() {
    if (!onRunHealthCheck) return;

    setCheckingHealth(true);
    try {
      await onRunHealthCheck(pool.id);
    } finally {
      setCheckingHealth(false);
    }
  }

  async function handleRunQuotaCheck() {
    if (!onRunQuotaCheck) return;

    setCheckingQuota(true);
    try {
      await onRunQuotaCheck(pool.id);
    } finally {
      setCheckingQuota(false);
    }
  }

  if (managementMode && editing) {
    return (
      <article className="item-card edit-card">
        <form className="target-form" onSubmit={handleSave}>
          <label>
            <span>名称</span>
            <input name="editPoolName" value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <label>
            <span>地址</span>
            <input name="editPoolBaseUrl" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} required />
          </label>
          <label>
            <span>额度低于几小时告警</span>
            <input
              name="editPoolQuotaAlertThresholdHours"
              type="number"
              min="0.1"
              step="0.1"
              value={quotaAlertThresholdHours}
              onChange={(event) => setQuotaAlertThresholdHours(event.target.value)}
              required
            />
          </label>
          {pool.platform === 'new_api' ? (
            <label>
              <span>更新管理 Token</span>
              <input
                name="editPoolAdminToken"
                type="password"
                value={credentialToken}
                onChange={(event) => setCredentialToken(event.target.value)}
                placeholder="留空则不修改"
              />
            </label>
          ) : (
            <div className="form-grid">
              <label>
                <span>更新邮箱</span>
                <input
                  name="editPoolEmail"
                  value={credentialEmail}
                  onChange={(event) => setCredentialEmail(event.target.value)}
                  placeholder="留空则不修改"
                />
              </label>
              <label>
                <span>更新密码</span>
                <input
                  name="editPoolPassword"
                  type="password"
                  value={credentialPassword}
                  onChange={(event) => setCredentialPassword(event.target.value)}
                  placeholder="留空则不修改"
                />
              </label>
            </div>
          )}
          <div className="management-actions">
            <button className="submit-button" type="submit" disabled={submitting}>{submitting ? '保存中' : '保存修改'}</button>
            <button className="secondary-button" type="button" onClick={() => setEditing(false)}>取消</button>
          </div>
        </form>
      </article>
    );
  }

  return (
    <article className="item-card">
      <div>
        <h3>{pool.name}</h3>
        <p>
          {platformLabel(pool.platform)} · {pool.base_url}
          · 告警阈值 {pool.quota_alert_threshold_hours ?? '-'}h
        </p>
      </div>
      <StatusPill status={pool.status || 'pending_probe'} />
      <div className="wide-note">
        <div>账号健康：{healthTime}</div>
        <div>额度巡检：{quotaTime}</div>
      </div>
      <div className="check-actions">
        <button className="wide-button check-button" type="button" onClick={() => void handleRunHealthCheck()} disabled={checkingHealth}>
          {checkingHealth ? '巡检中' : '查健康'}
        </button>
        <button className="wide-button check-button" type="button" onClick={() => void handleRunQuotaCheck()} disabled={checkingQuota}>
          {checkingQuota ? '巡检中' : '查额度'}
        </button>
      </div>
      {managementMode && (
        <div className="management-actions">
          <button className="secondary-button" type="button" onClick={() => setEditing(true)}>编辑</button>
          <button className="danger-button" type="button" onClick={() => void onDelete?.(pool.id)}>删除</button>
        </div>
      )}
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

function SectionHeader({
  title,
  hint,
  managementMode,
  onManagementModeChange
}: {
  title: string;
  hint: string;
  managementMode: boolean;
  onManagementModeChange: (enabled: boolean) => void;
}) {
  return (
    <div className="section-title section-header">
      <div>
        <h2>{title}</h2>
        <span>{hint}</span>
      </div>
      <button
        className={`manage-toggle ${managementMode ? 'active' : ''}`}
        type="button"
        onClick={() => onManagementModeChange(!managementMode)}
      >
        {managementMode ? '完成' : '管理'}
      </button>
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
  onUpdateUpstream,
  onDeleteUpstream,
  onResolve,
  onSnooze,
  onRerun
}: {
  alerts: AlertItem[];
  defaultBusinessView: DefaultBusinessView;
  upstreams: Array<UpstreamItem | BackendUpstream>;
  pools: PoolItem[] | BackendPool[];
  realMode: boolean;
  onUpdateUpstream: (id: string, payload: UpdateUpstreamPayload) => Promise<void>;
  onDeleteUpstream: (id: string) => Promise<void>;
  onResolve: (id: string) => void;
  onSnooze: (id: string) => void;
  onRerun: (id: string) => void;
}) {
  const activeAlerts = alerts.filter((alert) => !alert.acknowledged && !alert.snoozed);
  const primaryAlert = activeAlerts[0];
  const showUpstreamsFirst = defaultBusinessView === 'upstreams';
  const upstreamWarningCount = upstreams.filter((item) => isActionableWarningStatus(item.status)).length;
  const poolWarningCount = pools.filter((pool) => {
    if ('failedAccounts' in pool) return pool.failedAccounts > 0;
    return isActionableWarningStatus(pool.status);
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
          <TargetList kind="upstreams" upstreams={upstreams} pools={pools} realMode={realMode} onUpdateUpstream={onUpdateUpstream} onDeleteUpstream={onDeleteUpstream} />
          <SectionTitle title="号池快照" hint={realMode ? '真实后端数据' : '每 1.5 小时预测'} />
          <TargetList kind="pools" upstreams={upstreams} pools={realMode ? (pools as BackendPool[]).slice(0, 1) : (pools as PoolItem[]).slice(0, 1)} realMode={realMode} compact />
        </>
      ) : (
        <>
          <SectionTitle title="号池快照" hint={realMode ? '真实后端数据' : '每 1.5 小时预测'} />
          <TargetList kind="pools" upstreams={upstreams} pools={pools} realMode={realMode} />
          <SectionTitle title="上游中转" hint={realMode ? '真实后端数据' : '余额低的优先处理'} />
          <TargetList kind="upstreams" upstreams={upstreams.slice(0, 2)} pools={pools} realMode={realMode} compact onUpdateUpstream={onUpdateUpstream} onDeleteUpstream={onDeleteUpstream} />
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
  onUpdateUpstream,
  onDeleteUpstream,
  onRunUpstreamBalanceCheck,
  onUpdatePool,
  onDeletePool,
  onRunPoolHealthCheck,
  onRunPoolQuotaCheck,
  compact
}: {
  kind: 'upstreams' | 'pools';
  upstreams: Array<UpstreamItem | BackendUpstream>;
  pools: PoolItem[] | BackendPool[];
  realMode: boolean;
  onUpdateUpstream?: (id: string, payload: UpdateUpstreamPayload) => Promise<void>;
  onDeleteUpstream?: (id: string) => Promise<void>;
  onRunUpstreamBalanceCheck?: (id: string) => Promise<void>;
  onUpdatePool?: (id: string, payload: UpdatePoolPayload) => Promise<void>;
  onDeletePool?: (id: string) => Promise<void>;
  onRunPoolHealthCheck?: (id: string) => Promise<void>;
  onRunPoolQuotaCheck?: (id: string) => Promise<void>;
  compact?: boolean;
}) {
  if (kind === 'upstreams') {
    return (
      <div className={`list ${compact ? 'compact-list' : ''}`}>
        {upstreams.length ? upstreams.map((item) => (
          <UpstreamCard
            key={item.id}
            upstream={item}
            onUpdate={onUpdateUpstream}
            onDelete={onDeleteUpstream}
            onRunBalanceCheck={onRunUpstreamBalanceCheck}
          />
        )) : (
          <EmptyState title="还没有上游" body="配置真实后端后，可以在上游页添加外部中转。" />
        )}
      </div>
    );
  }

  return (
    <div className={`list ${compact ? 'compact-list' : ''}`}>
      {pools.length ? pools.map((pool) => (
        realMode
          ? (
            <BackendPoolCard
              key={pool.id}
              pool={pool as BackendPool}
              onUpdate={onUpdatePool}
              onDelete={onDeletePool}
              onRunHealthCheck={onRunPoolHealthCheck}
              onRunQuotaCheck={onRunPoolQuotaCheck}
            />
          )
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
  onCreated,
  onError
}: {
  settings: ApiSettings;
  canSubmit: boolean;
  onCreated: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [platform, setPlatform] = useState<Platform>('new_api');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [adminToken, setAdminToken] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [thresholdValue, setThresholdValue] = useState('10');
  const [thresholdUnit, setThresholdUnit] = useState('USD');
  const [renewalKind, setRenewalKind] = useState<RenewalKind>('contact_owner');
  const [renewalInstructions, setRenewalInstructions] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const formValid = platform === 'new_api'
    ? Boolean(name && baseUrl && adminToken)
    : Boolean(name && baseUrl && email && password);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || !formValid) return;

    const credential: Record<string, string> = platform === 'new_api'
      ? { kind: 'admin_token', token: adminToken }
      : { kind: 'login', email, password };
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
    } catch (error) {
      onError(error instanceof Error ? `上游保存失败：${error.message}` : '上游保存失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <article className="add-card">
      <div>
        <h3>添加上游</h3>
        <p>上游是你向别人购买的外部中转。支持 New API（管理 Token）和 Sub2API（邮箱+密码）两种方式。</p>
      </div>
      <form className="target-form" onSubmit={handleSubmit}>
        <label>
          <span>平台</span>
          <select name="upstreamPlatform" value={platform} onChange={(event) => setPlatform(event.target.value as Platform)}>
            <option value="new_api">New API</option>
            <option value="sub2api">Sub2API</option>
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
        {platform === 'new_api' ? (
          <label>
            <span>管理 Token</span>
            <input name="upstreamAdminToken" type="password" value={adminToken} onChange={(event) => setAdminToken(event.target.value)} placeholder="sk-..." required />
          </label>
        ) : (
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
        <button className="submit-button" type="submit" disabled={!canSubmit || !formValid || submitting}>
          {submitting ? '保存中' : '保存上游'}
        </button>
      </form>
    </article>
  );
}

function PoolForm({
  settings,
  canSubmit,
  onCreated,
  onError
}: {
  settings: ApiSettings;
  canSubmit: boolean;
  onCreated: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [platform, setPlatform] = useState<Platform>('sub2api');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [adminToken, setAdminToken] = useState('');
  const [quotaAlertThresholdHours, setQuotaAlertThresholdHours] = useState('5');
  const [submitting, setSubmitting] = useState(false);

  const credentialValid = platform === 'new_api'
    ? Boolean(adminToken)
    : Boolean(email && password);

  const formValid = Boolean(name && baseUrl && credentialValid);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || !formValid) return;

    const credential: Record<string, string> = platform === 'sub2api'
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
    } catch (error) {
      onError(error instanceof Error ? `中转站保存失败：${error.message}` : '中转站保存失败');
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
            <div className="form-grid">
              <label>
                <span>邮箱</span>
                <input name="poolEmail" value={email} onChange={(event) => setEmail(event.target.value)} required />
              </label>
              <label>
                <span>密码</span>
                <input name="poolPassword" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
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
        <button className="submit-button" type="submit" disabled={!canSubmit || !formValid || submitting}>
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
            <p>当前地址：{settings.baseUrl} · API Key：{maskSecret(settings.apiKey)}</p>
          </div>
          <form className="target-form" onSubmit={handleSubmit}>
            <label>
              <span>后端地址</span>
              <input name="apiBaseUrl" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="http://127.0.0.1:8000" required />
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
  onError,
  onUpdateUpstream,
  onDeleteUpstream,
  onRunUpstreamBalanceCheck,
  onUpdatePool,
  onDeletePool,
  onRunPoolHealthCheck,
  onRunPoolQuotaCheck,
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
  onError: (message: string) => void;
  onUpdateUpstream: (id: string, payload: UpdateUpstreamPayload) => Promise<void>;
  onDeleteUpstream: (id: string) => Promise<void>;
  onRunUpstreamBalanceCheck: (id: string) => Promise<void>;
  onUpdatePool: (id: string, payload: UpdatePoolPayload) => Promise<void>;
  onDeletePool: (id: string) => Promise<void>;
  onRunPoolHealthCheck: (id: string) => Promise<void>;
  onRunPoolQuotaCheck: (id: string) => Promise<void>;
  onResolve: (id: string) => void;
  onSnooze: (id: string) => void;
  onRerun: (id: string) => void;
}) {
  const canSubmit = hasApiCredentials(settings);
  const [showUpstreamForm, setShowUpstreamForm] = useState(false);
  const [showPoolForm, setShowPoolForm] = useState(false);
  const [manageUpstreams, setManageUpstreams] = useState(false);
  const [managePools, setManagePools] = useState(false);

  async function handleUpstreamCreated(message: string) {
    await onCreated(message);
    setShowUpstreamForm(false);
  }

  async function handlePoolCreated(message: string) {
    await onCreated(message);
    setShowPoolForm(false);
  }

  if (tab === 'upstreams') {
    return (
      <>
        <SectionHeader
          title="上游续费"
          hint="余额低的优先"
          managementMode={manageUpstreams}
          onManagementModeChange={setManageUpstreams}
        />
        <div className="list">
          {showUpstreamForm ? (
            <UpstreamForm settings={settings} canSubmit={canSubmit} onCreated={handleUpstreamCreated} onError={onError} />
          ) : (
            <button className="fold-button" type="button" onClick={() => setShowUpstreamForm(true)}>添加上游</button>
          )}
          {upstreams.length ? upstreams.map((item) => (
            <UpstreamCard
              key={item.id}
              upstream={item}
              managementMode={manageUpstreams}
              onUpdate={onUpdateUpstream}
              onDelete={onDeleteUpstream}
              onRunBalanceCheck={onRunUpstreamBalanceCheck}
            />
          )) : (
            <EmptyState title="还没有上游" body="保存第一个外部中转后，后端调度器会按阈值巡检余额。" />
          )}
        </div>
      </>
    );
  }

  if (tab === 'pools') {
    return (
      <>
        <SectionHeader
          title="号池巡检"
          hint="健康 10 分钟，额度 1.5 小时"
          managementMode={managePools}
          onManagementModeChange={setManagePools}
        />
        <div className="list">
          {showPoolForm ? (
            <PoolForm settings={settings} canSubmit={canSubmit} onCreated={handlePoolCreated} onError={onError} />
          ) : (
            <button className="fold-button" type="button" onClick={() => setShowPoolForm(true)}>添加中转站</button>
          )}
          {pools.length ? pools.map((pool) => (
            realMode
              ? (
                <BackendPoolCard
                  key={pool.id}
                  pool={pool as BackendPool}
                  managementMode={managePools}
                  onUpdate={onUpdatePool}
                  onDelete={onDeletePool}
                  onRunHealthCheck={onRunPoolHealthCheck}
                  onRunQuotaCheck={onRunPoolQuotaCheck}
                />
              )
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
      onUpdateUpstream={onUpdateUpstream}
      onDeleteUpstream={onDeleteUpstream}
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

  async function refreshTargets(settings = apiSettings, message = '刚刚同步真实后端数据', failurePrefix = '后端连接失败') {
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
      setToast(error instanceof Error ? `${failurePrefix}：${error.message}` : failurePrefix);
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
    void refreshTargets(saved, '后端连接已保存', '后端连接已保存，但连通测试失败');
  }

  async function handleCreated(message: string) {
    await refreshTargets(apiSettings, message);
  }

  async function handleUpdateUpstream(id: string, payload: UpdateUpstreamPayload) {
    try {
      await updateUpstream(apiSettings, id, payload);
      await refreshTargets(apiSettings, '上游已更新');
    } catch (error) {
      setToast(error instanceof Error ? `上游更新失败：${error.message}` : '上游更新失败');
    }
  }

  async function handleDeleteUpstream(id: string) {
    if (!window.confirm('确定删除这个上游吗？')) return;
    try {
      await deleteUpstream(apiSettings, id);
      await refreshTargets(apiSettings, '上游已删除');
    } catch (error) {
      setToast(error instanceof Error ? `上游删除失败：${error.message}` : '上游删除失败');
    }
  }

  async function handleRunUpstreamBalanceCheck(id: string) {
    try {
      const result = await runUpstreamBalanceCheck(apiSettings, id);
      const message = result.result === 'ok'
        ? '上游余额巡检完成'
        : `上游余额巡检失败：${result.message || result.result}`;
      await refreshTargets(apiSettings, message);
    } catch (error) {
      setToast(error instanceof Error ? `上游余额巡检失败：${error.message}` : '上游余额巡检失败');
    }
  }

  async function handleUpdatePool(id: string, payload: UpdatePoolPayload) {
    try {
      await updatePool(apiSettings, id, payload);
      await refreshTargets(apiSettings, '中转站已更新');
    } catch (error) {
      setToast(error instanceof Error ? `中转站更新失败：${error.message}` : '中转站更新失败');
    }
  }

  async function handleDeletePool(id: string) {
    if (!window.confirm('确定删除这个中转站吗？')) return;
    try {
      await deletePool(apiSettings, id);
      await refreshTargets(apiSettings, '中转站已删除');
    } catch (error) {
      setToast(error instanceof Error ? `中转站删除失败：${error.message}` : '中转站删除失败');
    }
  }

  async function handleRunPoolHealthCheck(id: string) {
    try {
      const result = await runPoolHealthCheck(apiSettings, id);
      const message = result.result === 'ok'
        ? '号池健康巡检完成'
        : `号池健康巡检失败：${result.message || result.result}`;
      await refreshTargets(apiSettings, message);
    } catch (error) {
      setToast(error instanceof Error ? `号池健康巡检失败：${error.message}` : '号池健康巡检失败');
    }
  }

  async function handleRunPoolQuotaCheck(id: string) {
    try {
      const result = await runPoolQuotaCheck(apiSettings, id);
      const message = result.result === 'ok'
        ? '号池额度巡检完成'
        : `号池额度巡检失败：${result.message || result.result}`;
      await refreshTargets(apiSettings, message);
    } catch (error) {
      setToast(error instanceof Error ? `号池额度巡检失败：${error.message}` : '号池额度巡检失败');
    }
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
          onError={setToast}
          onUpdateUpstream={handleUpdateUpstream}
          onDeleteUpstream={handleDeleteUpstream}
          onRunUpstreamBalanceCheck={handleRunUpstreamBalanceCheck}
          onUpdatePool={handleUpdatePool}
          onDeletePool={handleDeletePool}
          onRunPoolHealthCheck={handleRunPoolHealthCheck}
          onRunPoolQuotaCheck={handleRunPoolQuotaCheck}
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
