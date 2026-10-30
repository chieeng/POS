import { zodResolver } from '@hookform/resolvers/zod';
import { KeyRound, Laptop, LogOut, Smartphone, Tablet, UserCheck, UserX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useParams } from 'react-router-dom';
import { Avatar } from '@/components/Avatar';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogActions,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Segmented } from '@/components/ui/segmented';
import { ROLE_LABELS, type Role } from '@/features/auth/roles';
import { PageHeader } from '@/features/settings/PageHeader';
import { api, describeApiError } from '@/lib/api';
import { ICON_STROKE } from '@/lib/utils';
import { useSession } from '@/stores/session';
import { describeLastSeen, useDevices, useUsers, type DeviceRecord, type UserRecord } from './data';
import { ResetLinkPanel } from './ResetLinkPanel';
import { editUserSchema, STAFF_ROLE_OPTIONS, type EditUserValues } from './schemas';
import { RoleTag, StatusTag } from './UsersPage';

type Pending =
  | { kind: 'role'; role: Role }
  | { kind: 'signOut' }
  | { kind: 'deactivate' }
  | { kind: 'reactivate' }
  | { kind: 'resetLink'; link: string }
  | null;

function deviceIcon(label: string) {
  if (/phone/i.test(label)) return Smartphone;
  if (/tablet|iPad/i.test(label)) return Tablet;
  return Laptop;
}

/** Settings > Users > one user (design 15b; AUTH-02..04, SEC-04, SEC-13). */
export function UserDetailPage() {
  const { uid = '' } = useParams();
  const me = useSession((s) => s.user);
  const branchId = me?.branchId ?? '';
  const users = useUsers(branchId);
  const devices = useDevices(branchId);
  const user = users.data.find((candidate) => candidate.uid === uid);

  return (
    <div className="flex w-full max-w-[560px] flex-col gap-[14px] p-[14px] md:px-[26px] md:py-[22px] xl:py-[28px] xl:pl-[16px]">
      <PageHeader
        title={<span className="font-body text-[15px] text-neutral-700">Users</span>}
        backTo="/settings/users"
        backLabel="Back to users"
        alwaysBack
      />
      {users.loading ? (
        <p className="text-neutral-700" role="status">
          Loading…
        </p>
      ) : !user ? (
        <Alert variant="warn">This user was not found.</Alert>
      ) : (
        <UserDetail
          key={user.uid}
          user={user}
          isSelf={user.uid === me?.uid}
          devices={devices.data.filter((device) => device.uid === user.uid)}
        />
      )}
    </div>
  );
}

interface UserDetailProps {
  user: UserRecord;
  isSelf: boolean;
  devices: DeviceRecord[];
}

function UserDetail({ user, isSelf, devices }: UserDetailProps) {
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const firstName = user.displayName.split(/\s+/)[0] || user.displayName;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<EditUserValues>({
    resolver: zodResolver(editUserSchema),
    defaultValues: { displayName: user.displayName, userCode: user.userCode },
  });

  // Keep the form in step with live changes made elsewhere.
  useEffect(() => {
    reset({ displayName: user.displayName, userCode: user.userCode });
  }, [reset, user.displayName, user.userCode]);

  /** Runs one Owner action, then closes the dialog and reports the result. */
  const run = async (action: () => Promise<unknown>, done: string | null) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setPending(null);
      setNotice(done);
    } catch (caught) {
      setPending(null);
      setError(describeApiError(caught));
    } finally {
      setBusy(false);
    }
  };

  const saveDetails = handleSubmit((values) =>
    run(() => api.updateUser({ uid: user.uid, ...values }), 'Saved.'),
  );

  const requestResetLink = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.createPasswordResetLink({ uid: user.uid });
      setPending({ kind: 'resetLink', link: result.resetLink });
    } catch (caught) {
      setError(describeApiError(caught));
    } finally {
      setBusy(false);
    }
  };

  const sortedDevices = [...devices].sort(
    (a, b) => (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0),
  );

  return (
    <>
      <div className="flex items-center gap-[12px]">
        <Avatar name={user.displayName} className="size-[60px] text-[20px]" />
        <div className="min-w-0 leading-[1.3]">
          <h2 className="truncate text-[24px]">{user.displayName}</h2>
          <div className="truncate text-[13.5px] text-neutral-700">{user.email}</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-[6px]">
        <RoleTag role={user.role} />
        <StatusTag active={user.active} />
      </div>

      {error && <Alert variant="danger">{error}</Alert>}
      {notice && <Alert variant="warn">{notice}</Alert>}

      {!user.active ? (
        <>
          <p className="text-[14px] text-neutral-700">
            This account is turned off and cannot sign in. Its sales and history are kept.
          </p>
          {!isSelf && (
            <Button
              variant="secondary"
              className="min-h-[50px]"
              disabled={busy}
              onClick={() => setPending({ kind: 'reactivate' })}
            >
              <UserCheck size={16} strokeWidth={ICON_STROKE} aria-hidden />
              Reactivate {firstName}
            </Button>
          )}
        </>
      ) : (
        <>
          <div>
            <Label className="text-[13px]">Role</Label>
            {user.role === 'owner' || isSelf ? (
              <p className="text-[14px] text-neutral-700">
                {isSelf
                  ? 'You cannot change your own role.'
                  : 'The Owner role cannot be changed here.'}
              </p>
            ) : (
              <Segmented
                label="Role"
                options={STAFF_ROLE_OPTIONS}
                value={user.role}
                disabled={busy}
                onChange={(role) => setPending({ kind: 'role', role })}
              />
            )}
          </div>

          <form onSubmit={saveDetails} noValidate className="flex flex-col gap-[10px]">
            <div className="grid grid-cols-[1fr_120px] gap-[10px]">
              <div>
                <Label htmlFor="edit-name" className="text-[13px]">
                  Full name
                </Label>
                <Input
                  id="edit-name"
                  autoComplete="off"
                  className="min-h-[48px] text-[15px]"
                  aria-invalid={!!errors.displayName || undefined}
                  {...register('displayName')}
                />
              </div>
              <div>
                <Label htmlFor="edit-code" className="text-[13px]">
                  User code
                </Label>
                <Input
                  id="edit-code"
                  autoComplete="off"
                  maxLength={6}
                  className="min-h-[48px] text-[15px] font-semibold uppercase"
                  aria-invalid={!!errors.userCode || undefined}
                  {...register('userCode')}
                />
              </div>
            </div>
            {(errors.displayName || errors.userCode) && (
              <p className="text-[13px] text-danger-fg">
                {errors.displayName?.message ?? errors.userCode?.message}
              </p>
            )}
            {isDirty && (
              <Button
                type="submit"
                className="min-h-[46px] self-end px-[24px]"
                disabled={isSubmitting || busy}
              >
                {isSubmitting ? 'Saving…' : 'Save'}
              </Button>
            )}
          </form>
        </>
      )}

      <h3 className="mt-[4px] font-body text-[12px] font-bold tracking-[0.08em] text-neutral-700 uppercase">
        Devices · {sortedDevices.length}
      </h3>
      {sortedDevices.length === 0 ? (
        <p className="text-[14px] text-neutral-700">No device has signed in yet.</p>
      ) : (
        <ul className="flex flex-col gap-[8px]">
          {sortedDevices.map((device) => {
            const Icon = deviceIcon(device.label);
            return (
              <li
                key={device.deviceTag}
                className="flex items-center gap-[12px] rounded-[22px] bg-surface px-[14px] py-[12px]"
              >
                <Icon size={20} strokeWidth={ICON_STROKE} aria-hidden />
                <div className="min-w-0 flex-1 leading-[1.3]">
                  <div className="truncate text-[14.5px] font-semibold">{device.label}</div>
                  <div className="text-[12.5px] text-neutral-700">
                    {describeLastSeen(device.lastSeenAt, { active: user.active })} · tag{' '}
                    {device.deviceTag}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {user.active && (
        <div className="mt-[8px] flex flex-col gap-[8px]">
          <Button
            variant="secondary"
            className="min-h-[50px]"
            disabled={busy}
            onClick={requestResetLink}
          >
            <KeyRound size={16} strokeWidth={ICON_STROKE} aria-hidden />
            Password reset link
          </Button>
          <Button
            variant="secondary"
            className="min-h-[50px]"
            disabled={busy}
            onClick={() => setPending({ kind: 'signOut' })}
          >
            <LogOut size={16} strokeWidth={ICON_STROKE} aria-hidden />
            Sign out of all devices
          </Button>
          {!isSelf && (
            <Button
              variant="quiet"
              className="min-h-[48px] font-bold text-danger-fg"
              disabled={busy}
              onClick={() => {
                setReason('');
                setPending({ kind: 'deactivate' });
              }}
            >
              <UserX size={16} strokeWidth={ICON_STROKE} aria-hidden />
              Deactivate {firstName}
            </Button>
          )}
        </div>
      )}

      <Dialog open={pending !== null} onOpenChange={(open) => !open && !busy && setPending(null)}>
        {pending?.kind === 'role' && (
          <DialogContent>
            <DialogTitle>Change role to {ROLE_LABELS[pending.role]}?</DialogTitle>
            <DialogDescription>
              {firstName} will be signed out of every device and must sign in again.
            </DialogDescription>
            <DialogActions>
              <DialogClose asChild>
                <Button variant="secondary" className="min-h-[46px] px-[18px]" disabled={busy}>
                  Cancel
                </Button>
              </DialogClose>
              <Button
                className="min-h-[46px] px-[22px]"
                disabled={busy}
                onClick={() =>
                  run(
                    () => api.setUserRole({ uid: user.uid, role: pending.role }),
                    `${user.displayName} is now ${ROLE_LABELS[pending.role]}.`,
                  )
                }
              >
                {busy ? 'Changing…' : 'Change role'}
              </Button>
            </DialogActions>
          </DialogContent>
        )}

        {pending?.kind === 'signOut' && (
          <DialogContent>
            <DialogTitle>Sign {firstName} out of all devices?</DialogTitle>
            <DialogDescription>
              Use this for a lost phone. The account stays on; {firstName} can sign in again with
              their password. A device that is open right now may keep working for up to an hour.
            </DialogDescription>
            <DialogActions>
              <DialogClose asChild>
                <Button variant="secondary" className="min-h-[46px] px-[18px]" disabled={busy}>
                  Cancel
                </Button>
              </DialogClose>
              <Button
                className="min-h-[46px] px-[22px]"
                disabled={busy}
                onClick={() =>
                  run(
                    () => api.signOutEverywhere({ uid: user.uid }),
                    `${user.displayName} has been signed out of all devices.`,
                  )
                }
              >
                {busy ? 'Signing out…' : 'Sign out'}
              </Button>
            </DialogActions>
          </DialogContent>
        )}

        {pending?.kind === 'deactivate' && (
          <DialogContent>
            <DialogTitle>Deactivate {firstName}?</DialogTitle>
            <DialogDescription>
              {firstName} will be signed out everywhere and can no longer sign in. Their sales and
              history are kept. You can reactivate {firstName} later.
            </DialogDescription>
            <div>
              <Label htmlFor="deactivate-reason" className="text-[13px]">
                Reason (optional)
              </Label>
              <Input
                id="deactivate-reason"
                value={reason}
                maxLength={200}
                onChange={(event) => setReason(event.target.value)}
                className="min-h-[46px] bg-bg text-[15px]"
              />
            </div>
            <DialogActions>
              <DialogClose asChild>
                <Button variant="secondary" className="min-h-[46px] px-[18px]" disabled={busy}>
                  Cancel
                </Button>
              </DialogClose>
              <Button
                className="min-h-[46px] bg-danger px-[22px] hover:bg-danger active:bg-danger"
                disabled={busy}
                onClick={() =>
                  run(
                    () =>
                      api.deactivateUser({
                        uid: user.uid,
                        ...(reason.trim() ? { reason: reason.trim() } : {}),
                      }),
                    `${user.displayName} has been deactivated and signed out of all devices.`,
                  )
                }
              >
                {busy ? 'Deactivating…' : 'Deactivate'}
              </Button>
            </DialogActions>
          </DialogContent>
        )}

        {pending?.kind === 'reactivate' && (
          <DialogContent>
            <DialogTitle>Reactivate {firstName}?</DialogTitle>
            <DialogDescription>
              {firstName} can sign in again with the same role, user code and password. Their sales
              and history are as they were.
            </DialogDescription>
            <DialogActions>
              <DialogClose asChild>
                <Button variant="secondary" className="min-h-[46px] px-[18px]" disabled={busy}>
                  Cancel
                </Button>
              </DialogClose>
              <Button
                className="min-h-[46px] px-[22px]"
                disabled={busy}
                onClick={() =>
                  run(
                    () => api.reactivateUser({ uid: user.uid }),
                    `${user.displayName} can sign in again with their old password. If they forgot it, use Password reset link below.`,
                  )
                }
              >
                {busy ? 'Reactivating…' : 'Reactivate'}
              </Button>
            </DialogActions>
          </DialogContent>
        )}

        {pending?.kind === 'resetLink' && (
          <DialogContent>
            <DialogTitle>Password reset link</DialogTitle>
            <DialogDescription className="sr-only">
              One-time link for {user.displayName} to set a new password.
            </DialogDescription>
            <ResetLinkPanel link={pending.link} name={user.displayName} />
            <DialogActions>
              <DialogClose asChild>
                <Button className="min-h-[46px] px-[22px]">Done</Button>
              </DialogClose>
            </DialogActions>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
