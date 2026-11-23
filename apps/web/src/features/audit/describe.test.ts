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
    expect(describeAudit({ ...entry, after: { kind: 'clock_out' } }, 'x').what).toBe(
      'made a clock-out offline that could not be saved',
    );
  });
});

describe('a time in on a marked day (decision F, Nov 23)', () => {
  it('reads as clocking in over the mark, with the mark’s reason', () => {
    expect(
      describeAudit(
        {
          ...entry,
          action: 'attendance.mark',
          after: { name: 'Test Two', day: '2026-11-24', kind: 'replaced', was: 'absent' },
          reason: 'Did not show up',
        },
        'x',
      ),
    ).toMatchObject({
      what: 'clocked in on 2026-11-24, replacing the Absent mark',
      change: 'The mark’s reason: Did not show up',
    });
  });
});
