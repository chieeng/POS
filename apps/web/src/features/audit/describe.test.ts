import { describe, expect, it } from 'vitest';
import { ACTION_LABELS, describeAudit } from './describe';

const entry = {
  id: 'a1',
  action: 'outbox.rejected',
  actorId: 'u1',
  targetId: 'sale-1',
  deviceTag: 'A1B2',
  before: null,
  after: { kind: 'sale', madeAt: '2026-10-31T06:00:00Z', entry: { total: 45 } },
  reason: 'The drawer is closed.',
  createdAt: new Date('2026-10-31T06:05:00Z'),
};

describe('offline entries the server refused (NFR-02)', () => {
  it('reads as a sale or clock-in that was not saved, with why and where it is kept', () => {
    expect(ACTION_LABELS['outbox.rejected']).toBe('Offline entries not saved');
    expect(describeAudit(entry, 'x')).toMatchObject({
      what: 'made a sale offline that could not be saved',
      change: 'The drawer is closed. Kept on device A1B2.',
    });
    expect(describeAudit({ ...entry, after: { kind: 'clock_in' } }, 'x').what).toBe(
      'made a clock-in offline that could not be saved',
    );
  });
});
