import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { useSession } from '@/stores/session';
import { cancelSecondStep, signIn, verifyTotp } from './authService';
import { SignInPage } from './SignInPage';

vi.mock('@/lib/supabase', () => ({ env: { storeName: 'Test Store', storeAddress: undefined } }));
vi.mock('./authService', () => ({
  signIn: vi.fn(),
  verifyTotp: vi.fn(),
  signOutUser: vi.fn(),
  cancelSecondStep: vi.fn(() => Promise.resolve()),
}));

const signInMock = vi.mocked(signIn);
const verifyTotpMock = vi.mocked(verifyTotp);

function renderPage() {
  return render(
    <MemoryRouter>
      <SignInPage />
    </MemoryRouter>,
  );
}

async function submit(email: string, password: string) {
  const user = userEvent.setup();
  if (email) await user.type(screen.getByLabelText('Email'), email);
  if (password) await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  useSession.setState({ status: 'signedOut', user: null, notice: null, locked: false });
});

describe('SignInPage', () => {
  test('shows the store name and no way to sign up (SEC-01)', () => {
    renderPage();
    expect(screen.getAllByText('Test Store').length).toBeGreaterThan(0);
    expect(screen.queryByText(/sign up|create (an )?account|register/i)).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  test('validates before calling Supabase', async () => {
    renderPage();
    await submit('', '');
    expect(await screen.findByText('Enter your email.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(signInMock).not.toHaveBeenCalled();
  });

  test('rejects a malformed email', async () => {
    renderPage();
    await submit('not-an-email', 'password12');
    expect(await screen.findByText('Enter a valid email.')).toBeInTheDocument();
    expect(signInMock).not.toHaveBeenCalled();
  });

  test('signs in with trimmed email and the password', async () => {
    signInMock.mockResolvedValue({ kind: 'signedIn' });
    renderPage();
    await submit(' jun@example.com ', 'password12');
    expect(signInMock).toHaveBeenCalledWith('jun@example.com', 'password12', 'test-captcha-token');
  });

  test.each([
    ['invalid_credentials', 'Email or password is wrong.'],
    ['user_banned', 'This account is turned off.'],
    ['over_request_rate_limit', 'Too many tries.'],
    ['captcha_unavailable', 'No internet connection.'],
  ])('shows the error for %s', async (code, message) => {
    signInMock.mockRejectedValue({ code });
    renderPage();
    await submit('jun@example.com', 'wrongpass');
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  test('marks the password field after wrong credentials', async () => {
    signInMock.mockRejectedValue({ code: 'invalid_credentials' });
    renderPage();
    await submit('jun@example.com', 'wrongpass');
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
  });

  test('asks the Owner for the authenticator code, then verifies it', async () => {
    const challenge = { factorId: 'factor-1' };
    signInMock.mockResolvedValue({ kind: 'totpRequired', challenge });
    verifyTotpMock.mockResolvedValue();
    renderPage();
    const user = await submit('owner@example.com', 'password12');

    expect(await screen.findByRole('heading', { name: 'Enter your code' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('6-digit code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(verifyTotpMock).toHaveBeenCalledWith(challenge, '123456');
  });

  test('rejects a short code and reports a wrong one', async () => {
    signInMock.mockResolvedValue({
      kind: 'totpRequired',
      challenge: { factorId: 'f' },
    });
    verifyTotpMock.mockRejectedValue({ code: 'mfa_verification_failed' });
    renderPage();
    const user = await submit('owner@example.com', 'password12');

    await user.type(await screen.findByLabelText('6-digit code'), '123');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText('Enter the 6-digit code.')).toBeInTheDocument();
    expect(verifyTotpMock).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('6-digit code'), '456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText('That code is wrong.')).toBeInTheDocument();
  });

  test('explains why an account without access was signed out', () => {
    useSession.setState({ notice: 'no-access' });
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent('no access');
  });
});

test('going back from the code step drops the password-only session', async () => {
  signInMock.mockResolvedValue({ kind: 'totpRequired', challenge: { factorId: 'f' } });
  renderPage();
  const user = await submit('owner@example.com', 'password12');
  await user.click(await screen.findByRole('button', { name: 'Back to sign in' }));
  expect(cancelSecondStep).toHaveBeenCalled();
  expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
});
