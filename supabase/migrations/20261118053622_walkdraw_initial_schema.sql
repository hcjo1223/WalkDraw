-- WalkDraw 초기 스키마 (Supabase 프로젝트 "walkdraw"에 적용됨)
-- 산책 기록 · 찜한 코스 · 파트너 도감을 계정별로 저장. 본인 행만 읽고 쓸 수 있다(RLS).

-- 산책 기록
create table public.walks (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 100),
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  primary key (user_id, id)
);
create index walks_user_created_idx on public.walks (user_id, created_at desc);

-- 찜한 코스
create table public.saved_routes (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 100),
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  primary key (user_id, id)
);

-- 파트너 도감 상태 (유저당 1행)
create table public.partner_states (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger walks_set_updated_at before update on public.walks
  for each row execute function public.set_updated_at();
create trigger saved_routes_set_updated_at before update on public.saved_routes
  for each row execute function public.set_updated_at();
create trigger partner_states_set_updated_at before update on public.partner_states
  for each row execute function public.set_updated_at();

alter table public.walks enable row level security;
alter table public.saved_routes enable row level security;
alter table public.partner_states enable row level security;

-- 본인 행만 읽기/쓰기
create policy "walks: own rows select" on public.walks for select to authenticated using ((select auth.uid()) = user_id);
create policy "walks: own rows insert" on public.walks for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "walks: own rows update" on public.walks for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "walks: own rows delete" on public.walks for delete to authenticated using ((select auth.uid()) = user_id);

create policy "saved_routes: own rows select" on public.saved_routes for select to authenticated using ((select auth.uid()) = user_id);
create policy "saved_routes: own rows insert" on public.saved_routes for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "saved_routes: own rows update" on public.saved_routes for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "saved_routes: own rows delete" on public.saved_routes for delete to authenticated using ((select auth.uid()) = user_id);

create policy "partner_states: own row select" on public.partner_states for select to authenticated using ((select auth.uid()) = user_id);
create policy "partner_states: own row insert" on public.partner_states for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "partner_states: own row update" on public.partner_states for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "partner_states: own row delete" on public.partner_states for delete to authenticated using ((select auth.uid()) = user_id);

-- 익명 키로는 접근 불가
revoke all on public.walks, public.saved_routes, public.partner_states from anon;
grant select, insert, update, delete on public.walks, public.saved_routes, public.partner_states to authenticated;
