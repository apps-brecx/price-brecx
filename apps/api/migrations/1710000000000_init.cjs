/* eslint-disable */
exports.up = (pgm) => {
  pgm.sql(`create extension if not exists "pgcrypto";`);

  pgm.sql(`
    create table workspaces (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      timezone text not null default 'America/New_York',
      currency text not null default 'USD',
      default_channel text not null default 'amazon',
      created_at timestamptz not null default now()
    );

    create table users (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references workspaces(id) on delete cascade,
      email text not null unique,
      name text not null,
      password_hash text not null,
      role text not null default 'owner',
      created_at timestamptz not null default now()
    );

    create table sessions (
      token_hash text primary key,
      user_id uuid not null references users(id) on delete cascade,
      expires_at timestamptz not null,
      created_at timestamptz not null default now()
    );
    create index sessions_user_idx on sessions(user_id);

    create table skus (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references workspaces(id) on delete cascade,
      sku text not null,
      asin text,
      title text not null,
      image_url text,
      channel text not null default 'amazon',
      price numeric(12,2) not null default 0,
      base_price numeric(12,2),
      cost numeric(12,2),
      stock integer not null default 0,
      sales_30d integer not null default 0,
      status text not null default 'active',
      favorite boolean not null default false,
      tags jsonb not null default '[]'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (workspace_id, sku, channel)
    );
    create index skus_workspace_idx on skus(workspace_id);

    create table products (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references workspaces(id) on delete cascade,
      name text not null,
      description text,
      sku_ids jsonb not null default '[]'::jsonb,
      created_at timestamptz not null default now()
    );
    create index products_workspace_idx on products(workspace_id);

    create table price_schedules (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references workspaces(id) on delete cascade,
      sku_id uuid not null references skus(id) on delete cascade,
      type text not null default 'single',
      status text not null default 'scheduled',
      price numeric(12,2) not null,
      current_price numeric(12,2) not null,
      start_date timestamptz,
      end_date timestamptz,
      time_slots jsonb not null default '[]'::jsonb,
      timezone text not null default 'America/New_York',
      created_by text not null default 'system',
      created_at timestamptz not null default now()
    );
    create index price_schedules_workspace_idx on price_schedules(workspace_id);
    create index price_schedules_sku_idx on price_schedules(sku_id);

    create table automation_rules (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references workspaces(id) on delete cascade,
      name text not null,
      type text not null,
      interval_hours numeric,
      amount text not null default '0',
      active boolean not null default true,
      sku_ids jsonb not null default '[]'::jsonb,
      created_by text not null default 'system',
      created_at timestamptz not null default now()
    );
    create index automation_rules_workspace_idx on automation_rules(workspace_id);

    create table alerts (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references workspaces(id) on delete cascade,
      kind text not null,
      sku_id uuid references skus(id) on delete set null,
      title text not null,
      message text not null,
      severity text not null default 'info',
      acknowledged boolean not null default false,
      created_at timestamptz not null default now()
    );
    create index alerts_workspace_idx on alerts(workspace_id);

    create table notification_rules (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references workspaces(id) on delete cascade,
      kind text not null,
      name text not null,
      config jsonb not null default '{}'::jsonb,
      emails jsonb not null default '[]'::jsonb,
      active boolean not null default true,
      created_at timestamptz not null default now()
    );
    create index notification_rules_workspace_idx on notification_rules(workspace_id);

    create table marketplace_credentials (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references workspaces(id) on delete cascade,
      channel text not null,
      label text not null,
      seller_id text,
      marketplace_id text,
      refresh_token text,
      lwa_app_id text,
      lwa_client_secret text,
      connected boolean not null default false,
      created_at timestamptz not null default now(),
      unique (workspace_id, channel)
    );

    create table activity_log (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references workspaces(id) on delete cascade,
      actor text not null,
      action text not null,
      entity_type text not null,
      entity_id text,
      summary text not null,
      meta jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
    create index activity_log_workspace_idx on activity_log(workspace_id, created_at desc);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    drop table if exists activity_log;
    drop table if exists marketplace_credentials;
    drop table if exists notification_rules;
    drop table if exists alerts;
    drop table if exists automation_rules;
    drop table if exists price_schedules;
    drop table if exists products;
    drop table if exists skus;
    drop table if exists sessions;
    drop table if exists users;
    drop table if exists workspaces;
  `);
};
