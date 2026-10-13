/* ============================================================
   IndyCar CRM — tarefas do vendedor (tabela `tarefas`, compartilhada)
   Substituem os lembretes que ficavam no navegador. A notificação
   "nova tarefa" sai sozinha pelo gatilho do banco.
   ============================================================ */
'use strict';

const { ehUuid, falha, ehGestor, podeCrm, texto } = require('./util-servidor');

const STATUS = ['aberta', 'feita', 'cancelada'];
const ORIGENS_INTERNAS = ['crm', 'ia', 'automacao'];
const COLS = 'id,titulo,descricao,responsavel_id,criado_por,cliente_id,lead_id,conversa_id,agendamento_id,origem,prioridade,vence_em,status,concluida_em,concluida_por,created_at,updated_at';

function criarTarefas({ sb, agora = () => Date.now(), auditar = async () => null } = {}) {
  if (!sb) throw new Error('tarefas: banco não configurado');

  async function pessoaValida(id) {
    const { data, error } = await sb.from('perfis').select('id,papel,ativo,apps').eq('id', id).maybeSingle();
    if (error) throw falha(503, 'Não consegui ler a equipe.');
    return podeCrm(data);
  }

  function lerVence(v) {
    if (v === null || v === '') return null;
    const t = Date.parse(String(v));
    if (!Number.isFinite(t)) throw falha(400, 'Prazo inválido.');
    if (t < agora() - 7 * 864e5 || t > agora() + 400 * 864e5) throw falha(400, 'Prazo fora do intervalo (até 1 ano).');
    return new Date(t).toISOString();
  }

  /** Valida e normaliza o corpo de criação/edição. parcial = PATCH. */
  function validar(b, { parcial = false } = {}) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw falha(400, 'Tarefa inválida.');
    const out = {};
    if (!parcial || 'titulo' in b) {
      const t = texto(b.titulo, 400).replace(/\s+/g, ' ').trim();
      if (!t) throw falha(400, 'Escreva o que precisa ser feito.');
      if (t.length > 200) throw falha(400, 'Título longo demais (máx. 200 caracteres).');
      out.titulo = t;
    }
    if ('descricao' in b) { const d = texto(b.descricao, 4000).trim(); if (d.length > 2000) throw falha(400, 'Descrição longa demais (máx. 2000).'); out.descricao = d || null; }
    if ('prioridade' in b) {
      const p = Number(b.prioridade);
      if (![1, 2, 3].includes(p)) throw falha(400, 'Prioridade vai de 1 (alta) a 3 (baixa).');
      out.prioridade = p;
    }
    if ('vence_em' in b) out.vence_em = lerVence(b.vence_em);
    if ('responsavel_id' in b) {
      if (b.responsavel_id !== null && !ehUuid(b.responsavel_id)) throw falha(400, 'Responsável inválido.');
      out.responsavel_id = b.responsavel_id;
    }
    if (parcial && 'status' in b) {
      if (!STATUS.includes(b.status)) throw falha(400, 'Situação inválida (aberta, feita ou cancelada).');
      out.status = b.status;
    }
    if (!parcial) {
      for (const k of ['lead_id', 'cliente_id', 'conversa_id', 'agendamento_id']) {
        if (b[k] == null || b[k] === '') continue;
        if (!ehUuid(b[k])) throw falha(400, 'Vínculo da tarefa inválido.');
        out[k] = b[k];
      }
    }
    return out;
  }

  /** Cria uma tarefa. origem: 'crm' (pessoa), 'ia' ou 'automacao'. */
  async function criar(b, quem, { origem = 'crm', semDono = false } = {}) {
    const t = validar(b);
    if (!ORIGENS_INTERNAS.includes(origem)) origem = 'crm';
    if (!('responsavel_id' in t) && !semDono) t.responsavel_id = quem?.id || null;
    if (t.responsavel_id && t.responsavel_id !== quem?.id && !(await pessoaValida(t.responsavel_id))) throw falha(400, 'Essa pessoa não pode receber tarefas do CRM.');
    if (t.lead_id) {
      const { data: lead, error } = await sb.from('leads').select('id,cliente_id').eq('id', t.lead_id).maybeSingle();
      if (error) throw falha(503, 'Não consegui ler o lead.');
      if (!lead) throw falha(404, 'Lead não encontrado.');
      if (!t.cliente_id && lead.cliente_id) t.cliente_id = lead.cliente_id;
    }
    const linha = { ...t, origem, prioridade: t.prioridade || 2, status: 'aberta', criado_por: quem && ehUuid(quem.id) ? quem.id : null };
    const { data, error } = await sb.from('tarefas').insert(linha).select(COLS).single();
    if (error || !data) throw falha(503, 'Não consegui criar a tarefa.');
    return comFlags(data);
  }

  const comFlags = t => ({ ...t, atrasada: t.status === 'aberta' && !!t.vence_em && Date.parse(t.vence_em) < agora() });

  async function ler(id) {
    if (!ehUuid(id)) throw falha(400, 'Tarefa inválida.');
    const { data, error } = await sb.from('tarefas').select(COLS).eq('id', id).maybeSingle();
    if (error) throw falha(503, 'Não consegui ler a tarefa.');
    if (!data) throw falha(404, 'Tarefa não encontrada.');
    return data;
  }

  const podeMexer = (t, quem) => ehGestor(quem.papel) || t.responsavel_id === quem.id || t.criado_por === quem.id || !t.responsavel_id;

  async function atualizar(id, b, quem) {
    const atual = await ler(id);
    if (!podeMexer(atual, quem)) throw falha(403, 'Só quem cuida da tarefa, quem criou ou um gestor pode mudá-la.');
    const p = validar(b, { parcial: true });
    if (!Object.keys(p).length) throw falha(400, 'Nada para mudar.');
    if ('responsavel_id' in p && p.responsavel_id && p.responsavel_id !== quem.id && !(await pessoaValida(p.responsavel_id))) throw falha(400, 'Essa pessoa não pode receber tarefas do CRM.');
    if (p.status === 'feita' && atual.status !== 'feita') p.concluida_por = quem.id;   // o gatilho não vê auth.uid() no servidor
    const { data, error } = await sb.from('tarefas').update(p).eq('id', id).select(COLS).maybeSingle();
    if (error || !data) throw falha(503, 'Não consegui salvar a tarefa.');
    if ('responsavel_id' in p && p.responsavel_id !== atual.responsavel_id) {
      await auditar(quem, 'reatribuir_tarefa', { tabela: 'tarefas', registro: id, detalhes: { de: atual.responsavel_id, para: p.responsavel_id } });
    }
    return comFlags(data);
  }

  async function apagar(id, quem) {
    const atual = await ler(id);
    if (!ehGestor(quem.papel) && atual.criado_por !== quem.id) throw falha(403, 'Só quem criou a tarefa ou um gestor pode apagá-la.');
    const { error } = await sb.from('tarefas').delete().eq('id', id);
    if (error) throw falha(503, 'Não consegui apagar a tarefa.');
    await auditar(quem, 'apagar_tarefa', { tabela: 'tarefas', registro: id, detalhes: { titulo: atual.titulo, responsavel_id: atual.responsavel_id, lead_id: atual.lead_id } });
    return { ok: true, id };
  }

  /** Cancela (usado pelo "desfazer" da IA). Só se ainda estiver aberta. */
  async function cancelar(id) {
    const { data, error } = await sb.from('tarefas').update({ status: 'cancelada' }).eq('id', id).eq('status', 'aberta').select('id').maybeSingle();
    if (error) throw falha(503, 'Não consegui cancelar a tarefa.');
    return !!data;
  }

  /**
   * Lista. minhas = responsável sou eu; lead/cliente = da ficha; status padrão 'aberta'
   * ('todas' = qualquer); responsavel = uuid | 'nenhum'.
   */
  async function listar({ quem, minhas = false, leadId, clienteId, status = 'aberta', responsavel, limite = 100 } = {}) {
    limite = Math.max(1, Math.min(300, Math.round(Number(limite) || 100)));
    let q = sb.from('tarefas').select(COLS);
    if (status !== 'todas') {
      if (!STATUS.includes(status)) throw falha(400, 'Situação inválida.');
      q = q.eq('status', status);
    }
    if (minhas) q = q.eq('responsavel_id', quem.id);
    else if (responsavel === 'nenhum') q = q.is('responsavel_id', null);
    else if (responsavel) { if (!ehUuid(responsavel)) throw falha(400, 'Responsável inválido.'); q = q.eq('responsavel_id', responsavel); }
    if (leadId) { if (!ehUuid(leadId)) throw falha(400, 'Lead inválido.'); q = q.eq('lead_id', leadId); }
    if (clienteId) { if (!ehUuid(clienteId)) throw falha(400, 'Cliente inválido.'); q = q.eq('cliente_id', clienteId); }
    const { data, error } = await q.order('created_at', { ascending: false }).limit(limite);
    if (error) throw falha(503, 'Não consegui ler as tarefas.');
    // prazo mais perto primeiro; sem prazo depois; feitas por último
    const lista = (data || []).map(comFlags).sort((a, b) =>
      (a.status === 'aberta' ? 0 : 1) - (b.status === 'aberta' ? 0 : 1)
      || (a.vence_em ? Date.parse(a.vence_em) : Infinity) - (b.vence_em ? Date.parse(b.vence_em) : Infinity)
      || a.prioridade - b.prioridade || String(b.created_at).localeCompare(String(a.created_at)));
    // nome do lead e da pessoa, para a lista não precisar de outra ida ao banco
    const idsLead = [...new Set(lista.map(t => t.lead_id).filter(Boolean))];
    const idsPessoa = [...new Set(lista.map(t => t.responsavel_id).filter(Boolean))];
    const [ls, ps] = await Promise.all([
      idsLead.length ? sb.from('leads').select('id,nome,status').in('id', idsLead) : { data: [] },
      idsPessoa.length ? sb.from('perfis').select('id,nome,avatar_cor').in('id', idsPessoa) : { data: [] },
    ]);
    const L = new Map((ls.data || []).map(x => [x.id, x])), P = new Map((ps.data || []).map(x => [x.id, x]));
    const fimDoDia = (() => { const d = new Date(agora() - 3 * 3600_000); d.setUTCHours(23, 59, 59, 999); return d.getTime() + 3 * 3600_000; })();
    const tarefas = lista.map(t => ({ ...t, lead: t.lead_id ? (L.get(t.lead_id) || null) : null, responsavel: t.responsavel_id ? (P.get(t.responsavel_id) || null) : null }));
    const abertas = tarefas.filter(t => t.status === 'aberta');
    return {
      tarefas,
      contagem: { abertas: abertas.length, atrasadas: abertas.filter(t => t.atrasada).length,
        hoje: abertas.filter(t => t.vence_em && Date.parse(t.vence_em) <= fimDoDia).length },
    };
  }

  /** Há tarefa aberta para estes leads? (Set de lead_id) */
  async function leadsComTarefaAberta(ids) {
    if (!ids.length) return new Set();
    const { data, error } = await sb.from('tarefas').select('lead_id').eq('status', 'aberta').in('lead_id', ids);
    if (error) throw falha(503, 'Não consegui ler as tarefas.');
    return new Set((data || []).map(x => x.lead_id));
  }

  return { criar, atualizar, apagar, cancelar, listar, ler, validar, leadsComTarefaAberta };
}

module.exports = { criarTarefas, STATUS };
