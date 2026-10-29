// @vitest-environment jsdom
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mounted = vi.hoisted(() => ({ root: null as Root | null }));
vi.mock('react-dom/client', async importOriginal => {
  const actual = await importOriginal<typeof import('react-dom/client')>();
  return {
    ...actual,
    createRoot: (...args: Parameters<typeof actual.createRoot>) => {
      mounted.root = actual.createRoot(...args);
      return mounted.root;
    },
  };
});

class TestWorker extends EventTarget {
  static instances: TestWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  messages: unknown[] = [];
  terminate = vi.fn();
  constructor() {
    super();
    TestWorker.instances.push(this);
  }
  postMessage(message: unknown) { this.messages.push(message); }
}

describe('game data selection', () => {
  afterEach(async () => {
    await act(async () => mounted.root?.unmount());
    mounted.root = null;
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.resetModules();
    TestWorker.instances = [];
  });

  it('reimports an open save with selected paths and keeps it open for invalid selections', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.stubGlobal('Worker', TestWorker);
    const root = document.createElement('div'); root.id = 'root'; document.body.append(root);
    await act(async () => { await import('./main'); });

    const save = new File(['save'], 'gamestate');
    const saveInput = document.querySelector<HTMLInputElement>('input[type=file]:not([webkitdirectory])');
    if (!saveInput) throw new Error('Missing save input');
    Object.defineProperty(saveInput, 'files', { configurable: true, value: [save] });
    await act(async () => saveInput.dispatchEvent(new Event('change', { bubbles: true })));
    const first = TestWorker.instances[0];
    expect(first.messages[0]).toMatchObject({ type: 'import', file: save, localizationFiles: [] });
    await act(async () => first.onmessage?.(new MessageEvent('message', { data: {
      type: 'ready', date: '867.1.1', living: 0, warnings: [], dynasties: [], houses: [],
      tables: { characters: { count: 0, columns: [] }, dynasties: { count: 0, columns: [] }, houses: { count: 0, columns: [] } },
    } })));

    const gameInput = document.querySelector<HTMLInputElement>('input[webkitdirectory]');
    if (!gameInput) throw new Error('Missing game data input');
    const definition = new File(['data'], 'houses.txt');
    Object.defineProperty(definition, 'webkitRelativePath', { value: 'game/common/dynasty_houses/houses.txt' });
    Object.defineProperty(gameInput, 'files', { configurable: true, value: [definition] });
    await act(async () => gameInput.dispatchEvent(new Event('change', { bubbles: true })));
    expect(first.terminate).toHaveBeenCalledOnce();
    expect(TestWorker.instances[1].messages[0]).toMatchObject({
      type: 'import', file: save, localizationFiles: [{ file: definition, path: 'game/common/dynasty_houses/houses.txt' }],
    });

    Object.defineProperty(gameInput, 'files', { configurable: true, value: [new File(['other'], 'other.txt')] });
    await act(async () => gameInput.dispatchEvent(new Event('change', { bubbles: true })));
    expect(TestWorker.instances).toHaveLength(2);
    expect(document.querySelector('[role=alert]')?.textContent).toContain('No English localization or dynasty definition files found');
  });
});
