export type AlertSeverity = 'warning' | 'critical';
export type AlertType = 'pool' | 'upstream';

export interface AlertItem {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  summary: string;
  target: string;
  actionLabel: string;
  actionUrl?: string;
  contact?: string;
  acknowledged: boolean;
  snoozed: boolean;
}

export interface UpstreamItem {
  id: string;
  name: string;
  platform: 'New API' | 'Sub2API';
  balance: string;
  threshold: string;
  renewal: '支付链接' | '联系群主' | '手动说明';
  status: 'normal' | 'warning' | 'critical';
}

export interface PoolItem {
  id: string;
  name: string;
  platform: 'New API' | 'Sub2API';
  successAccounts: number;
  totalAccounts: number;
  failedAccounts: number;
  fiveHourRemainingPercent: number;
  fiveHourBurnRate: number;
  sevenDayRemainingPercent: number;
  sevenDayBurnRate: number;
}

export const initialAlerts: AlertItem[] = [
  {
    id: 'codex-main-pool',
    type: 'pool',
    severity: 'critical',
    title: 'Codex 主号池快撑不住了',
    summary: '5H 预计还能撑 4.8 小时，低于 5 小时提醒阈值。账号 44/45 成功，1 失败。',
    target: 'Codex 主号池',
    actionLabel: '查看号池',
    acknowledged: false,
    snoozed: false
  },
  {
    id: 'sub2api-owner-a',
    type: 'upstream',
    severity: 'warning',
    title: '群主 A 的 Sub2API 余额不足',
    summary: '余额 $4.1，阈值 $10。需要群内 @owner，最低充值 $20。',
    target: '群主 A 的 Sub2API',
    actionLabel: '复制联系信息',
    contact: '群内 @owner，最低充值 $20',
    acknowledged: false,
    snoozed: false
  }
];

export const upstreams: UpstreamItem[] = [
  {
    id: 'sub2api-owner-a',
    name: '群主 A 的 Sub2API',
    platform: 'Sub2API',
    balance: '$4.1',
    threshold: '$10',
    renewal: '联系群主',
    status: 'critical'
  },
  {
    id: 'runapi',
    name: 'RunAPI 上游',
    platform: 'New API',
    balance: '¥38.20',
    threshold: '¥50',
    renewal: '支付链接',
    status: 'warning'
  },
  {
    id: 'backup-newapi',
    name: '备用 New API',
    platform: 'New API',
    balance: '$92.8',
    threshold: '$20',
    renewal: '支付链接',
    status: 'normal'
  }
];

export const pools: PoolItem[] = [
  {
    id: 'codex-main',
    name: 'Codex 主号池',
    platform: 'New API',
    successAccounts: 44,
    totalAccounts: 45,
    failedAccounts: 1,
    fiveHourRemainingPercent: 18,
    fiveHourBurnRate: 3.75,
    sevenDayRemainingPercent: 86.7,
    sevenDayBurnRate: 2.8
  },
  {
    id: 'sub2api-pool',
    name: 'Sub2API 自营池',
    platform: 'Sub2API',
    successAccounts: 18,
    totalAccounts: 18,
    failedAccounts: 0,
    fiveHourRemainingPercent: 72,
    fiveHourBurnRate: 4.6,
    sevenDayRemainingPercent: 91,
    sevenDayBurnRate: 1.2
  }
];

export const notificationChannels = [
  { id: 'wechat-work', name: '企业微信群', status: '正常', lastSent: '2 分钟前' },
  { id: 'telegram', name: 'Telegram Bot', status: '正常', lastSent: '1 小时前' },
  { id: 'serverchan', name: 'ServerChan', status: '未启用', lastSent: '无' }
];
