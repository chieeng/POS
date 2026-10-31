import { describe, expect, it } from 'vitest';
import { ACTION_LABELS, describeAudit } from './describe';

const base = {
  id: 'a1',
  actorId: 'u1',
  targetId: 'd1',
  deviceTag: 'A1B2',
  before: null,
  reason: null,
  createdAt: new Date('2026-11-01T06:05:00Z'),
};

describe('drawer entries in the audit log (SHIFT-01..03)', () => {
  it('reads an opening, with the difference from the last count', () => {
    expect(ACTION_LABELS['drawer.open']).toBe('Drawer opened');
    expect(
      describeAudit(
        {
          ...base,
          action: 'drawer.open',
          after: { businessDate: '2026-11-01', opening: 1800, lastCount: 2000, difference: -200 },
        },
        'x',
      ),
    ).toMatchObject({
      what: 'opened the drawer for Nov 1',
      change: '₱1,800.00 (last count ₱2,000.00, −₱200.00)',
    });
  });

  it('reads a closing with the exact over/short', () => {
    expect(
      describeAudit(
        {
          ...base,
          action: 'drawer.close',
          after: { businessDate: '2026-11-01', counted: 8392, expected: 8412, overShort: -20 },
        },
        'x',
      ).change,
    ).toBe('Counted ₱8,392.00, expected ₱8,412.00, short ₱20.00');
  });

  it('reads a drawer nobody counted, and a reopening', () => {
    expect(
      describeAudit(
        {
          ...base,
          action: 'drawer.notCounted',
          after: { businessDate: '2026-10-31', expected: 2000 },
        },
        'x',
      ),
    ).toMatchObject({
      what: "opened today's drawer; the drawer for Oct 31 was never counted",
      change: 'Expected ₱2,000.00, not counted',
    });
    expect(
      describeAudit(
        {
          ...base,
          action: 'drawer.reopen',
          before: { businessDate: '2026-11-01', counted: 2140, overShort: 0 },
          after: { status: 'open' },
          reason: 'A late sale',
        },
        'x',
      ).change,
    ).toBe('It was counted at ₱2,140.00, exact · Reason: A late sale');
  });

  it('reads cash in and out with the amount, reason and note', () => {
    expect(ACTION_LABELS['drawer.cashOut']).toBe('Cash taken out of the drawer');
    expect(
      describeAudit(
        {
          ...base,
          action: 'drawer.cashOut',
          after: {
            businessDate: '2026-10-31',
            amount: 350,
            reason: 'expense',
            note: 'Ice, 2 sacks',
          },
        },
        'x',
      ),
    ).toMatchObject({
      what: 'took ₱350.00 out of the drawer for Oct 31',
      change: 'Expense · Ice, 2 sacks',
    });
    expect(
      describeAudit(
        {
          ...base,
          action: 'drawer.cashIn',
          after: { businessDate: '2026-10-31', amount: 500, reason: 'change_fund', note: null },
        },
        'x',
      ),
    ).toMatchObject({ what: 'put ₱500.00 into the drawer for Oct 31', change: 'Change fund' });
  });
});
