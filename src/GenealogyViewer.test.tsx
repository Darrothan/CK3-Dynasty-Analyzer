// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GenealogyGraph, type GraphRequest } from './genealogy';
import { GenealogyViewer } from './GenealogyViewer';

class GraphWorker extends EventTarget {
  graph = new GenealogyGraph([
    { id: 'a', name: 'Alice', dynasty_id: 'd', house_id: 'h', house: 'House A', status: 'Living', ruler_status: 'Ruler' },
    { id: 'b', name: 'Bob', dynasty_id: 'other', house_id: 'other', house: 'House B', status: 'Deceased', ruler_status: 'Unknown' },
  ], [{ character_id: 'a', relation: 'father', relative_id: 'b' }]);
  messages: { type: string; requestId: number; graph?: GraphRequest; search?: string; dynasty?: string; id?: string; target?: string; includeMarriage?: boolean }[] = [];
  postMessage(message: typeof this.messages[number]) {
    this.messages.push(message);
    let response: object | undefined;
    if (message.type === 'genealogy-search') response = { people: this.graph.search(message.search ?? '', message.dynasty) };
    if (message.type === 'genealogy-graph' && message.graph) response = { graph: this.graph.subgraph(message.graph) };
    if (message.type === 'genealogy-connection' && message.id && message.target) {
      const connection = this.graph.connection(message.id, message.target, message.includeMarriage);
      response = { connection, people: connection.ids.map(id => this.graph.people.get(id)) };
    }
    if (response) this.dispatchEvent(new MessageEvent('message', { data: { type: message.type, requestId: message.requestId, ...response } }));
  }
}

describe('genealogy viewer', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let worker: GraphWorker;
  const flush = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(200); }); };
  const click = async (label: string, index = 0) => {
    const button = [...container.querySelectorAll('button')].filter(item => item.textContent?.trim() === label)[index];
    if (!button) throw new Error(`Missing button ${label}`);
    await act(async () => button.click());
  };
  beforeEach(async () => {
    vi.useFakeTimers(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    worker = new GraphWorker(); container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    await act(async () => root.render(<GenealogyViewer worker={worker as unknown as Worker} dynastyId="d" houses={[{ id: 'h', dynastyId: 'd', name: 'House A' }]} />));
    await flush();
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });
  it('searches, focuses, renders cross-dynasty ancestors and collapses branches', async () => {
    expect(container.textContent).toContain('Alice');
    await click('Focus');
    expect(container.querySelectorAll('.genealogy-canvas g[role=button]')).toHaveLength(2);
    expect(container.textContent).toContain('Bob');
    await click('Collapse ancestors');
    expect(container.querySelectorAll('.genealogy-canvas g[role=button]')).toHaveLength(1);
    await click('Expand ancestors');
    expect(container.querySelectorAll('.genealogy-canvas g[role=button]')).toHaveLength(2);
    await click('Zoom in');
    expect(container.querySelector('.genealogy-canvas g')?.getAttribute('transform')).toContain('scale(');
  });
  it('searches all dynasties and displays a biological relationship path', async () => {
    await click('Focus');
    const checkbox = [...container.querySelectorAll<HTMLInputElement>('input')].find(input => input.parentElement?.textContent?.includes('Search all dynasties'));
    if (!checkbox) throw new Error('Missing world search');
    await act(async () => checkbox.click()); await flush();
    await click('Set relationship target', 1);
    await click('Find connection');
    expect(container.textContent).toContain('parent-child');
    expect(worker.messages.at(-1)).toMatchObject({ type: 'genealogy-connection', id: 'a', target: 'b', includeMarriage: false });
  });
  it('pans safely when pointer events are batched', async () => {
    await click('Focus');
    const svg = container.querySelector<SVGSVGElement>('.genealogy-canvas');
    if (!svg) throw new Error('Missing graph');
    svg.setPointerCapture = vi.fn();
    svg.getBoundingClientRect = () => ({ x: 0, y: 0, width: 1000, height: 600, top: 0, left: 0, right: 1000, bottom: 600, toJSON: () => ({}) });
    const before = svg.querySelector('g')?.getAttribute('transform');
    await act(async () => {
      svg.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
      svg.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 50, clientY: 40 }));
      svg.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 50, clientY: 40 }));
    });
    expect(svg.querySelector('g')?.getAttribute('transform')).not.toBe(before);
  });
});
