-- IndyCar CRM — rodada 3: trava das automações e histórico das voltas.
-- Aditivo, prefixo crm_. Aplicado pela ferramenta apply_migration (nome: crm_automacoes_travas).
-- Só o servidor (service role) usa: RLS ligado sem política e EXECUTE revogado de anon/authenticated.

create table if not exists public.crm_travas (
  nome text primary key,
  dono text not null,
  ate timestamptz not null,
  atualizado_em timestamptz not null default now()
);
alter table public.crm_travas enable row level security;
comment on table public.crm_travas is 'CRM: trava curta para as automações não rodarem em duas instâncias ao mesmo tempo.';

create table if not exists public.crm_automacoes_execucoes (
  id bigint generated always as identity primary key,
  origem text not null check (origem in ('timer', 'agendador', 'manual')),
  perfil_id uuid references public.perfis(id) on delete set null,
  iniciado_em timestamptz not null,
  terminado_em timestamptz,
  resultado jsonb,
  created_at timestamptz not null default now()
);
alter table public.crm_automacoes_execucoes enable row level security;
create index if not exists crm_automacoes_execucoes_iniciado_idx on public.crm_automacoes_execucoes (iniciado_em desc);
create index if not exists crm_automacoes_execucoes_perfil_idx on public.crm_automacoes_execucoes (perfil_id);
comment on table public.crm_automacoes_execucoes is 'CRM: histórico de cada volta das automações (o que cada regra fez).';

-- Pega a trava se estiver livre, vencida ou já for do mesmo dono. true = pegou.
create or replace function public.crm_pegar_trava(p_nome text, p_dono text, p_segundos integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.crm_travas (nome, dono, ate)
  values (p_nome, p_dono, now() + make_interval(secs => greatest(5, least(coalesce(p_segundos, 300), 3600))))
  on conflict (nome) do update
    set dono = excluded.dono, ate = excluded.ate, atualizado_em = now()
    where public.crm_travas.ate < now() or public.crm_travas.dono = excluded.dono;
  return found;
end $$;

-- Solta a trava (só se for do mesmo dono).
create or replace function public.crm_soltar_trava(p_nome text, p_dono text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.crm_travas where nome = p_nome and dono = p_dono;
  return found;
end $$;

revoke all on function public.crm_pegar_trava(text, text, integer) from public, anon, authenticated;
revoke all on function public.crm_soltar_trava(text, text) from public, anon, authenticated;
grant execute on function public.crm_pegar_trava(text, text, integer) to service_role;
grant execute on function public.crm_soltar_trava(text, text) to service_role;
