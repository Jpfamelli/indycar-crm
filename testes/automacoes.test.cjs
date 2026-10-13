/* Automações do CRM com relógio injetável: sem contato em 2 h, orçamento
   sem resposta em 3 dias, parado 14 dias, meta em risco, rodízio, trava
   e rota do agendador. Banco em memória, nada real. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarFakeSb } = require('./ia-fake-sb.cjs');
const { criarAutomacoes } = require('../lib/automacoes');
const { criarEquipe } = require('../lib/equipe-crm');
const { criarTarefas } = require('../lib/tarefas');
const { criarAuditoria } = require('../lib/auditoria');
const { planoAcao } = require('../lib/ia-crm');
const { subirServidor } = require('./servidor-falso.cjs');

const H = 3600_000, D = 864e5;
const AGORA = Date.parse('2026-10-20T15:00:00Z');           // dia 20: ~62% do mês
const iso = t => new Date(t).toISOString();
const Id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/* pessoas e leads com uuid (as tarefas validam os vínculos) */
const ANA = Id(1), BETO = Id(2), GIL = Id(3), DONO = Id(4);

function montar({ leads = [], extra = {}, opcoes = {} } = {}) {
  let t = AGORA;
  const sb = criarFakeSb({
    perfis: [
      { id: ANA, nome: 'Ana', papel: 'atendente', ativo: true, apps: ['crm'], recebe_leads: true },
      { id: BETO, nome: 'Beto', papel: 'atendente', ativo: true, apps: ['crm'], recebe_leads: false },
      { id: GIL, nome: 'Gil', papel: 'gestor', ativo: true, apps: ['crm'], recebe_leads: false },
      { id: DONO, nome: 'Dono', papel: 'admin', ativo: true, apps: [], recebe_leads: false },
    ],
    leads, conversas: [], whatsapp_mensagens: [], tarefas: [], ia_acoes: [], metas: [], agendamentos: [], notificacoes: [], auditoria: [],
    ...extra,
  });
  const agora = () => t;
  const auditar = criarAuditoria({ sb });
  const equipe = criarEquipe({ sb, agora, auditar });
  const tarefas = criarTarefas({ sb, agora, auditar });
  const auto = criarAutomacoes({ sb, agora, equipe, tarefas, auditar, planoAcao, opcoes });
  return { sb, db: sb.db, auto, avancar: ms => { t += ms; }, agora };
}

test('1. lead novo sem contato em 2 h avisa o responsável (sem dono: gestores), uma vez só', async () => {
  const m = montar({ opcoes: { rodizio: false }, leads: [
    { id: 'l1', nome: 'Carla', status: 'novo', responsavel_id: ANA, cliente_id: 'c1', created_at: iso(AGORA - 3 * H) },
    { id: 'l2', nome: 'Davi', status: 'novo', responsavel_id: ANA, cliente_id: 'c2', created_at: iso(AGORA - 3 * H) },   // já respondido
    { id: 'l3', nome: 'Elis', status: 'novo', responsavel_id: null, created_at: iso(AGORA - 5 * H) },
    { id: 'l4', nome: 'Fábio', status: 'novo', responsavel_id: ANA, created_at: iso(AGORA - 1 * H) },                   // ainda no prazo
    { id: 'l5', nome: 'Gabi', status: 'novo', responsavel_id: ANA, created_at: iso(AGORA - 10 * D) },                  // velho demais: fora
  ], extra: {
    conversas: [{ id: 'cv1', cliente_id: 'c1' }, { id: 'cv2', cliente_id: 'c2' }],
    whatsapp_mensagens: [{ id: 'm1', conversa_id: 'cv2', direcao: 'saida', created_at: iso(AGORA - 2.5 * H) },
      { id: 'm0', conversa_id: 'cv1', direcao: 'saida', created_at: iso(AGORA - 30 * H) }],          // fala antiga não conta
  } });
  const r = await m.auto.ciclo({ regras: ['sem_contato'] });
  assert.equal(r.ok, true);
  assert.equal(r.regras.sem_contato.contatados, 1);
  const ns = m.db.notificacoes;
  assert.equal(ns.filter(n => n.perfil_id === ANA).length, 1);
  assert.match(ns.find(n => n.perfil_id === ANA).titulo, /Carla/);
  assert.equal(ns.find(n => n.perfil_id === ANA).link, '/?lead=l1');
  assert.deepEqual(ns.filter(n => /Elis/.test(n.titulo)).map(n => n.perfil_id).sort(), [DONO, GIL].sort(), 'sem dono: gestores e admin');
  const r2 = await m.auto.ciclo({ regras: ['sem_contato'] });
  assert.equal(r2.regras.sem_contato.notificados, 0, 'segunda volta não repete (chave)');
  assert.equal(m.db.notificacoes.length, 3);
});

test('2. orçamento sem resposta em 3 dias vira tarefa do responsável, sem duplicar', async () => {
  const m = montar({ opcoes: { rodizio: false }, leads: [
    { id: Id(11), nome: 'Hugo', status: 'orcamento', responsavel_id: ANA, cliente_id: 'c1', updated_at: iso(AGORA - 4 * D), servico: 'Freios' },
    { id: Id(12), nome: 'Iara', status: 'orcamento', responsavel_id: ANA, cliente_id: 'c2', updated_at: iso(AGORA - 4 * D) },   // cliente respondeu
    { id: Id(13), nome: 'Juca', status: 'orcamento', responsavel_id: BETO, updated_at: iso(AGORA - 9 * D) },                    // já tem tarefa aberta
    { id: Id(14), nome: 'Kiko', status: 'orcamento', responsavel_id: null, updated_at: iso(AGORA - 5 * D) },
    { id: Id(15), nome: 'Lia', status: 'orcamento', responsavel_id: ANA, updated_at: iso(AGORA - 1 * D) },                     // cedo
  ], extra: {
    conversas: [{ id: 'cv1', cliente_id: 'c1' }, { id: 'cv2', cliente_id: 'c2' }],
    whatsapp_mensagens: [{ id: 'm1', conversa_id: 'cv2', direcao: 'entrada', created_at: iso(AGORA - 1 * D) }],
    tarefas: [{ id: 't0', titulo: 'Ligar', status: 'aberta', lead_id: Id(13), responsavel_id: BETO, origem: 'crm', created_at: iso(AGORA - 2 * D) }],
  } });
  const r = await m.auto.ciclo({ regras: ['orcamento'] });
  assert.deepEqual({ ...r.regras.orcamento }, { avaliados: 4, semDono: 1, respondeu: 1, tarefas: 1 });
  const t = m.db.tarefas.find(x => x.lead_id === Id(11));
  assert.equal(t.responsavel_id, ANA); assert.equal(t.origem, 'automacao'); assert.match(t.titulo, /Cobrar orçamento: Hugo/); assert.match(t.descricao, /4 dias.*Freios/);
  assert.equal((await m.auto.ciclo({ regras: ['orcamento'] })).regras.orcamento.tarefas, 0, 'tarefa aberta: não duplica');
  t.status = 'feita'; t.created_at = iso(AGORA);       // o banco falso usa o relógio real no insert
  m.avancar(H);
  assert.equal((await m.auto.ciclo({ regras: ['orcamento'] })).regras.orcamento.tarefas, 0, 'acabou de concluir: espera 3 dias');
  m.avancar(3 * D);
  await m.auto.ciclo({ regras: ['orcamento'] });
  assert.equal(m.db.tarefas.filter(x => x.lead_id === Id(11)).length, 2, 'continua sem resposta 3 dias depois: nova tarefa');
  assert.equal(m.db.tarefas.filter(x => x.lead_id === Id(15)).length, 1, 'o orçamento da Lia completou 3 dias');
});

test('3. lead parado há 14 dias ganha SUGESTÃO de perdido (nada muda sozinho) e executar pede confirmação', async () => {
  const m = montar({ opcoes: { rodizio: false }, leads: [
    { id: 'p1', nome: 'Mara', status: 'orcamento', responsavel_id: ANA, updated_at: iso(AGORA - 20 * D), observacoes: '' },
    { id: 'p2', nome: 'Nino', status: 'contato', responsavel_id: null, updated_at: iso(AGORA - 15 * D) },
    { id: 'p3', nome: 'Olga', status: 'agendado', responsavel_id: ANA, updated_at: iso(AGORA - 30 * D) },   // agendado: fora
    { id: 'p4', nome: 'Pepe', status: 'novo', responsavel_id: ANA, updated_at: iso(AGORA - 1 * D) },       // recente
  ] });
  const r = await m.auto.ciclo({ regras: ['parados'] });
  assert.equal(r.regras.parados.sugestoes, 2);
  const s1 = m.db.ia_acoes.find(a => a.lead_id === 'p1');
  assert.equal(s1.tipo, 'crm_sugestao_perdido'); assert.equal(s1.status, 'proposta');
  assert.match(s1.saida.motivo_perda, /Orçamento sem resposta há 20 dias/);
  assert.equal(s1.saida.plano.faturamento, true, 'marcar perdido sempre pede clique');
  assert.equal(m.db.leads.find(l => l.id === 'p1').status, 'orcamento', 'não mudou sozinho');
  assert.equal(m.db.notificacoes.filter(n => n.perfil_id === ANA && n.tipo === 'sugestao_perdido').length, 1);
  assert.equal((await m.auto.ciclo({ regras: ['parados'] })).regras.parados.sugestoes, 0, 'proposta esperando: não repete');
  s1.status = 'recusada';
  m.avancar(10 * D);
  assert.equal((await m.auto.ciclo({ regras: ['parados'] })).regras.parados.sugestoes, 0, 'recusada há menos de 30 dias: não volta');
});

test('4. meta do mês em risco avisa os gestores uma vez por semana', async () => {
  const m = montar({ opcoes: { rodizio: false }, leads: [
    { id: 'v1', responsavel_id: ANA, status: 'concluido', valor_pago: 1000, created_at: '2026-10-02T12:00:00Z', closed_at: '2026-10-05T12:00:00Z' },
  ], extra: { metas: [{ id: 'm1', perfil_id: null, mes: '2026-10-01', faturamento: 20000, vendas: 10 }, { id: 'm2', perfil_id: ANA, mes: '2026-10-01', vendas: 1 }] } });
  const r = await m.auto.ciclo({ regras: ['metas'] });
  assert.equal(r.regras.metas.emRisco, 1, 'loja em risco; a Ana já bateu');
  const avisos = m.db.notificacoes.filter(n => n.tipo === 'meta_risco');
  assert.deepEqual(avisos.map(n => n.perfil_id).sort(), [DONO, GIL].sort());
  assert.match(avisos[0].corpo, /faturamento: projeção R\$ 1\.\d{3} de R\$ 20\.000/);
  await m.auto.ciclo({ regras: ['metas'] });
  assert.equal(m.db.notificacoes.filter(n => n.tipo === 'meta_risco').length, 2, 'mesma semana: não repete');
  m.avancar(7 * D);
  await m.auto.ciclo({ regras: ['metas'] });
  assert.equal(m.db.notificacoes.filter(n => n.tipo === 'meta_risco').length, 4, 'semana seguinte: avisa de novo');
});

test('0. rodízio no ciclo, trava contra duas voltas juntas e histórico', async () => {
  const m = montar({ leads: [{ id: 'n1', nome: 'Novo', status: 'novo', responsavel_id: null, created_at: iso(AGORA - 1 * H) }] });
  const [a, b] = await Promise.all([m.auto.ciclo({}), m.auto.ciclo({})]);
  assert.ok([a, b].some(x => x.ocupado), 'a segunda volta encontra a trava');
  const ok = [a, b].find(x => !x.ocupado);
  assert.equal(ok.regras.rodizio.atribuidos, 1);
  assert.equal(m.db.leads[0].responsavel_id, ANA, 'só a Ana recebe leads');
  assert.equal(m.db.crm_automacoes_execucoes.length, 1);
  assert.ok(m.db.auditoria.some(x => x.acao === 'rodizio_leads'));
  assert.equal(m.auto.ultimo().ok, true);
  // trava de outra instância no banco
  m.db.crm_travas = [{ nome: 'crm_automacoes', dono: 'outro-servidor', ate: Date.now() + 60_000 }];
  assert.equal((await m.auto.ciclo({})).ocupado, true);
  // regra com erro não derruba as outras
  m.db.crm_travas = [];
  m.sb.falhar(['metas']);
  const r = await m.auto.ciclo({});
  assert.equal(r.ok, false); assert.equal(r.erros[0].regra, 'metas'); assert.ok(r.regras.sem_contato);
  await assert.rejects(m.auto.ciclo({ regras: ['nada'] }), /Regras válidas/);
});

test('rota do agendador: token obrigatório, comparação segura, gestor pelo login', async () => {
  const sem = await subirServidor();
  try {
    assert.equal((await sem.req(null, '/api/automacoes/rodar', { body: {}, headers: { 'x-agendador-token': 'qualquer' } })).status, 503, 'sem token configurado');
  } finally { await sem.fechar(); }
  const s = await subirServidor({ env: { CRM_AGENDADOR_TOKEN: 'token-do-agendador-de-teste' } });
  try {
    assert.equal((await s.req(null, '/api/automacoes/rodar', { body: {}, headers: { 'x-agendador-token': 'errado' } })).status, 401);
    const ok = await s.req(null, '/api/automacoes/rodar', { body: { regras: ['sem_contato', 'parados'] }, headers: { 'x-agendador-token': 'token-do-agendador-de-teste' } });
    assert.equal(ok.status, 200); assert.equal(ok.corpo.origem, 'agendador'); assert.deepEqual(Object.keys(ok.corpo.regras), ['sem_contato', 'parados']);
    assert.equal((await s.req(null, '/api/automacoes/rodar', { body: {} })).status, 401, 'sem token nem login');
    assert.equal((await s.req('atendente', '/api/automacoes/rodar', { body: {} })).status, 403);
    assert.equal((await s.req('atendente', '/api/automacoes')).status, 403);
    const g = await s.req('gestor', '/api/automacoes/rodar', { body: { regras: ['metas'] } });
    assert.equal(g.status, 200); assert.equal(g.corpo.origem, 'manual');
    const st = (await s.req('gestor', '/api/automacoes')).corpo;
    assert.equal(st.agendador, true); assert.equal(st.ultimo.origem, 'manual'); assert.ok(st.regras.includes('rodizio'));
    assert.ok(!JSON.stringify(st).includes('token-do-agendador'), 'o token não volta');
  } finally { await s.fechar(); }
});
