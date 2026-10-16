// Servidor FALSO do CRM: serve a interface real de public/ com login fictício e dados
// 100% inventados, em memória. Não lê .env, não chama Supabase, não envia mensagens.
// Uso: npm run mock  →  http://127.0.0.1:3101
//   MOCK_LATENCIA=800        atrasa cada /api (para ver esqueletos)
//   MOCK_IA_TESTE=arquivo.js injeta um script de teste do contrato da IA (nunca commitar)
//   MOCK_PAPEL=atendente     papel padrão do login fictício (a tela também aceita /?papel=)
//   Papéis: admin, gestor, atendente, agenda, desativado, sem_app, trocar_senha, mfa, deslogado.
//   Abra http://127.0.0.1:3101/?papel=gestor (fica num cookie). Senhas fictícias do login falso:
//   qualquer uma entra; 'senha-errada' erra; e-mail banido@… vem desativado; código MFA 123456.
//   Ganchos de teste: POST /__mock/notificar {titulo,link,app} e POST /__mock/tarefa {titulo}.
//   PORT=3121                outra porta (quando a 3101 estiver ocupada)
//   Rodada 4: MOCK_LEADS=700 gera mais leads (os extras antigos e sem responsável, para a distribuição);
//   MOCK_DORMINDO=40 faz /api/* responder 503 em HTML (como o Render acordando) pelos primeiros 40 s;
//   POST /__mock/dormir {segundos} faz o mesmo a qualquer momento. ?tour=1 mostra o tour de boas-vindas.
//   Rodada 5: MOCK_PREFIXO=/crm monta o app em http://127.0.0.1:3101/crm/ (ensaio da Central).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const PATIO = createRequire(import.meta.url)('../lib/patio-crm.js');
const R5 = createRequire(import.meta.url)('../lib/rodada5.js');
// Rodada 5: MOCK_PREFIXO=/crm serve o app montado num prefixo, como a IndyCar Central
const PREFIXO = (p => p ? '/' + p : '')(String(process.env.MOCK_PREFIXO || '').trim().replace(/^\/+|\/+$/g, ''));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const statuses = ['novo','contato','orcamento','agendado','em_servico','concluido','perdido'];
const origens = ['meta','google','organico','whatsapp','indicacao','passagem'];
const DIA = 86400000;

/* gerador previsível: os mesmos dados fictícios a cada execução */
function rng(semente) { let s = semente >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const NOMES = ['Ana','Bruno','Carla','Diego','Elisa','Fábio','Gabi','Hugo','Iara','Jonas','Kátia','Lucas','Marta','Nilo','Olga','Paulo','Rita','Saulo','Tânia','Vítor'];
const SOBRE = ['Teste','Fictício','Exemplo','Simulado','Demo'];
const CARROS = ['Onix 2019','HB20 2021','Corolla 2018','Gol 2015','Civic 2020','Strada 2022','Kwid 2023','Compass 2021'];
const SERVICOS = ['Troca de Óleo de Motor','Freios','Suspensão','Alinhamento 3D','Diagnóstico com Scanner','Embreagem','Correia Dentada'];
const MOTIVOS = ['Achou caro','Foi em outra oficina','Sem retorno do cliente','Desistiu do serviço'];

/* Equipe fictícia. A primeira pessoa é "você": o papel dela muda conforme ?papel=. */
const EU = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const EQUIPE_BASE = [
  {id: EU, nome: 'Equipe de teste', email: 'teste@exemplo.invalid', papel: 'admin', apps: ['atendimento','crm','agenda','comunicar','orcador','ads'], cargo: 'Consultor (fictício)'},
  {id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002', nome: 'Bruno Vendas Fictício', email: 'bruno@exemplo.invalid', papel: 'atendente', apps: ['atendimento','crm']},
  {id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003', nome: 'Carla Consultora Fictícia', email: 'carla@exemplo.invalid', papel: 'atendente', apps: ['atendimento','crm'], avatar_cor: '#a855f7'},
  {id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000004', nome: 'Diego Gestor Fictício', email: 'diego@exemplo.invalid', papel: 'gestor', apps: ['atendimento','crm','agenda','comunicar']},
  {id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000005', nome: 'Franklin Agenda Fictício', email: 'franklin@exemplo.invalid', papel: 'agenda', apps: ['agenda']},
];
/* Como cada papel de teste aparece para a tela e para o servidor. */
const PAPEIS_MOCK = {
  admin: {papel: 'admin'},
  gestor: {papel: 'gestor', apps: ['atendimento','crm','agenda','comunicar']},
  atendente: {papel: 'atendente', apps: ['atendimento','crm']},
  agenda: {papel: 'agenda', apps: ['agenda']},
  desativado: {papel: 'atendente', apps: ['atendimento','crm'], ativo: false},
  sem_app: {papel: 'atendente', apps: ['atendimento','comunicar']},
  trocar_senha: {papel: 'atendente', apps: ['atendimento','crm'], precisa_trocar_senha: true},
  mfa: {papel: 'gestor', apps: ['atendimento','crm']},
  deslogado: {papel: 'atendente', apps: ['atendimento','crm']},
};
const EH_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function gerarDados(agora = Date.now(), qtdLeads = Number(process.env.MOCK_LEADS) || 90) {
  const r = rng(42), pick = a => a[Math.floor(r() * a.length)];
  const placa = i => 'TST' + (i % 10) + String.fromCharCode(65 + (i % 26)) + String(i % 100).padStart(2, '0');
  const clientes = [];
  for (let i = 0; i < 2500; i++) {
    clientes.push({id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, nome: `${pick(NOMES)} ${pick(SOBRE)} ${i}`,
      telefone: '129' + String(10000000 + i).slice(-8), carro_modelo: pick(CARROS), placa: placa(i), origem: pick(origens),
      created_at: new Date(agora - Math.floor(r() * 900) * DIA).toISOString(), nascimento: i % 7 ? null : '1904-0' + (1 + i % 9) + '-1' + (i % 9),
      aceita_mensagens: i % 3 ? true : null, email: null, observacoes: null});
  }
  // o primeiro cliente mantém o nome com sinais de < > para provar o escape
  clientes[0] = {...clientes[0], id: '11111111-1111-4111-8111-111111111111', nome: 'CLIENTE FICTÍCIO <teste>', telefone: '12900000001', placa: 'ABC1D23', carro_modelo: 'Carro de teste', nascimento: '1904-02-29', aceita_mensagens: false};
  const leads = [];
  for (let i = 0; i < 90; i++) {
    // 60 clientes para 90 leads: alguns clientes têm mais de um lead (histórico e link por cliente)
    const c = clientes[i * 7 % 60], st = i === 0 ? 'novo' : statuses[Math.floor(r() * statuses.length)];
    const criado = agora - Math.floor(r() * 75 * DIA) - 3600000, mexido = Math.min(agora - 600000, criado + Math.floor(r() * 12) * DIA);
    const orc = [0, 150, 280, 420, 690, 1250, 2300][Math.floor(r() * 7)];
    const l = {id: `22222222-2222-4222-8222-${String(i).padStart(12, '0')}`, cliente_id: c.id, nome: c.nome, telefone: c.telefone,
      carro_modelo: c.carro_modelo, placa: c.placa, servico: pick(SERVICOS), origem: pick(origens), status: st,
      valor_orcado: orc, valor_pago: st === 'concluido' && i % 3 !== 0 ? orc || 180 : 0, utm_campaign: r() < .3 ? 'campanha-teste' : '',
      utm_source: i % 6 === 1 ? 'instagram' : i % 6 === 2 ? 'site' : null, utm_medium: i % 6 === 1 ? 'story' : null,
      observacoes: st === 'perdido' && r() < .75 ? 'Motivo da perda: ' + pick(MOTIVOS) : '',
      created_at: new Date(criado).toISOString(), updated_at: new Date(mexido).toISOString(),
      closed_at: ['concluido','perdido'].includes(st) ? new Date(mexido).toISOString() : null,
      // responsável: quatro pessoas da equipe fictícia em rodízio e um em cada cinco sem ninguém
      responsavel_id: i % 5 === 4 ? null : EQUIPE_BASE[i % 4].id};
    leads.push(l);
  }
  // rodada 4: leads antigos e sem responsável (como os 585 da base real), só quando MOCK_LEADS > 90
  for (let i = 90; i < qtdLeads; i++) {
    const c = clientes[60 + (i % 2400)], st = ['novo', 'novo', 'contato', 'orcamento', 'concluido', 'perdido', 'agendado'][i % 7];
    const criado = agora - (10 + Math.floor(r() * 60)) * DIA;
    leads.push({id: `22222222-2222-4222-8222-${String(i).padStart(12, '0')}`, cliente_id: c.id, nome: c.nome, telefone: c.telefone, carro_modelo: c.carro_modelo, placa: c.placa,
      servico: pick(SERVICOS), origem: i % 9 === 0 ? 'google' : 'whatsapp', status: st, valor_orcado: 0, valor_pago: 0, utm_campaign: '',
      observacoes: st === 'perdido' ? 'Motivo da perda: ' + pick(MOTIVOS) : '', created_at: new Date(criado).toISOString(), updated_at: new Date(criado + DIA).toISOString(),
      closed_at: ['concluido', 'perdido'].includes(st) ? new Date(criado + DIA).toISOString() : null, responsavel_id: null});
  }
  leads.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return {clientes, leads};
}

const SB_FALSO = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'mock-supabase.js'), 'utf8');

const tipos = {'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.mjs':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};

export function criarMock({latencia = Number(process.env.MOCK_LATENCIA) || 0, iaTeste = process.env.MOCK_IA_TESTE || '', papel = process.env.MOCK_PAPEL || 'admin'} = {}) {
  let {clientes, leads} = gerarDados();
  const acoes = [];
  let dormeAte = Number(process.env.MOCK_DORMINDO) > 0 ? Date.now() + Number(process.env.MOCK_DORMINDO) * 1000 : 0;
  const distribuicoes = [];
  const idem = new Map();          // x-idempotencia → resposta (igual ao servidor real)
  const papelPadrao = PAPEIS_MOCK[papel] ? papel : 'admin';

  /* ---------- equipe, perfis (um "você" por papel), tarefas, notificações, metas ---------- */
  const agoraIso = () => new Date().toISOString();
  const perfis = EQUIPE_BASE.slice(1).map(p => ({ativo: true, cargo: null, telefone: null, avatar_cor: null, recebe_leads: true, precisa_trocar_senha: false, preferencias: {}, ultimo_acesso_em: new Date(Date.now() - 3 * 3600000).toISOString(), ultimo_app: 'atendimento', ...p}));
  const euPorPapel = new Map();
  const eu = pp => {
    if (!euPorPapel.has(pp)) euPorPapel.set(pp, {...EQUIPE_BASE[0], ativo: true, telefone: null, avatar_cor: null, recebe_leads: true, precisa_trocar_senha: false, preferencias: {}, ultimo_acesso_em: null, ultimo_app: null, ...PAPEIS_MOCK[pp]});
    return euPorPapel.get(pp);
  };
  const equipe = pp => [eu(pp), ...perfis];
  const ha = (d, h = 10) => { const x = new Date(); x.setDate(x.getDate() + d); x.setHours(h, 0, 0, 0); return x.toISOString(); };
  let tarefas = [
    {titulo: 'Retornar o orçamento de freios (fictício)', vence_em: ha(-2, 10), prioridade: 3, lead_id: leads[1].id},
    {titulo: 'Ligar para confirmar o diagnóstico (fictício)', vence_em: ha(-1, 15), prioridade: 2, lead_id: leads[2].id},
    {titulo: 'Mandar foto do scanner (fictício)', vence_em: ha(0, 9), prioridade: 2},
    {titulo: 'Cobrar resposta da suspensão (fictício)', vence_em: ha(0, 16), prioridade: 3, lead_id: leads[3].id},
    {titulo: 'Pós-venda da troca de óleo (fictício)', vence_em: ha(2, 11), prioridade: 1},
    {titulo: 'Conferir peças com o fornecedor (fictício)', vence_em: null, prioridade: 2},
    {titulo: 'Agendar alinhamento do cliente (fictício)', vence_em: ha(1, 10), prioridade: 2, responsavel_id: EQUIPE_BASE[1].id},
  ].map((t, i) => ({id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(i).padStart(12, '0')}`, descricao: null, responsavel_id: EU, criado_por: i === 3 ? EQUIPE_BASE[3].id : EU, cliente_id: null, conversa_id: null, agendamento_id: null, origem: i === 3 ? 'atendimento' : 'crm', status: 'aberta', concluida_em: null, concluida_por: null, created_at: new Date(Date.now() - (10 - i) * 3600000).toISOString(), lead_id: null, ...t}));
  let notificacoes = [
    {tipo: 'lead_atribuido', titulo: 'Lead passado para você', corpo: `${leads[4].nome} — ${leads[4].servico}`, link: '/?lead=' + leads[4].id, app: 'crm', lida_em: null, created_at: new Date(Date.now() - 20 * 60000).toISOString()},
    {tipo: 'aguardando_consultor', titulo: 'Cliente esperando consultor', corpo: 'Conversa fictícia aguardando resposta', link: '/?conversa=00000000-0000-4000-8000-000000000123', app: 'atendimento', lida_em: null, created_at: new Date(Date.now() - 3 * 3600000).toISOString()},
    {tipo: 'tarefa_atribuida', titulo: 'Nova tarefa: cobrar resposta da suspensão', corpo: 'Diego Gestor Fictício passou para você', link: '/?lead=' + leads[3].id, app: 'crm', lida_em: null, created_at: new Date(Date.now() - 5 * 3600000).toISOString()},
    {tipo: 'sistema', titulo: 'Bem-vindo ao CRM (fictício)', corpo: null, link: null, app: 'crm', lida_em: new Date(Date.now() - 86400000).toISOString(), created_at: new Date(Date.now() - 2 * 86400000).toISOString()},
  ].map((n, i) => ({id: `cccccccc-cccc-4ccc-8ccc-${String(i).padStart(12, '0')}`, perfil_id: EU, chave: null, ...n}));
  const metas = new Map();       // 'AAAA-MM' → [{perfil_id, leads, agendamentos, vendas, faturamento}]
  const mesHoje = () => new Date().toISOString().slice(0, 7);
  metas.set(mesHoje(), [{perfil_id: null, leads: 60, agendamentos: 30, vendas: 20, faturamento: 30000}, {perfil_id: EU, leads: 15, agendamentos: 8, vendas: 6, faturamento: 8000}, {perfil_id: EQUIPE_BASE[1].id, leads: 15, agendamentos: 8, vendas: 5, faturamento: 7000}]);
  const sse = new Set();
  const avisar = (table, eventType, novo, velho) => { const d = `data: ${JSON.stringify({table, eventType, new: novo || {}, old: velho || {}})}\n\n`; for (const r of sse) { try { r.write(d); } catch { sse.delete(r); } } };
  /* "RLS" do banco falso: notificações só minhas; tarefas da equipe; perfil só o meu se grava. */
  const filtrar = (lista, filtros) => lista.filter(x => filtros.every(([op, c, v]) => op === 'eq' ? String(x[c]) === String(v) : op === 'neq' ? String(x[c]) !== String(v)
    : op === 'in' ? (v || []).map(String).includes(String(x[c])) : op === 'is' ? (v === null ? x[c] == null : x[c] === v) : op === 'gte' ? String(x[c]) >= String(v) : op === 'lte' ? String(x[c]) <= String(v) : true));
  const recorte = (x, cols) => { if (!cols || cols === '*') return {...x}; const o = {}; for (const c of String(cols).split(',').map(s => s.trim()).filter(Boolean)) o[c] = x[c] ?? null; return o; };
  function bancoFalso(q, pp) {
    const me = eu(pp), daEquipe = me.ativo !== false && ['admin','gestor','atendente'].includes(me.papel);
    const negar = () => ({data: null, error: {message: 'permission denied (RLS fictícia)', code: '42501'}});
    let tabela;
    if (q.tabela === 'perfis') tabela = equipe(pp).map(p => p.id === EU && !q.tour && !p.preferencias?.crm_tour ? {...p, preferencias: {...p.preferencias, crm_tour: {visto: '2026-10-01T12:00:00Z'}}} : p);
    else if (q.tabela === 'tarefas') { if (!daEquipe) return negar(); tabela = tarefas; }
    else if (q.tabela === 'notificacoes') tabela = notificacoes.filter(n => n.perfil_id === EU);
    else return {data: null, error: {message: 'tabela fictícia não existe', code: '42P01'}};
    const unico = linhas => q.unico === 'single' ? (linhas.length === 1 ? {data: linhas[0], error: null} : {data: null, error: {message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116'}}) : q.unico === 'maybe' ? {data: linhas[0] || null, error: null} : {data: linhas, error: null};
    if (q.op === 'select') {
      let l = filtrar(tabela, q.filtros);
      for (const [c, asc, nf] of [...q.ordem].reverse()) l = [...l].sort((a, b) => { const x = a[c], y = b[c]; if (x == null && y == null) return 0; if (x == null) return nf ? -1 : 1; if (y == null) return nf ? 1 : -1; return (String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0) * (asc ? 1 : -1); });
      if (q.limite) l = l.slice(0, q.limite);
      return unico(l.map(x => recorte(x, q.select)));
    }
    if (q.op === 'insert') {
      if (q.tabela !== 'tarefas') return negar();
      const novos = (Array.isArray(q.valores) ? q.valores : [q.valores]).map(v => ({descricao: null, responsavel_id: null, cliente_id: null, lead_id: null, conversa_id: null, agendamento_id: null, origem: 'manual', prioridade: 2, vence_em: null, status: 'aberta', concluida_em: null, concluida_por: null, ...v, id: crypto.randomUUID(), criado_por: EU, created_at: agoraIso()}));
      if (novos.some(t => !String(t.titulo || '').trim())) return {data: null, error: {message: 'null value in column "titulo"', code: '23502'}};
      tarefas.push(...novos); novos.forEach(t => avisar('tarefas', 'INSERT', t));
      return q.devolver ? unico(novos.map(x => recorte(x, q.devolver))) : {data: null, error: null};
    }
    const alvo = filtrar(tabela, q.filtros);
    if (q.op === 'update') {
      const v = {...q.valores};
      if (q.tabela === 'perfis') {
        if (alvo.some(p => p.id !== EU)) return negar();
        if (['papel','apps','ativo'].some(k => k in v && !(pp === 'admin'))) return {data: null, error: {message: 'Só o administrador muda papel, apps ou ativo (gatilho fictício).', code: 'P0001'}};
      }
      if (q.tabela === 'tarefas' && v.status) { v.concluida_em = v.status === 'feita' ? agoraIso() : null; v.concluida_por = v.status === 'feita' ? EU : null; }
      for (const x of alvo) { const velho = {...x}; Object.assign(x, v); avisar(q.tabela, 'UPDATE', {...x}, velho); }
      return q.devolver ? unico(alvo.map(x => recorte(x, q.devolver))) : {data: null, error: null};
    }
    if (q.op === 'delete') {
      if (q.tabela === 'perfis') return negar();
      if (q.tabela === 'tarefas' && !['admin','gestor'].includes(me.papel) && alvo.some(t => t.criado_por !== EU)) return negar();
      const ids = new Set(alvo.map(x => x.id));
      if (q.tabela === 'tarefas') tarefas = tarefas.filter(t => !ids.has(t.id)); else notificacoes = notificacoes.filter(n => !ids.has(n.id));
      alvo.forEach(x => avisar(q.tabela, 'DELETE', null, {id: x.id, perfil_id: x.perfil_id, responsavel_id: x.responsavel_id}));
      return {data: null, error: null};
    }
    return {data: null, error: {message: 'operação fictícia não suportada'}};
  }
  /* Realizado e projeção de metas e desempenho, calculados dos leads fictícios. */
  const doMes = (l, campo, mes) => String(l[campo] || '').slice(0, 7) === mes;
  function realizado(mes, perfilId) {
    const ls = leads.filter(l => !perfilId || l.responsavel_id === perfilId);
    const ganhos = ls.filter(l => l.status === 'concluido' && doMes(l, 'closed_at', mes));
    return {leads: ls.filter(l => doMes(l, 'created_at', mes)).length, agendamentos: ls.filter(l => ['agendado','em_servico','concluido'].includes(l.status) && doMes(l, 'updated_at', mes)).length,
      vendas: ganhos.length, faturamento: ganhos.reduce((s, l) => s + Number(l.valor_pago || 0), 0)};
  }
  /* Formato do servidor real: {mes, decorrido, loja:{meta, itens, status}, pessoas:[{perfil_id, nome, avatar_cor, meta, itens, status}]} */
  function metasServidor(mes, pp) {
    const plano = metasDoMes(mes, pp), dias = new Date(+mes.slice(0, 4), +mes.slice(5, 7), 0).getDate();
    const frac = mes === mesHoje() ? new Date().getDate() / dias : mes < mesHoje() ? 1 : 0;
    const CAMPOS = ['leads','agendamentos','vendas','faturamento'];
    const montar = m => { const tem = CAMPOS.some(k => m[k] > 0);
      const itens = Object.fromEntries(CAMPOS.map(k => [k, m[k] > 0 ? {meta: m[k], realizado: m.realizado[k], progresso: Math.round(m.realizado[k] / m[k] * 1000) / 10, projecao: frac ? m.projecao[k] : null, batida: m.realizado[k] >= m[k]} : {meta: null, realizado: m.realizado[k], progresso: null, projecao: null}]));
      return {meta: tem ? {leads: m.leads, agendamentos: m.agendamentos, vendas: m.vendas, faturamento: m.faturamento} : null, itens, status: tem ? 'ok' : 'sem_meta'}; };
    const pessoa = id => equipe(pp).find(p => p.id === id) || {};
    return {mes, decorrido: Math.round(frac * 1000) / 10, loja: montar(plano[0]), pessoas: plano.slice(1).map(m => ({perfil_id: m.perfil_id, nome: pessoa(m.perfil_id).nome, avatar_cor: pessoa(m.perfil_id).avatar_cor || null, ...montar(m)}))};
  }
  function metasDoMes(mes, pp) {
    const dias = new Date(+mes.slice(0, 4), +mes.slice(5, 7), 0).getDate(), hoje = new Date(), atual = mes === mesHoje();
    const passados = atual ? hoje.getDate() : (mes < mesHoje() ? dias : 0);
    const salvas = metas.get(mes) || [];
    const ids = [null, ...equipe(pp).filter(p => p.papel !== 'agenda' && p.ativo !== false).map(p => p.id)];
    return ids.map(id => { const m = salvas.find(x => (x.perfil_id || null) === id) || {perfil_id: id, leads: 0, agendamentos: 0, vendas: 0, faturamento: 0};
      const r = realizado(mes, id); const projecao = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, passados ? Math.round(v / passados * dias * 100) / 100 : 0]));
      return {...m, perfil_id: id, realizado: r, projecao}; });
  }
  function desempenho(de, ate, pp) {
    const dentro = v => { const d = String(v || '').slice(0, 10); return d >= de && d <= ate; };
    return equipe(pp).filter(p => p.papel !== 'agenda' && p.ativo !== false).map((p, i) => {
      const ls = leads.filter(l => l.responsavel_id === p.id), novos = ls.filter(l => dentro(l.created_at)), ganhos = ls.filter(l => l.status === 'concluido' && dentro(l.closed_at));
      const decididos = ls.filter(l => ['concluido','perdido'].includes(l.status) && dentro(l.closed_at)).length;
      return {perfil_id: p.id, nome: p.nome, leads: novos.length, agendados: ls.filter(l => ['agendado','em_servico'].includes(l.status)).length, vendas: ganhos.length,
        faturamento: ganhos.reduce((s, l) => s + Number(l.valor_pago || 0), 0), conversao: decididos ? Math.round(ganhos.length / decididos * 1000) / 10 : 0, tempo_resposta_min: [12, 34, 7, null][i % 4]};
    });
  }
  const resumo = (lista, desde) => {
    const rec = desde ? lista.filter(l => Date.parse(l.created_at) >= desde) : lista;
    const ganhos = rec.filter(l => l.status === 'concluido'), perdidos = rec.filter(l => l.status === 'perdido');
    const faturamento = ganhos.reduce((s, l) => s + Number(l.valor_pago || 0), 0);
    const porOrigem = origens.map(o => { const d = rec.filter(l => l.origem === o), g = d.filter(l => l.status === 'concluido');
      return {origem: o, leads: d.length, ganhos: g.length, faturamento: g.reduce((s, l) => s + Number(l.valor_pago || 0), 0)}; }).filter(o => o.leads);
    return {total: rec.length, ganhos: ganhos.length, perdidos: perdidos.length, faturamento,
      emAberto: rec.filter(l => !['concluido','perdido'].includes(l.status)).reduce((s, l) => s + Number(l.valor_orcado || 0), 0),
      ticket: ganhos.length ? faturamento / ganhos.length : 0, conversao: rec.length ? ganhos.length / rec.length * 100 : 0, porOrigem,
      porStatus: Object.fromEntries(statuses.map(s => [s, rec.filter(l => l.status === s).length]))};
  };
  /* Pátio + Área do Cliente (16/10): o cliente fictício <teste> passou pelo pátio (extra aprovado e recusado)
     e indicou um amigo, que virou o lead de outro cliente (utm_source=area_cliente). */
  const C0 = clientes[0].id, leadDoC0 = leads.find(l => l.cliente_id === C0), leadIndicado = leads.find(l => l.cliente_id !== C0);
  if (leadIndicado) { leadIndicado.utm_source = 'area_cliente'; leadIndicado.origem = 'indicacao'; }
  const hAtras = h => new Date(Date.now() - h * 3600000).toISOString();
  const PATIO_FALSO = [{id: '44444444-4444-4444-8444-444444444444', numero: 57, etapa: 'entregue', cliente_id: C0, lead_id: leadDoC0?.id || null, veiculo: 'Carro de teste', placa: 'ABC1D23',
    servico: 'Revisão (fictícia)', created_at: hAtras(30), entregue_em: hAtras(2), abrir: PATIO.PATIO_URL + '/?os=44444444-4444-4444-8444-444444444444',
    eventos: [{tipo: 'etapa', etapa_de: 'recebido', etapa_para: 'diagnostico', created_at: hAtras(29)}, {tipo: 'etapa', etapa_de: 'em_execucao', etapa_para: 'pronto', created_at: hAtras(6)}, {tipo: 'etapa', etapa_de: 'pronto', etapa_para: 'entregue', created_at: hAtras(2)}],
    extras: [{id: 'x1', descricao: 'Disco de freio (fictício)', valor: 680, status: 'aprovado', decidido_em: hAtras(20)}, {id: 'x2', descricao: 'Palheta (fictícia)', valor: 60, status: 'recusado', decidido_em: hAtras(19), motivo_recusa: 'depois'}]}];
  const INDICACOES_FALSAS = leadIndicado ? [{id: 'i1', indicado_por: C0, nome: 'Amigo Fictício', telefone: leadIndicado.telefone, status: 'agendou', lead_id: leadIndicado.id, created_at: hAtras(48)}] : [];
  const piDoCliente = cid => ({patio: PATIO_FALSO.filter(o => o.cliente_id === cid), indicacoes: {feitas: INDICACOES_FALSAS.filter(i => i.indicado_por === cid), recebidas: []}});
  const piDoLead = l => { const pi = piDoCliente(l.cliente_id); pi.indicacoes.recebidas = INDICACOES_FALSAS.filter(i => i.lead_id === l.id).map(i => ({...i, indicado_por_nome: clientes[0].nome})); return pi; };
  const fichaCliente = id => {
    const c = clientes.find(x => x.id === id); if (!c) return null;
    const ls = leads.filter(l => l.cliente_id === id);
    const ag = ls.filter(l => ['agendado','em_servico','concluido'].includes(l.status)).map((l, i) => ({id: 'ag' + i + l.id.slice(-4), data: l.updated_at.slice(0, 10), hora: '09:30:00', servico: l.servico, veiculo: l.carro_modelo, status: l.status === 'concluido' ? 'concluido' : 'confirmado', valor: l.valor_orcado, lead_id: l.id}));
    const gasto = ls.filter(l => l.status === 'concluido').reduce((s, l) => s + Number(l.valor_pago || 0), 0);
    const servicos = {}; for (const l of ls.filter(l => l.status === 'concluido')) servicos[l.servico] = (servicos[l.servico] || 0) + 1;
    return {cliente: c, resumo: {gasto, emAberto: ls.filter(l => !['concluido','perdido'].includes(l.status)).reduce((s, l) => s + Number(l.valor_orcado || 0), 0),
      servicosFeitos: Object.values(servicos).reduce((s, n) => s + n, 0), ticket: 0, leads: ls.length, agendamentos: ag.length, faltas: 0, ultimoServico: null},
      leads: ls, agendamentos: ag, servicos: Object.entries(servicos).map(([nome, vezes]) => ({nome, vezes})),
      ...(() => { const pi = piDoCliente(id); return {patio: pi.patio.map(o => ({...o, aprovados: 1, recusados: 1, valor_aprovado: 680})), indicacoes: pi.indicacoes, eventos: PATIO.eventosParaLinhaDoTempo(pi)}; })()};
  };
  const contexto = l => {
    const ag = fichaCliente(l.cliente_id)?.agendamentos || [];
    const cliente = clientes.find(c => c.id === l.cliente_id) || null;
    const criado = Date.parse(l.created_at), em = ms => new Date(criado + ms).toISOString();
    return {
      lead: l, leads: leads.filter(x => x.cliente_id && x.cliente_id === l.cliente_id), cliente, c360: null, conversa: {id: 'conversa-ficticia'}, etapa: null,
      mensagens: [
        {id: 'm1', direcao: 'entrada', corpo: `Oi, queria orçamento de ${l.servico} (mensagem fictícia)`, created_at: em(60000)},
        {id: 'm2', direcao: 'saida', gerada_por_ia: true, corpo: 'Olá! Posso agendar um diagnóstico digital gratuito? (fictício)', created_at: em(120000)},
      ],
      agendamentos: ag,
      orcamentos: l.valor_orcado ? [{id: 'o1', numero: 1000 + leads.indexOf(l), status: 'enviado', total: l.valor_orcado, created_at: em(3600000), enviado_em: em(3600000), lead_id: l.id}] : [],
      comunicar: l.status === 'concluido' ? [{id: 'e1', tipo: 'pos_venda', status: 'enviado', corpo: 'Como ficou o carro? (fictício)', created_at: l.updated_at, enviado_em: l.updated_at, respondido_em: null, resposta: null}] : [],
      satisfacao: [],
      ...(() => { const pi = piDoLead(l); return {patio: pi.patio, indicacoes: pi.indicacoes, eventos: PATIO.eventosParaLinhaDoTempo(pi)}; })(),
      sinais: {diasNaEtapa: Math.floor((Date.now() - Date.parse(l.updated_at || l.created_at)) / DIA), clienteEsperandoResposta: false},
      links: linksDe(l.telefone), geradoEm: new Date().toISOString(),
    };
  };
  // Rotas da IA no MESMO formato do servidor real (lib/ia-crm.js), com conteúdo inventado e sem chamar a Claude.
  const registrar = (tipo, lead, resumo, saida, status = 'proposta') => {
    const a = {id: crypto.randomUUID(), origem: 'crm', tipo, status, lead_id: lead?.id || null, cliente_id: lead?.cliente_id || null, resumo, saida, created_at: new Date().toISOString(), executada_em: status === 'executada' ? new Date().toISOString() : null};
    acoes.unshift(a); return a;
  };
  const resumoLead = l => ({id: l.id, nome: l.nome, status: l.status, origem: l.origem, servico: l.servico || null, telefone: l.telefone || null});
  const linksDe = tel => { const t = String(tel || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, ''), q = t ? '?tel=' + t : '';
    return {atendimento: 'https://indycar-atendimento.onrender.com/' + q, agenda: 'https://indycar-agendamentos.onrender.com/' + q, comunicar: 'https://indycar-posvenda.onrender.com/' + q, whatsapp: t ? 'https://wa.me/55' + t : null, ligar: t ? 'tel:+55' + t : null}; };
  const ia = (url, req, d, json) => {
    const p = url.pathname;
    const ml = p.match(/^\/api\/ia\/lead\/([0-9a-f-]{36})\/(contexto|proxima-acao|qualificar|preencher)$/);
    if (ml) {
      const l = leads.find(x => x.id === ml[1]); if (!l) return json({erro: 'Lead não encontrado.'}, 404);
      if (ml[2] === 'contexto') return json(contexto(l));
      if (req.method !== 'POST') return json({erro: 'método não permitido'}, 405);
      if (ml[2] === 'proxima-acao') {
        const proposta = {acao: 'mensagem', prioridade: 'alta', justificativa: 'Cliente pediu orçamento e está sem resposta (fictício).', texto_mensagem: 'Oi! Aqui é da IndyCar. Posso reservar um diagnóstico digital gratuito pra você? (texto fictício)', novo_status: null, motivo_perda: null};
        const plano = {abrir: linksDe(l.telefone).atendimento, texto: proposta.texto_mensagem};
        return json({acao: registrar('crm_proxima_acao', l, 'Mandar mensagem — ' + proposta.justificativa, {...proposta, plano}), proposta, plano, avisos: [], automatico: false, autonomia: 'confirmar'});
      }
      if (ml[2] === 'qualificar') {
        const qualificacao = {temperatura: 'morno', probabilidade: 62, motivo: 'Pediu orçamento, mas não marcou data (fictício).', sinais: ['Pediu orçamento', 'Sem data definida']};
        return json({acao: registrar('crm_qualificar', l, `morno · 62% — ${qualificacao.motivo}`, qualificacao, 'executada'), qualificacao});
      }
      const campos = [{campo: 'carro_modelo', atual: l.carro_modelo || null, sugerido: l.carro_modelo || 'Onix 2019', vazio: !l.carro_modelo}, {campo: 'servico', atual: l.servico || null, sugerido: l.servico || 'Freios', vazio: !l.servico}];
      return json({acao: registrar('crm_preencher', l, 'Atualizar carro_modelo, servico pela conversa', {campos, plano: {muda: {lead: {antes: {}, depois: {}}}}}), campos, avisos: [], automatico: false, autonomia: 'confirmar'});
    }
    if (p === '/api/ia/triagem' && req.method === 'POST') {
      const agora = Date.now(), parados = leads.filter(l => !['concluido','perdido'].includes(l.status) && agora - Date.parse(l.updated_at || l.created_at) > 3 * DIA).slice(0, 6);
      const itens = parados.map(l => { const dias = Math.floor((agora - Date.parse(l.updated_at || l.created_at)) / DIA); const a = registrar('crm_triagem', l, `Ligar — parado há ${dias} dias (fictício)`, {acao: 'ligar', justificativa: 'Parado (fictício)', plano: {abrir: linksDe(l.telefone).ligar}, regra: 'parado', dias, porIA: false, lead: resumoLead(l)});
        return {...a, lead: resumoLead(l), regra: 'parado', dias}; });
      return json({itens, novos: itens.length, porIA: false, erroIA: null, autonomia: 'confirmar', total: leads.length});
    }
    if (p === '/api/ia/perguntar' && req.method === 'POST') {
      const pergunta = String(d.pergunta || '').slice(0, 300), citados = leads.slice(0, 3).map(resumoLead);
      const a = registrar('crm_perguntar', null, pergunta, {resposta: 'resposta fictícia'}, 'executada');
      return json({id: a.id, pergunta, resposta: `Resposta fictícia para: ${pergunta}`, leads: citados, semDados: false, modelo: 'mock', base: {hoje: new Date().toISOString().slice(0, 10), leads: leads.length}});
    }
    const ma = p.match(/^\/api\/ia\/acoes\/([0-9a-f-]{36})\/(executar|recusar|desfazer)$/);
    if (ma && req.method === 'POST') {
      const a = acoes.find(x => x.id === ma[1]); if (!a) return json({erro: 'Ação não encontrada.'}, 404);
      if (ma[2] === 'desfazer') { if (a.status !== 'executada') return json({erro: 'Esta ação não mudou nada no CRM; não há o que desfazer.'}, 422); a.status = 'desfeita'; return json({ok: true, id: a.id}); }
      if (a.status !== 'proposta') return json({erro: 'Essa ação já foi tratada.'}, 409);
      if (ma[2] === 'recusar') { a.status = 'recusada'; return json({ok: true, id: a.id}); }
      const novo = a.saida?.novo_status;
      if (['concluido','perdido'].includes(novo) && !d.confirmarFaturamento) return json({erro: 'Esta ação mexe em faturamento (concluído/perdido). Confirme para executar.', precisaConfirmar: true}, 428);
      a.status = 'executada'; a.executada_em = new Date().toISOString();
      return json({ok: true, id: a.id, abrir: a.saida?.plano?.abrir || null, texto: a.saida?.plano?.texto || null, mudou: false});
    }
    if (p === '/api/ia/acoes') { const lid = url.searchParams.get('leadId'); return json({acoes: acoes.filter(a => !lid || a.lead_id === lid).slice(0, Number(url.searchParams.get('limite')) || 30)}); }
    if (p === '/api/ia/uso') { const hoje = acoes.length; return json({ativo: true, configurada: true, autonomia: 'confirmar', modelos: {rapido: 'mock', forte: 'mock'}, hoje, limite: 300, restante: Math.max(0, 300 - hoje), doCrmHoje: hoje, porTipo: {}, tokensHoje: 0}); }
    return null;
  };

  const filtros = new Map();      // papel → filtros salvos (rodada 5)
  const campanhas = [];
  return http.createServer(async (req, res) => {
    if (PREFIXO) {
      if (req.url === PREFIXO) { res.writeHead(308, {Location: PREFIXO + '/'}); return res.end(); }
      if (!req.url.startsWith(PREFIXO + '/')) { res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'}); return res.end('fora do prefixo ' + PREFIXO); }
      req.url = req.url.slice(PREFIXO.length);
    }
    const url = new URL(req.url, 'http://localhost');
    const cabExtra = {};
    let json = (v, status = 200) => { res.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cabExtra}); res.end(JSON.stringify(v)); };
    // papel desta requisição: ?papel= (vira cookie) > cookie > padrão
    const cookie = /(?:^|;\s*)mock_papel=([a-z_]+)/.exec(req.headers.cookie || '')?.[1];
    const pedido = url.searchParams.get('papel');
    const pp = PAPEIS_MOCK[pedido] ? pedido : PAPEIS_MOCK[cookie] ? cookie : papelPadrao;
    if (PAPEIS_MOCK[pedido]) cabExtra['Set-Cookie'] = `mock_papel=${pedido}; Path=/; SameSite=Strict`;
    if (url.pathname === '/__sb/eventos') {
      res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive'}); res.write(': ok\n\n');
      sse.add(res); req.on('close', () => sse.delete(res)); return;
    }
    let body = ''; for await (const c of req) body += c;
    let d = {};
    try { d = body ? JSON.parse(body) : {}; } catch { return json({erro: 'JSON inválido.', codigo: 'json_invalido'}, 400); }
    const tourCookie = /(?:^|;\s*)mock_tour=1/.test(req.headers.cookie || '') || url.searchParams.get('tour') === '1';
    if (url.searchParams.get('tour') === '1') cabExtra['Set-Cookie'] = [cabExtra['Set-Cookie'], 'mock_tour=1; Path=/; SameSite=Strict'].filter(Boolean);
    if (url.pathname === '/__sb' && req.method === 'POST') return json(bancoFalso({...d, tour: tourCookie}, pp));
    if (url.pathname === '/__mock/dormir' && req.method === 'POST') { dormeAte = Date.now() + Math.max(0, Number(d.segundos) || 0) * 1000; return json({ok: true, ate: dormeAte}); }
    if (url.pathname === '/__mock/notificar' && req.method === 'POST') {
      const n = {id: crypto.randomUUID(), perfil_id: EU, tipo: d.tipo || 'lead_atribuido', titulo: String(d.titulo || 'Notificação fictícia').slice(0, 160), corpo: d.corpo ?? null, link: d.link ?? null, app: d.app || 'crm', chave: null, lida_em: null, created_at: agoraIso()};
      notificacoes.unshift(n); avisar('notificacoes', 'INSERT', n); return json(n, 201);
    }
    if (url.pathname === '/__mock/tarefa' && req.method === 'POST') {
      const t = {id: crypto.randomUUID(), titulo: String(d.titulo || 'Tarefa fictícia'), descricao: null, responsavel_id: EU, criado_por: EQUIPE_BASE[3].id, lead_id: d.lead_id || null, cliente_id: null, conversa_id: null, agendamento_id: null, origem: 'atendimento', prioridade: 2, vence_em: d.vence_em || null, status: 'aberta', concluida_em: null, concluida_por: null, created_at: agoraIso()};
      tarefas.push(t); avisar('tarefas', 'INSERT', t); return json(t, 201);
    }
    if (url.pathname.startsWith('/api/')) {
      if (latencia) await new Promise(r => setTimeout(r, latencia));
      // Render acordando: 503 em HTML, sem o JSON do nosso servidor
      if (dormeAte > Date.now()) { res.writeHead(503, {'Content-Type': 'text/html; charset=utf-8', 'x-render-routing': 'hibernate-wake-error', 'Cache-Control': 'no-store'}); return res.end('<html><body>Service Unavailable</body></html>'); }
      if (url.pathname === '/api/ping') return json({ok: true, versao: 'mock-r4', hora: new Date().toISOString()});
      const chaveIdem = req.method !== 'GET' && req.headers['x-idempotencia'] ? pp + ':' + req.method + ':' + url.pathname + ':' + req.headers['x-idempotencia'] : null;
      if (chaveIdem && idem.has(chaveIdem)) { const r0 = idem.get(chaveIdem); res.writeHead(r0.status, {'Content-Type': 'application/json', 'x-idempotencia-repetida': '1'}); return res.end(JSON.stringify(r0.corpo)); }
      if (chaveIdem) { const json0 = json; json = (v, status = 200) => { if (status < 500) idem.set(chaveIdem, {status, corpo: v}); return json0(v, status); }; }
      const p = url.pathname, me = eu(pp), gestor = ['admin','gestor'].includes(me.papel);
      if (p === '/api/config') return json({configurado: true, supabaseUrl: 'http://localhost', supabaseAnonKey: 'ficticia'});
      if (p === '/api/primeiro-acesso') return json({aberto: false});
      /* Portão igual ao combinado com o servidor real: 401 sem token; 401/403 com código. */
      const token = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
      if (!token) return json({erro: 'Faça login para usar o CRM.', codigo: 'sem_login'}, 401);
      if (token === 'expirado') return json({erro: 'Sessão expirada.', codigo: 'token_expirado'}, 401);
      if (me.ativo === false) return json({erro: 'Seu acesso foi desativado.', codigo: 'desativado'}, 401);
      if (me.papel === 'agenda' || (me.papel !== 'admin' && !(me.apps || []).includes('crm'))) return json({erro: 'Você não tem acesso ao CRM.', codigo: 'sem_acesso_app'}, 403);
      if (p === '/api/perfil' && req.method === 'GET') { const {apps, cargo, telefone, precisa_trocar_senha, preferencias, ...b} = me; return json({...b, apps, cargo, telefone, precisa_trocar_senha, avatar_cor: preferencias?.avatar_cor || null}); }
      if (p === '/api/perfil' && req.method === 'PATCH') { for (const k of ['nome','cargo','telefone']) if (k in d) me[k] = d[k]; if (d.avatar_cor) me.preferencias = {...me.preferencias, avatar_cor: d.avatar_cor}; return json({ok: true, nome: me.nome}); }
      if (me.precisa_trocar_senha) return json({erro: 'Troque a senha provisória antes de continuar.', codigo: 'precisa_trocar_senha'}, 403);
      if (p === '/api/equipe/nomes') return json(equipe(pp).filter(x => x.ativo !== false).map(x => ({id: x.id, nome: x.nome, avatar_cor: x.avatar_cor || null, papel: x.papel})));
      // formato do servidor real: só quem pode usar o CRM (sem o papel agenda), com a carga de leads abertos
      if (p === '/api/vendedores') { const carga = id => leads.filter(l => l.responsavel_id === id && !['concluido','perdido'].includes(l.status)).length;
        return json({vendedores: equipe(pp).filter(x => x.ativo !== false && x.papel !== 'agenda').map(x => ({id: x.id, nome: x.nome, papel: x.papel, cargo: x.cargo || null, avatar_cor: x.avatar_cor || null, recebe_leads: x.recebe_leads !== false, ultimo_lead_em: null, abertos: carga(x.id), eu: x.id === EU, respostas: 0}))}); }
      const mr = p.match(/^\/api\/leads\/([0-9a-f-]{36})\/responsavel$/);
      if (mr && req.method === 'PATCH') {
        const l = leads.find(x => x.id === mr[1]); if (!l) return json({erro: 'Lead não encontrado.', codigo: 'nao_encontrado'}, 404);
        const r = d.responsavel_id === 'eu' ? EU : (d.responsavel_id ?? null), antes = l.responsavel_id || null;
        if (r === null && !gestor) return json({erro: 'Só um gestor pode deixar o lead sem responsável.'}, 403);
        if (!gestor && antes && antes !== EU) return json({erro: 'Só o responsável pelo lead ou um gestor pode passá-lo para outra pessoa.'}, 403);
        if (r !== null && !equipe(pp).some(x => x.id === r && x.papel !== 'agenda')) return json({erro: 'Essa pessoa não pode receber leads do CRM (desativada ou sem acesso).'}, 400);
        if (antes === r) return json({ok: true, mudou: false, lead: {id: l.id, nome: l.nome, status: l.status, responsavel_id: antes}});
        Object.assign(l, {responsavel_id: r, updated_at: agoraIso()});
        return json({ok: true, mudou: true, lead: {id: l.id, nome: l.nome, status: l.status, responsavel_id: r}, responsavel: r ? {id: r} : null});
      }
      if (p === '/api/leads/responsavel-lote' && req.method === 'POST') {
        if (!gestor) return json({erro: 'Só um gestor distribui leads em lote.'}, 403);
        const ids = Array.isArray(d.ids) ? d.ids.filter(x => EH_UUID.test(String(x))) : [], r = d.responsavel_id ?? null;
        if (!ids.length || ids.length > 200) return json({erro: 'Escolha de 1 a 200 leads.', codigo: 'lote_invalido'}, 400);
        if (r !== null && !equipe(pp).some(x => x.id === r && x.papel !== 'agenda')) return json({erro: 'Escolha alguém da equipe.', codigo: 'responsavel_invalido'}, 400);
        const mexidos = leads.filter(l => ids.includes(l.id)); mexidos.forEach(l => Object.assign(l, {responsavel_id: r, updated_at: agoraIso()}));
        return json({ok: true, atualizados: mexidos.length, ids: mexidos.map(l => l.id), responsavel: r ? {id: r} : null});
      }
      /* ---------- rodada 4: valor pago, distribuição ---------- */
      if (p === '/api/leads/sem-valor') {
        const lista = leads.filter(l => l.status === 'concluido' && !(Number(l.valor_pago) > 0) && !/^Cortesia: sem cobrança$/m.test(l.observacoes || '') && (gestor || l.responsavel_id === EU));
        return json({total: lista.length, leads: lista.map((l, i) => ({...l, sugestoes: {agendamento: i % 4 === 1 ? 480 : null, orcamento: i % 4 === 2 ? 990 : null}}))});
      }
      if (p === '/api/leads/valores-lote' && req.method === 'POST') {
        if (!gestor) return json({erro: 'Só um gestor preenche valores em lote. Peça ao gestor ou preencha na ficha de cada lead.', codigo: 'so_gestor'}, 403);
        const feitos = [], pulados = [];
        for (const x of d.itens || []) { const l = leads.find(y => y.id === x.id); if (!l || l.status !== 'concluido') { pulados.push({id: x.id, motivo: 'não está mais concluído'}); continue; }
          const antes = {valor_pago: l.valor_pago, observacoes: l.observacoes || ''};
          if (x.cortesia) l.observacoes = (l.observacoes ? l.observacoes + '\n' : '') + 'Cortesia: sem cobrança'; else l.valor_pago = Number(x.valor_pago);
          feitos.push({id: l.id, nome: l.nome, antes, depois: {valor_pago: l.valor_pago, observacoes: l.observacoes}}); }
        return json({ok: true, atualizados: feitos.length, feitos, pulados});
      }
      if (p === '/api/leads/valores-lote/desfazer' && req.method === 'POST') {
        let voltaram = 0; for (const x of d.itens || []) { const l = leads.find(y => y.id === x.id); if (l) { l.valor_pago = x.antes.valor_pago; l.observacoes = x.antes.observacoes; voltaram++; } }
        return json({ok: true, voltaram, pulados: []});
      }
      if (p === '/api/leads/distribuir' && req.method === 'POST') {
        if (!gestor) return json({erro: 'Só um gestor distribui leads. Peça ao gestor da loja.', codigo: 'so_gestor'}, 403);
        const itens = []; let pulados = 0;
        for (const [pid, ids] of Object.entries(d.grupos || {})) {
          if (!equipe(pp).some(x => x.id === pid && x.papel !== 'agenda' && x.ativo !== false)) return json({erro: 'Uma das pessoas escolhidas não pode receber leads do CRM (desativada ou sem acesso).'}, 400);
          for (const id of ids) { const l = leads.find(y => y.id === id); if (l && !l.responsavel_id) { l.responsavel_id = pid; itens.push({id, para: pid}); } else pulados++; }
        }
        const lote = crypto.randomUUID();
        distribuicoes.unshift({id: lote, em: agoraIso(), por: eu(pp).nome, modo: d.modo, total: itens.length, itens, desfeita_em: null});
        const porPessoa = Object.keys(d.grupos || {}).map(id => ({id, nome: equipe(pp).find(x => x.id === id)?.nome, recebeu: itens.filter(x => x.para === id).length}));
        return json({ok: true, lote, atualizados: itens.length, pulados, porPessoa, itens});
      }
      if (p === '/api/leads/distribuicoes') {
        if (!gestor) return json({erro: 'Só um gestor vê as distribuições.', codigo: 'so_gestor'}, 403);
        return json({distribuicoes: distribuicoes.slice(0, 10).map(x => { const por = {}; for (const i of x.itens) por[i.para] = (por[i.para] || 0) + 1;
          return {id: x.id, em: x.em, por: x.por, modo: x.modo, total: x.total, desfeita_em: x.desfeita_em, desfeita_por: x.desfeita_em ? eu(pp).nome : null, pessoas: Object.entries(por).map(([id, n]) => ({id, nome: equipe(pp).find(y => y.id === id)?.nome || 'Fora', recebeu: n}))}; })});
      }
      const mdist = p.match(/^\/api\/leads\/distribuicoes\/([0-9a-f-]{36})\/desfazer$/);
      if (mdist && req.method === 'POST') {
        const x = distribuicoes.find(y => y.id === mdist[1]); if (!x) return json({erro: 'Distribuição não encontrada.'}, 404);
        if (x.desfeita_em) return json({erro: 'Esta distribuição já foi desfeita.'}, 409);
        let voltaram = 0, ficaram = 0; for (const i of x.itens) { const l = leads.find(y => y.id === i.id); if (l && l.responsavel_id === i.para) { l.responsavel_id = null; voltaram++; } else ficaram++; }
        x.desfeita_em = agoraIso(); return json({ok: true, voltaram, ficaram});
      }
      if (p === '/api/auditoria/exportacao') return json({ok: true});
      if (p === '/api/metas') {
        const mes = url.searchParams.get('mes') || mesHoje();
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return json({erro: 'Mês inválido (AAAA-MM).', codigo: 'mes_invalido'}, 400);
        if (req.method === 'PUT') {
          if (!gestor) return json({erro: 'Só gestor ou administrador define metas.', codigo: 'papel_insuficiente'}, 403);
          const lista = Array.isArray(d) ? d : d.metas, mesB = d.mes || mes;
          if (!Array.isArray(lista) || !lista.length || lista.length > 30) return json({erro: 'Envie de 1 a 30 metas.'}, 400);
          const atuais = metas.get(mesB) || [];
          for (const m of lista) { const x = {perfil_id: m.perfil_id || null, leads: +m.leads || 0, agendamentos: +m.agendamentos || 0, vendas: +m.vendas || 0, faturamento: +m.faturamento || 0}; const i = atuais.findIndex(a => (a.perfil_id || null) === x.perfil_id); if (i >= 0) atuais[i] = x; else atuais.push(x); }
          metas.set(mesB, atuais);
          return json({ok: true, metas: lista});
        }
        return json(url.searchParams.get('formato') === 'lista' ? metasDoMes(mes, pp) : metasServidor(mes, pp));
      }
      if (p === '/api/desempenho') {
        // como o servidor real: ?mes=AAAA-MM ou ?dias=N; atendente vê só os próprios números
        const mesQ = url.searchParams.get('mes'), dias = Number(url.searchParams.get('dias'));
        let de, ate;
        if (url.searchParams.get('livre') === '1') { de = url.searchParams.get('de'); ate = url.searchParams.get('ate'); if (!/^\d{4}-\d{2}-\d{2}$/.test(de || '') || !/^\d{4}-\d{2}-\d{2}$/.test(ate || '') || ate < de) return json({erro: 'Período inválido.'}, 400); }
        else if (dias >= 1) { ate = new Date().toISOString().slice(0, 10); de = new Date(Date.now() - (dias - 1) * DIA).toISOString().slice(0, 10); }
        else { const m = mesQ || mesHoje(); de = m + '-01'; ate = m + '-' + String(new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate()).padStart(2, '0'); }
        let pessoas = desempenho(de, ate, pp); if (!gestor) pessoas = pessoas.filter(x => x.perfil_id === EU);
        return json({periodo: {desde: de, ate, mes: mesQ || null, dias: dias || null}, pessoas, loja: {tempo_resposta_min: 18, respostas: 40}, ranking: [...pessoas].sort((a, b) => b.faturamento - a.faturamento).map((x, i) => ({posicao: i + 1, perfil_id: x.perfil_id, nome: x.nome, faturamento: x.faturamento, vendas: x.vendas, conversao: x.conversao}))});
      }
      if (p === '/api/tarefas' && req.method === 'GET') return json(bancoFalso({tabela: 'tarefas', op: 'select', select: '*', filtros: [['eq', 'status', url.searchParams.get('status') || 'aberta'], ['eq', 'responsavel_id', url.searchParams.get('responsavel_id') || EU]], ordem: [['vence_em', true, false]], limite: 300}, pp).data || []);
      if (p === '/api/tarefas' && req.method === 'POST') { const r = bancoFalso({tabela: 'tarefas', op: 'insert', valores: d, devolver: '*', unico: 'single', filtros: [], ordem: []}, pp); return r.error ? json({erro: r.error.message}, 400) : json(r.data, 201); }
      const mt = p.match(/^\/api\/tarefas\/([0-9a-f-]{36})$/);
      if (mt && req.method === 'PATCH') { const r = bancoFalso({tabela: 'tarefas', op: 'update', valores: d, devolver: '*', unico: 'maybe', filtros: [['eq', 'id', mt[1]]], ordem: []}, pp); return r.data ? json(r.data) : json({erro: 'Tarefa não encontrada.'}, 404); }
      if (p === '/api/stats') return json({semana: resumo(leads, Date.now() - 7 * DIA), geral: resumo(leads), comparativo: {leads: {atual: 5, anterior: 4}, faturamento: {atual: 900, anterior: 1200}}, dominios: {STATUSES: statuses, ORIGENS: origens}});
      if (p === '/api/saude') return json({avisos: [{problema: 'Aviso fictício: integração em manutenção', desde: '2026-10-09'}]});
      if (p === '/api/lead-por-telefone') {
        const t = String(url.searchParams.get('tel') || url.searchParams.get('t') || '').replace(/\D/g, '').slice(-8);
        const doTel = x => t.length === 8 && String(x.telefone).replace(/\D/g, '').slice(-8) === t;
        const cliente = clientes.find(doTel) || null, ls = leads.filter(doTel).sort((a, b) => b.created_at.localeCompare(a.created_at));
        const aberto = ls.find(l => !['concluido','perdido'].includes(l.status)) || null;
        return json({cliente, leads: ls, aberto, lead: aberto || ls[0] || null});
      }
      /* ---------- rodada 5 ---------- */
      if (p === '/api/clientes/360') {
        const cid = url.searchParams.get('cliente'), tel = R5.normalizarTelefone(url.searchParams.get('tel') || '');
        const c = clientes.find(x => x.id === cid) || (tel ? clientes.find(x => R5.normalizarTelefone(x.telefone) === tel) : null);
        if (!c) return json({erro: 'Informe o telefone com DDD (ou um cliente válido).'}, 400);
        const fc = fichaCliente(c.id), ls = leads.filter(l => l.cliente_id === c.id), aberto = ls.find(l => !['concluido','perdido'].includes(l.status));
        const t = R5.normalizarTelefone(c.telefone), ctx = aberto ? contexto(aberto) : null;
        const ficha = {telefone: t, telefone_55: '55' + t, gerado_em: agoraIso(),
          cliente: {...c, cliente_desde: c.created_at, link_crm: '/?cliente=' + c.id},
          conversa: ctx ? {id: 'conversa-ficticia', status: 'aberta', etapa: 'Orçamento enviado (fictício)', atribuida_a_nome: EQUIPE_BASE[1].nome, aguardando_consultor: ls.length % 2 === 0, ultima_mensagem_em: aberto.updated_at, link: '/?conversa=conversa-ficticia'} : null,
          mensagens: ctx ? ctx.mensagens.map(m => ({...m, anexo: false})).reverse() : [],
          leads: ls.map(l => ({...l, link: '/?lead=' + l.id, responsavel_nome: equipe(pp).find(x => x.id === l.responsavel_id)?.nome || null})),
          agendamentos: fc.agendamentos.map(a => ({...a, consultor: 'Consultor Fictício', link: '/?agendamento=' + a.id})),
          patio: fc.patio.map(o => ({...o, link: '/?os=' + o.id, extras_pendentes: 1, mecanico: 'Mecânico Fictício', token_publico: 'tokfake', link_cliente: 'https://indycar-patio.netlify.app/acompanhar/?t=tokfake'})),
          orcamentos: ctx ? ctx.orcamentos.map(o => ({...o, link: '/?orcamento=' + o.id})) : [],
          comunicar: ctx ? ctx.comunicar : [], tarefas: tarefas.filter(x => x.status === 'aberta' && ls.some(l => l.id === x.lead_id)).map(x => ({...x, responsavel_nome: equipe(pp).find(y => y.id === x.responsavel_id)?.nome || null})),
          indicacoes: {fez: fc.indicacoes.feitas, foi_indicado_por: INDICACOES_FALSAS.some(i => i.lead_id && ls.some(l => l.id === i.lead_id)) ? {cliente_id: C0, nome: clientes[0].nome, telefone: clientes[0].telefone, quando: hAtras(48)} : null},
          resumo: {total_agendamentos: fc.agendamentos.length, servicos_feitos: fc.resumo.servicosFeitos, faltas: 0, nao_fechou: 0, gasto_agenda: 0, gasto_leads: fc.resumo.gasto, total_gasto: fc.resumo.gasto, ultima_visita: fc.agendamentos[0] ? fc.agendamentos[0].data + 'T09:30:00Z' : null, proximo_horario: null, carro_na_oficina: fc.patio.some(o => !['entregue','cancelado'].includes(o.etapa)), total_leads: ls.length, leads_abertos: ls.filter(l => !['concluido','perdido'].includes(l.status)).length, mensagens_total: ctx ? ctx.mensagens.length : 0, ultima_mensagem_em: aberto?.updated_at || null, tarefas_abertas: 0}};
        return json({...ficha, links: R5.linksFicha(ficha), motivosPerda: R5.MOTIVOS_PERDA});
      }
      if (p === '/api/busca') return json(R5.buscaGlobal({leads, clientes}, url.searchParams.get('q') || '', {limite: 8}));
      if (p === '/api/leads/sem-dono') {
        if (!gestor) return json({erro: 'Só um gestor vê a distribuição dos leads sem responsável.', codigo: 'so_gestor'}, 403);
        const carga = id => leads.filter(l => l.responsavel_id === id && !['concluido','perdido'].includes(l.status)).length;
        const vendedores = equipe(pp).filter(x => x.ativo !== false && x.papel !== 'agenda' && x.recebe_leads !== false).map(x => ({id: x.id, nome: x.nome, abertos: carga(x.id), recebe_leads: true}));
        const cargas = new Map(vendedores.map(v => [v.id, v.abertos]));
        return json({resumo: R5.resumoSemDono(leads), vendedores, sugestao: R5.sugerirRodizio(leads, vendedores, {cargas}), leads: leads.filter(l => !l.responsavel_id && !['concluido','perdido'].includes(l.status)).slice(0, 1000)});
      }
      if (p === '/api/leads/campanha' && req.method === 'POST') {
        const ids = Array.isArray(d.ids) ? d.ids : [], corpo = String(d.corpo || '').trim();
        if (!ids.length || ids.length > 300) return json({erro: 'Escolha de 1 a 300 leads.'}, 400);
        if (corpo.length < 10) return json({erro: 'Escreva a mensagem da campanha (pelo menos 10 caracteres).'}, 400);
        const destinos = R5.destinosDeLeads(leads.filter(l => ids.includes(l.id)));
        const camp = {id: crypto.randomUUID(), status: 'aguardando', corpo, destinos, total_previsto: destinos.length, criado_por: EU, created_at: agoraIso()};
        campanhas.unshift(camp);
        return json({ok: true, campanha: {id: camp.id, status: 'aguardando', total: destinos.length}, destinos: destinos.length, pulados: ids.length - destinos.length, avisados: 1, abrir: 'https://indycar-posvenda.onrender.com/?campanha=' + camp.id}, 201);
      }
      if (p === '/api/filtros') {
        if (req.method === 'PUT') { try { const f = R5.validarFiltrosSalvos(d.filtros); filtros.set(pp, f); return json({ok: true, filtros: f}); } catch (e) { return json({erro: e.message}, e.status || 400); } }
        return json({filtros: filtros.get(pp) || []});
      }
      if (p === '/api/previsao') return json(R5.previsaoPipeline(url.searchParams.get('meus') === '1' ? leads.filter(l => l.responsavel_id === EU) : leads));
      if (p === '/api/motivos-perda') return json({motivos: R5.MOTIVOS_PERDA});
      if (p.startsWith('/api/ia/')) { const r = ia(url, req, d, json); if (r !== null) return r; }
      if (p === '/api/leads' && req.method === 'POST') {
        const c = clientes.find(x => String(x.telefone).replace(/\D/g, '').slice(-8) === String(d.telefone || '').replace(/\D/g, '').slice(-8));
        const agora = new Date().toISOString();
        const l = {valor_orcado: 0, valor_pago: 0, status: 'novo', origem: 'organico', ...d, id: crypto.randomUUID(), cliente_id: c?.id || null, created_at: agora, updated_at: agora, closed_at: null};
        leads.unshift(l); return json(l, 201);
      }
      if (p === '/api/leads') return json(leads);
      if (p === '/api/indicacoes') return json({indicacoes: INDICACOES_FALSAS.map(i => ({lead_id: i.lead_id, status: i.status, indicado_por: i.indicado_por, indicado_por_nome: clientes[0].nome}))});
      if (p.startsWith('/api/leads/')) {
        const id = p.split('/').at(-1), l = leads.find(x => x.id === id);
        if (!l) return json({erro: 'lead não encontrado'}, 404);
        if (req.method === 'PATCH') {
          if (d.status && !statuses.includes(d.status)) return json({erro: 'Etapa inválida.'}, 400);
          const mudouEtapa = d.status && d.status !== l.status;
          Object.assign(l, d, {updated_at: new Date().toISOString()});
          if (mudouEtapa) l.closed_at = ['concluido','perdido'].includes(l.status) ? l.updated_at : null;
        }
        if (req.method === 'DELETE') { if (!gestor) return json({erro: 'Só gestor ou administrador apaga leads.', codigo: 'papel_insuficiente'}, 403); leads = leads.filter(x => x.id !== id); return json({ok: true}); }
        return json(l);
      }
      if (p === '/api/clientes') {
        const q = String(url.searchParams.get('q') || '').toLowerCase(), dig = q.replace(/\D/g, '');
        const lista = clientes.filter(c => !q || c.nome.toLowerCase().includes(q) || (dig.length >= 4 && c.telefone.includes(dig)) || c.placa.toLowerCase().includes(q.replace(/[^a-z0-9]/g, '')))
          .map(c => { const ls = leads.filter(l => l.cliente_id === c.id), g = ls.filter(l => l.status === 'concluido');
            return {...c, gasto: g.reduce((s, l) => s + Number(l.valor_pago || 0), 0), emAberto: ls.filter(l => !['concluido','perdido'].includes(l.status)).reduce((s, l) => s + Number(l.valor_orcado || 0), 0), servicos: g.length, leads: ls.length, agendamentos: 0, ultimoContato: ls[0]?.updated_at || c.created_at}; })
          .sort((a, b) => b.gasto - a.gasto || String(b.ultimoContato).localeCompare(String(a.ultimoContato)));
        const fat = lista.reduce((s, c) => s + c.gasto, 0);
        return json({clientes: lista, filtrado: !!q, total: lista.length, faturamento: fat, totalBase: clientes.length, faturamentoBase: leads.filter(l => l.status === 'concluido').reduce((s, l) => s + Number(l.valor_pago || 0), 0)});
      }
      if (p.startsWith('/api/clientes/')) {
        const id = p.split('/').at(-1), c = clientes.find(x => x.id === id);
        if (!c) return json({erro: 'cliente não encontrado'}, 404);
        if (req.method === 'PATCH') { for (const k of ['nascimento','aceita_mensagens']) if (k in d) c[k] = d[k]; return json({cliente: c}); }
        return json(fichaCliente(id));
      }
      if (p === '/api/resumo-ia') return json({ok: true, resumo: '## Semana fictícia\n- Dados inventados pelo servidor falso.\n\n## ✅ O que fazer esta semana\n1. Cobrar os orçamentos parados (fictício).\n2. Responder as conversas sem resposta (fictício).\n3. Preencher os valores pagos (fictício).', modelo: 'mock', geradoEm: new Date().toISOString(), previsao: R5.previsaoPipeline(leads)});
      if (p === '/api/catalogo') return json({servicos: [], souAdmin: me.papel === 'admin'});
      if (p === '/api/equipe' && req.method === 'GET') { const lista = me.papel === 'admin' ? equipe(pp) : [me]; return json({equipe: lista.map(x => ({id: x.id, nome: x.nome, email: x.email, papel: x.papel, ativo: x.ativo !== false, ultimo_acesso_em: x.ultimo_acesso_em, created_at: '2026-08-01T12:00:00Z'})), souAdmin: me.papel === 'admin', meuId: EU}); }
      if (p === '/api/equipe/papel' && req.method === 'POST') { if (me.papel !== 'admin') return json({erro: 'Só o administrador muda a função da equipe.', codigo: 'papel_insuficiente'}, 403); const x = equipe(pp).find(y => y.id === d.id); if (!x || !['admin','gestor','atendente','agenda'].includes(d.papel)) return json({erro: 'Pessoa ou função inválida.'}, 400); x.papel = d.papel; return json({ok: true}); }
      if (p === '/api/integracoes') return json({canais: []});
      if (p === '/api/roi') return json({totais: {investimento: 0, faturamento: 0, lucro: 0, roi: null, leads: 0, ganhos: 0}, linhas: []});
      return json({erro: 'Rota fictícia não implementada'}, 404);
    }
    if (iaTeste && url.pathname === '/__ia-teste.js') { res.writeHead(200, {'Content-Type': tipos['.js']}); return res.end(fs.readFileSync(iaTeste)); }
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1)); const f = path.resolve(root, rel);
    if (!f.startsWith(root + path.sep)) return json({erro: 'Proibido'}, 403);
    try {
      let data = fs.readFileSync(f);
      if (rel === 'index.html') {
        let h = data.toString().replace(/<script src="https:\/\/cdn.jsdelivr[^>]+><\/script>/, () => `<script>window.__MOCK_PAPEL=${JSON.stringify(pp)};${SB_FALSO.replace(/<\/script/gi, '<\\/script')}</script>`).replace(/if \('serviceWorker' in navigator\)/, 'if (false)');
        if (iaTeste) h = h.replace('</body>', '<script src="/__ia-teste.js"></script></body>');
        data = Buffer.from(h);
      }
      res.writeHead(200, {'Content-Type': tipos[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...cabExtra}); res.end(data);
    } catch { return json({erro: 'Arquivo não encontrado'}, 404); }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { const porta = Number(process.env.PORT) || 3101; criarMock().listen(porta, '127.0.0.1', () => console.log('CRM fictício em http://127.0.0.1:' + porta + PREFIXO + '/')); }
