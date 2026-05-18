/* eslint-disable */
/**
 * Collapse the role set to exactly {admin, user} and add invite-only
 * account creation (the `invitations` table).
 *
 *  - owner/admin  -> admin   (workspace owners keep full control)
 *  - manager/viewer/anything else -> user
 *  - new users default to 'user' (admins are made explicitly, via seed or
 *    an admin promoting them)
 */
exports.up = (pgm) => {
  pgm.sql(`
    update users set role = 'admin' where role in ('owner', 'admin');
    update users set role = 'user'  where role <> 'admin';
    alter table users alter column role set default 'user';

    create table invitations (
      id           uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references workspaces(id) on delete cascade,
      email        text not null,
      role         text not null default 'user',
      token_hash   text not null unique,
      invited_by   text not null,
      expires_at   timestamptz not null,
      accepted_at  timestamptz,
      created_at   timestamptz not null default now()
    );
    create index invitations_workspace_idx on invitations(workspace_id);

    -- At most one pending (not-yet-accepted) invite per email per workspace.
    create unique index invitations_pending_idx
      on invitations(workspace_id, lower(email))
      where accepted_at is null;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    drop table if exists invitations;
    alter table users alter column role set default 'owner';
  `);
};
