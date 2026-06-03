export type Platform = 'new_api' | 'sub2api';
export type RenewalKind = 'manual' | 'contact_owner' | 'payment_link';

export interface ApiSettings {
  baseUrl: string;
  apiKey: string;
}

export interface BackendUpstream {
  id: string;
  kind: 'upstream';
  name: string;
  platform: Platform;
  base_url: string;
  threshold?: {
    metric?: string;
    operator?: string;
    value?: number;
    unit?: string;
  };
  renewal?: {
    kind?: RenewalKind;
    label?: string;
    url?: string;
    instructions?: string;
  };
  status?: string;
  last_balance_checked_at?: string | null;
}

export interface BackendPool {
  id: string;
  kind: 'pool';
  ownership?: 'owned';
  name: string;
  platform: Platform;
  base_url: string;
  quota_alert_threshold_hours?: number;
  status?: string;
  last_health_checked_at?: string | null;
  last_quota_checked_at?: string | null;
}

export interface BackendAlert {
  id: string;
  target_kind?: 'upstream' | 'pool';
  target_id?: string;
  severity?: 'warning' | 'critical';
  title?: string;
  message?: string;
  status?: string;
}

export interface MobileHomeResponse {
  upstreams: BackendUpstream[];
  pools: BackendPool[];
  alerts: BackendAlert[];
  default_business_view: 'upstreams' | 'pools';
}

export interface CreateUpstreamPayload {
  name: string;
  platform: Platform;
  base_url: string;
  credential: Record<string, string>;
  threshold: {
    metric: 'balance';
    operator: 'lt';
    value: number;
    unit: string;
  };
  renewal: {
    kind: RenewalKind;
    instructions?: string;
    label?: string;
    url?: string;
  };
}

export interface CreatePoolPayload {
  name: string;
  platform: Platform;
  base_url: string;
  credential: Record<string, string>;
  quota_alert_threshold_hours: number;
}

const STORAGE_KEY = 'relay-sentinel-api-settings';
const DEFAULT_SETTINGS: ApiSettings = {
  baseUrl: 'http://127.0.0.1:8000',
  apiKey: ''
};

export function getApiSettings(): ApiSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_SETTINGS;

  try {
    const parsed = JSON.parse(raw) as Partial<ApiSettings>;
    return normalizeSettings({
      baseUrl: parsed.baseUrl || DEFAULT_SETTINGS.baseUrl,
      apiKey: parsed.apiKey || ''
    });
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveApiSettings(settings: ApiSettings): ApiSettings {
  const normalized = normalizeSettings(settings);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function hasApiCredentials(settings: ApiSettings): boolean {
  return Boolean(settings.baseUrl.trim() && settings.apiKey.trim());
}

export async function listTargets(settings: ApiSettings): Promise<MobileHomeResponse> {
  return request<MobileHomeResponse>(settings, '/api/mobile/home', { method: 'GET' });
}

export async function createUpstream(settings: ApiSettings, payload: CreateUpstreamPayload): Promise<BackendUpstream> {
  return request<BackendUpstream>(settings, '/api/upstreams', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function createPool(settings: ApiSettings, payload: CreatePoolPayload): Promise<BackendPool> {
  return request<BackendPool>(settings, '/api/pools', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

function normalizeSettings(settings: ApiSettings): ApiSettings {
  return {
    baseUrl: (settings.baseUrl || DEFAULT_SETTINGS.baseUrl).trim().replace(/\/+$/, ''),
    apiKey: settings.apiKey.trim()
  };
}

async function request<T>(settings: ApiSettings, path: string, init: RequestInit): Promise<T> {
  const normalized = normalizeSettings(settings);
  const response = await fetch(`${normalized.baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${normalized.apiKey}`,
      ...(init.headers || {})
    }
  });

  if (!response.ok) {
    let detail = `请求失败：${response.status}`;
    try {
      const body = await response.json() as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      // Keep the generic status message when the server does not return JSON.
    }
    throw new Error(detail);
  }

  return response.json() as Promise<T>;
}
