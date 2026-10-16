# Backups and restoring them

Every night at 02:23 (Manila time), the **Backup** workflow
([.github/workflows/backup.yml](../.github/workflows/backup.yml)) copies the whole `pos-prod`
database into one encrypted file in a private Cloudflare R2 bucket (SYS-04, SEC-15). The
Supabase Free plan has no backups of its own, so these files are the only way back after a
mistake or a lost project.

- **What is in a backup:** every user account (with password hashes and authenticator-app
  secrets, so everyone keeps their password and two-step sign-in), every table of the app,
  and the list of migrations the database had.
- **What is not:** anything changed after the backup ran. A restore goes back to that night,
  so up to one day of work can be lost (NFR-07).
- **How long they are kept:** daily files 35 days, monthly files (from the 1st) 400 days.
- **Who can read them:** only someone holding the **backup key** (see below). Cloudflare,
  GitHub and anyone with the R2 password see only scrambled data.

If a nightly backup fails, GitHub emails the repository owner. If backups stop running at all,
the daily Heartbeat workflow fails and GitHub emails the same way.

## The backup key

Backups are encrypted with [age](https://age-encryption.org). The key comes in two halves:

- the **public key** (`age1...`) is in GitHub as `BACKUP_AGE_RECIPIENTS`. It can only lock
  files, never open them;
- the **private key** (`AGE-SECRET-KEY-1...`) opens them. It is **not** in GitHub, Cloudflare
  or this repository. The Owner keeps it in a password manager and on one printed copy in a
  safe place.

**If the private key is lost, every backup is unreadable.** If it is leaked, make a new key
pair, replace the public key in GitHub, and keep the old private key only for old backups.

---

## How to restore, step by step

Read the whole section once before starting. Take your time: nothing changes in the database
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

### 3. Download the backup

1. Cloudflare dashboard > **R2 Object Storage** > the backup bucket.
2. Open the **daily** folder (or **monthly** for an older one). Files are named by date:
   `pos-prod-2026-10-17.tar.gz.age` is the backup taken in the early hours of 17 October.
3. Choose the newest file from **before** the problem happened, and **Download** it.
4. Move the file into `D:\restore`.

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

1. Open the app and sign in as the Owner, with your authenticator app.
2. **Settings > Users:** the people and their roles are as they were on the backup's date.
3. **Settings > Audit log:** the newest entries are from just before the backup time.
4. Anyone who signed in after the backup time is signed out and signs in again with their
   usual password.

### 8. Clean up (do not skip)

The unpacked files contain password hashes and customer details. In PowerShell:

```powershell
cd D:\
Remove-Item -Recurse -Force D:\restore
```

Then empty the Recycle Bin, and delete the downloaded `.age` file from your Downloads folder
if it is still there.

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

**Before you start:** backups are set up (README, "Backups"), including the
`backup-staging` environment, and `BACKUP_ENABLED` is `true`.

1. **Note how staging looks now:** on `https://dev.pos-duz.pages.dev`, Settings > Users:
   write down each user's name and status. Settings > Audit log: note the newest entry.
2. **Take a backup:** GitHub > **Actions** > **Backup** > **Run workflow**. Branch: `dev`.
   Target: `staging`. Wait for the green tick. Its summary shows the file name, for example
   `pos-staging-2026-10-20-1405.tar.gz.age`.
3. **Change something:** in the app, rename **Test Two** to `Restore Test`. A new
   "edited Test Two" entry appears in the audit log.
4. **Restore** the backup from step 2 into **staging**, following steps 1 to 8 above. It is
   in the bucket's **staging** folder, and the project is `pos-staging`.
5. **Check**, then sign out and back in as the Owner (with your authenticator app):
   - Test Two has their old name again, and the "edited" entry from step 3 is gone;
   - every user's name and status matches your notes from step 1;
   - the newest audit entry is the one you noted.
6. **Record the result** in the table below (or tell me and I will).

| Date | Backup file | Result | Notes |
| ---- | ----------- | ------ | ----- |
|      |             |        |       |
