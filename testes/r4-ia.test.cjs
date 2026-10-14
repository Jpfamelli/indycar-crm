/* Rodada 4: ajustes da IA do CRM depois da avaliação com 10 leads reais (modo sugerir).
   IA falsa roteirizada e banco em memória — nada real, nada de API. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarFakeSb, criarIAFalsa } = require('./ia-fake-sb.cjs');
const { criarIACrm, limparTextoCliente, horasEmDias, SYSTEM_BASE } = require('../lib/ia-crm');
const { sinaisParaIA } = require('../lib/contexto-lead');

const AGORA = Date.parse('2026-10-14T15:00:00Z');
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('texto ao cliente: nome da oficina padronizado e "Oi, Família!" vira um oi simples', () => {
  assert.equal(limparTextoCliente('Oi, Família! Aqui é da Indy Car.'), 'Oi! Aqui é da IndyCar.');
  assert.equal(limparTextoCliente('Aqui é da Indycar e da INDY-CAR'), 'Aqui é da IndyCar e da IndyCar');
  assert.equal(limparTextoCliente('Oi Pedro, tudo bem?'), 'Oi Pedro, tudo bem?', 'nome de gente fica');
  assert.equal(limparTextoCliente('Bom dia, cliente. Tudo certo?'), 'Bom dia! Tudo certo?');
});

test('tempo em dias: "995h" vira "41 dias", mas 17h30 e 8h ficam', () => {
  assert.equal(horasEmDias('sem resposta há 995h (41 dias)'), 'sem resposta há 41 dias (41 dias)');
  assert.equal(horasEmDias('faz 612 horas'), 'faz 26 dias');
  assert.equal(horasEmDias('atende das 8h às 17h30, faz 20h'), 'atende das 8h às 17h30, faz 20h');
});

test('sinais para a IA: horas viram dias acima de 48 h e etapa desatualizada aparece', () => {
  const s = sinaisParaIA({ horasDesdeUltimaMensagem: 995, horasDesdeUltimaDoCliente: 30, temHorarioFuturo: false }, { status: 'agendado' });
  assert.equal(s.diasDesdeUltimaMensagem, 41); assert.equal('horasDesdeUltimaMensagem' in s, false);
  assert.equal(s.horasDesdeUltimaDoCliente, 30, 'menos de 48 h continua em horas');
  assert.match(s.etapaDesatualizada, /agendado/);
  assert.equal(sinaisParaIA({ temHorarioFuturo: true }, { status: 'agendado' }).etapaDesatualizada, undefined);
});

test('regras novas estão no prompt da IA', () => {
  for (const r of [/3 frases curtas/, /"IndyCar"/, /Família/, /dias/, /mover_status/]) assert.match(SYSTEM_BASE, r);
});

test('próxima ação real (IA falsa): manda dias e etapa desatualizada; justificativa e texto saem limpos', async () => {
  const CLI = U(1), L = U(11), CV = U(21);
  const sb = criarFakeSb({
    ia_config: [{ id: true, ativo: true, modelo_rapido: 'r', modelo_forte: 'f', autonomia: 'sugerir', limite_chamadas_dia: 50 }], ia_acoes: [],
    clientes: [{ id: CLI, nome: 'Família Teste', telefone: '5512900000001', telefone_e164: '12900000001', aceita_mensagens: true, created_at: '2026-01-01T10:00:00Z' }],
    leads: [{ id: L, cliente_id: CLI, nome: 'Família Teste', telefone: '5512900000001', status: 'agendado', origem: 'whatsapp', valor_orcado: 0, valor_pago: 0, observacoes: '', created_at: '2026-08-01T10:00:00Z', updated_at: '2026-09-01T10:00:00Z' }],
    conversas: [{ id: CV, cliente_id: CLI, telefone_e164: '12900000001', created_at: '2026-08-01T10:00:00Z' }],
    whatsapp_mensagens: [{ id: U(51), conversa_id: CV, direcao: 'entrada', corpo: 'Vou levar na sexta', created_at: '2026-09-03T12:00:00Z' }],
    agendamentos: [{ id: U(61), cliente_id: CLI, lead_id: L, data: '2026-09-10', hora: '09:00:00', status: 'nao_veio' }],
    etapas_funil: [], v_cliente_360: [], orc_orcamentos: [], posvenda_envios: [], posvenda_respostas: [], catalogo_servicos: [],
  });
  const ia = criarIAFalsa([{ entrada: { acao: 'mensagem', prioridade: 'alta', justificativa: 'Sem resposta há 995h.', texto_mensagem: 'Oi, Família! Aqui é da Indy Car. Vamos remarcar?', novo_status: null, motivo_perda: null, tarefa_titulo: null, tarefa_prazo_horas: null } }]);
  const crm = criarIACrm({ sb, store: { getLead: async id => sb.db.leads.find(l => l.id === id) }, clienteIA: ia, agora: () => AGORA });
  const r = await crm.proximaAcao(L, { id: U(41), papel: 'atendente' });
  const enviado = ia.pedidos[0].messages[0].content;
  assert.match(enviado, /"diasDesdeUltimaMensagem":41/);
  assert.doesNotMatch(enviado, /horasDesdeUltimaMensagem/);
  assert.match(enviado, /etapaDesatualizada/);
  assert.equal(r.proposta.justificativa, 'Sem resposta há 41 dias.');
  assert.equal(r.proposta.texto_mensagem, 'Oi! Aqui é da IndyCar. Vamos remarcar?');
  assert.equal(r.automatico, false, 'modo sugerir não executa nada');
  assert.equal(sb.db.leads[0].status, 'agendado', 'lead intacto');
});
