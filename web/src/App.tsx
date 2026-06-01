import { useMemo, useState } from 'react';
import { initialAlerts, notificationChannels, pools, upstreams, type AlertItem, type PoolItem, type UpstreamItem } from './data/mockData';
import { isQuotaBelowThreshold, predictHoursRemaining } from './domain/quota';

type Tab = 'home' | 'upstreams' | 'pools' | 'notifications' | 'settings';

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

function StatusPill({ status }: { status: 'normal' | 'warning' | 'critical' | string }) {
  const label = status === 'normal' ? '正常' : status === 'warning' ? '预警' : status === 'critical' ? '处理' : status;
  return <span className={`status ${status}`}>{label}</span>;
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

function UpstreamCard({ upstream }: { upstream: UpstreamItem }) {
  return (
    <article className="item-card">
      <div>
        <h3>{upstream.name}</h3>
        <p>{upstream.platform} · 余额 {upstream.balance}，阈值 {upstream.threshold}</p>
      </div>
      <StatusPill status={upstream.status} />
      <button className="wide-button">{upstream.renewal}</button>
    </article>
  );
}

function HomePage({
  alerts,
  onResolve,
  onSnooze,
  onRerun
}: {
  alerts: AlertItem[];
  onResolve: (id: string) => void;
  onSnooze: (id: string) => void;
  onRerun: (id: string) => void;
}) {
  const activeAlerts = alerts.filter((alert) => !alert.acknowledged && !alert.snoozed);
  const primaryAlert = activeAlerts[0];

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
        <div className="mini"><span>上游预警</span><strong>{upstreams.filter((item) => item.status !== 'normal').length}</strong></div>
        <div className="mini"><span>号池预警</span><strong>{pools.filter((pool) => pool.failedAccounts > 0).length}</strong></div>
        <div className="mini"><span>未处理</span><strong>{activeAlerts.length}</strong></div>
      </section>

      <SectionTitle title="号池快照" hint="每 1.5 小时预测" />
      <div className="list">
        {pools.map((pool) => <PoolQuotaCard key={pool.id} pool={pool} />)}
      </div>
    </>
  );
}

function SectionTitle({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      <span>{hint}</span>
    </div>
  );
}

function AppContent({
  tab,
  alerts,
  onResolve,
  onSnooze,
  onRerun
}: {
  tab: Tab;
  alerts: AlertItem[];
  onResolve: (id: string) => void;
  onSnooze: (id: string) => void;
  onRerun: (id: string) => void;
}) {
  if (tab === 'upstreams') {
    return (
      <>
        <SectionTitle title="上游续费" hint="余额低的优先" />
        <div className="list">{upstreams.map((item) => <UpstreamCard key={item.id} upstream={item} />)}</div>
      </>
    );
  }

  if (tab === 'pools') {
    return (
      <>
        <SectionTitle title="号池巡检" hint="健康 10 分钟，额度 1.5 小时" />
        <div className="list">{pools.map((pool) => <PoolQuotaCard key={pool.id} pool={pool} />)}</div>
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
              <button className="wide-button">测试</button>
            </article>
          ))}
        </div>
      </>
    );
  }

  if (tab === 'settings') {
    return (
      <>
        <SectionTitle title="设置" hint="私有部署优先" />
        <div className="list">
          <article className="item-card">
            <div>
              <h3>添加到主屏幕</h3>
              <p>安卓 Chrome 打开后选择“添加到主屏幕”，像 App 一样启动。</p>
            </div>
          </article>
          <article className="item-card">
            <div>
              <h3>哨兵服务</h3>
              <p>巡检运行在服务器端，手机只负责查看和处理。</p>
            </div>
            <StatusPill status="normal" />
          </article>
        </div>
      </>
    );
  }

  return <HomePage alerts={alerts} onResolve={onResolve} onSnooze={onSnooze} onRerun={onRerun} />;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [alerts, setAlerts] = useState<AlertItem[]>(initialAlerts);
  const [toast, setToast] = useState('哨兵服务在线，2 分钟前同步');

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

  return (
    <>
      <main className="app">
        <TopBar title={title} subtitle={toast} onRefresh={() => setToast('刚刚手动刷新，等待下一次哨兵结果')} />
        <AppContent
          tab={activeTab}
          alerts={alerts}
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
