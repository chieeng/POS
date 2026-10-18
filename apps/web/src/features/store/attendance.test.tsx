import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { describeAudit } from '@/features/audit/describe';
import type { AuditRecord } from '@/features/users/data';
import { AttendanceSettingsPage } from './AttendanceSettingsPage';
import { BranchContext, toBranch, updateBranchSettings, type BranchSettings } from './data';

vi.mock('@/lib/supabase', () => ({ env: {}, supabase: {} }));
vi.mock('./data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./data')>()),
  updateBranchSettings: vi.fn(),
}));

// The defaults decided for the SRS on 18 Oct 2026.
const BRANCH: BranchSettings = {
  ...toBranch({ id: 'main', name: 'Eragon Store' }),
  morningClockIn: '06:00',
  afternoonClockIn: '13:00',
  graceMinutes: 15,
  lateDeduction: 'none',
  latePenalty: 0,
  paidMinutesPerDay: 480,
  afternoonDayCredit: 0.5,
  ownerClocksIn: false,
};

const save = vi.mocked(updateBranchSettings);

function renderPage(branch: BranchSettings = BRANCH) {
  render(
    <MemoryRouter>
      <BranchContext.Provider value={{ data: [branch], loading: false, error: false }}>
        <AttendanceSettingsPage />
      </BranchContext.Provider>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

const saveButton = () => screen.getByRole('button', { name: 'Save attendance rules' });

beforeEach(() => {
  vi.clearAllMocks();
  save.mockResolvedValue();
});

describe('Settings > Attendance (ATT-07)', () => {
  test('shows the defaults: 6:00, 13:00, 15 min, no deduction, half day, staff only', () => {
    renderPage();
    expect(screen.getByLabelText('Morning shift clock-in')).toHaveValue('06:00');
    expect(screen.getByLabelText('Afternoon shift clock-in')).toHaveValue('13:00');
    expect(screen.getByLabelText('Grace period (minutes)')).toHaveValue('15');
    expect(screen.getByRole('radio', { name: 'None' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Half day' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'No, staff only' })).toBeChecked();
    expect(screen.getByText('Lateness is recorded, and nothing is deducted.')).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  test('saves every rule, in the database units', async () => {
    const user = renderPage();
    await user.clear(screen.getByLabelText('Morning shift clock-in'));
    await user.type(screen.getByLabelText('Morning shift clock-in'), '07:30');
    await user.clear(screen.getByLabelText('Grace period (minutes)'));
    await user.type(screen.getByLabelText('Grace period (minutes)'), '10');
    await user.click(screen.getByRole('radio', { name: 'Minutes late' }));
    await user.clear(screen.getByLabelText('Paid hours per day'));
    await user.type(screen.getByLabelText('Paid hours per day'), '9');
    await user.click(screen.getByRole('radio', { name: 'Full day' }));
    await user.click(screen.getByRole('radio', { name: 'Yes' }));
    await user.click(saveButton());

    expect(save).toHaveBeenCalledWith({
      morning_clock_in: '07:30',
      afternoon_clock_in: '13:00',
      grace_minutes: 10,
      late_deduction: 'minutes',
      late_penalty: 0,
      paid_minutes_per_day: 540,
      afternoon_day_credit: 1,
      owner_clocks_in: true,
    });
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  test('"Minutes late" shows a worked example', async () => {
    const user = renderPage();
    await user.click(screen.getByRole('radio', { name: 'Minutes late' }));
    // 600 / (8 x 60) x 10 = 12.50
    expect(
      screen.getByText('Example: with a ₱600.00 daily rate, 10 minutes late deducts ₱12.50.'),
    ).toBeInTheDocument();
  });

  test('"Flat amount" asks for the amount and shows the labor-rules warning', async () => {
    const user = renderPage();
    expect(screen.queryByText(/Check before using a flat amount/)).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Flat amount' }));
    expect(screen.getByText(/Check before using a flat amount/)).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Amount per late day (₱)'));
    await user.type(screen.getByLabelText('Amount per late day (₱)'), '25.50');
    expect(
      screen.getByText('Each late day deducts ₱25.50, however few minutes late.'),
    ).toBeInTheDocument();
    await user.click(saveButton());
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ late_deduction: 'flat', late_penalty: 25.5 }),
    );
  });

  test('refuses an afternoon shift that starts before the morning one', async () => {
    const user = renderPage();
    await user.clear(screen.getByLabelText('Afternoon shift clock-in'));
    await user.type(screen.getByLabelText('Afternoon shift clock-in'), '05:00');
    await user.click(saveButton());
    expect(
      await screen.findByText('The afternoon shift must start after the morning shift.'),
    ).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  test('refuses a grace period over 120 minutes and too few paid hours', async () => {
    const user = renderPage();
    await user.clear(screen.getByLabelText('Grace period (minutes)'));
    await user.type(screen.getByLabelText('Grace period (minutes)'), '200');
    await user.click(screen.getByRole('radio', { name: 'Minutes late' }));
    await user.clear(screen.getByLabelText('Paid hours per day'));
    await user.type(screen.getByLabelText('Paid hours per day'), '0.5');
    await user.click(saveButton());
    expect(await screen.findByText('Use 0 to 120 minutes.')).toBeInTheDocument();
    expect(screen.getByText('Use 1 to 24 hours.')).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  test('loads saved rules', () => {
    renderPage({
      ...BRANCH,
      lateDeduction: 'flat',
      latePenalty: 30,
      paidMinutesPerDay: 450,
      afternoonDayCredit: 1,
      ownerClocksIn: true,
    });
    expect(screen.getByRole('radio', { name: 'Flat amount' })).toBeChecked();
    expect(screen.getByLabelText('Amount per late day (₱)')).toHaveValue('30');
    expect(screen.getByRole('radio', { name: 'Full day' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Yes' })).toBeChecked();
  });
});

describe('branch row and audit log', () => {
  test('toBranch reads the attendance columns', () => {
    expect(
      toBranch({
        morning_clock_in: '07:30:00',
        afternoon_clock_in: '14:00:00',
        grace_minutes: 10,
        late_deduction: 'minutes',
        late_penalty: '0.00',
        paid_minutes_per_day: 540,
        afternoon_day_credit: '1.0',
        owner_clocks_in: true,
      }),
    ).toMatchObject({
      morningClockIn: '07:30',
      afternoonClockIn: '14:00',
      lateDeduction: 'minutes',
      paidMinutesPerDay: 540,
      afternoonDayCredit: 1,
      ownerClocksIn: true,
    });
  });

  test('an attendance rule change reads the way the Owner would say it', () => {
    const entry: AuditRecord = {
      id: '1',
      action: 'branch.update',
      actorId: 'o1',
      targetId: 'main',
      deviceTag: null,
      before: {
        morning_clock_in: '06:00:00',
        late_deduction: 'none',
        afternoon_day_credit: 0.5,
        owner_clocks_in: false,
      },
      after: {
        morning_clock_in: '13:30:00',
        late_deduction: 'minutes',
        afternoon_day_credit: 1.0,
        owner_clocks_in: true,
      },
      reason: null,
      createdAt: null,
    };
    expect(describeAudit(entry, 'x').change).toBe(
      'Morning clock-in: 6:00 AM → 1:30 PM · Late deduction: None → Minutes late · ' +
        'Afternoon-start day: Half day → Full day · Owner clocks in: No → Yes',
    );
  });
});
