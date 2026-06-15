-- projects
create table public.projects (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  location text not null default '',
  start_date date,
  end_date date,
  status text not null default 'active' check (status in ('active','completed','archived')),
  cover_photo_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.projects enable row level security;
create policy "projects_select_own" on public.projects for select using (auth.uid() = user_id);
create policy "projects_insert_own" on public.projects for insert with check (auth.uid() = user_id);
create policy "projects_update_own" on public.projects for update using (auth.uid() = user_id);
create policy "projects_delete_own" on public.projects for delete using (auth.uid() = user_id);

-- photos（メタ情報のみ。thumbnail_data_url はDBに保存しない）
create table public.photos (
  id uuid primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  original_filename text not null,
  file_size integer not null default 0,
  width integer,
  height integer,
  taken_at timestamptz,
  comment text not null default '',
  floor text not null default '',
  location text not null default '',
  sort_order integer not null default 0,
  phase text check (phase in ('before','during','after')),
  storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index photos_project_id_idx on public.photos(project_id);
alter table public.photos enable row level security;
create policy "photos_select_own" on public.photos for select using (auth.uid() = user_id);
create policy "photos_insert_own" on public.photos for insert with check (auth.uid() = user_id);
create policy "photos_update_own" on public.photos for update using (auth.uid() = user_id);
create policy "photos_delete_own" on public.photos for delete using (auth.uid() = user_id);

-- Storage: 600px圧縮写真用の公開バケット
insert into storage.buckets (id, name, public) values ('photo-compressed', 'photo-compressed', true);

create policy "photo_compressed_insert_own" on storage.objects for insert
  with check (bucket_id = 'photo-compressed' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photo_compressed_update_own" on storage.objects for update
  using (bucket_id = 'photo-compressed' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photo_compressed_delete_own" on storage.objects for delete
  using (bucket_id = 'photo-compressed' and (storage.foldername(name))[1] = auth.uid()::text);
