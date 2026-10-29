// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DynastyDashboard } from './DynastyDashboard';
import type { DashboardRequest } from './dashboard';

class TestWorker extends EventTarget implements Worker {
  onerror: ((this: AbstractWorker, ev: ErrorEvent) => unknown) | null = null;
  onmessage: ((this: Worker, ev: MessageEvent) => unknown) | null = null;
  onmessageerror: ((this: Worker, ev: MessageEvent) => unknown) | null = null;
  requests: { requestId: number; dashboard: DashboardRequest }[] = [];
  postMessage(message: unknown, _options?: StructuredSerializeOptions | Transferable[]) {
    this.requests.push(message as { requestId: number; dashboard: DashboardRequest });
  }
  terminate() {}
  respond() {
    const requestId = this.requests.at(-1)?.requestId;
    this.dispatchEvent(new MessageEvent('message', { data: {
      type: 'dashboard', requestId, results: {
        cohorts: [{ cohort: 'selected', population: 2, historical_unknown: 0 }],
        summary: [{ population: 2, living: 1, deceased: 1, houses: 1, rulers: 1, ruler_unknown: 1 }],
        houses: [{ id: '2', label: 'House Two', n: 2, living: 1, deceased: 1, rulers: 1 }],
        drill: [{ id: 'a', name: 'Alice', house: 'House Two', status: 'Living' }],
        drill_count: [{ n: 2 }],
      },
    } }));
  }
}

describe('dynasty dashboard interactions', () => {
  let container: HTMLDivElement;
  let root: Root;
  let worker: TestWorker;
  let inspect = vi.fn<(id: string) => void>();
  const flush = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(200); }); };
  const select = async (label: string, value: string) => {
    const input = [...container.querySelectorAll('label')].find(item => item.textContent?.startsWith(label))?.querySelector('select');
    if (!input) throw new Error(`Missing select: ${label}`);
    await act(async () => { input.value = value; input.dispatchEvent(new Event('change', { bubbles: true })); });
  };
  const click = async (label: string) => {
    const button = [...container.querySelectorAll('button')].find(item => item.textContent?.trim() === label);
    if (!button) throw new Error(`Missing button: ${label}`);
    await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  };
  beforeEach(async () => {
    vi.useFakeTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div'); document.body.append(container);
    root = createRoot(container);
    worker = new TestWorker(); inspect = vi.fn<(id: string) => void>();
    await act(async () => root.render(<DynastyDashboard worker={worker} dynasties={[{ id: '5', name: 'Dynasty Five', count: 2, house: 'House Two', houseSearch: 'House Two' }]} houses={[{ id: '2', dynastyId: '5', name: 'House Two' }]} onCharacter={inspect} onTitle={vi.fn()} />));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('shares and resets filters when navigating dashboard sections', async () => {
    await select('Dynasty', '5'); await flush();
    await select('Status', 'Living'); await flush();
    await click('skills'); await flush();
    expect(worker.requests.at(-1)?.dashboard).toMatchObject({ section: 'skills', filters: { dynastyId: '5', status: 'Living' } });
    await click('Reset filters'); await flush();
    expect(worker.requests.at(-1)?.dashboard.filters).toMatchObject({ dynastyId: '5', status: 'Both', houseId: '', historical: null });
  });
  it('turns a house bar into a cohort-bound drilldown and opens a character', async () => {
    await select('Dynasty', '5'); await flush();
    await act(async () => worker.respond());
    const bar = container.querySelector<HTMLButtonElement>('.bar-list button');
    if (!bar) throw new Error('Missing house bar');
    await act(async () => bar.click()); await flush();
    expect(worker.requests.at(-1)?.dashboard.drill).toMatchObject({ kind: 'house', value: '2' });
    await act(async () => worker.respond());
    await click('Alice');
    expect(inspect).toHaveBeenCalledWith('a');
  });
  it('keeps the existing dashboard mounted and non-interactive while filters update', async () => {
    await select('Dynasty', '5'); await flush();
    await act(async () => worker.respond());
    const bar = container.querySelector('.bar-list button');
    await select('Status', 'Living');
    expect(container.querySelector('.bar-list button')).toBe(bar);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    await flush();
    await act(async () => worker.respond());
    expect(container.querySelector('.bar-list button')).toBe(bar);
    expect(container.querySelector('[aria-busy="false"]')).not.toBeNull();
  });
});
