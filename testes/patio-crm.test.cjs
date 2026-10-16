/* Pátio + Área do Cliente (16/10/2026): passagens pelo pátio e indicações no CRM.
   Banco em memória (ia-fake-sb) — nada sai para a rede. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/patio-crm');
const { criarContexto, paraIA } = require('../lib/contexto-lead');
const U = require('../public/crm-utils');
const { criarFakeSb } = require('./ia-fake-sb.cjs');

const CLI = '11111111-1111-4111-8111-111111111111';
const AMIGO = '11111111-1111-4111-8111-222222222222';
const LEAD = '22222222-2222-4222-8222-000000000001';
const LEAD_IND = '22222222-2222-4222-8222-000000000002';
const OS = '44444444-4444-4444-8444-444444444444';

function tabelas() {
  return {
    clientes: [
      { id: CLI, nome: 'Maria Souza', telefone: '12999990001', telefone_e164: '12999990001', created_at: '2026-01-01T00:00:00Z' },
      { id: AMIGO, nome: 'Pedro Amigo', telefone: '12988887777', telefone_e164: '12988887777', created_at: '2026-10-10T00:00:00Z' },
    ],
    leads: [
      { id: LEAD, cliente_id: CLI, nome: 'Maria Souza', telefone: '12999990001', status: 'em_servico', origem: 'whatsapp', servico: 'Freio', created_at: '2026-10-10T10:00:00Z', updated_at: '2026-10-15T10:00:00Z' },
      { id: LEAD_IND, cliente_id: AMIGO, nome: 'Pedro Amigo', telefone: '12988887777', status: 'novo', origem: 'indicacao', utm_source: 'area_cliente', created_at: '2026-10-14T10:00:00Z', updated_at: '2026-10-14T10:00:00Z' },
    ],
    patio_os: [{ id: OS, numero: 57, etapa: 'entregue', cliente_id: CLI, lead_id: LEAD, veiculo: 'HB20', placa: 'ABC1D23', servico: 'Freio', created_at: '2026-10-15T11:00:00Z', entregue_em: '2026-10-16T17:00:00Z' }],
    patio_eventos: [
      { os_id: OS, tipo: 'etapa', etapa_de: null, etapa_para: 'recebido', created_at: '2026-10-15T11:00:00Z' },
      { os_id: OS, tipo: 'etapa', etapa_de: 'recebido', etapa_para: 'diagnostico', created_at: '2026-10-15T11:30:00Z' },
      { os_id: OS, tipo: 'etapa', etapa_de: 'pronto', etapa_para: 'entregue', created_at: '2026-10-16T17:00:00Z' },
      { os_id: OS, tipo: 'nota', texto: 'nota interna', created_at: '2026-10-15T12:00:00Z' },
    ],
    patio_extras: [
      { id: 'x1', os_id: OS, descricao: 'Disco de freio', valor: 680, status: 'aprovado', decidido_em: '2026-10-15T14:00:00Z', created_at: '2026-10-15T13:00:00Z' },
      { id: 'x2', os_id: OS, descricao: 'Palheta', valor: 60.5, status: 'recusado', motivo_recusa: 'depois', decidido_em: '2026-10-15T14:05:00Z', created_at: '2026-10-15T13:00:00Z' },
    ],
    indicacoes: [{ id: 'i1', indicado_por: CLI, nome: 'Pedro Amigo', telefone: '12988887777', status: 'agendou', lead_id: LEAD_IND, created_at: '2026-10-14T09:00:00Z' }],
  };
}

test('lê passagens pelo pátio (eventos e extras) e as indicações feitas pelo cliente', async () => {
  const sb = criarFakeSb(tabelas());
  const r = await P.lerPatioEIndicacoes(sb, { clienteId: CLI, leadIds: [LEAD] });
  assert.equal(r.patio.length, 1);
  assert.equal(r.patio[0].eventos.length, 3, 'só etapa/cliente; nota interna fica de fora');
  assert.equal(r.patio[0].extras.length, 2);
  assert.match(r.patio[0].abrir, /\/\?os=4444/);
  assert.equal(r.indicacoes.feitas[0].nome, 'Pedro Amigo');
  assert.deepEqual(r.indicacoes.recebidas, []);
});

test('linha do tempo: recebido, etapas, extra APROVADO/recusado com valor; sem duplicar o "recebido"', () => {
  const t = tabelas();
  const pi = { patio: [{ ...t.patio_os[0], eventos: t.patio_eventos.filter(e => e.tipo === 'etapa'), extras: t.patio_extras }], indicacoes: { feitas: t.indicacoes, recebidas: [] } };
  const it = P.eventosParaLinhaDoTempo(pi);
  const titulos = it.map(i => i.titulo);
  assert.equal(titulos.filter(x => /carro recebido/.test(x)).length, 1);
  assert.ok(titulos.includes('Pátio · diagnóstico (ordem nº 57)'));
  assert.ok(titulos.includes('Pátio · entregue (ordem nº 57)'));
  const ap = it.find(i => /APROVADO/.test(i.titulo)), rc = it.find(i => /recusado/.test(i.titulo));
  assert.match(ap.detalhe, /Disco de freio · R\$\s?680,00/);
  assert.match(rc.detalhe, /Palheta · R\$\s?60,50 · motivo: depois/);
  assert.ok(it.some(i => i.tipo === 'indicacao' && i.titulo === 'Indicou Pedro Amigo'));
  // e o formato serve direto para CrmUtils.linhaDoTempo
  assert.ok(U.linhaDoTempo({ eventos: it }).some(i => i.tipo === 'patio'));
});

test('lead indicado: "veio por indicação de" com o nome de quem indicou (pelo lead_id ou pelo telefone)', async () => {
  const sb = criarFakeSb(tabelas());
  const r = await P.lerPatioEIndicacoes(sb, { clienteId: AMIGO, leadIds: [LEAD_IND] });
  assert.equal(r.indicacoes.recebidas[0].indicado_por_nome, 'Maria Souza');
  const t = tabelas(); t.indicacoes[0].lead_id = null;
  const r2 = await P.lerPatioEIndicacoes(criarFakeSb(t), { clienteId: AMIGO, leadIds: [LEAD_IND], telefone: '(12) 98888-7777' });
  assert.equal(r2.indicacoes.recebidas.length, 1, 'acha pelo telefone');
  assert.match(P.eventosParaLinhaDoTempo(r2).find(i => i.tipo === 'indicacao').titulo, /Veio por indicação de Maria Souza/);
});

test('contexto do lead (tela) traz patio, indicações e eventos; recorte da IA não tem R$', async () => {
  const ctx = await criarContexto({ sb: criarFakeSb(tabelas()) }).montar({ leadId: LEAD });
  assert.equal(ctx.patio.length, 1);
  assert.ok(ctx.eventos.some(e => /APROVADO/.test(e.titulo)));
  const ia = paraIA(ctx);
  assert.deepEqual(ia.passagens_patio[0], { etapa: 'entregue', entrou_em: '2026-10-15', entregue_em: '2026-10-16', extras_aprovados: 1, extras_recusados: 1, extras_pendentes: 0 });
  assert.equal(ia.indicou, 1);
  assert.doesNotMatch(JSON.stringify(ia.passagens_patio), /680|R\$/);
});

test('Pátio fora do ar não derruba a ficha do lead', async () => {
  const sb = criarFakeSb(tabelas());
  sb.falhar?.(['patio_os', 'indicacoes']);
  const ctx = await criarContexto({ sb }).montar({ leadId: LEAD });
  assert.ok(ctx.lead);
  assert.ok(Array.isArray(ctx.eventos));
});

test('filtro de origem: "Área do Cliente" (utm_source) e "Indicação" (origem ou indicação ligada ao lead)', () => {
  const l1 = { id: 'a', origem: 'whatsapp', utm_source: 'area_cliente' };
  const l2 = { id: 'b', origem: 'whatsapp' };
  const l3 = { id: 'c', origem: 'indicacao' };
  const ind = new Map([['b', { indicado_por_nome: 'Maria' }]]);
  assert.equal(U.casaOrigem(l1, 'area_cliente'), true);
  assert.equal(U.casaOrigem(l2, 'area_cliente', ind), false);
  assert.equal(U.casaOrigem(l2, 'indicacao', ind), true, 'gerado por indicação da Área');
  assert.equal(U.casaOrigem(l3, 'indicacao'), true);
  assert.equal(U.casaOrigem(l1, 'indicacao', ind), false);
  assert.equal(U.casaOrigem(l1, ''), true);
  assert.equal(U.casaOrigem(l2, 'whatsapp'), true);
  assert.equal(P.ehDaArea(l1), true);
});
