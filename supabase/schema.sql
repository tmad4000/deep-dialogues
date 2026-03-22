-- Conversations table
create table if not exists conversations (
  id uuid default gen_random_uuid() primary key,
  slug text unique not null,
  title text not null,
  description text,
  commentary text,
  messages jsonb not null default '[]'::jsonb,
  ai_model text,
  contributor_name text,
  tags text[] default '{}',
  turn_count integer,
  original_url text,
  highlights jsonb default '[]'::jsonb,
  featured boolean default false,
  status text default 'pending' check (status in ('pending', 'published', 'rejected')),
  created_at timestamptz default now(),
  published_at timestamptz
);

-- Indexes
create index if not exists idx_conversations_status on conversations(status);
create index if not exists idx_conversations_slug on conversations(slug);
create index if not exists idx_conversations_featured on conversations(featured) where featured = true;

-- Enable RLS
alter table conversations enable row level security;

-- Public can read published conversations
create policy "Public can read published conversations"
  on conversations for select
  using (status = 'published');

-- Anyone can insert (goes to pending)
create policy "Anyone can submit conversations"
  on conversations for insert
  with check (status = 'pending');
