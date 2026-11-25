# Polish list (build step 15, after go-live)

Small wording and look findings that don't affect money, stock or security wait here instead
of getting their own pull request (the owner's rule of Nov 21, 2026). Each line says where it
was found. Anything that touches money, stock or security is fixed before go-live instead.

| Found                          | Screen      | Finding                                                                                                                |
| ------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| Nov 1, 2026 (drawer reopen)    | Audit log   | The auto-close line says "was never counted" even after a reopen whose drawer had been counted before.                 |
| Nov 24, 2026 (offline test)    | Sidebar     | Offline, the laptop sidebar shows "POS" instead of the store name; keep the last known store name on the device.       |
| Nov 25, 2026 (step 11 re-test) | Attendance  | "Ask to fix" on a staff day looks like plain text, not a button.                                                       |
| Nov 25, 2026 (step 11 re-test) | Attendance  | On a phone, "Ask to fix" opens the request form at the top of the page, far from the row tapped: scroll it into view.  |
| Nov 25, 2026 (step 11 re-test) | Sell, clock | Offline notes say "on this phone" also on a laptop: say "on this device".                                              |
| Nov 25, 2026 (step 11 re-test) | Approvals   | Offline, the first time stayed on "Loading..." instead of saying it needs internet (later it showed the offline copy). |
