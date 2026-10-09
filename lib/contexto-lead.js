/* ============================================================
   IndyCar CRM — ficha completa de um lead/cliente para a IA
   Junta TUDO o que o ecossistema sabe sobre a pessoa: lead(s),
   cliente + v_cliente_360, conversa e últimas mensagens do
   WhatsApp, agendamentos, orçamentos do Orçador, mensagens do
   Comunicar (e respostas), satisfação e etapa do funil.

   Duas saídas:
   - montar()  → objeto completo para a TELA (com valores em R$);
   - paraIA()  → recorte sem dinheiro, sem ids desnecessários e com
                 textos cortados. A IA não vê preço e por isso não
                 tem como repetir/inventar preço para o cliente.
   ============================================================ */
'use strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ehUuid = v => UUID.test(String(v ?? ''));
const digitos = s => String(s ?? '').replace(/\D/g, '');
const DIA = 864e5;

/* Links de saída para os outros apps (podem ser trocados por variável). */
const BASES = {
  atendimento: process.env.CRM_URL_ATENDIMENTO || 'https://indycar-atendimento.onrender.com',
  agenda: process.env.CRM_URL_AGENDA || 'https://indycar-agendamentos.onrender.com',
  comunicar: process.env.CRM_URL_COMUNICAR || 'https://indycar-posvenda.onrender.com',
  orcador: process.env.CRM_URL_ORCADOR || 'https://indycar-orcador.netlify.app',
};

/** Telefone completo com 55 (formato que os apps aceitam no ?tel=). */
function telCompleto(t) {
  const d = digitos(t);
  if (d.length === 10 || d.length === 11) return '55' + d;
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d;
  return d || null;
}

/** Variações do telefone sem DDI, com e sem o nono dígito (como em telefone_e164). */
function variacoesE164(t) {
  let d = digitos(t);
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return [];
  const out = new Set([d]);
  if (d.length === 11 && d[2] === '9') out.add(d.slice(0, 2) + d.slice(3));
  if (d.length === 10) out.add(d.slice(0, 2) + '9' + d.slice(2));
  return [...out];
}

function links(telefone) {
  const tel = telCompleto(telefone);
  const q = tel ? `/?tel=${encodeURIComponent(tel)}` : '/';
  return {
    atendimento: BASES.atendimento + q,
    agenda: BASES.agenda + q,
    comunicar: BASES.comunicar + q,
    orcador: BASES.orcador + '/',
    ligar: tel ? `tel:+${tel}` : null,
  };
}

const dias = (iso, agora) => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? Math.max(0, Math.floor((agora - t) / DIA)) : null;
};
const horas = (iso, agora) => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? Math.max(0, Math.round((agora - t) / 36e5)) : null;
};
const corta = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};
const nDec = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Lê o resultado de uma consulta: erro vira exceção com contexto. */
async function ler(promessa, ctx) {
  const { data, error } = await promessa;
  if (error) throw new Error(`${ctx}: ${error.message || 'falha no banco'}`);
  return data;
}

function criarContexto({ sb, agora = () => Date.now() } = {}) {
  if (!sb) throw new Error('contexto-lead: banco não configurado');

  /** Encontra a conversa do cliente: pelo cliente_id; senão pelo telefone. */
  async function acharConversa(clienteId, telefone) {
    const campos = 'id,cliente_id,telefone,nome,status,etapa_id,etapa_em,etapa_por_ia,ia_ativa,aguardando_consultor,aguardando_desde,desfecho,ultima_mensagem_em,primeira_resposta_em,aberta_em,nao_lidas,atribuida_a';
    if (clienteId) {
      const r = await ler(sb.from('conversas').select(campos).eq('cliente_id', clienteId)
        .order('ultima_mensagem_em', { ascending: false }).limit(1), 'conversa');
      if (r && r[0]) return r[0];
    }
    const vs = variacoesE164(telefone);
    if (!vs.length) return null;
    const r = await ler(sb.from('conversas').select(campos).in('telefone_e164', vs)
      .order('ultima_mensagem_em', { ascending: false }).limit(1), 'conversa/telefone');
    return (r && r[0]) || null;
  }

  /**
   * Monta a ficha completa. Aceita { leadId } ou { clienteId } (ou telefone).
   * Devolve null quando nada é encontrado.
   */
  async function montar({ leadId, clienteId, telefone, limiteMensagens = 30 } = {}) {
    const t0 = agora();
    let lead = null;
    if (leadId) {
      if (!ehUuid(leadId)) throw Object.assign(new Error('Lead inválido.'), { status: 400 });
      lead = await ler(sb.from('leads').select('*').eq('id', leadId).maybeSingle(), 'lead');
      if (!lead) return null;
      clienteId = clienteId || lead.cliente_id || null;
      telefone = telefone || lead.telefone;
    }
    if (clienteId && !ehUuid(clienteId)) throw Object.assign(new Error('Cliente inválido.'), { status: 400 });

    let cliente = null;
    if (clienteId) {
      cliente = await ler(sb.from('clientes')
        .select('id,nome,telefone,telefone_e164,email,carro_modelo,carro_ano,placa,origem,observacoes,created_at,nascimento,aceita_mensagens')
        .eq('id', clienteId).maybeSingle(), 'cliente');
    } else if (telefone) {
      const vs = variacoesE164(telefone);
      if (vs.length) {
        const r = await ler(sb.from('clientes')
          .select('id,nome,telefone,telefone_e164,email,carro_modelo,carro_ano,placa,origem,observacoes,created_at,nascimento,aceita_mensagens')
          .in('telefone_e164', vs).limit(1), 'cliente/telefone');
        cliente = (r && r[0]) || null;
      }
    }
    if (!lead && !cliente) return null;
    telefone = telefone || cliente?.telefone;

    const cid = cliente?.id || null;
    const vazio = Promise.resolve({ data: [], error: null });
    const [leads, c360, agendamentos, orcamentos, envios, satisfacao, conversa] = await Promise.all([
      cid ? ler(sb.from('leads').select('id,nome,status,origem,servico,valor_orcado,valor_pago,created_at,updated_at,closed_at,observacoes')
        .eq('cliente_id', cid).order('created_at', { ascending: false }).limit(20), 'leads') : (lead ? [lead] : []),
      cid ? ler(sb.from('v_cliente_360').select('*').eq('id', cid).maybeSingle(), 'v_cliente_360') : null,
      cid ? ler(sb.from('agendamentos').select('id,data,hora,servico,veiculo,placa,status,valor,lead_id,compareceu,created_at')
        .eq('cliente_id', cid).order('data', { ascending: false }).limit(15), 'agendamentos') : [],
      ler(cid || leadId
        ? sb.from('orc_orcamentos').select('id,numero,status,total,enviado_em,visualizado_em,decidido_em,motivo_recusa,validade,lead_id,created_at,veiculo')
          .in(cid ? 'cliente_id' : 'lead_id', [cid || leadId]).order('created_at', { ascending: false }).limit(10)
        : vazio, 'orcamentos'),
      cid ? ler(sb.from('posvenda_envios').select('id,tipo,status,corpo,enviar_em,enviado_em,respondido_em,resposta,resposta_tipo,agendou_depois_id,motivo_pulado,created_at')
        .eq('cliente_id', cid).order('created_at', { ascending: false }).limit(10), 'comunicar') : [],
      cid ? ler(sb.from('posvenda_respostas').select('id,satisfeito,nota,comentario,created_at,origem')
        .eq('cliente_id', cid).order('created_at', { ascending: false }).limit(5), 'satisfacao') : [],
      acharConversa(cid, telefone),
    ]);

    // o lead pedido sempre aparece, mesmo que ainda não tenha cliente_id
    let listaLeads = leads || [];
    if (lead && !listaLeads.some(l => l.id === lead.id)) listaLeads = [lead, ...listaLeads];
    if (!lead) lead = listaLeads.find(l => !['concluido', 'perdido'].includes(l.status)) || listaLeads[0] || null;

    let mensagens = [], etapa = null;
    if (conversa) {
      const [msgs, et] = await Promise.all([
        ler(sb.from('whatsapp_mensagens').select('id,direcao,corpo,created_at,gerada_por_ia,anexo_mime,status')
          .eq('conversa_id', conversa.id).order('created_at', { ascending: false }).limit(limiteMensagens), 'mensagens'),
        conversa.etapa_id
          ? ler(sb.from('etapas_funil').select('id,nome,status_lead,cor,emoji,ganho,perda').eq('id', conversa.etapa_id).maybeSingle(), 'etapa')
          : null,
      ]);
      mensagens = (msgs || []).reverse();       // cronológico
      etapa = et || null;
    }

    const T = agora();
    const ultima = mensagens[mensagens.length - 1] || null;
    const ultimaEntrada = [...mensagens].reverse().find(m => m.direcao === 'entrada') || null;
    const orcPendente = (orcamentos || []).find(o => o.enviado_em && !o.decidido_em && !['aprovado', 'recusado', 'cancelado', 'expirado'].includes(o.status));
    const futuros = (agendamentos || []).filter(a => a.data && Date.parse(a.data + 'T23:59:59') >= T &&
      !['cancelado', 'nao_veio', 'concluido', 'nao_fechou'].includes(a.status));

    const sinais = {
      diasNaEtapa: lead ? dias(lead.updated_at || lead.created_at, T) : null,
      diasDesdeEntrada: lead ? dias(lead.created_at, T) : null,
      horasDesdeUltimaMensagem: ultima ? horas(ultima.created_at, T) : null,
      ultimaMensagemDe: ultima ? (ultima.direcao === 'entrada' ? 'cliente' : 'oficina') : null,
      clienteEsperandoResposta: !!(ultima && ultima.direcao === 'entrada'),
      horasDesdeUltimaDoCliente: ultimaEntrada ? horas(ultimaEntrada.created_at, T) : null,
      aguardandoConsultor: !!conversa?.aguardando_consultor,
      orcamentoPendenteDias: orcPendente ? dias(orcPendente.enviado_em, T) : null,
      temHorarioFuturo: futuros.length > 0,
      faltas: (agendamentos || []).filter(a => a.status === 'nao_veio').length,
      servicosConcluidos: (agendamentos || []).filter(a => a.status === 'concluido').length,
      aceitaMensagens: cliente ? cliente.aceita_mensagens : null,
      respondeuComunicar: (envios || []).some(e => e.respondido_em),
      insatisfeito: (satisfacao || []).some(s => s.satisfeito === false || (s.nota != null && s.nota <= 6)),
    };

    return {
      lead, leads: listaLeads, cliente, c360: c360 || null,
      conversa, etapa, mensagens,
      agendamentos: agendamentos || [], orcamentos: orcamentos || [],
      comunicar: envios || [], satisfacao: satisfacao || [],
      sinais,
      links: links(telefone),
      geradoEm: new Date(T).toISOString(),
      duracaoMs: T - t0,
    };
  }

  return { montar, acharConversa };
}

/**
 * Recorte para a IA: sem valores em R$, sem telefone, textos cortados.
 * O que vem do cliente continua sendo DADO (a cerca é posta por quem chama).
 */
function paraIA(ctx, { maxMensagens = 25 } = {}) {
  if (!ctx) return null;
  const l = ctx.lead, c = ctx.cliente;
  return {
    lead: l ? {
      nome: corta(l.nome, 80), status: l.status, origem: l.origem, servico: corta(l.servico, 120) || null,
      carro: corta(l.carro_modelo, 80) || null, placa: l.placa || null,
      tem_valor_orcado: nDec(l.valor_orcado) > 0,
      entrou_em: String(l.created_at || '').slice(0, 10), atualizado_em: String(l.updated_at || '').slice(0, 10),
      observacoes: corta(l.observacoes, 400) || null,
    } : null,
    outros_leads: (ctx.leads || []).filter(x => !l || x.id !== l.id).slice(0, 8)
      .map(x => ({ status: x.status, servico: corta(x.servico, 80) || null, entrou_em: String(x.created_at || '').slice(0, 10) })),
    cliente: c ? {
      nome: corta(c.nome, 80), carro: corta(c.carro_modelo, 80) || null, ano: c.carro_ano || null, placa: c.placa || null,
      cliente_desde: String(c.created_at || '').slice(0, 10), aceita_mensagens: c.aceita_mensagens,
      observacoes: corta(c.observacoes, 300) || null,
    } : null,
    historico: ctx.c360 ? {
      servicos_feitos: Number(ctx.c360.servicos_feitos) || 0, faltas: Number(ctx.c360.faltas) || 0,
      ultimo_servico_em: String(ctx.c360.ultimo_servico_em || '').slice(0, 10) || null,
      proximo_horario: ctx.c360.proximo_horario || null, ja_gastou_algo: nDec(ctx.c360.total_gasto) > 0,
    } : null,
    etapa_atendimento: ctx.etapa ? ctx.etapa.nome : null,
    conversa: ctx.conversa ? {
      desfecho: ctx.conversa.desfecho || null, aguardando_consultor: !!ctx.conversa.aguardando_consultor,
      ia_ativa: !!ctx.conversa.ia_ativa,
    } : null,
    mensagens: (ctx.mensagens || []).slice(-maxMensagens).map(m => ({
      de: m.direcao === 'entrada' ? 'cliente' : (m.gerada_por_ia ? 'oficina(robô)' : 'oficina'),
      em: String(m.created_at || '').slice(0, 16).replace('T', ' '),
      texto: corta(m.corpo || (m.anexo_mime ? `[anexo ${m.anexo_mime}]` : ''), 400),
    })),
    agendamentos: (ctx.agendamentos || []).slice(0, 8).map(a => ({
      data: a.data, hora: String(a.hora || '').slice(0, 5) || null, servico: corta(a.servico, 80) || null, status: a.status,
    })),
    orcamentos: (ctx.orcamentos || []).slice(0, 5).map(o => ({
      numero: o.numero, status: o.status, enviado_em: String(o.enviado_em || '').slice(0, 10) || null,
      decidido_em: String(o.decidido_em || '').slice(0, 10) || null, motivo_recusa: corta(o.motivo_recusa, 160) || null,
    })),
    comunicar: (ctx.comunicar || []).slice(0, 6).map(e => ({
      tipo: e.tipo, status: e.status, enviado_em: String(e.enviado_em || '').slice(0, 10) || null,
      resposta: corta(e.resposta, 200) || null, resposta_tipo: e.resposta_tipo || null, agendou_depois: !!e.agendou_depois_id,
    })),
    satisfacao: (ctx.satisfacao || []).slice(0, 3).map(s => ({
      satisfeito: s.satisfeito, nota: s.nota, comentario: corta(s.comentario, 200) || null,
    })),
    sinais: ctx.sinais,
  };
}

module.exports = { criarContexto, paraIA, links, telCompleto, variacoesE164, ehUuid, corta };
