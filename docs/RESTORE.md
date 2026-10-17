# Backups and restoring them

The Supabase Free plan has no backups of its own. The **Backup** workflow
([.github/workflows/backup.yml](../.github/workflows/backup.yml)) copies the whole database
into one encrypted file (SYS-04, SEC-15). These files are the only way back after a mistake
or a lost project.

**The developer who maintains the system makes, keeps and restores the backups.** The
store's Owner uses the app but has no GitHub access and nothing to do here: the app shows
them the last backup date (Settings > Backups) and, when a backup is overdue, a calm note on
their home screen saying the system administrator has been notified.

- **Manual backups** are the ones that count. The developer makes one at least **every 7
  days** (more often before payroll or a big stock count), downloads it, and saves it to
  their PC **and** Google Drive. GitHub keeps its copy for 1 day only.
- **Nightly backups** run at 02:23 Manila time, production only, and stay on GitHub for
  7 days. They are a safety net between manual backups: nothing is saved off GitHub, so
  they do not count as a backup being made.
- **What is in a backup:** every user account (with password hashes and authenticator-app
  secrets, so everyone keeps their password and two-step sign-in), every table of the app,
  and the list of migrations the database had.
- **What is not:** anything changed after the backup ran. A restore goes back to that moment
  (NFR-07).
- **Who can read them:** only someone holding the **backup key** (see below). The repository
  is public, so while GitHub keeps a file, anyone signed in to GitHub can download it; it is
  unreadable without the key. The public run logs show only when a backup ran, the file
  name and its size.

**Reminders reach the developer, by email from GitHub:** the daily Heartbeat workflow fails
when the last successful manual production backup is more than 7 days old (once the
repository variable `GO_LIVE` is `true`; before go-live it is only a warning), and a failed
nightly backup fails its own run.

## Making a backup

1. GitHub > **Actions** > **Backup** > **Run workflow**. Keep branch **main** and target
   **production**, and press the green **Run workflow** button.
2. Wait about 2 minutes for the green tick, then open the run.
3. Under **Artifacts**, download the file. It is named like
   `pos-prod-2026-10-17-0930.tar.gz.age` (date and time in Manila). GitHub downloads it
   inside a `.zip`: open the zip and take the `.age` file out.
4. Save the `.age` file in two places: a folder on your PC (for example
   `Documents\POS backups`) and Google Drive.
5. Back on the run page, delete the artifact (the bin icon next to it).

The `.age` file is safe to keep anywhere: without the key it cannot be opened.

## The backup key

Backups are encrypted with [age](https://age-encryption.org). The key comes in two halves:

- the **public key** (`age1...`) is in GitHub as `BACKUP_AGE_RECIPIENTS`. It can only lock
  files, never open them;
- the **private key** (`AGE-SECRET-KEY-1...`) opens them. It is **not** in GitHub, Cloudflare
  or this repository. The developer keeps it in a password manager and on one printed copy
  in a safe place. If the system is ever handed to someone else, hand the key over the same
  way (in person or through a password manager), never by email or chat.

**If the private key is lost, every backup is unreadable.** If it is leaked, make a new key
pair, replace the public key in GitHub, and keep the old private key only for old backups.
Anyone holding a leaked key could also read any file they downloaded while it was on GitHub,
which is why manual files stay there 1 day and you delete them once saved.

---

## How to restore, step by step

This is for the developer. Read the whole section once before starting. Take your time: nothing changes in the database
until step 6, and if anything goes wrong during step 6 the database is left exactly as it was.

### 1. What you need

- A Windows PC with **Docker Desktop** installed and running (the same one used for this
  project).
- **age**: open PowerShell and run `winget install --id FiloSottile.age`, then close and
  reopen PowerShell.
- The **backup key** from the password manager.
- The **database password** of the project you are restoring into (Supabase dashboard >
  Project Settings > Database; you can reset it there if needed, then update the
  `SUPABASE_DB_PASSWORD` secret in GitHub too).
- The project's **reference id** and **session pooler host**: Supabase dashboard > the
  project > **Connect** > Session pooler. The connection string looks like
  `postgresql://postgres.abcdefghijklmnop:[YOUR-PASSWORD]@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres`.
  The reference id is the part after `postgres.`; the host is the part after `@`, before
  `:5432`.

### 2. Make a working folder and save the key into it

In PowerShell:

```powershell
mkdir D:\restore
notepad D:\restore\backup-key.txt
```

Paste the whole backup key (all three lines, including the one starting
`AGE-SECRET-KEY-1`), save, and close Notepad.

### 3. Get the backup file

1. Choose the newest backup from **before** the problem happened: from your PC or Google
   Drive, or, if it is newer, a nightly one still on GitHub (Actions > Backup > open the run >
   Artifacts; take the `.age` file out of the zip).
2. Files are named by date and time in Manila: `pos-prod-2026-10-17-0930.tar.gz.age` was
   made at 09:30 on 17 October.
3. Copy the file into `D:\restore`.

### 4. Unlock and unpack it

In PowerShell (change the file name to yours):

```powershell
cd D:\restore
age --decrypt --identity backup-key.txt --output backup.tar.gz pos-prod-2026-10-17.tar.gz.age
tar -xzf backup.tar.gz
type MANIFEST.txt
```

If `age` says `no identity matched any of the recipients`, the key does not belong to this
backup. `MANIFEST.txt` shows when it was taken, the number of rows in each table, and the
**last migration**.

### 5. Check the project's database matches the backup

The restore puts back the data, not the table layout, which comes from the migrations in this
repository. The project you restore into must have the **same last migration** as the
`MANIFEST.txt`:

- Supabase dashboard > the project > **Database** > **Migrations**: the newest entry's
  version must equal the manifest's `last migration`.
- **Same:** go on to step 6.
- **The project is newer** (a release went out after the backup): usually still fine; try
  step 6. If it stops with an error about a column, ask for help before going on.
- **The project is older, or brand new and empty:** first deploy the app's migrations to it
  (see "Restoring into a new project" below), then come back here.

### 6. Restore

This empties every table the backup fills and loads the backup into it, **in one step**: it
either all works or nothing changes. In PowerShell, all on one line, replacing `REF` and
`HOST` with the values from step 1:

```powershell
docker run --rm -it -v D:\restore:/restore postgres:17 psql "postgresql://postgres.REF@HOST:5432/postgres?sslmode=require" --single-transaction -v ON_ERROR_STOP=1 -f /restore/truncate.sql -c "SET session_replication_role = replica" -f /restore/data.sql
```

1. The first time, Docker downloads the `postgres:17` image (free, about 150 MB).
2. It asks `Password for user postgres.REF:`. Type (or paste) the **database password** and
   press Enter. Nothing shows while you type; that is normal.
3. Many lines like `COPY 4` scroll past. It ends back at the PowerShell prompt.

- **It ended without any line starting with `ERROR`:** the restore is done.
- **A line starts with `ERROR`:** nothing was changed. Copy the error message (it never
  contains the password) and ask for help.

### 7. Check the app

1. Open the app and sign in as an Owner, with the authenticator app (on staging, your own
   staging Owner; on production, ask the store's Owner to check with you).
2. **Settings > Users:** the people and their roles are as they were on the backup's date.
3. **Settings > Audit log:** the newest entries are from just before the backup time.
4. **Settings > Backups** also goes back to that moment, so the backup you just restored may
   not be listed, and the Owner may see the "overdue" note. Make a fresh manual backup once
   everything looks right.
5. Anyone who signed in after the backup time is signed out and signs in again with their
   usual password.

### 8. Clean up (do not skip)

The unpacked files contain password hashes and customer details. In PowerShell:

```powershell
cd D:\
Remove-Item -Recurse -Force D:\restore
```

Then empty the Recycle Bin, and delete the backup key file if you saved it anywhere other
than `D:\restore`. Keep the `.age` files in your backup folders: they are still useful.

### Restoring into a new project

If `pos-prod` itself is gone, a new Free project can take its place:

1. Create the project and set it up as in the README's "Supabase setup" (Authentication
   settings, Turnstile, URL configuration).
2. In GitHub, update the `production` and `backup-production` environments with the new
   project's reference id, pooler host and database password, and the repository variables
   used by the heartbeat.
3. Deploy the database: on GitHub, re-run the production **Deploy** for the current release
   tag (it applies every migration), then check step 5.
4. Restore (steps 1 to 8).
5. Update `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Cloudflare Pages and retry the
   latest production deployment.

---

## Restore rehearsal on staging (once, before go-live)

This proves the backups work and that you can follow the steps above. Staging holds only
test accounts, so nothing real can be lost. Plan about 45 minutes.

**Before you start:** the backup key exists and the `backup-staging` environment is set up
(README, "Backups").

1. **Note how staging looks now:** on `https://dev.pos-duz.pages.dev`, Settings > Users:
   write down each user's name and status. Settings > Audit log: note the newest entry.
2. **Take a backup:** GitHub > **Actions** > **Backup** > **Run workflow**. Branch: **dev**.
   Target: **staging**. Wait for the green tick, then download the file from the run's
   **Artifacts** (it is named like `pos-staging-2026-10-20-1405.tar.gz.age`). In the app,
   Settings > Backups now lists it.
3. **Change something:** in the app, **Add user** `Restore Test` (any made-up email, role
   Sales). You do not need to send the link. A new "added Restore Test" entry appears in the
   audit log.
4. **Restore** the backup from step 2 into **staging**, following steps 1 to 8 above, with
   the `pos-staging` project's reference id, pooler host and database password.
5. **Check**, then sign out and back in as the Owner (with your authenticator app):
   - `Restore Test` is gone from Users, and the "added Restore Test" entry is gone from the
     audit log (the account itself is gone too: that proves sign-in data was restored);
   - every user's name and status matches your notes from step 1;
   - the newest audit entry is the one you noted.
6. **Record the result** in the table below (or tell me and I will). If step 6 of the
   restore printed an `ERROR`, nothing was changed: send me the error line.

| Date | Backup file | Result | Notes |
| ---- | ----------- | ------ | ----- |
|      |             |        |       |
