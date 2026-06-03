import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';

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

  it('keeps upstream and owned pool add entries separate with New API and Sub2API choices', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    await act(async () => {
      createRoot(host).render(<App />);
    });

    await act(async () => {
      findButton('上游').click();
    });

    const upstreamAdd = findArticle('添加上游');
    expect(upstreamAdd.textContent).toContain('New API');
    expect(upstreamAdd.textContent).toContain('Sub2API');
    expect(upstreamAdd.textContent).not.toContain('CLIProxyAPI');

    await act(async () => {
      findButton('号池').click();
    });

    const poolAdd = findArticle('添加自己的中转站');
    expect(poolAdd.textContent).toContain('New API');
    expect(poolAdd.textContent).toContain('Sub2API');
    expect(poolAdd.textContent).not.toContain('上游');
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
  });
});

function findButton(label: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.includes(label));

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`);
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
