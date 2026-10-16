/* Rodada 5 (servidor real sobre banco em memória): handler exportado e montado em /crm/
   como na Central, ficha 360 pela rpc, busca global, leads sem dono + rodízio, campanha do
   Comunicar, filtros salvos, previsão, telefone normalizado, motivo da perda na auditoria. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { subirServidor, PESSOAS, U } = require('./servidor-falso.cjs');

const L = n => `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`;
const C = n => `33333333-3333-4333-8333-${String(n).padStart(12, '0')}`;
const dias = n => new Date(Date.now() - n * 864e5).toISOString();
const lead = (n, extra = {}) => ({ id: L(n), nome: `Cliente Fictício ${n}`, telefone: '1299' + String(1000000 + n), status: 'novo', origem: 'whatsapp', valor_orcado: 0, valor_pago: 0, observacoes: '', created_at: dias(30 - (n % 20)), updated_at: dias(5), closed_at: null, responsavel_id: null, cliente_id: null, ...extra });

test('server.js exporta { handler, iniciar } e nada escuta sozinho ao importar', () => {
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(codigo, /module\.exports = \{ handler, iniciar/);
  assert.match(codigo, /if \(require\.main === module\) iniciar\(\);/);
  assert.ok(!/^server\.listen\(/m.test(codigo), 'listen só dentro de iniciar()');
  // nada da tela começa com "/" na raiz (a Central monta em /crm/)
  for (const arq of ['index.html', 'app.js', 'acesso.js', 'rodada4.js', 'rodada5.js', 'crm-ia.js', 'equipe.js', 'melhorias.js']) {
    const s = fs.readFileSync(path.join(__dirname, '..', 'public', arq), 'utf8');
    assert.ok(!/\bfetch\(\s*['"`]\//.test(s), `${arq}: fetch com caminho absoluto`);
    assert.ok(!/(href|src)="\/[a-z]/.test(s), `${arq}: href/src absoluto`);
  }
  const sw = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
  assert.match(sw, /self\.registration/); assert.ok(!/'\/api\/'/.test(sw));
  const man = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'manifest.json'), 'utf8'));
  assert.equal(man.start_url, './'); assert.equal(man.scope, './'); assert.ok(man.icons.every(i => !i.src.startsWith('/')));
});

test('montado em /crm/ (proxy mínimo como a Central): página, estáticos, API e links com o prefixo', async () => {
  const s = await subirServidor({ prefixo: '/crm', tabelas: { leads: [lead(1), lead(2)], crm_distribuicoes: [] } });
  try {
    assert.match(s.url, /\/crm$/);
    const html = await fetch(s.url + '/');
    assert.equal(html.status, 200); const corpo = await html.text();
    assert.match(corpo, /<script src="apps\.js">/); assert.ok(!/href="\/manifest/.test(corpo));
    assert.equal((await fetch(s.url + '/sw.js')).status, 200);
    assert.equal((await fetch(s.url + '/manifest.json')).status, 200);
    const ping = await s.req(null, '/api/ping'); assert.equal(ping.status, 200); assert.match(ping.corpo.versao, /r5/);
    assert.equal((await s.req('gestor', '/api/leads')).corpo.length, 2);
    // fora do prefixo o proxy não entrega nada do CRM
    assert.equal((await fetch(s.url.replace(/\/crm$/, '') + '/api/ping')).status, 404);
    // o link do aviso de distribuição leva o prefixo
    const r = await s.req('gestor', '/api/leads/distribuir', { body: { grupos: { [PESSOAS.atendente.id]: [L(1)] } } });
    assert.equal(r.status, 200);
    assert.equal(s.db.notificacoes.find(n => /Você recebeu/.test(n.titulo)).link, '/crm/?meus=1');
    // /api/eu: os outros apps viram caminhos irmãos na Central
    const eu = await s.req('atendente', '/api/eu');
    assert.equal(eu.status, 200); assert.equal(eu.corpo.prefixo, '/crm');
    assert.ok(eu.corpo.outrosApps.some(a => a.app === 'agenda' && a.url === '/agenda/'), JSON.stringify(eu.corpo.outrosApps));
    assert.ok(eu.corpo.outrosApps.some(a => a.app === 'orcador' && /netlify/.test(a.url)));
    // ficha 360 com links irmãos
    s.db.clientes.push({ id: C(1), nome: 'Cliente Fictício 1', telefone: '12991000001', created_at: dias(400) });
    const f = await s.req('gestor', '/api/clientes/360?tel=12991000001');
    assert.equal(f.status, 200); assert.equal(f.corpo.links.agenda, '/agenda/?tel=5512991000001'); assert.equal(f.corpo.links.leads[L(1)], '/crm/?lead=' + L(1));
  } finally { await s.fechar(); }
});

test('prefixo pela variável PREFIXO: pedido ainda com o prefixo na URL funciona e /crm vira /crm/', async () => {
  const s = await subirServidor({ env: { PREFIXO: '/crm' } });
  try {
    const r = await fetch(s.url + '/crm/api/ping'); assert.equal(r.status, 200);
    const red = await fetch(s.url + '/crm', { redirect: 'manual' }); assert.equal(red.status, 308); assert.equal(red.headers.get('location'), '/crm/');
    assert.equal((await fetch(s.url + '/crm/')).status, 200);
  } finally { await s.fechar(); }
});

test('ficha 360 em uma chamada: cliente, leads, agenda, pátio, Comunicar, tarefas, indicações, resumo e links', async () => {
  const cid = C(7);
  const s = await subirServidor({ tabelas: {
    clientes: [{ id: cid, nome: 'Dona Fictícia', telefone: '+55 (12) 99100-0007', carro_modelo: 'Kwid', placa: 'KWD1A23', created_at: dias(300), aceita_mensagens: true }],
    leads: [lead(7, { cliente_id: cid, status: 'orcamento', valor_orcado: 900, responsavel_id: PESSOAS.atendente.id }), lead(8, { telefone: '12991000007', status: 'concluido', valor_pago: 350, closed_at: dias(60) })],
    agendamentos: [{ id: 'ag-1', cliente_id: cid, telefone: '12991000007', data: '2026-10-20', hora: '09:00', status: 'confirmado', servico: 'Freios', valor: 400, created_at: dias(1) }, { id: 'ag-2', cliente_id: cid, data: '2026-08-01', hora: '10:00', status: 'nao_veio', created_at: dias(70) }],
    conversas: [{ id: 'cv-1', cliente_id: cid, telefone: '12991000007', status: 'aberta', ultima_mensagem_em: dias(0), aguardando_consultor: true }],
    whatsapp_mensagens: [{ id: 'm1', conversa_id: 'cv-1', cliente_id: cid, telefone: '12991000007', direcao: 'entrada', corpo: 'Quanto fica o freio?', created_at: dias(0) }],
    patio_os: [{ id: 'os-1', numero: 12, etapa: 'em_execucao', cliente_id: cid, telefone: '12991000007', veiculo: 'Kwid', placa: 'KWD1A23', token_publico: 'tok1', created_at: dias(1) }],
    patio_extras: [{ id: 'x1', os_id: 'os-1', status: 'pendente', descricao: 'Palheta', valor: 60 }],
    posvenda_envios: [{ id: 'e1', cliente_id: cid, telefone: '12991000007', tipo: 'lembrete', status: 'enviado', enviado_em: dias(2) }],
    tarefas: [{ id: 't1', titulo: 'Ligar', status: 'aberta', cliente_id: cid, responsavel_id: PESSOAS.atendente.id, prioridade: 2 }],
    indicacoes: [{ id: 'i1', indicado_por: cid, nome: 'Amigo', telefone: '12995550000', status: 'nova', created_at: dias(3) }],
  } });
  try {
    assert.equal((await s.req(null, '/api/clientes/360?tel=12991000007')).status, 401);
    assert.equal((await s.req('gestor', '/api/clientes/360?tel=123')).status, 400);
    const f = await s.req('atendente', '/api/clientes/360?tel=5512991000007');
    assert.equal(f.status, 200);
    const b = f.corpo;
    assert.equal(b.telefone, '12991000007'); assert.equal(b.cliente.id, cid);
    assert.equal(b.leads.length, 2, 'lead sem cliente_id entra pelo telefone normalizado');
    assert.equal(b.leads.find(l => l.id === L(7)).responsavel_nome, PESSOAS.atendente.nome);
    assert.equal(b.agendamentos.length, 2); assert.equal(b.patio[0].extras_pendentes, 1); assert.ok(b.patio[0].link_cliente);
    assert.equal(b.conversa.aguardando_consultor, true); assert.equal(b.mensagens.length, 1);
    assert.equal(b.comunicar.length, 1); assert.equal(b.tarefas.length, 1); assert.equal(b.indicacoes.fez.length, 1);
    assert.equal(b.resumo.faltas, 1); assert.equal(b.resumo.total_gasto, 350); assert.equal(b.resumo.carro_na_oficina, true); assert.equal(b.resumo.leads_abertos, 1);
    assert.equal(b.links.conversa, 'https://indycar-atendimento.onrender.com/?conversa=cv-1');
    assert.equal(b.links.patio['os-1'], 'https://indycar-patio.netlify.app/?os=os-1');
    assert.equal(b.links.agendamentos['ag-1'], 'https://indycar-agendamentos.onrender.com/?agendamento=ag-1');
    assert.deepEqual(b.motivosPerda.slice(0, 2), ['Achou caro', 'Foi em outra oficina']);
    // pelo id do cliente também
    assert.equal((await s.req('gestor', '/api/clientes/360?cliente=' + cid)).corpo.cliente.id, cid);
    // uma só chamada à rpc por ficha
    const rpcs = s.sb.chamadas.filter(c => c.rpc === 'cliente_360').length; assert.equal(rpcs, 2, 'uma rpc por ficha aberta, nenhuma outra leitura de tabela');
    // rpc ausente no banco → 503 claro (a tela cai na ficha antiga)
    s.sb.falhar(['rpc:cliente_360']);
    assert.equal((await s.req('gestor', '/api/clientes/360?tel=12991000007')).status, 503);
  } finally { await s.fechar(); }
});

test('lead por telefone usa telefone_e164 (não varre com like) e junta os leads do cliente', async () => {
  const cid = C(2);
  const s = await subirServidor({ tabelas: {
    clientes: [{ id: cid, nome: 'Cliente Fictício', telefone: '12991000002' }],
    leads: [lead(2, { telefone: '5512991000002' }), lead(3, { telefone: '12991000002', cliente_id: cid }), lead(4, { telefone: '11991000002' }), lead(5, { telefone: '(12) 9100-0002', cliente_id: cid })],
  } });
  try {
    const r = await s.req('atendente', '/api/lead-por-telefone?tel=12991000002');
    assert.equal(r.status, 200); assert.equal(r.corpo.cliente.id, cid);
    assert.deepEqual(r.corpo.leads.map(l => l.id).sort(), [L(2), L(3), L(5)].sort(), 'outro DDD fica fora; lead do cliente com telefone digitado diferente entra');
    assert.ok(!s.sb.chamadas.some(c => c.modo === 'select' && c.like), 'sem like');
  } finally { await s.fechar(); }
});

test('busca global: leads e clientes por nome, telefone e placa', async () => {
  const s = await subirServidor({ tabelas: { leads: [lead(1, { nome: 'Zuleica Fictícia', placa: 'ZUL1E23' })], clientes: [{ id: C(1), nome: 'Zuleide Cliente', telefone: '12998887777', placa: 'ABC1234' }] } });
  try {
    const r = await s.req('atendente', '/api/busca?q=zule');
    assert.equal(r.status, 200); assert.equal(r.corpo.leads.length, 1); assert.equal(r.corpo.clientes.length, 1);
    assert.equal((await s.req('atendente', '/api/busca?q=887777')).corpo.clientes[0].por, 'telefone');
    assert.equal((await s.req('atendente', '/api/busca?q=zul1e23')).corpo.leads[0].por, 'placa');
    assert.equal((await s.req('atendente', '/api/busca?q=z')).corpo.leads.length, 0);
  } finally { await s.fechar(); }
});

test('leads sem dono: só gestor; resumo e rodízio sugerido pronto para /api/leads/distribuir (auditado, com desfazer)', async () => {
  const ls = [...Array.from({ length: 9 }, (_, i) => lead(i, { status: ['novo', 'contato', 'orcamento'][i % 3] })), lead(9, { responsavel_id: PESSOAS.atendente.id }), lead(10, { status: 'perdido' })];
  const s = await subirServidor({ tabelas: { leads: ls, crm_distribuicoes: [] } });
  try {
    assert.equal((await s.req('atendente', '/api/leads/sem-dono')).status, 403);
    const r = await s.req('gestor', '/api/leads/sem-dono');
    assert.equal(r.status, 200);
    assert.equal(r.corpo.resumo.total, 9); assert.deepEqual(r.corpo.resumo.porEtapa, { novo: 3, contato: 3, orcamento: 3 });
    // recebem só quem tem recebe_leads e o CRM: admin (apps só agenda) é admin → entra; gestora recebe_leads=false fica fora
    const ids = r.corpo.vendedores.map(v => v.id);
    assert.ok(ids.includes(PESSOAS.atendente.id) && ids.includes(PESSOAS.atendente2.id)); assert.ok(!ids.includes(PESSOAS.gestor.id));
    assert.equal(r.corpo.sugestao.total, 9);
    assert.ok(s.db.leads.every(l => l.id === L(9) ? l.responsavel_id === PESSOAS.atendente.id : !l.responsavel_id || l.status === 'perdido'), 'a sugestão não grava nada');
    // a Ana já tem 1 aberto: o Bruno recebe mais
    const ana = r.corpo.sugestao.resumo.find(x => x.id === PESSOAS.atendente.id), bruno = r.corpo.sugestao.resumo.find(x => x.id === PESSOAS.atendente2.id);
    assert.ok(bruno.recebe >= ana.recebe);
    // aplicar = a rota de distribuição da rodada 4 (auditoria + desfazer)
    const ap = await s.req('gestor', '/api/leads/distribuir', { body: { grupos: r.corpo.sugestao.grupos, modo: 'carga', filtros: { rodizio: 'sugerido' } } });
    assert.equal(ap.status, 200); assert.equal(ap.corpo.atualizados, 9);
    assert.equal((await s.req('gestor', '/api/leads/sem-dono')).corpo.resumo.total, 0);
    assert.ok(s.db.auditoria.some(a => a.acao === 'distribuir_leads' && a.detalhes.quantidade === 9));
    const d = await s.req('gestor', `/api/leads/distribuicoes/${ap.corpo.lote}/desfazer`, { method: 'POST', body: {} });
    assert.equal(d.corpo.voltaram, 9);
  } finally { await s.fechar(); }
});

test('campanha do Comunicar a partir de leads: proposta aguardando, gestores avisados, auditado, vocabulário da casa', async () => {
  const s = await subirServidor({ tabelas: { leads: [lead(1, { telefone: '12991000001', cliente_id: C(1) }), lead(2, { telefone: '5512991000001' }), lead(3, { telefone: '12991000003' }), lead(4, { telefone: '123' })], comunicar_campanhas: [] } });
  try {
    const ids = [L(1), L(2), L(3), L(4)];
    assert.equal((await s.req('atendente', '/api/leads/campanha', { body: { ids, corpo: 'curta' } })).status, 400);
    assert.equal((await s.req('atendente', '/api/leads/campanha', { body: { ids, corpo: 'Prezado cliente, favor comparecer com o veículo.' } })).status, 400);
    assert.equal((await s.req('atendente', '/api/leads/campanha', { body: { ids: [], corpo: 'Oi {nome}! Tudo bem com o carro?' } })).status, 400);
    assert.equal((await s.req('atendente', '/api/leads/campanha', { body: { ids, corpo: 'Oi {nome}! Tudo bem com o carro?', enviar_em: 'ontem' } })).status, 400);
    const r = await s.req('atendente', '/api/leads/campanha', { body: { ids, corpo: 'Oi {nome}! Tudo bem com o carro? Posso ajudar?', detalhe: 'reativação' } });
    assert.equal(r.status, 201);
    assert.equal(r.corpo.destinos, 2, 'telefones iguais (com e sem 55) contam uma vez; telefone inválido fica fora'); assert.equal(r.corpo.pulados, 2);
    assert.equal(r.corpo.campanha.status, 'aguardando'); assert.match(r.corpo.abrir, /indycar-posvenda\.onrender\.com\/\?campanha=/);
    const camp = s.db.comunicar_campanhas[0];
    assert.equal(camp.status, 'aguardando'); assert.equal(camp.total_previsto, 2); assert.equal(camp.criado_por, PESSOAS.atendente.id); assert.equal(camp.destinos.find(d => d.telefone === '12991000001').cliente_id, C(1), 'telefone repetido fica com o cliente_id de quem tinha'); assert.equal(camp.segmento, null);
    // admin e gestora ativos recebem um aviso cada (com link para a campanha no Comunicar)
    const avisos = s.db.notificacoes.filter(n => n.tipo === 'campanha');
    assert.equal(avisos.length, 2); assert.equal(r.corpo.avisados, 2); assert.equal(avisos[0].app, 'comunicar'); assert.equal(avisos[0].link, '/?campanha=' + camp.id);
    assert.ok(s.db.auditoria.some(a => a.acao === 'campanha_comunicar' && a.detalhes.destinos === 2));
    // repetir não duplica o aviso (chave única por campanha/pessoa) — nova campanha, novos avisos
    const r2 = await s.req('gestor', '/api/leads/campanha', { body: { ids: [L(3)], corpo: 'Oi {nome}! Seu carro está pronto para a revisão?' } });
    assert.equal(r2.status, 201); assert.equal(s.db.notificacoes.filter(n => n.tipo === 'campanha').length, 4);
  } finally { await s.fechar(); }
});

test('filtros salvos por pessoa: gravam em perfis.preferencias sem apagar as outras chaves', async () => {
  const s = await subirServidor();
  try {
    s.db.perfis.find(p => p.id === PESSOAS.atendente.id).preferencias = { tema: 'claro', crm_tour: { visto: 'x' } };
    assert.deepEqual((await s.req('atendente', '/api/filtros')).corpo, { filtros: [] });
    const r = await s.req('atendente', '/api/filtros', { method: 'PUT', body: { filtros: [{ nome: 'Google parados', filtro: { origem: 'google', parados: true } }, { nome: 'Meus orçamentos', filtro: { status: 'orcamento', resp: 'meus' } }] } });
    assert.equal(r.status, 200); assert.equal(r.corpo.filtros.length, 2);
    const pref = s.db.perfis.find(p => p.id === PESSOAS.atendente.id).preferencias;
    assert.equal(pref.tema, 'claro'); assert.equal(pref.crm_tour.visto, 'x'); assert.equal(pref.crm_filtros.length, 2);
    assert.equal((await s.req('atendente', '/api/filtros')).corpo.filtros[1].nome, 'Meus orçamentos');
    assert.equal((await s.req('atendente', '/api/filtros', { method: 'PUT', body: { filtros: [{ nome: '' }] } })).status, 400);
    // filtros são de cada pessoa
    assert.deepEqual((await s.req('gestor', '/api/filtros')).corpo, { filtros: [] });
  } finally { await s.fechar(); }
});

test('previsão pelo funil: loja para o gestor, só os meus para o atendente; motivos de perda únicos', async () => {
  const s = await subirServidor({ tabelas: { leads: [lead(1, { status: 'orcamento', valor_orcado: 1000, responsavel_id: PESSOAS.atendente.id }), lead(2, { status: 'agendado', valor_orcado: 2000, responsavel_id: PESSOAS.atendente2.id })] } });
  try {
    const g = await s.req('gestor', '/api/previsao'); assert.equal(g.status, 200); assert.equal(g.corpo.emAberto, 3000); assert.equal(g.corpo.previsto, 1000 * 0.45 + 2000 * 0.7);
    const a = await s.req('atendente', '/api/previsao?meus=1'); assert.equal(a.corpo.emAberto, 1000);
    assert.equal((await s.req('atendente', '/api/motivos-perda')).corpo.motivos.length, 7);
  } finally { await s.fechar(); }
});

test('fechar como perdido grava o motivo (livre e padronizado) na auditoria; utm aceito no lead', async () => {
  const s = await subirServidor({ tabelas: { leads: [lead(1)] } });
  try {
    const p = await s.req('atendente', '/api/leads/' + L(1), { method: 'PATCH', body: { status: 'perdido', observacoes: 'Motivo da perda: achou muito caro mesmo' } });
    assert.equal(p.status, 200);
    const a = s.db.auditoria.find(x => x.acao === 'lead_fechado');
    assert.equal(a.detalhes.motivo, 'achou muito caro mesmo'); assert.equal(a.detalhes.motivo_padrao, 'Achou caro');
    const n = await s.req('atendente', '/api/leads', { body: { nome: 'Fulano Fictício', telefone: '12991110000', utm_source: 'instagram', utm_medium: 'story', utm_campaign: 'cambio' } });
    assert.equal(n.status, 201); assert.equal(n.corpo.utm_source, 'instagram'); assert.equal(n.corpo.utm_medium, 'story');
  } finally { await s.fechar(); }
});

test('resumo da IA leva a previsão no briefing e a devolve para a tela', async () => {
  const s = await subirServidor({ tabelas: { leads: [lead(1, { status: 'orcamento', valor_orcado: 1000 })] }, roteiros: [{ texto: '## Resumo fictício\n\n## ✅ O que fazer esta semana\n1. a\n2. b\n3. c' }] });
  try {
    const r = await s.req('gestor', '/api/resumo-ia', { body: { periodo: 'semana' } });
    assert.equal(r.status, 200); assert.equal(r.corpo.ok, true); assert.equal(r.corpo.previsao.emAberto, 1000);
    const pedido = s.ia.pedidos[0];
    assert.match(pedido.messages[0].content, /PREVISÃO PELO FUNIL/); assert.match(pedido.system[0].text, /O que fazer esta semana/);
    assert.deepEqual(pedido.output_config, { effort: 'low' }, 'modelo forte de teste não é Sonnet: effort');
    assert.equal(pedido.thinking, undefined);
    void U;
  } finally { await s.fechar(); }
});
