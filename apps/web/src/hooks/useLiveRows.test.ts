import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLiveRows } from './useLiveRows';

type Row = Record<string, unknown>;
type ChangeHandler = (change: Row) => void;
type StatusHandler = (status: string) => void;

const realtime = vi.hoisted(() => ({
  channels: [] as {
    topic: string;
    config: Row;
    onChange: ChangeHandler;
    onStatus: StatusHandler;
    removed: boolean;
  }[],
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: (topic: string) => {
      const entry = {
        topic,
        config: {} as Row,
        onChange: (() => undefined) as ChangeHandler,
        onStatus: (() => undefined) as StatusHandler,
        removed: false,
      };
      realtime.channels.push(entry);
      const channel = {
        on: (_type: string, config: Row, handler: ChangeHandler) => {
          entry.config = config;
          entry.onChange = handler;
          return channel;
        },
        subscribe: (handler: StatusHandler) => {
          entry.onStatus = handler;
          return channel;
        },
        entry,
      };
      return channel;
    },
    removeChannel: (channel: { entry: { removed: boolean } }) => {
      channel.entry.removed = true;
      return Promise.resolve('ok');
    },
  },
}));

const open = () => realtime.channels.filter((channel) => !channel.removed);

/** The one open channel. */
function feed() {
  const [channel] = open();
  if (!channel) throw new Error('No open channel');
  return channel;
}

const toItem = (row: Row) => ({ id: String(row.id), name: String(row.name) });
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

function setup(rows: Row[], options: { apply?: boolean; filter?: string } = {}) {
  const load = vi.fn(() => Promise.resolve({ data: [...rows], error: null }));
  const hook = renderHook(() =>
    useLiveRows({
      table: 'products',
      queryKey: 'all',
      load,
      map: toItem,
      filter: options.filter,
      apply: options.apply ? { key: (row) => String(row.id), compare: byName } : undefined,
    }),
  );
  return { load, hook };
}

beforeEach(() => {
  realtime.channels.length = 0;
});

describe('useLiveRows with apply (SRS 7.1)', () => {
  it('applies an inserted, updated or deleted row without loading the list again', async () => {
    const { load, hook } = setup([{ id: 'b', name: 'Bread' }], { apply: true });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    const channel = feed();

    act(() => channel.onChange({ eventType: 'INSERT', new: { id: 'a', name: 'Apple' }, old: {} }));
    expect(hook.result.current.data.map((item) => item.name)).toEqual(['Apple', 'Bread']);

    act(() => channel.onChange({ eventType: 'UPDATE', new: { id: 'b', name: 'Banana' }, old: {} }));
    expect(hook.result.current.data.map((item) => item.name)).toEqual(['Apple', 'Banana']);

    act(() => channel.onChange({ eventType: 'DELETE', new: {}, old: { id: 'a' } }));
    expect(hook.result.current.data.map((item) => item.name)).toEqual(['Banana']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('loads again when a change arrives without its columns', async () => {
    const { load, hook } = setup([{ id: 'b', name: 'Bread' }], { apply: true });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    act(() => feed().onChange({ eventType: 'UPDATE', new: {}, old: {}, errors: ['too large'] }));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('loads again after Realtime reconnects, since missed changes are not replayed', async () => {
    const { load, hook } = setup([{ id: 'b', name: 'Bread' }], { apply: true });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    const channel = feed();
    act(() => channel.onStatus('SUBSCRIBED'));
    expect(load).toHaveBeenCalledTimes(1);
    act(() => channel.onStatus('CHANNEL_ERROR'));
    act(() => channel.onStatus('SUBSCRIBED'));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('loads once more when a change arrives while the list is loading', async () => {
    const { load, hook } = setup([{ id: 'b', name: 'Bread' }], { apply: true });
    act(() => feed().onChange({ eventType: 'INSERT', new: { id: 'a', name: 'A' }, old: {} }));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('useLiveRows without apply', () => {
  it('loads the list again on a change', async () => {
    const { load, hook } = setup([{ id: 'b', name: 'Bread' }]);
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    act(() => feed().onChange({ eventType: 'UPDATE', new: { id: 'b' }, old: {} }));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('asks Realtime only for the rows it shows', () => {
    setup([], { filter: 'product_id=eq.p1' });
    expect(feed().config).toMatchObject({ table: 'products', filter: 'product_id=eq.p1' });
  });
});

describe('one Realtime channel per table on a device', () => {
  it('is shared by every screen watching the table, and closed after the last one', async () => {
    const first = setup([{ id: 'b', name: 'Bread' }], { apply: true });
    const second = setup([{ id: 'b', name: 'Bread' }], { apply: true });
    await waitFor(() => expect(second.hook.result.current.loading).toBe(false));
    expect(open()).toHaveLength(1);

    act(() => feed().onChange({ eventType: 'UPDATE', new: { id: 'b', name: 'Bun' }, old: {} }));
    expect(first.hook.result.current.data[0]?.name).toBe('Bun');
    expect(second.hook.result.current.data[0]?.name).toBe('Bun');

    first.hook.unmount();
    expect(open()).toHaveLength(1);
    second.hook.unmount();
    expect(open()).toHaveLength(0);
  });
});
