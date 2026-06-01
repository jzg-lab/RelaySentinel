import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import App from './App';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('App workbench', () => {
  afterEach(() => {
    document.body.innerHTML = '';
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
