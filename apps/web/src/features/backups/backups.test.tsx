import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { BackupReminder } from './BackupReminder';
import { BackupsPage } from './BackupsPage';
import { backupStatus, describeDaysAgo, type BackupRecord } from './data';

const state = vi.hoisted(() => ({
  backups: { data: [] as BackupRecord[], loading: false, error: false },
}));

vi.mock('@/lib/supabase', () => ({ env: {}, supabase: {} }));
vi.mock('@/features/settings/PageHeader', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock('./data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./data')>()),
  useBackups: () => state.backups,
}));

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-10-17T12:00:00+08:00');
const OVERDUE = 'Data backup is overdue. Your system administrator has been notified.';

function backup(kind: BackupRecord['kind'], daysAgo: number, from = new Date()): BackupRecord {
  return { id: `${kind}-${daysAgo}`, kind, createdAt: new Date(from.getTime() - daysAgo * DAY) };
}

beforeEach(() => {
  state.backups = { data: [], loading: false, error: false };
});

describe('backupStatus (SYS-04)', () => {
  test('no backup at all is overdue', () => {
    expect(backupStatus([], now)).toMatchObject({ lastManual: null, overdue: true });
  });

  test('a manual backup within 7 days is fine; older is overdue', () => {
    expect(backupStatus([backup('manual', 3, now)], now)).toMatchObject({
      manualDaysAgo: 3,
      overdue: false,
    });
    expect(backupStatus([backup('manual', 7, now)], now).overdue).toBe(false);
    expect(backupStatus([backup('manual', 7.5, now)], now).overdue).toBe(true);
  });

  test('nightly backups never count', () => {
    const status = backupStatus([backup('nightly', 0, now), backup('manual', 10, now)], now);
    expect(status.lastNightly).not.toBeNull();
    expect(status.manualDaysAgo).toBe(10);
    expect(status.overdue).toBe(true);
    expect(backupStatus([backup('nightly', 0, now)], now).overdue).toBe(true);
  });

  test('picks the newest manual backup', () => {
    expect(
      backupStatus([backup('manual', 9, now), backup('manual', 2, now)], now).manualDaysAgo,
    ).toBe(2);
  });

  test('describeDaysAgo', () => {
    expect(describeDaysAgo(0)).toBe('today');
    expect(describeDaysAgo(1)).toBe('yesterday');
    expect(describeDaysAgo(9)).toBe('9 days ago');
  });
});

describe('the Owner home note', () => {
  test('says the administrator was notified when a backup is overdue, with no steps or links', () => {
    state.backups.data = [backup('manual', 9), backup('nightly', 0)];
    render(<BackupReminder />);
    expect(screen.getByRole('status')).toHaveTextContent(OVERDUE);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText(/GitHub/i)).toBeNull();
  });

  test('shows when there has never been a backup', () => {
    render(<BackupReminder />);
    expect(screen.getByRole('status')).toHaveTextContent(OVERDUE);
  });

  test('stays hidden after a recent manual backup', () => {
    state.backups.data = [backup('manual', 2)];
    render(<BackupReminder />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  test('stays hidden while loading or when the list cannot be read', () => {
    state.backups = { data: [], loading: true, error: false };
    const { unmount } = render(<BackupReminder />);
    expect(screen.queryByRole('status')).toBeNull();
    unmount();
    state.backups = { data: [], loading: false, error: true };
    render(<BackupReminder />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('Settings > Backups (read-only)', () => {
  test('shows the last backup and the last nightly copy, and nothing to do', () => {
    state.backups.data = [backup('nightly', 0), backup('manual', 3)];
    render(<BackupsPage />);
    expect(screen.getByText(/3 days ago/)).toBeInTheDocument();
    expect(screen.getByText(/Last automatic nightly copy:/)).toBeInTheDocument();
    expect(screen.queryByText(OVERDUE)).toBeNull();
    expect(screen.getByText(/made and kept safe by your system administrator/)).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(/GitHub/i)).toBeNull();
  });

  test('says when a backup is overdue', () => {
    state.backups.data = [backup('manual', 9)];
    render(<BackupsPage />);
    expect(screen.getByText(OVERDUE)).toBeInTheDocument();
  });

  test('says when there is no backup yet', () => {
    render(<BackupsPage />);
    expect(screen.getByText('No backup yet')).toBeInTheDocument();
    expect(screen.getByText(OVERDUE)).toBeInTheDocument();
  });
});
