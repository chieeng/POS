import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { unsentMessage, useBlocked } from './signOut';

/** Says why Sign out did nothing. Mounted once, for every screen and the lock screen. */
export function SignOutBlockedDialog() {
  const count = useBlocked((s) => s.count);
  const close = () => useBlocked.setState({ count: 0 });
  return (
    <Dialog open={count > 0} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogTitle>You can&apos;t sign out yet</DialogTitle>
        <DialogDescription>{unsentMessage(count)}</DialogDescription>
        <DialogActions>
          <Button className="min-h-[46px] px-[22px]" onClick={close}>
            OK
          </Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
