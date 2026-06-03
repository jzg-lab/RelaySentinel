import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('service worker cache policy', () => {
  it('bypasses API requests so dashboard data stays fresh', () => {
    const source = readFileSync(resolve(__dirname, '../public/service-worker.js'), 'utf8');

    expect(source).toContain("url.pathname.startsWith('/api/')");
    expect(source).toContain('fetch(event.request)');
  });
});
