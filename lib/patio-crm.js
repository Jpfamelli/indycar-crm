/* ============================================================
   IndyCar CRM — Pátio + Área do Cliente (16/10/2026)

   O IndyCar Pátio guarda cada passagem do carro pela oficina
   (patio_os), a linha do tempo dela (patio_eventos) e os serviços
   extras que o cliente aprova ou recusa pelo celular (patio_extras).
   A Área do Cliente grava as indicações de amigos (indicacoes).

   Aqui o CRM só LÊ (chave de serviço) para:
   - a linha do tempo do lead: passagens pelo pátio, etapas e extras
     aprovados/recusados com valor;
   - a ficha de quem indicou (indicações feitas) e do lead indicado
     ("veio por indicação de …").

   Puro + leitura injetável (sb) para testar com dublê.
   ============================================================ */
'use strict';

const PATIO_URL = 'https://indycar-patio.netlify.app';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ehUuid = v => UUID.test(String(v ?? ''));

const ETAPA = {
  recebido: 'carro recebido', diagnostico: 'diagnóstico', aguardando_aprovacao: 'aguardando aprovação',
  aguardando_peca: 'aguardando peça', em_execucao: 'em execução', teste: 'em teste', pronto: 'pronto para retirar',
  entregue: 'entregue', cancelado: 'cancelado',
};
const STATUS_INDICACAO = { nova: 'nova', contatada: 'já contatada', agendou: 'agendou', virou_cliente: 'virou cliente', descartada: 'descartada' };
const moeda = v => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Lê sem derrubar: erro vira lista vazia (o Pátio é extra na ficha, nunca bloqueia). */
async function lerSeguro(consulta) {
  try { const { data, error } = await consulta; return error ? [] : (data || []); } catch { return []; }
}

/**
 * Ordens do pátio (com eventos e extras) e indicações ligadas a este cliente/lead.
 *   clienteId: ordens do cliente e indicações FEITAS por ele
 *   leadIds:   ordens ligadas a esses leads e a indicação que GEROU o lead
 *   telefone:  acha a indicação que gerou o lead mesmo sem lead_id (só dígitos)
 */
async function lerPatioEIndicacoes(sb, { clienteId = null, leadIds = [], telefone = null } = {}) {
  const leads = (leadIds || []).filter(ehUuid);
  const cid = ehUuid(clienteId) ? clienteId : null;
  const SEL_OS = 'id,numero,etapa,etapa_em,cliente_id,lead_id,agendamento_id,veiculo,placa,servico,created_at,entregue_em';
  const [porCliente, porLead, feitas, recebidasLead, recebidasTel] = await Promise.all([
    cid ? lerSeguro(sb.from('patio_os').select(SEL_OS).eq('cliente_id', cid).order('created_at', { ascending: false }).limit(10)) : [],
    leads.length ? lerSeguro(sb.from('patio_os').select(SEL_OS).in('lead_id', leads).order('created_at', { ascending: false }).limit(10)) : [],
    cid ? lerSeguro(sb.from('indicacoes').select('id,indicado_por,nome,telefone,status,lead_id,created_at').eq('indicado_por', cid).order('created_at', { ascending: false }).limit(30)) : [],
    leads.length ? lerSeguro(sb.from('indicacoes').select('id,indicado_por,nome,telefone,status,lead_id,created_at').in('lead_id', leads).limit(5)) : [],
    telefone ? lerSeguro(sb.from('indicacoes').select('id,indicado_por,nome,telefone,status,lead_id,created_at').in('telefone', variantes(telefone)).limit(5)) : [],
  ]);
  const ordens = unicos([...porCliente, ...porLead]);
  const ids = ordens.map(o => o.id);
  const [eventos, extras] = ids.length ? await Promise.all([
    lerSeguro(sb.from('patio_eventos').select('os_id,tipo,etapa_de,etapa_para,texto,created_at').in('os_id', ids).in('tipo', ['etapa', 'cliente']).order('created_at', { ascending: true }).limit(300)),
    lerSeguro(sb.from('patio_extras').select('id,os_id,descricao,valor,status,urgencia,decidido_em,decidido_por,motivo_recusa,created_at').in('os_id', ids).limit(200)),
  ]) : [[], []];
  const recebidas = unicos([...recebidasLead, ...recebidasTel]).filter(i => !cid || i.indicado_por !== cid);
  // nome de quem indicou (para "veio por indicação de …")
  const quemIds = [...new Set(recebidas.map(i => i.indicado_por).filter(ehUuid))];
  const quem = quemIds.length ? await lerSeguro(sb.from('clientes').select('id,nome').in('id', quemIds)) : [];
  const nomeDe = new Map(quem.map(c => [c.id, c.nome]));
  return {
    patio: ordens.map(o => ({
      ...o, abrir: `${PATIO_URL}/?os=${o.id}`,
      eventos: eventos.filter(e => e.os_id === o.id),
      extras: extras.filter(e => e.os_id === o.id),
    })),
    indicacoes: {
      feitas,
      recebidas: recebidas.map(i => ({ ...i, indicado_por_nome: nomeDe.get(i.indicado_por) || null })),
    },
  };
}

function unicos(lista) {
  const vistos = new Set();
  return lista.filter(x => x && x.id && !vistos.has(x.id) && vistos.add(x.id));
}
/** Telefone em dígitos, com e sem 55 (indicacoes.telefone vem como a pessoa digitou, já limpo pelo app). */
function variantes(t) {
  let d = String(t ?? '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return d ? [d] : [];
  return [...new Set([d, '55' + d])];
}

/**
 * Itens da linha do tempo do lead (formato de CrmUtils.linhaDoTempo: tipo,
 * quando, titulo, detalhe). Tela do CRM: aqui o valor do extra aparece.
 */
function eventosParaLinhaDoTempo({ patio = [], indicacoes = {} } = {}) {
  const out = [];
  const add = (tipo, quando, titulo, detalhe = '') => { if (quando) out.push({ tipo, quando, titulo, detalhe }); };
  for (const o of patio) {
    const carro = [o.veiculo, o.placa].filter(Boolean).join(' · ');
    const num = o.numero ? ` (ordem nº ${o.numero})` : '';
    add('patio', o.created_at, `Pátio · carro recebido${num}`, [carro, o.servico].filter(Boolean).join(' · '));
    for (const e of o.eventos || []) {
      if (e.tipo !== 'etapa' || !e.etapa_para || e.etapa_para === 'recebido' && !e.etapa_de) continue;
      add('patio', e.created_at, `Pátio · ${ETAPA[e.etapa_para] || e.etapa_para}${num}`, e.etapa_de ? `antes: ${ETAPA[e.etapa_de] || e.etapa_de}` : '');
    }
    for (const x of o.extras || []) {
      if (x.status === 'aprovado' || x.status === 'recusado') {
        add('patio', x.decidido_em || x.created_at, `Pátio · extra ${x.status === 'aprovado' ? 'APROVADO' : 'recusado'} pelo cliente`,
          [x.descricao, x.valor != null ? moeda(x.valor) : '', x.status === 'recusado' && x.motivo_recusa ? `motivo: ${x.motivo_recusa}` : ''].filter(Boolean).join(' · '));
      } else if (x.status === 'pendente') {
        add('patio', x.created_at, 'Pátio · extra esperando o cliente', [x.descricao, x.valor != null ? moeda(x.valor) : ''].filter(Boolean).join(' · '));
      }
    }
  }
  for (const i of indicacoes.feitas || []) {
    add('indicacao', i.created_at, `Indicou ${i.nome}`, `Área do Cliente · ${STATUS_INDICACAO[i.status] || i.status}`);
  }
  for (const i of indicacoes.recebidas || []) {
    add('indicacao', i.created_at, `Veio por indicação${i.indicado_por_nome ? ` de ${i.indicado_por_nome}` : ''}`, `Área do Cliente · ${STATUS_INDICACAO[i.status] || i.status}`);
  }
  return out;
}

/** Recorte para a IA do CRM: sem valores em R$. */
function patioParaIA({ patio = [], indicacoes = {} } = {}) {
  return {
    passagens_patio: patio.slice(0, 5).map(o => ({
      etapa: o.etapa, entrou_em: String(o.created_at || '').slice(0, 10), entregue_em: String(o.entregue_em || '').slice(0, 10) || null,
      extras_aprovados: (o.extras || []).filter(x => x.status === 'aprovado').length,
      extras_recusados: (o.extras || []).filter(x => x.status === 'recusado').length,
      extras_pendentes: (o.extras || []).filter(x => x.status === 'pendente').length,
    })),
    indicou: (indicacoes.feitas || []).length,
    veio_por_indicacao: (indicacoes.recebidas || []).length > 0,
  };
}

/** Lead da Área do Cliente? (o app do cliente grava utm_source='area_cliente') */
const ehDaArea = l => String(l?.utm_source || '').toLowerCase() === 'area_cliente';

module.exports = { lerPatioEIndicacoes, eventosParaLinhaDoTempo, patioParaIA, ehDaArea, variantes, PATIO_URL, ETAPA };
