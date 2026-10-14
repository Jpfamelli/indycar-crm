-- Rodada 4 (14/10/2026): histórico das distribuições em lote do CRM, para o
-- gestor ver o que foi feito e DESFAZER. Só o servidor (service role) lê e grava:
-- RLS ligado sem política e sem permissão para anon/authenticated.
-- Aplicada pelo MCP como migração `crm_distribuicoes_v1`.
create table if not exists public.crm_distribuicoes (
  id uuid primary key default gen_random_uuid(),
  criado_por uuid references public.perfis(id) on delete set null,
  created_at timestamptz not null default now(),
  modo text not null default 'igual' check (modo in ('igual', 'carga')),
  filtros jsonb,
  total integer not null default 0 check (total >= 0),
  itens jsonb not null default '[]'::jsonb,          -- [{id: lead, para: perfil}]
  desfeita_em timestamptz,
  desfeita_por uuid references public.perfis(id) on delete set null
);
comment on table public.crm_distribuicoes is 'CRM: distribuições em lote de leads sem responsável (com desfazer). Só o servidor do CRM usa.';
create index if not exists crm_distribuicoes_created_at_idx on public.crm_distribuicoes (created_at desc);
create index if not exists crm_distribuicoes_criado_por_idx on public.crm_distribuicoes (criado_por);
create index if not exists crm_distribuicoes_desfeita_por_idx on public.crm_distribuicoes (desfeita_por);
alter table public.crm_distribuicoes enable row level security;
revoke all on public.crm_distribuicoes from anon, authenticated;
