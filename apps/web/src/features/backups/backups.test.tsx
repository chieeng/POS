import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { BackupReminder } from './BackupReminder';
import { BackupsPage } from './BackupsPage';
import { backupStatus, describeDaysAgo, type BackupRecord } from './data';

const state = vi.hoisted(() => ({
  backups: { data: [] as BackupRecord[], loading: false, error: false },
}));

vi.mock('@/lib/supabase', () => ({ env: {}, supabase: {} }));
vi.mock('./data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./data')>()),
  useBackups: () => state.backups,
}));

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-10-17T12:00:00+08:00');

function backup(kind: BackupRecord['kind'], daysAgo: number, keepDays = 1): BackupRecord {
  const createdAt = new Date(Date.now() - daysAgo * DAY);
  return {
    id: `${kind}-${daysAgo}`,
    createdAt,
    kind,
    fileName: 'pos-prod-2026-10-17-0930.tar.gz.age',
    sizeBytes: 18578,
    runUrl: 'https://github.com/chieeng/POS/actions/runs/1',
    expiresAt: new Date(createdAt.getTime() + keepDays * DAY),
  };
}

function renderInRouter(element: React.ReactNode) {
  const router = createMemoryRouter([{ path: '/', element }], { initialEntries: ['/'] });
  render(<RouterProvider router={router} />);
}

beforeEach(() => {
  state.backups = { data: [], loading: false, error: false };
});

describe('backupStatus (SYS-04)', () => {
  const at = (kind: BackupRecord['kind'], days: number): BackupRecord => ({
    ...backup(kind, 0),
    createdAt: new Date(now.getTime() - days * DAY),
  });

  test('no backup at all is overdue', () => {
    expect(backupStatus([], now)).toMatchObject({ lastManual: null, overdue: true });
  });

  test('a manual backup within 7 days is fine; older is overdue', () => {
    expect(backupStatus([at('manual', 3)], now)).toMatchObject({
      manualDaysAgo: 3,
      overdue: false,
    });
    expect(backupStatus([at('manual', 7)], now).overdue).toBe(false);
    expect(backupStatus([at('manual', 7.5)], now).overdue).toBe(true);
  });

  test('nightly backups never count for the reminder', () => {
    const status = backupStatus([at('nightly', 0), at('manual', 10)], now);
    expect(status.lastNightly).not.toBeNull();
    expect(status.manualDaysAgo).toBe(10);
    expect(status.overdue).toBe(true);
    expect(backupStatus([at('nightly', 0)], now).overdue).toBe(true);
  });

  test('picks the newest manual backup', () => {
    expect(backupStatus([at('manual', 9), at('manual', 2)], now).manualDaysAgo).toBe(2);
  });

  test('describeDaysAgo', () => {
    expect(describeDaysAgo(0)).toBe('today');
    expect(describeDaysAgo(1)).toBe('yesterday');
    expect(describeDaysAgo(9)).toBe('9 days ago');
  });
});

describe('BackupReminder on the Owner home', () => {
  test('shows when the last manual backup is more than 7 days old', () => {
    state.backups.data = [backup('manual', 9), backup('nightly', 0, 7)];
    renderInRouter(<BackupReminder />);
    expect(screen.getByRole('alert')).toHaveTextContent('Your last backup was 9 days ago.');
    expect(screen.getByRole('link', { name: 'Backups' })).toHaveAttribute(
      'href',
      '/settings/backups',
    );
  });

  test('shows when there has never been a backup', () => {
    renderInRouter(<BackupReminder />);
    expect(screen.getByRole('alert')).toHaveTextContent('You have not made a backup yet.');
  });

  test('stays hidden after a recent manual backup', () => {
    state.backups.data = [backup('manual', 2)];
    renderInRouter(<BackupReminder />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('stays hidden while loading or when the list cannot be read', () => {
    state.backups = { data: [], loading: true, error: false };
    const { unmount } = render(<BackupReminder />);
    expect(screen.queryByRole('alert')).toBeNull();
    unmount();
    state.backups = { data: [], loading: false, error: true };
    render(<BackupReminder />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('Settings > Backups', () => {
  test('shows the last saved backup, the steps and the GitHub link', () => {
    state.backups.data = [backup('nightly', 0, 7), backup('manual', 3)];
    renderInRouter(<BackupsPage />);
    expect(screen.getByText(/3 days ago/)).toBeInTheDocument();
    expect(screen.queryByText(/more than 7 days old/)).toBeNull();
    expect(screen.getByText(/Last nightly backup:/)).toBeInTheDocument();
    const open = screen.getByRole('link', { name: /Open the Backup workflow on GitHub/ });
    expect(open).toHaveAttribute(
      'href',
      'https://github.com/chieeng/POS/actions/workflows/backup.yml',
    );
    expect(open).toHaveAttribute('rel', 'noopener noreferrer');
  });

  test('lists recent backups, linking only those still on GitHub', () => {
    state.backups.data = [backup('nightly', 0, 7), backup('manual', 3)];
    renderInRouter(<BackupsPage />);
    expect(screen.getByText(/Nightly · 18 KB/)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Download until/ })).toHaveLength(1);
    expect(screen.getByText('No longer on GitHub')).toBeInTheDocument();
  });

  test('warns when there is no backup yet', () => {
    renderInRouter(<BackupsPage />);
    expect(screen.getByText('No backup yet')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('There is no backup yet.');
  });
});
