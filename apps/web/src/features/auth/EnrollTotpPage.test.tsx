import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { finishTotpEnrollment, signOutUser, startTotpEnrollment } from './authService';
import { EnrollTotpPage } from './EnrollTotpPage';

vi.mock('@/lib/supabase', () => ({ env: {} }));
vi.mock('./authService', () => ({
  startTotpEnrollment: vi.fn(),
  finishTotpEnrollment: vi.fn(),
  signOutUser: vi.fn(),
}));

const enrollment = {
  factorId: 'factor-1',
  secretKey: 'JBSWY3DPEHPK3PXP',
  qrCode: 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  otpauthUrl: 'otpauth://totp/POS:owner@example.com?secret=JBSWY3DPEHPK3PXP&issuer=POS',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(startTotpEnrollment).mockResolvedValue(enrollment);
});

test('shows a QR code and the setup key for the authenticator app (SEC-05)', async () => {
  render(<EnrollTotpPage />);
  const qr = await screen.findByRole('img', { name: /QR code/ });
  expect(qr).toHaveAttribute('src', enrollment.qrCode);
  expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Open authenticator app/ })).toHaveAttribute(
    'href',
    enrollment.otpauthUrl,
  );
});

test('turns two-step on with the code, then asks for a fresh sign-in', async () => {
  vi.mocked(finishTotpEnrollment).mockResolvedValue();
  render(<EnrollTotpPage />);
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('6-digit code'), '123456');
  await user.click(screen.getByRole('button', { name: 'Turn on' }));
  await vi.waitFor(() => expect(finishTotpEnrollment).toHaveBeenCalledWith(enrollment, '123456'));
  await vi.waitFor(() => expect(signOutUser).toHaveBeenCalledWith('two-step-ready'));
});

test('a wrong code is reported and nothing is turned on', async () => {
  vi.mocked(finishTotpEnrollment).mockRejectedValue({ code: 'mfa_verification_failed' });
  render(<EnrollTotpPage />);
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('6-digit code'), '000000');
  await user.click(screen.getByRole('button', { name: 'Turn on' }));
  expect(await screen.findByText('That code is wrong.')).toBeInTheDocument();
  expect(signOutUser).not.toHaveBeenCalled();
});
