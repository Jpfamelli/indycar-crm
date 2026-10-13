/* Tarefas do vendedor (tabela tarefas): criar, listar (minhas / da ficha),
   concluir, reatribuir, apagar e validações — no servidor real. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { subirServidor, PESSOAS, U } = require('./servidor-falso.cjs');

const ANA = PESSOAS.atendente.id, BRUNO = PESSOAS.atendente2.id;
const LEAD = U(201), CLI = U(202);

test('tarefas: criar, minhas, da ficha, concluir, permissões, apagar e validação', async () => {
  const s = await subirServidor({ tabelas: {
    clientes: [{ id: CLI, nome: 'Cliente Fictício' }],
    leads: [{ id: LEAD, cliente_id: CLI, nome: 'Lead Fictício', status: 'orcamento', created_at: new Date().toISOString() }],
  } });
  try {
    const em = h => new Date(Date.now() + h * 3600_000).toISOString();
    // validação
    for (const ruim of [{}, { titulo: '   ' }, { titulo: 'x'.repeat(201) }, { titulo: 'ok', prioridade: 7 }, { titulo: 'ok', vence_em: 'amanhã' },
      { titulo: 'ok', vence_em: em(24 * 500) }, { titulo: 'ok', lead_id: 'nao-uuid' }, { titulo: 'ok', responsavel_id: PESSOAS.agenda.id }]) {
      assert.equal((await s.req('atendente', '/api/tarefas', { body: ruim })).status, 400, JSON.stringify(ruim).slice(0, 60));
    }
    assert.equal((await s.req('atendente', '/api/tarefas', { body: { titulo: 'ok', lead_id: U(999) } })).status, 404);
    // criar para mim, ligada ao lead (o cliente vem do lead)
    const t1 = await s.req('atendente', '/api/tarefas', { body: { titulo: '  Ligar   para confirmar  ', lead_id: LEAD, vence_em: em(-1), prioridade: 1 } });
    assert.equal(t1.status, 201);
    assert.equal(t1.corpo.titulo, 'Ligar para confirmar'); assert.equal(t1.corpo.responsavel_id, ANA); assert.equal(t1.corpo.criado_por, ANA);
    assert.equal(t1.corpo.cliente_id, CLI); assert.equal(t1.corpo.origem, 'crm'); assert.equal(t1.corpo.atrasada, true);
    // criar para o colega
    const t2 = await s.req('atendente', '/api/tarefas', { body: { titulo: 'Mandar orçamento', responsavel_id: BRUNO, vence_em: em(5) } });
    assert.equal(t2.corpo.responsavel_id, BRUNO);
    const t3 = await s.req('atendente2', '/api/tarefas', { body: { titulo: 'Sem prazo', responsavel_id: 'eu' } });
    assert.equal(t3.corpo.responsavel_id, BRUNO);
    // listas
    const minhas = (await s.req('atendente', '/api/tarefas?minhas=1')).corpo;
    assert.equal(minhas.tarefas.length, 1); assert.equal(minhas.contagem.atrasadas, 1); assert.equal(minhas.contagem.hoje, 1);
    assert.equal(minhas.tarefas[0].lead.nome, 'Lead Fictício'); assert.equal(minhas.tarefas[0].responsavel.nome, 'Ana Vendedora');
    const doBruno = (await s.req('atendente2', '/api/tarefas?minhas=1')).corpo.tarefas;
    assert.deepEqual(doBruno.map(t => t.titulo), ['Mandar orçamento', 'Sem prazo'], 'prazo mais perto primeiro, sem prazo depois');
    assert.equal((await s.req('gestor', `/api/tarefas?lead=${LEAD}`)).corpo.tarefas.length, 1);
    assert.equal((await s.req('gestor', `/api/tarefas?cliente=${CLI}`)).corpo.tarefas.length, 1);
    assert.equal((await s.req('gestor', '/api/tarefas?lead=xyz')).status, 400);
    assert.equal((await s.req('gestor', '/api/tarefas?status=talvez')).status, 400);
    // permissões: Bruno não mexe na tarefa da Ana; gestor mexe
    assert.equal((await s.req('atendente2', `/api/tarefas/${t1.corpo.id}`, { method: 'PATCH', body: { status: 'feita' } })).status, 403);
    // Ana conclui a dela: concluida_por = Ana (o gatilho não vê auth.uid() no servidor)
    const feita = await s.req('atendente', `/api/tarefas/${t1.corpo.id}`, { method: 'PATCH', body: { status: 'feita' } });
    assert.equal(feita.status, 200); assert.equal(feita.corpo.concluida_por, ANA); assert.equal(feita.corpo.atrasada, false);
    assert.equal((await s.req('atendente', `/api/tarefas/${t1.corpo.id}`, { method: 'PATCH', body: { status: 'quase' } })).status, 400);
    assert.equal((await s.req('atendente', `/api/tarefas/${t1.corpo.id}`, { method: 'PATCH', body: {} })).status, 400);
    // quem criou pode reatribuir; vai para a auditoria
    assert.equal((await s.req('atendente', `/api/tarefas/${t2.corpo.id}`, { method: 'PATCH', body: { responsavel_id: 'eu' } })).corpo.responsavel_id, ANA);
    assert.ok(s.db.auditoria.some(a => a.acao === 'reatribuir_tarefa'));
    assert.equal((await s.req('gestor', `/api/tarefas/${t3.corpo.id}`, { method: 'PATCH', body: { titulo: 'Sem prazo (gestor)' } })).status, 200);
    // listas por situação
    assert.equal((await s.req('atendente', '/api/tarefas?minhas=1&status=feita')).corpo.tarefas.length, 1);
    assert.equal((await s.req('atendente', '/api/tarefas?minhas=1&status=todas')).corpo.tarefas.length, 2);
    // apagar: quem criou ou gestor
    assert.equal((await s.req('atendente', `/api/tarefas/${t3.corpo.id}`, { method: 'DELETE' })).status, 403);
    assert.equal((await s.req('atendente2', `/api/tarefas/${t3.corpo.id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await s.req('gestor', `/api/tarefas/${t2.corpo.id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await s.req('gestor', `/api/tarefas/${t2.corpo.id}`)).status, 404);
    assert.equal(s.db.auditoria.filter(a => a.acao === 'apagar_tarefa').length, 2);
    assert.equal((await s.req('gestor', '/api/tarefas/abc', { method: 'PATCH', body: { titulo: 'x' } })).status, 400);
    // papel agenda e sem app não chegam às tarefas
    assert.equal((await s.req('agenda', '/api/tarefas?minhas=1')).status, 403);
    assert.equal((await s.req('semApp', '/api/tarefas?minhas=1')).status, 403);
  } finally { await s.fechar(); }
});
