-- SYS-04: one row per backup file made by the Backup workflow (.github/workflows/backup.yml).
-- The workflow writes it over the database connection, as `postgres`, after the encrypted
-- file is uploaded; no API role can write here. The app shows the Owner the last backup and
-- reminds them when the last manual one is more than 7 days old.
--
-- A backup covers the whole project, not one branch, so there is no branch_id: any Owner
-- with the second step may read it. Rows hold no data from the backup, only facts about the
-- file.
create table public.backup_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  -- manual: "Run workflow" by the Owner, kept on GitHub for 1 day, to be saved offline.
  -- nightly: the schedule, kept on GitHub for 7 days only.
  kind text not null check (kind in ('manual', 'nightly')),
  file_name text not null check (file_name ~ '^pos-(prod|staging)-[0-9-]+\.tar\.gz\.age$'),
  size_bytes bigint not null check (size_bytes > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  run_url text not null check (run_url ~ '^https://github\.com/[A-Za-z0-9._/-]+$'),
  -- When GitHub deletes the file; download it before then.
  expires_at timestamptz not null
);

create index backup_log_created_at_idx on public.backup_log (created_at desc);

revoke all on table public.backup_log from public, anon, authenticated, service_role;
grant select on table public.backup_log to authenticated;

alter table public.backup_log enable row level security;

create policy backup_log_select_owner on public.backup_log
  for select to authenticated
  using ((select private.is_owner()));

-- Live on the Owner's Backups page: a run that finishes shows up without a reload.
alter publication supabase_realtime add table public.backup_log;
