import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import type { BackendPool, BackendUpstream } from './api';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('App workbench', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('shows upstream transit as the default business section on the home page', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    await act(async () => {
      createRoot(host).render(<App />);
    });

    const sectionTitles = Array.from(document.querySelectorAll('.section-title h2')).map((node) => node.textContent);

    expect(sectionTitles[0]).toBe('上游中转');
  });

  it('can switch the home page default business section to pool inspection', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    await act(async () => {
      createRoot(host).render(<App />);
    });

    await act(async () => {
      findButton('设置').click();
    });
    await act(async () => {
      findButton('号池').click();
    });
    await act(async () => {
      findButton('工作台').click();
    });

    const sectionTitles = Array.from(document.querySelectorAll('.section-title h2')).map((node) => node.textContent);

    expect(sectionTitles[0]).toBe('号池快照');
  });

  it('supports both New API and Sub2API platforms in the external upstream form', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    await act(async () => {
      createRoot(host).render(<App />);
    });

    await act(async () => {
      findButton('上游').click();
    });

    expect(document.querySelector('[name="upstreamPlatform"]')).toBeNull();
    await act(async () => {
      findButton('添加上游').click();
    });

    const upstreamAdd = findArticle('添加上游');
    // Both platforms are available; default is new_api which shows admin token
    expect(upstreamAdd.textContent).toContain('New API');
    expect(upstreamAdd.textContent).toContain('Sub2API');
    expect(upstreamAdd.textContent).not.toContain('CLIProxyAPI');
    // new_api selected by default → admin token field visible, email fields hidden
    expect(document.querySelector('[name="upstreamAdminToken"]')).not.toBeNull();
    expect(document.querySelector('[name="upstreamEmail"]')).toBeNull();

    // Switch to sub2api → email/password fields appear, admin token hidden
    await setField('upstreamPlatform', 'sub2api');
    expect(document.querySelector('[name="upstreamEmail"]')).not.toBeNull();
    expect(document.querySelector('[name="upstreamPassword"]')).not.toBeNull();
    expect(document.querySelector('[name="upstreamAdminToken"]')).toBeNull();

    await act(async () => {
      findButton('号池').click();
    });

    expect(document.querySelector('[name="poolPlatform"]')).toBeNull();
    await act(async () => {
      findButton('添加中转站').click();
    });

    const poolAdd = findArticle('添加自己的中转站');
    expect(poolAdd.textContent).toContain('New API');
    expect(poolAdd.textContent).toContain('Sub2API');
    expect(poolAdd.textContent).not.toContain('上游');
    expect(document.querySelector('[name="poolEmail"]')).not.toBeNull();
    expect(document.querySelector('[name="poolPassword"]')).not.toBeNull();
    expect(document.querySelector('[name="poolAdminToken"]')).toBeNull();
  });

  it('does not present CLIProxyAPI as a target platform', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    await act(async () => {
      createRoot(host).render(<App />);
    });

    expect(document.body.textContent).not.toContain('CLIProxyAPI');
  });

  it('saves backend API settings locally for real backend requests', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    await act(async () => {
      createRoot(host).render(<App />);
    });

    await act(async () => {
      findButton('设置').click();
    });
    await setField('apiBaseUrl', 'http://localhost:8000');
    await setField('apiKey', 'owner-api-key');
    await act(async () => {
      findButton('保存连接').click();
    });

    expect(window.localStorage.getItem('relay-sentinel-api-settings')).toContain('owner-api-key');
    expect(document.body.textContent).toContain('后端连接已保存');
    expect(document.body.textContent).toContain('当前地址：http://localhost:8000');
    expect(document.body.textContent).toContain('API Key：owne...-key');
  });

  it('enables upstream creation immediately after saving API settings and filling form', async () => {
    installFetchMock();
    const host = document.createElement('div');
    document.body.appendChild(host);

    await act(async () => {
      createRoot(host).render(<App />);
    });

    await act(async () => {
      findButton('设置').click();
    });
    await setField('apiBaseUrl', 'http://localhost:8000');
    await setField('apiKey', 'owner-api-key');
    await act(async () => {
      findButton('保存连接').click();
    });
    await flushPromises();

    await act(async () => {
      findNavButton('上游').click();
    });

    expect(document.body.textContent).not.toContain('先到设置页保存后端地址和 API Key');
    await act(async () => {
      findButton('添加上游').click();
    });
    // Form needs fields filled before the button enables
    await setField('upstreamName', '测试上游');
    await setField('upstreamBaseUrl', 'https://example.com');
    await setField('upstreamAdminToken', 'sk-test-token');
    await setField('upstreamThresholdValue', '10');
    await setField('upstreamRenewalInstructions', '联系群主');
    expect(findButton('保存上游').disabled).toBe(false);
  });

  it('keeps saved API settings even when the immediate backend probe fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ detail: 'Invalid API key' }, 401)));
    const host = document.createElement('div');
    document.body.appendChild(host);

    await act(async () => {
      createRoot(host).render(<App />);
    });

    await act(async () => {
      findButton('设置').click();
    });
    await setField('apiBaseUrl', 'http://localhost:8000');
    await setField('apiKey', 'bad-api-key');
    await act(async () => {
      findButton('保存连接').click();
    });
    await flushPromises();

    expect(window.localStorage.getItem('relay-sentinel-api-settings')).toContain('bad-api-key');
    expect(document.body.textContent).toContain('后端连接已保存');
    expect(document.body.textContent).toContain('但连通测试失败：Invalid API key');
  });

  it('does not count pending backend targets as warnings on the workbench', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      upstreams: [{
        id: 'up_pending',
        kind: 'upstream',
        name: '待巡检上游',
        platform: 'sub2api',
        base_url: 'https://ciyuan.fast',
        threshold: { metric: 'balance', operator: 'lt', value: 10, unit: 'USD' },
        renewal: { kind: 'contact_owner', instructions: '联系群主' },
        status: 'pending_probe'
      }],
      pools: [{
        id: 'pool_pending',
        kind: 'pool',
        ownership: 'owned',
        name: '待巡检号池',
        platform: 'sub2api',
        base_url: 'https://self.example.com',
        quota_alert_threshold_hours: 5,
        status: 'pending_probe'
      }],
      alerts: [],
      default_business_view: 'upstreams'
    })));
    window.localStorage.setItem(
      'relay-sentinel-api-settings',
      JSON.stringify({ baseUrl: 'http://localhost:8000', apiKey: 'owner-api-key' })
    );
    const host = document.createElement('div');
    document.body.appendChild(host);

    await act(async () => {
      createRoot(host).render(<App />);
    });
    await flushPromises();

    const summary = Array.from(document.querySelectorAll('.mini')).map((node) => node.textContent);

    expect(summary).toEqual(['上游预警0', '号池预警0', '未处理0']);
    expect(document.body.textContent).toContain('今天没有必须处理的事');
  });

  it('submits a Sub2API upstream through the real backend API', async () => {
    const requests = installFetchMock();
    window.localStorage.setItem(
      'relay-sentinel-api-settings',
      JSON.stringify({ baseUrl: 'http://localhost:8000', apiKey: 'owner-api-key' })
    );
    const host = document.createElement('div');
    document.body.appendChild(host);

    await act(async () => {
      createRoot(host).render(<App />);
    });
    await flushPromises();

    await act(async () => {
      findButton('上游').click();
    });
    await act(async () => {
      findButton('添加上游').click();
    });
    await setField('upstreamPlatform', 'sub2api');
    await setField('upstreamName', '词元 fast');
    await setField('upstreamBaseUrl', 'https://ciyuan.fast');
    await setField('upstreamEmail', 'owner@example.com');
    await setField('upstreamPassword', 'secret-password');
    await setField('upstreamThresholdValue', '10');
    await setField('upstreamRenewalInstructions', '群内 @owner，最低充值 $20');
    await act(async () => {
      findButton('保存上游').click();
    });
    await flushPromises();

    const createRequest = requests.find((request) => request.url === 'http://localhost:8000/api/upstreams');
    expect(createRequest?.init.method).toBe('POST');
    expect(createRequest?.init.headers).toMatchObject({ Authorization: 'Bearer owner-api-key' });
    expect(JSON.parse(String(createRequest?.init.body))).toMatchObject({
      name: '词元 fast',
      platform: 'sub2api',
      base_url: 'https://ciyuan.fast',
      credential: { kind: 'login', email: 'owner@example.com', password: 'secret-password' },
      threshold: { metric: 'balance', operator: 'lt', value: 10, unit: 'USD' },
      renewal: { kind: 'contact_owner', instructions: '群内 @owner，最低充值 $20' }
    });
    expect(document.body.textContent).toContain('上游已保存');
    expect(document.querySelector('[name="upstreamPlatform"]')).toBeNull();
  });

  it('shows the backend error when upstream creation fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/mobile/home')) {
        return jsonResponse({ upstreams: [], pools: [], alerts: [], default_business_view: 'upstreams' });
      }
      if (url.endsWith('/api/upstreams')) {
        return jsonResponse({ detail: 'Unauthorized' }, 401);
      }
      return jsonResponse({ detail: 'not found' }, 404);
    }));
    window.localStorage.setItem(
      'relay-sentinel-api-settings',
      JSON.stringify({ baseUrl: 'http://localhost:8000', apiKey: 'wrong-api-key' })
    );
    const host = document.createElement('div');
    document.body.appendChild(host);

    await act(async () => {
      createRoot(host).render(<App />);
    });
    await flushPromises();

    await act(async () => {
      findButton('上游').click();
    });
    await act(async () => {
      findButton('添加上游').click();
    });
    await setField('upstreamPlatform', 'sub2api');
    await setField('upstreamName', '可达鸭');
    await setField('upstreamBaseUrl', 'https://sub.kedaya.xyz');
    await setField('upstreamEmail', 'jizeguo1@gmail.com');
    await setField('upstreamPassword', 'secret-password');
    await setField('upstreamThresholdValue', '10');
    await setField('upstreamRenewalKind', 'payment_link');
    await setField('upstreamRenewalInstructions', 'https://shop.kedaya.xyz/');
    await act(async () => {
      findButton('保存上游').click();
    });
    await flushPromises();

    expect(document.body.textContent).toContain('上游保存失败：Unauthorized');
  });

  it('can edit and delete a backend upstream only while management mode is enabled', async () => {
    const requests: Array<{ url: string; init: RequestInit & { headers?: Record<string, string> } }> = [];
    let upstreams: BackendUpstream[] = [{
      id: 'up_1',
      kind: 'upstream',
      name: '旧上游',
      platform: 'sub2api',
      base_url: 'https://old.example.com',
      threshold: { metric: 'balance', operator: 'lt', value: 10, unit: 'USD' },
      renewal: { kind: 'manual', instructions: '旧说明' },
      status: 'pending_probe'
    }];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      requests.push({ url, init: init as RequestInit & { headers?: Record<string, string> } });

      if (url.endsWith('/api/mobile/home')) {
        return jsonResponse({ upstreams, pools: [], alerts: [], default_business_view: 'upstreams' });
      }
      if (url.endsWith('/api/upstreams/up_1') && init.method === 'PATCH') {
        const patch = JSON.parse(String(init.body));
        upstreams = [{ ...upstreams[0], ...patch }];
        return jsonResponse(upstreams[0]);
      }
      if (url.endsWith('/api/upstreams/up_1') && init.method === 'DELETE') {
        upstreams = [];
        return new Response(null, { status: 204 });
      }
      return jsonResponse({ detail: 'not found' }, 404);
    }));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    window.localStorage.setItem(
      'relay-sentinel-api-settings',
      JSON.stringify({ baseUrl: 'http://localhost:8000', apiKey: 'owner-api-key' })
    );
    const host = document.createElement('div');
    document.body.appendChild(host);

    await act(async () => {
      createRoot(host).render(<App />);
    });
    await flushPromises();

    await act(async () => {
      findButton('上游').click();
    });
    expect(document.body.textContent).toContain('旧上游');
    expect(queryButton('编辑')).toBeNull();
    expect(queryButton('删除')).toBeNull();

    await act(async () => {
      findButton('管理').click();
    });

    expect(findButton('编辑')).not.toBeNull();
    expect(findButton('删除')).not.toBeNull();

    await act(async () => {
      findButton('编辑').click();
    });
    await setField('editUpstreamName', '新上游');
    await setField('editUpstreamBaseUrl', 'https://new.example.com');
    await setField('editUpstreamThresholdValue', '20');
    await setField('editUpstreamRenewalInstructions', '新说明');
    await setField('editUpstreamEmail', 'new-owner@example.com');
    await setField('editUpstreamPassword', 'new-secret-password');
    await act(async () => {
      findButton('保存修改').click();
    });
    await flushPromises();

    const patchRequest = requests.find((request) => request.url === 'http://localhost:8000/api/upstreams/up_1' && request.init.method === 'PATCH');
    expect(JSON.parse(String(patchRequest?.init.body))).toMatchObject({
      name: '新上游',
      base_url: 'https://new.example.com',
      threshold: { metric: 'balance', operator: 'lt', value: 20, unit: 'USD' },
      renewal: { kind: 'manual', instructions: '新说明' },
      credential: { kind: 'login', email: 'new-owner@example.com', password: 'new-secret-password' }
    });
    expect(document.body.textContent).toContain('上游已更新');

    await act(async () => {
      findButton('删除').click();
    });
    await flushPromises();

    expect(requests.some((request) => request.url === 'http://localhost:8000/api/upstreams/up_1' && request.init.method === 'DELETE')).toBe(true);
    expect(document.body.textContent).toContain('上游已删除');
  });

  it('opens payment renewal links and highlights backend upstream balance', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      upstreams: [{
        id: 'up_1',
        kind: 'upstream',
        name: '余额上游',
        platform: 'sub2api',
        base_url: 'https://old.example.com',
        threshold: { metric: 'balance', operator: 'lt', value: 10, unit: 'USD' },
        renewal: { kind: 'payment_link', label: '购买额度', url: 'https://shop.example.com' },
        status: 'active',
        last_balance_value: 12,
        last_balance_unit: 'USD'
      }],
      pools: [],
      alerts: [],
      default_business_view: 'upstreams'
    })));
    const open = vi.fn();
    vi.stubGlobal('open', open);
    window.localStorage.setItem(
      'relay-sentinel-api-settings',
      JSON.stringify({ baseUrl: 'http://localhost:8000', apiKey: 'owner-api-key' })
    );
    const host = document.createElement('div');
    document.body.appendChild(host);

    await act(async () => {
      createRoot(host).render(<App />);
    });
    await flushPromises();

    await act(async () => {
      findButton('上游').click();
    });
    const balanceMetric = document.querySelector('.balance-metric');
    expect(balanceMetric?.textContent).toContain('余额');
    expect(balanceMetric?.textContent).toContain('12 USD');

    await act(async () => {
      findButton('购买额度').click();
    });

    expect(open).toHaveBeenCalledWith('https://shop.example.com', '_blank', 'noopener,noreferrer');
  });

  it('can manually run a backend upstream balance check', async () => {
    const requests: Array<{ url: string; init: RequestInit & { headers?: Record<string, string> } }> = [];
    let upstreams: BackendUpstream[] = [{
      id: 'up_1',
      kind: 'upstream',
      name: '待查上游',
      platform: 'sub2api',
      base_url: 'https://old.example.com',
      threshold: { metric: 'balance', operator: 'lt', value: 10, unit: 'USD' },
      renewal: { kind: 'manual', instructions: '旧说明' },
      status: 'pending_probe',
      last_balance_checked_at: null,
      last_balance_value: null,
      last_balance_unit: null
    }];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      requests.push({ url, init: init as RequestInit & { headers?: Record<string, string> } });

      if (url.endsWith('/api/mobile/home')) {
        return jsonResponse({ upstreams, pools: [], alerts: [], default_business_view: 'upstreams' });
      }
      if (url.endsWith('/api/upstreams/up_1/run-balance-check') && init.method === 'POST') {
        upstreams = [{ ...upstreams[0], status: 'active', last_balance_value: 12, last_balance_unit: 'USD' }];
        return jsonResponse({ target_id: 'up_1', kind: 'upstream', check_type: 'balance', result: 'ok' });
      }
      return jsonResponse({ detail: 'not found' }, 404);
    }));
    window.localStorage.setItem(
      'relay-sentinel-api-settings',
      JSON.stringify({ baseUrl: 'http://localhost:8000', apiKey: 'owner-api-key' })
    );
    const host = document.createElement('div');
    document.body.appendChild(host);

    await act(async () => {
      createRoot(host).render(<App />);
    });
    await flushPromises();

    await act(async () => {
      findButton('上游').click();
    });
    await act(async () => {
      findButton('查余额').click();
    });
    await flushPromises();

    expect(requests.some((request) => request.url === 'http://localhost:8000/api/upstreams/up_1/run-balance-check' && request.init.method === 'POST')).toBe(true);
    expect(document.body.textContent).toContain('上游余额巡检完成');
    expect(document.querySelector('.balance-metric')?.textContent).toContain('12 USD');
  });

  it('can edit and delete a backend pool only while management mode is enabled', async () => {
    const requests: Array<{ url: string; init: RequestInit & { headers?: Record<string, string> } }> = [];
    let pools: BackendPool[] = [{
      id: 'pool_1',
      kind: 'pool',
      ownership: 'owned',
      name: '旧号池',
      platform: 'sub2api',
      base_url: 'https://old-pool.example.com',
      quota_alert_threshold_hours: 5,
      status: 'pending_probe'
    }];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      requests.push({ url, init: init as RequestInit & { headers?: Record<string, string> } });

      if (url.endsWith('/api/mobile/home')) {
        return jsonResponse({ upstreams: [], pools, alerts: [], default_business_view: 'pools' });
      }
      if (url.endsWith('/api/pools/pool_1') && init.method === 'PATCH') {
        const patch = JSON.parse(String(init.body));
        pools = [{ ...pools[0], ...patch }];
        return jsonResponse(pools[0]);
      }
      if (url.endsWith('/api/pools/pool_1') && init.method === 'DELETE') {
        pools = [];
        return new Response(null, { status: 204 });
      }
      return jsonResponse({ detail: 'not found' }, 404);
    }));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    window.localStorage.setItem(
      'relay-sentinel-api-settings',
      JSON.stringify({ baseUrl: 'http://localhost:8000', apiKey: 'owner-api-key' })
    );
    const host = document.createElement('div');
    document.body.appendChild(host);

    await act(async () => {
      createRoot(host).render(<App />);
    });
    await flushPromises();

    await act(async () => {
      findButton('号池').click();
    });
    expect(document.body.textContent).toContain('旧号池');
    expect(queryButton('编辑')).toBeNull();
    expect(queryButton('删除')).toBeNull();

    await act(async () => {
      findButton('管理').click();
    });

    await act(async () => {
      findButton('编辑').click();
    });
    await setField('editPoolName', '新号池');
    await setField('editPoolBaseUrl', 'https://new-pool.example.com');
    await setField('editPoolQuotaAlertThresholdHours', '8');
    await setField('editPoolEmail', 'new-pool@example.com');
    await setField('editPoolPassword', 'new-pool-secret');
    await act(async () => {
      findButton('保存修改').click();
    });
    await flushPromises();

    const patchRequest = requests.find((request) => request.url === 'http://localhost:8000/api/pools/pool_1' && request.init.method === 'PATCH');
    expect(JSON.parse(String(patchRequest?.init.body))).toMatchObject({
      name: '新号池',
      base_url: 'https://new-pool.example.com',
      quota_alert_threshold_hours: 8,
      credential: { kind: 'login', email: 'new-pool@example.com', password: 'new-pool-secret' }
    });
    expect(document.body.textContent).toContain('中转站已更新');

    await act(async () => {
      findButton('删除').click();
    });
    await flushPromises();

    expect(requests.some((request) => request.url === 'http://localhost:8000/api/pools/pool_1' && request.init.method === 'DELETE')).toBe(true);
    expect(document.body.textContent).toContain('中转站已删除');
  });

  it('can manually run backend pool health and quota checks', async () => {
    const requests: Array<{ url: string; init: RequestInit & { headers?: Record<string, string> } }> = [];
    let pools: BackendPool[] = [{
      id: 'pool_1',
      kind: 'pool',
      ownership: 'owned',
      name: '待查号池',
      platform: 'sub2api',
      base_url: 'https://old-pool.example.com',
      quota_alert_threshold_hours: 5,
      status: 'pending_probe',
      last_health_checked_at: null,
      last_quota_checked_at: null
    }];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      requests.push({ url, init: init as RequestInit & { headers?: Record<string, string> } });

      if (url.endsWith('/api/mobile/home')) {
        return jsonResponse({ upstreams: [], pools, alerts: [], default_business_view: 'pools' });
      }
      if (url.endsWith('/api/pools/pool_1/run-health-check') && init.method === 'POST') {
        pools = [{ ...pools[0], status: 'active', last_health_checked_at: '2026-06-08T08:35:41+00:00' }];
        return jsonResponse({ target_id: 'pool_1', kind: 'pool', check_type: 'health', result: 'ok' });
      }
      if (url.endsWith('/api/pools/pool_1/run-quota-check') && init.method === 'POST') {
        pools = [{ ...pools[0], status: 'active', last_quota_checked_at: '2026-06-08T08:35:42+00:00' }];
        return jsonResponse({ target_id: 'pool_1', kind: 'pool', check_type: 'quota', result: 'ok' });
      }
      return jsonResponse({ detail: 'not found' }, 404);
    }));
    window.localStorage.setItem(
      'relay-sentinel-api-settings',
      JSON.stringify({ baseUrl: 'http://localhost:8000', apiKey: 'owner-api-key' })
    );
    const host = document.createElement('div');
    document.body.appendChild(host);

    await act(async () => {
      createRoot(host).render(<App />);
    });
    await flushPromises();

    await act(async () => {
      findButton('号池').click();
    });
    await act(async () => {
      findButton('查健康').click();
    });
    await flushPromises();
    expect(document.body.textContent).toContain('号池健康巡检完成');
    expect(document.body.textContent).not.toContain('账号健康：待巡检');

    await act(async () => {
      findButton('查额度').click();
    });
    await flushPromises();

    expect(requests.some((request) => request.url === 'http://localhost:8000/api/pools/pool_1/run-health-check' && request.init.method === 'POST')).toBe(true);
    expect(requests.some((request) => request.url === 'http://localhost:8000/api/pools/pool_1/run-quota-check' && request.init.method === 'POST')).toBe(true);
    expect(document.body.textContent).toContain('号池额度巡检完成');
    expect(document.body.textContent).not.toContain('额度巡检：待巡检');
  });

  it('submits a New API owned pool through the real backend API', async () => {
    const requests = installFetchMock();
    window.localStorage.setItem(
      'relay-sentinel-api-settings',
      JSON.stringify({ baseUrl: 'http://localhost:8000', apiKey: 'owner-api-key' })
    );
    const host = document.createElement('div');
    document.body.appendChild(host);

    await act(async () => {
      createRoot(host).render(<App />);
    });
    await flushPromises();

    await act(async () => {
      findButton('号池').click();
    });
    await act(async () => {
      findButton('添加中转站').click();
    });
    await setField('poolPlatform', 'new_api');
    await setField('poolName', '自营 New API 号池');
    await setField('poolBaseUrl', 'https://self.example.com');
    await setField('poolAdminToken', 'secret-admin-token');
    await setField('poolQuotaAlertThresholdHours', '5');
    await act(async () => {
      findButton('保存中转站').click();
    });
    await flushPromises();

    const createRequest = requests.find((request) => request.url === 'http://localhost:8000/api/pools');
    expect(createRequest?.init.method).toBe('POST');
    expect(createRequest?.init.headers).toMatchObject({ Authorization: 'Bearer owner-api-key' });
    expect(JSON.parse(String(createRequest?.init.body))).toMatchObject({
      name: '自营 New API 号池',
      platform: 'new_api',
      base_url: 'https://self.example.com',
      credential: { kind: 'admin_token', token: 'secret-admin-token' },
      quota_alert_threshold_hours: 5
    });
    expect(document.body.textContent).toContain('中转站已保存');
    expect(document.querySelector('[name="poolPlatform"]')).toBeNull();
  });

  it('submits a Sub2API owned pool with login credentials only', async () => {
    const requests = installFetchMock();
    window.localStorage.setItem(
      'relay-sentinel-api-settings',
      JSON.stringify({ baseUrl: 'http://localhost:8000', apiKey: 'owner-api-key' })
    );
    const host = document.createElement('div');
    document.body.appendChild(host);

    await act(async () => {
      createRoot(host).render(<App />);
    });
    await flushPromises();

    await act(async () => {
      findButton('号池').click();
    });
    await act(async () => {
      findButton('添加中转站').click();
    });
    await setField('poolName', '自营 Sub2API 号池');
    await setField('poolBaseUrl', 'https://self.example.com');
    await setField('poolEmail', 'owner@example.com');
    await setField('poolPassword', 'secret-password');
    await setField('poolQuotaAlertThresholdHours', '5');
    await act(async () => {
      findButton('保存中转站').click();
    });
    await flushPromises();

    const createRequest = requests.find((request) => request.url === 'http://localhost:8000/api/pools');
    expect(createRequest?.init.method).toBe('POST');
    expect(JSON.parse(String(createRequest?.init.body))).toMatchObject({
      name: '自营 Sub2API 号池',
      platform: 'sub2api',
      base_url: 'https://self.example.com',
      credential: { kind: 'login', email: 'owner@example.com', password: 'secret-password' },
      quota_alert_threshold_hours: 5
    });
    expect(document.body.textContent).toContain('中转站已保存');
  });
});

function findButton(label: string): HTMLButtonElement {
  const button = queryButton(label);

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`);
  }

  return button;
}

function queryButton(label: string): HTMLButtonElement | null {
  const button = Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.includes(label));

  return button instanceof HTMLButtonElement ? button : null;
}

function findNavButton(label: string): HTMLButtonElement {
  const nav = document.querySelector('nav[aria-label="主导航"]');
  const button = nav
    ? Array.from(nav.querySelectorAll('button')).find((node) => node.textContent?.includes(label))
    : null;

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Nav button not found: ${label}`);
  }

  return button;
}

function findArticle(title: string): HTMLElement {
  const article = Array.from(document.querySelectorAll('article')).find((node) => node.textContent?.includes(title));

  if (!(article instanceof HTMLElement)) {
    throw new Error(`Article not found: ${title}`);
  }

  return article;
}

async function setField(name: string, value: string): Promise<void> {
  const field = document.querySelector(`[name="${name}"]`);

  if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) {
    throw new Error(`Field not found: ${name}`);
  }

  await act(async () => {
    const prototype = field instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

    setter?.call(field, value);
    field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function flushPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function installFetchMock(): Array<{ url: string; init: RequestInit & { headers?: Record<string, string> } }> {
  const requests: Array<{ url: string; init: RequestInit & { headers?: Record<string, string> } }> = [];

  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    requests.push({ url, init: init as RequestInit & { headers?: Record<string, string> } });

    if (url.endsWith('/api/mobile/home')) {
      return jsonResponse({ upstreams: [], pools: [], alerts: [], default_business_view: 'upstreams' });
    }

    if (url.endsWith('/api/upstreams')) {
      return jsonResponse({
        id: 'up_1',
        kind: 'upstream',
        name: '词元 fast',
        platform: 'sub2api',
        base_url: 'https://ciyuan.fast',
        threshold: { metric: 'balance', operator: 'lt', value: 10, unit: 'USD' },
        renewal: { kind: 'contact_owner', instructions: '群内 @owner，最低充值 $20' },
        status: 'pending_probe'
      }, 201);
    }

    if (url.endsWith('/api/pools')) {
      return jsonResponse({
        id: 'pool_1',
        kind: 'pool',
        ownership: 'owned',
        name: '自营 New API 号池',
        platform: 'new_api',
        base_url: 'https://self.example.com',
        quota_alert_threshold_hours: 5,
        status: 'pending_probe'
      }, 201);
    }

    return jsonResponse({ detail: 'not found' }, 404);
  }));

  return requests;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
