/* ============================================================
   IndyCar CRM — números do CRM em funções puras (testáveis)
   Usado por: "Pergunte ao CRM" (JSON agregado e seguro), triagem
   de leads parados e resumo semanal/mensal com IA.
   Nenhuma função aqui fala com o banco: recebem listas prontas.
   ============================================================ */
'use strict';

const DIA = 864e5;
const STATUSES = ['novo', 'contato', 'orcamento', 'agendado', 'em_servico', 'concluido', 'perdido'];
const ORIGENS = ['meta', 'google', 'indicacao', 'organico', 'whatsapp', 'passagem', 'telefone'];
const FATURAMENTO = new Set(['concluido', 'perdido']);   // mexem em faturamento: sempre clique

const n = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = v => Math.round(n(v) * 100) / 100;
const mesDe = iso => String(iso || '').slice(0, 7);
const ts = iso => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : NaN; };
const diasDesde = (iso, agora) => { const t = ts(iso); return Number.isFinite(t) ? Math.max(0, Math.floor((agora - t) / DIA)) : null; };
const corta = (s, m) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > m ? t.slice(0, m - 1) + '…' : t; };
const fechamento = l => l.closed_at || l.updated_at || l.created_at;

/** Meses AAAA-MM de trás para frente, a partir do mês de `agora`. */
function ultimosMeses(agora, qtd) {
  const d = new Date(agora), out = [];
  for (let i = 0; i < qtd; i++) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(x.toISOString().slice(0, 7));
  }
  return out;
}

/** Estatística de um intervalo [desde, ate): entrada, ganhos, perdas, faturamento. */
function statsPeriodo(leads, desde, ate) {
  const dentro = iso => { const t = ts(iso); return t >= desde && t < ate; };
  const entrada = leads.filter(l => dentro(l.created_at));
  const fechados = leads.filter(l => FATURAMENTO.has(l.status) && dentro(fechamento(l)));
  const ganhos = fechados.filter(l => l.status === 'concluido');
  const perdidos = fechados.filter(l => l.status === 'perdido');
  const faturamento = r2(ganhos.reduce((s, l) => s + n(l.valor_pago), 0));
  const porOrigem = ORIGENS.map(o => ({
    origem: o,
    leads: entrada.filter(l => l.origem === o).length,
    ganhos: ganhos.filter(l => l.origem === o).length,
    perdidos: perdidos.filter(l => l.origem === o).length,
    faturamento: r2(ganhos.filter(l => l.origem === o).reduce((s, l) => s + n(l.valor_pago), 0)),
  })).filter(x => x.leads || x.ganhos || x.perdidos);
  const porStatus = Object.fromEntries(STATUSES.map(s => [s, entrada.filter(l => l.status === s).length]));
  return {
    total: entrada.length, ganhos: ganhos.length, perdidos: perdidos.length, faturamento,
    ticket: ganhos.length ? r2(faturamento / ganhos.length) : 0,
    conversao: fechados.length ? Math.round((ganhos.length / fechados.length) * 1000) / 10 : 0,
    emAberto: r2(leads.filter(l => !FATURAMENTO.has(l.status)).reduce((s, l) => s + n(l.valor_orcado), 0)),
    porOrigem, porStatus,
  };
}

/**
 * Leads parados que merecem atenção. Regras simples e explicáveis; a IA
 * só escreve a proposta em cima delas (e a triagem funciona sem IA).
 */
function candidatosTriagem(leads, agora, { dias = 3, servicoVelho = 7, limite = 30 } = {}) {
  const out = [];
  for (const l of leads) {
    const parado = diasDesde(l.updated_at || l.created_at, agora);
    if (parado == null) continue;
    let regra = null;
    if ((l.status === 'novo' || l.status === 'contato') && parado >= dias) regra = 'parado';
    else if (l.status === 'orcamento' && parado >= dias) regra = 'orcamento_sem_resposta';
    else if (l.status === 'agendado' && parado >= servicoVelho * 2) regra = 'agendado_velho';
    else if (l.status === 'em_servico' && parado >= servicoVelho) regra = 'servico_velho';
    if (regra) out.push({ lead: l, regra, dias: parado });
  }
  // mais parado primeiro; orçamento e serviço velho (dinheiro na mesa) desempatam
  const peso = { servico_velho: 3, orcamento_sem_resposta: 2, agendado_velho: 1, parado: 0 };
  return out.sort((a, b) => b.dias - a.dias || peso[b.regra] - peso[a.regra]).slice(0, limite);
}

/** Proposta padrão de cada regra — usada quando a IA está fora ou não respondeu. */
function propostaPadrao({ lead, regra, dias }) {
  const nome = String(lead.nome || '').split(' ')[0] || 'tudo bem';
  switch (regra) {
    case 'orcamento_sem_resposta':
      return { acao: 'cobrar_orcamento', prioridade: dias >= 7 ? 'alta' : 'media', novo_status: null, motivo_perda: null,
        justificativa: `Orçamento sem resposta há ${dias} dias.`,
        texto_mensagem: `Oi, ${nome}! Aqui é da IndyCar. Conseguiu dar uma olhada no orçamento? Se quiser, tiro qualquer dúvida e já deixo um horário reservado pra você.` };
    case 'servico_velho':
      return { acao: 'mover_status', prioridade: 'alta', novo_status: 'concluido', motivo_perda: null, texto_mensagem: null,
        justificativa: `Em serviço há ${dias} dias: confira se já foi entregue e conclua.` };
    case 'agendado_velho':
      return { acao: 'ligar', prioridade: 'media', novo_status: null, motivo_perda: null, texto_mensagem: null,
        justificativa: `Agendado há ${dias} dias sem novidade: confirme se veio.` };
    default:
      return { acao: dias >= 30 ? 'marcar_perdido' : 'mensagem', prioridade: dias >= 14 ? 'baixa' : 'media', novo_status: null,
        motivo_perda: dias >= 30 ? 'Sem resposta há mais de 30 dias' : null,
        justificativa: `Sem andamento há ${dias} dias.`,
        texto_mensagem: dias >= 30 ? null : `Oi, ${nome}! Aqui é da IndyCar. Ainda posso te ajudar com o seu carro? Fazemos um diagnóstico digital gratuito, leva uns 30 minutos.` };
  }
}

/**
 * JSON agregado para "Pergunte ao CRM". Só contagens, métricas e listas
 * curtas de leads (id, nome, status, origem, serviço, dias). Sem telefone,
 * sem observações livres. A IA responde com base SÓ nisto.
 */
function agregadoParaPergunta({ leads = [], conversas = [], envios = [], orcamentos = [], agendamentos = [] }, agora) {
  const hoje = new Date(agora).toISOString().slice(0, 10);
  const meses = ultimosMeses(agora, 6);
  const item = l => ({ id: l.id, nome: corta(l.nome, 60), status: l.status, origem: l.origem,
    servico: corta(l.servico, 60) || null, entrou: String(l.created_at || '').slice(0, 10),
    dias_parado: diasDesde(l.updated_at || l.created_at, agora) });

  const porMes = [];
  for (const mes of meses) for (const o of ORIGENS) {
    const entraram = leads.filter(l => mesDe(l.created_at) === mes && l.origem === o).length;
    const ganhos = leads.filter(l => l.status === 'concluido' && l.origem === o && mesDe(fechamento(l)) === mes);
    const perderam = leads.filter(l => l.status === 'perdido' && l.origem === o && mesDe(fechamento(l)) === mes).length;
    if (entraram || ganhos.length || perderam) porMes.push({ mes, origem: o, entraram, fecharam: ganhos.length, perderam,
      faturamento: r2(ganhos.reduce((s, l) => s + n(l.valor_pago), 0)) });
  }

  const abertos = leads.filter(l => !FATURAMENTO.has(l.status));
  const esperandoTodos = leads.filter(l => l.status === 'orcamento').map(item).sort((a, b) => a.dias_parado - b.dias_parado);
  const esperandoOrcamento = esperandoTodos.slice(0, 100);
  const paradosTodos = abertos.filter(l => ['novo', 'contato'].includes(l.status)).map(item)
    .filter(x => x.dias_parado >= 3).sort((a, b) => a.dias_parado - b.dias_parado);
  const parados = paradosTodos.slice(0, 100);
  // contagens exatas (as listas são cortadas; os números não)
  const contar = (lista, faixas) => ({ total: lista.length,
    por_origem: Object.fromEntries(ORIGENS.map(o => [o, lista.filter(x => x.origem === o).length]).filter(([, q]) => q)),
    por_dias: Object.fromEntries(faixas.map(([rot, min, max]) => [rot, lista.filter(x => x.dias_parado >= min && x.dias_parado <= max).length])) });
  const FAIXAS = [['3_a_7_dias', 3, 7], ['8_a_30_dias', 8, 30], ['mais_de_30_dias', 31, 1e9]];
  const recentes = [...leads].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 40).map(item);
  const mesAtual = meses[0];
  const fechadosMes = leads.filter(l => l.status === 'concluido' && mesDe(fechamento(l)) === mesAtual).map(item).slice(0, 60);
  const perdidosMes = leads.filter(l => l.status === 'perdido' && mesDe(fechamento(l)) === mesAtual).map(item).slice(0, 60);
  const emServico = leads.filter(l => l.status === 'em_servico').map(item).slice(0, 40);
  const agendados = leads.filter(l => l.status === 'agendado').map(item).slice(0, 40);

  const d30 = agora - 30 * DIA;
  const conv30 = conversas.filter(c => ts(c.ultima_mensagem_em || c.created_at) >= d30);
  const tempos = conv30.map(c => (ts(c.primeira_resposta_em) - ts(c.aberta_em || c.created_at)) / 6e4)
    .filter(m => Number.isFinite(m) && m >= 0 && m < 7 * 24 * 60);
  const env30 = envios.filter(e => ts(e.enviado_em || e.created_at) >= d30);
  const fut7 = agendamentos.filter(a => { const t = ts(a.data + 'T12:00:00'); return t >= agora - DIA && t <= agora + 7 * DIA; });

  return {
    hoje, mes_atual: mesAtual, mes_anterior: meses[1],
    observacao: 'Datas em AAAA-MM-DD. "fecharam" = status concluido no mês do fechamento. Valores em reais. Listas de leads vêm cortadas (mais recentes primeiro); para contar use os campos *_contagem e por_status.',
    leads: {
      total: leads.length,
      abertos: abertos.length,
      por_status: Object.fromEntries(STATUSES.map(s => [s, leads.filter(l => l.status === s).length])),
      por_origem: Object.fromEntries(ORIGENS.map(o => [o, leads.filter(l => l.origem === o).length]).filter(([, q]) => q)),
      por_mes_e_origem: porMes,
      esperando_orcamento_contagem: contar(esperandoTodos, [['0_a_2_dias', 0, 2], ...FAIXAS]),
      esperando_orcamento: esperandoOrcamento,
      parados_contagem: contar(paradosTodos, FAIXAS),
      parados_novo_ou_contato: parados,
      agendados, em_servico: emServico,
      fechados_no_mes_atual: fechadosMes,
      perdidos_no_mes_atual: perdidosMes,
      recentes,
    },
    atendimento: {
      conversas_ultimos_30_dias: conv30.length,
      aguardando_consultor_agora: conversas.filter(c => c.aguardando_consultor).length,
      tempo_medio_primeira_resposta_min: tempos.length ? Math.round(tempos.reduce((s, x) => s + x, 0) / tempos.length) : null,
      fechou_30_dias: conv30.filter(c => c.desfecho === 'fechou').length,
      nao_fechou_30_dias: conv30.filter(c => c.desfecho === 'nao_fechou').length,
    },
    comunicar: {
      enviadas_30_dias: env30.filter(e => e.status === 'enviado').length,
      responderam_30_dias: env30.filter(e => e.respondido_em).length,
      agendaram_pela_mensagem_30_dias: env30.filter(e => e.agendou_depois_id).length,
      na_fila: envios.filter(e => e.status === 'pendente' || e.status === 'agendado').length,
    },
    orcador: {
      total: orcamentos.length,
      enviados: orcamentos.filter(o => o.enviado_em).length,
      aprovados: orcamentos.filter(o => o.status === 'aprovado').length,
      recusados: orcamentos.filter(o => o.status === 'recusado').length,
      esperando_resposta: orcamentos.filter(o => o.status === 'enviado').length,
    },
    agenda: {
      proximos_7_dias: fut7.filter(a => !['cancelado', 'nao_veio'].includes(a.status)).length,
      faltas_30_dias: agendamentos.filter(a => a.status === 'nao_veio' && ts(a.data + 'T12:00:00') >= d30).length,
    },
  };
}

/** Ids de lead presentes no agregado (para validar o que a IA cita). */
function idsDoAgregado(ag) {
  const ids = new Map();
  for (const k of ['esperando_orcamento', 'parados_novo_ou_contato', 'agendados', 'em_servico', 'fechados_no_mes_atual', 'perdidos_no_mes_atual', 'recentes'])
    for (const l of ag.leads[k] || []) ids.set(l.id, l);
  return ids;
}

/** Extras do resumo: Comunicar, Atendimento e Orçador no período. */
function extrasResumo({ conversas = [], envios = [], orcamentos = [] }, desde, ate) {
  const dentro = iso => { const t = ts(iso); return t >= desde && t < ate; };
  const conv = conversas.filter(c => dentro(c.aberta_em || c.created_at));
  const tempos = conv.map(c => (ts(c.primeira_resposta_em) - ts(c.aberta_em || c.created_at)) / 6e4)
    .filter(m => Number.isFinite(m) && m >= 0 && m < 7 * 24 * 60);
  const env = envios.filter(e => dentro(e.enviado_em || e.created_at));
  const orc = orcamentos.filter(o => dentro(o.enviado_em || o.created_at));
  return {
    atendimento: {
      conversasNovas: conv.length,
      tempoMedioPrimeiraRespostaMin: tempos.length ? Math.round(tempos.reduce((s, x) => s + x, 0) / tempos.length) : null,
      semResposta: conv.filter(c => !c.primeira_resposta_em).length,
      fechou: conv.filter(c => c.desfecho === 'fechou').length,
      naoFechou: conv.filter(c => c.desfecho === 'nao_fechou').length,
    },
    comunicar: {
      enviadas: env.filter(e => e.status === 'enviado').length,
      respostas: env.filter(e => e.respondido_em).length,
      agendaramPelaMensagem: env.filter(e => e.agendou_depois_id).length,
      falharam: env.filter(e => e.status === 'erro' || e.status === 'falhou').length,
    },
    orcador: {
      enviados: orc.filter(o => o.enviado_em).length,
      aprovados: orc.filter(o => o.status === 'aprovado').length,
      recusados: orc.filter(o => o.status === 'recusado').length,
      valorAprovado: r2(orc.filter(o => o.status === 'aprovado').reduce((s, o) => s + n(o.total), 0)),
    },
  };
}

module.exports = {
  STATUSES, ORIGENS, FATURAMENTO,
  statsPeriodo, candidatosTriagem, propostaPadrao, agregadoParaPergunta, idsDoAgregado, extrasResumo,
  ultimosMeses, diasDesde,
};
