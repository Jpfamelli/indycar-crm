/* IA do CRM + tarefas (cliente da IA falso, sem gastar API):
   criar_tarefa na próxima ação (clique e automático), desfazer cancela,
   triagem que vira tarefas (clique e automático) e sugestão de perdido. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { subirServidor, PESSOAS, U } = require('./servidor-falso.cjs');
const { planoAcao, tarefaSugerida, FERRAMENTAS } = require('../lib/ia-crm');

const ANA = PESSOAS.atendente.id, BRUNO = PESSOAS.atendente2.id;
const L1 = U(301), L2 = U(302), CLI = U(303);
const velho = new Date(Date.now() - 10 * 864e5).toISOString();
const tabelas = () => ({
  clientes: [{ id: CLI, nome: 'Cliente Fictício', telefone: '5512900000001', telefone_e164: '12900000001' }],
  leads: [
    { id: L1, cliente_id: CLI, nome: 'Rita Fictícia', telefone: '5512900000001', status: 'orcamento', origem: 'google', responsavel_id: BRUNO, valor_orcado: 0, valor_pago: 0, observacoes: '', created_at: velho, updated_at: velho },
    { id: L2, nome: 'Saulo Fictício', telefone: '5512900000002', status: 'novo', origem: 'meta', responsavel_id: null, valor_orcado: 0, valor_pago: 0, observacoes: '', created_at: velho, updated_at: velho },
  ],
});
const tarefaIA = { entrada: { acao: 'criar_tarefa', prioridade: 'alta', justificativa: 'Cliente pediu retorno amanhã cedo.', texto_mensagem: null, novo_status: null, motivo_perda: null, tarefa_titulo: 'Ligar para a Rita às 9h', tarefa_prazo_horas: 18 } };

test('esquema da ferramenta tem os campos da tarefa (strict) e o plano vira tarefa', () => {
  const sc = FERRAMENTAS.proxima_acao.input_schema;
  assert.ok(sc.properties.acao.enum.includes('criar_tarefa'));
  assert.ok(sc.required.includes('tarefa_titulo') && sc.required.includes('tarefa_prazo_horas'));
  const p = planoAcao({ acao: 'criar_tarefa', prioridade: 'baixa', justificativa: 'j', tarefa: { titulo: 'T', prazo_horas: 48 } }, { telefone: '12900000001' });
  assert.deepEqual(p, { tarefa: { titulo: 'T', descricao: 'j', prazo_horas: 48, prioridade: 3 } });
  assert.equal(tarefaSugerida({ acao: 'aguardar' }, {}), null);
  assert.equal(tarefaSugerida({ acao: 'cobrar_orcamento', prioridade: 'alta', justificativa: 'x' }, { nome: 'Rita Souza' }).titulo, 'Cobrar orçamento: Rita');
});

test('próxima ação criar_tarefa: clique cria para o dono do lead, desfazer cancela, auditoria registra', async () => {
  const s = await subirServidor({ tabelas: tabelas(), roteiros: [tarefaIA, { entrada: { ...tarefaIA.entrada, tarefa_titulo: null, justificativa: 'Sem justificativa.' } }] });
  try {
    const pa = await s.req('atendente', `/api/ia/lead/${L1}/proxima-acao`, { body: {} });
    assert.equal(pa.status, 200);
    assert.equal(pa.corpo.proposta.acao, 'criar_tarefa'); assert.equal(pa.corpo.proposta.tarefa.prazo_horas, 18);
    assert.equal(s.db.tarefas.length, 0, 'modo confirmar: só propõe');
    const ex = await s.req('atendente', `/api/ia/acoes/${pa.corpo.acao.id}/executar`, { body: {} });
    assert.equal(ex.status, 200); assert.equal(ex.corpo.tarefa.titulo, 'Ligar para a Rita às 9h');
    const t = s.db.tarefas[0];
    assert.equal(t.responsavel_id, BRUNO, 'vai para o responsável do lead'); assert.equal(t.criado_por, ANA);
    assert.equal(t.origem, 'ia'); assert.equal(t.prioridade, 1); assert.equal(t.lead_id, L1); assert.equal(t.cliente_id, CLI);
    assert.ok(Math.abs(Date.parse(t.vence_em) - (Date.now() + 18 * 3600_000)) < 60_000);
    assert.ok(s.db.auditoria.some(a => a.acao === 'ia_executar' && a.detalhes.tarefa === t.id));
    const hist = (await s.req('atendente', `/api/ia/acoes?leadId=${L1}`)).corpo.acoes;
    assert.equal(hist[0].desfazivel, true);
    const df = await s.req('atendente', `/api/ia/acoes/${pa.corpo.acao.id}/desfazer`, { body: {} });
    assert.equal(df.status, 200); assert.equal(df.corpo.tarefaCancelada, t.id);
    assert.equal(s.db.tarefas[0].status, 'cancelada');
    // sem título e sem justificativa útil: a resposta da IA é recusada
    const ruim = await s.req('atendente', `/api/ia/lead/${L1}/proxima-acao`, { body: {} });
    assert.equal(ruim.status, 502);
  } finally { await s.fechar(); }
});

test('modo automático: criar_tarefa e a triagem já criam as tarefas sozinhas (sem duplicar)', async () => {
  const s = await subirServidor({ tabelas: tabelas(), roteiros: [tarefaIA, { erro: 'IA fora' }] });
  s.db.ia_config[0].autonomia = 'automatico';
  try {
    const pa = await s.req('gestor', `/api/ia/lead/${L1}/proxima-acao`, { body: {} });
    assert.equal(pa.corpo.automatico, true); assert.ok(pa.corpo.tarefa?.id);
    assert.equal(s.db.tarefas.length, 1);
    const tri = await s.req('gestor', '/api/ia/triagem', { body: { dias: 3 } });
    assert.equal(tri.status, 200); assert.equal(tri.corpo.novos, 2);
    assert.equal(tri.corpo.tarefasCriadas, 1, 'L1 já tinha tarefa aberta; só L2 ganha');
    const t2 = s.db.tarefas.find(t => t.lead_id === L2);
    assert.equal(t2.responsavel_id, PESSOAS.gestor.id, 'lead sem dono: tarefa de quem rodou');
    assert.match(t2.titulo, /Saulo/);
    const item = tri.corpo.itens.find(i => i.lead_id === L2);
    assert.equal(item.saida.tarefa_automatica, true);
  } finally { await s.fechar(); }
});

test('triagem → "virar tarefas" com um clique; sugestão de perdido da automação pede confirmação', async () => {
  const s = await subirServidor({ tabelas: tabelas(), roteiros: [{ erro: 'IA fora' }] });
  try {
    const tri = await s.req('atendente', '/api/ia/triagem', { body: { dias: 3 } });
    const ids = tri.corpo.itens.map(i => i.id);
    assert.ok(tri.corpo.itens.every(i => i.saida.tarefa_sugerida && !i.saida.tarefa_id));
    assert.equal((await s.req('atendente', '/api/ia/triagem/tarefas', { body: { ids: [] } })).status, 400);
    const r = await s.req('atendente', '/api/ia/triagem/tarefas', { body: { ids: [...ids, U(999)] } });
    assert.equal(r.status, 200); assert.equal(r.corpo.criadas, 2);
    assert.ok(r.corpo.itens.some(x => x.motivo === 'nao_encontrada'));
    assert.equal(s.db.tarefas.find(t => t.lead_id === L1).responsavel_id, BRUNO);
    assert.equal(s.db.tarefas.find(t => t.lead_id === L2).responsavel_id, ANA);
    const de2 = await s.req('atendente', '/api/ia/triagem/tarefas', { body: { ids } });
    assert.equal(de2.corpo.criadas, 0, 'clicar de novo não duplica');
    assert.ok(s.db.auditoria.some(a => a.acao === 'ia_tarefas_triagem'));
    // sugestão de perdido gravada pela automação: executar pede confirmação (428)
    s.db.ia_acoes.push({ id: U(777), origem: 'crm', tipo: 'crm_sugestao_perdido', status: 'proposta', lead_id: L2,
      saida: { acao: 'marcar_perdido', motivo_perda: 'Nunca respondeu', novo_status: 'perdido', plano: planoAcao({ acao: 'marcar_perdido', novo_status: 'perdido', motivo_perda: 'Nunca respondeu' }, s.db.leads[1]) }, created_at: new Date().toISOString() });
    assert.equal((await s.req('atendente', `/api/ia/acoes/${U(777)}/executar`, { body: {} })).status, 428);
    const ok = await s.req('atendente', `/api/ia/acoes/${U(777)}/executar`, { body: { confirmarFaturamento: true } });
    assert.equal(ok.status, 200); assert.equal(s.db.leads[1].status, 'perdido');
    assert.ok(s.db.auditoria.some(a => a.acao === 'ia_executar' && a.detalhes.confirmouFaturamento === true));
  } finally { await s.fechar(); }
});
