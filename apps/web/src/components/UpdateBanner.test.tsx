import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateBanner } from './UpdateBanner';

const pwa = vi.hoisted(() => ({ needRefresh: false, update: vi.fn() }));

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [pwa.needRefresh, vi.fn()],
    offlineReady: [false, vi.fn()],
    updateServiceWorker: pwa.update,
  }),
}));

beforeEach(() => {
  pwa.needRefresh = false;
  pwa.update.mockReset();
});

describe('new version banner', () => {
  it('shows nothing while the app is up to date', () => {
    render(<UpdateBanner />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('waits for the user, then reloads into the new version', async () => {
    pwa.needRefresh = true;
    render(<UpdateBanner />);
    expect(screen.getByRole('status')).toHaveTextContent('A new version of the app is ready');
    expect(pwa.update).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reload now' }));
    expect(pwa.update).toHaveBeenCalledWith(true);
  });
});
