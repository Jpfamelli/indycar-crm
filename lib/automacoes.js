/* ============================================================
   IndyCar CRM — automações (rodam no servidor; também por rota
   protegida para um agendador externo, porque o Render gratuito dorme)

   0. rodízio dos leads novos sem dono (últimas 48 h)
   1. lead novo sem contato em 2 h      → notificação ao responsável
                                           (sem dono: aos gestores)
   2. orçamento sem resposta em 3 dias  → tarefa para o responsável
                                           (se não houver tarefa aberta)
   3. lead parado há 14 dias            → SUGESTÃO de perdido com motivo
                                           (proposta em ia_acoes; nada muda sozinho)
   4. meta do mês em risco              → notificação aos gestores

   Trava: dentro do processo (flag) + no banco (rpc crm_pegar_trava),
   para dois servidores/agendador não rodarem juntos. Cada regra é
   idempotente por chave (notificar deduplica por perfil+chave).
   Relógio injetável (agora) para os testes.
   ============================================================ */
'use strict';

const crypto = require('node:crypto');
const { falha, ehGestor, podeCrm, corta, diaBRT, mesBRT } = require('./util-servidor');

const H = 3600_000, D = 864e5;
const REGRAS = ['rodizio', 'sem_contato', 'orcamento', 'parados', 'metas'];
const TIPO_PERDIDO = 'crm_sugestao_perdido';

function criarAutomacoes({ sb, agora = () => Date.now(), equipe, tarefas, auditar = async () => null, planoAcao, log = () => {},
  opcoes = {} } = {}) {
  if (!sb) throw new Error('automacoes: banco não configurado');
  const cfg = {
    rodizio: opcoes.rodizio !== false,
    horasSemContato: 2, diasOrcamento: 3, diasParado: 14,
    limitePorRegra: 50, limiteSugestoes: 20,
    ...opcoes,
  };
  const dono = `crm-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
  let rodando = false, ultimo = null, rpcTravaFalhou = false;

  async function pegarTrava(segundos = 300) {
    try {
      const { data, error } = await sb.rpc('crm_pegar_trava', { p_nome: 'crm_automacoes', p_dono: dono, p_segundos: segundos });
      if (error) { if (!rpcTravaFalhou) log('trava no banco indisponível:', error.message); rpcTravaFalhou = true; return true; }
      return data === true;
    } catch (e) { log('trava:', e && e.message); return true; }   // sem a rpc fica só a trava do processo
  }
  async function soltarTrava() {
    try { await sb.rpc('crm_soltar_trava', { p_nome: 'crm_automacoes', p_dono: dono }); } catch { /* vence sozinha */ }
  }
  async function notificar(perfil, tipo, titulo, corpo, link, chave) {
    const { data, error } = await sb.rpc('notificar', { p_perfil: perfil, p_tipo: tipo, p_titulo: corta(titulo, 140), p_corpo: corta(corpo, 400) || null, p_link: link || null, p_app: 'crm', p_chave: chave });
    if (error) { log('notificar:', error.message); return false; }
    return !!data;                                      // null = já tinha (mesma chave) ou pessoa inativa
  }
  async function gestores() {
    const { data, error } = await sb.from('perfis').select('id,nome,papel,ativo,apps').eq('ativo', true).in('papel', ['admin', 'gestor']);
    if (error) throw falha(503, 'Não consegui ler os gestores.');
    return (data || []).filter(podeCrm);
  }
  const iso = t => new Date(t).toISOString();

  /** Conversas dos clientes destes leads: Map cliente_id -> [conversa_id]. */
  async function conversasDe(leads) {
    const cli = [...new Set(leads.map(l => l.cliente_id).filter(Boolean))];
    const m = new Map();
    if (!cli.length) return m;
    const { data, error } = await sb.from('conversas').select('id,cliente_id').in('cliente_id', cli);
    if (error) throw falha(503, 'Não consegui ler as conversas.');
    for (const c of data || []) { if (!m.has(c.cliente_id)) m.set(c.cliente_id, []); m.get(c.cliente_id).push(c.id); }
    return m;
  }
  /** Mensagens de uma direção depois de `desde` nestas conversas: Map conversa_id -> último ms. */
  async function ultimaMensagem(conversaIds, direcao, desde) {
    const m = new Map();
    if (!conversaIds.length) return m;
    const { data, error } = await sb.from('whatsapp_mensagens').select('conversa_id,created_at')
      .in('conversa_id', conversaIds).eq('direcao', direcao).gte('created_at', iso(desde)).order('created_at', { ascending: false }).limit(5000);
    if (error) throw falha(503, 'Não consegui ler as mensagens.');
    for (const x of data || []) { const t = Date.parse(x.created_at); if (!(m.get(x.conversa_id) >= t)) m.set(x.conversa_id, t); }
    return m;
  }

  /* ---------- 0. rodízio ---------- */
  async function regraRodizio() {
    if (!cfg.rodizio || !equipe) return { ligado: false };
    const r = await equipe.rodizio({ executar: true, horas: 48, limite: cfg.limitePorRegra });
    return { ligado: true, atribuidos: r.atribuidos.length, motivo: r.motivo || null };
  }

  /* ---------- 1. lead novo sem contato em 2 h ---------- */
  async function regraSemContato() {
    const t = agora();
    const { data: leads, error } = await sb.from('leads').select('id,nome,servico,carro_modelo,cliente_id,responsavel_id,created_at,status')
      .eq('status', 'novo').lte('created_at', iso(t - cfg.horasSemContato * H)).gte('created_at', iso(t - 3 * D))
      .order('created_at', { ascending: true }).limit(cfg.limitePorRegra);
    if (error) throw falha(503, 'Não consegui ler os leads novos.');
    if (!leads?.length) return { avaliados: 0, notificados: 0 };
    const conv = await conversasDe(leads);
    const todasConv = [...conv.values()].flat();
    const desde = Math.min(...leads.map(l => Date.parse(l.created_at)));
    const saidas = await ultimaMensagem(todasConv, 'saida', desde);
    let gest = null, notificados = 0, contatados = 0;
    for (const l of leads) {
      const criado = Date.parse(l.created_at);
      const falou = (conv.get(l.cliente_id) || []).some(c => (saidas.get(c) || 0) >= criado);
      if (falou) { contatados++; continue; }
      const horas = Math.floor((t - criado) / H);
      const titulo = `Lead sem contato há ${horas} h: ${l.nome || 'cliente'}`;
      const corpo = [l.servico, l.carro_modelo].filter(Boolean).join(' · ') || 'Ninguém falou com ele ainda.';
      const alvos = l.responsavel_id ? [l.responsavel_id] : (gest ||= (await gestores()).map(g => g.id));
      for (const p of alvos) if (await notificar(p, 'lead_sem_contato', titulo, corpo, `/?lead=${l.id}`, `auto:sem_contato:${l.id}`)) notificados++;
    }
    return { avaliados: leads.length, contatados, notificados };
  }

  /* ---------- 2. orçamento sem resposta em 3 dias ---------- */
  async function regraOrcamento() {
    if (!tarefas) return { ligado: false };
    const t = agora();
    const { data: leads, error } = await sb.from('leads').select('id,nome,servico,cliente_id,responsavel_id,updated_at,status')
      .eq('status', 'orcamento').lte('updated_at', iso(t - cfg.diasOrcamento * D)).gte('updated_at', iso(t - 60 * D))
      .order('updated_at', { ascending: true }).limit(cfg.limitePorRegra);
    if (error) throw falha(503, 'Não consegui ler os orçamentos.');
    if (!leads?.length) return { avaliados: 0, tarefas: 0 };
    const comDono = leads.filter(l => l.responsavel_id);
    const ids = comDono.map(l => l.id);
    const abertas = await tarefas.leadsComTarefaAberta(ids);
    // não recria logo depois que a pessoa concluiu: uma da automação por lead a cada 3 dias
    const { data: recentes } = ids.length ? await sb.from('tarefas').select('lead_id').eq('origem', 'automacao').in('lead_id', ids).gte('created_at', iso(t - cfg.diasOrcamento * D)) : { data: [] };
    const jaFeita = new Set((recentes || []).map(x => x.lead_id));
    const conv = await conversasDe(comDono);
    const desde = comDono.length ? Math.min(...comDono.map(l => Date.parse(l.updated_at))) : t;
    const entradas = await ultimaMensagem([...conv.values()].flat(), 'entrada', desde);
    let criadas = 0, respondeu = 0;
    for (const l of comDono) {
      if (abertas.has(l.id) || jaFeita.has(l.id)) continue;
      const desdeLead = Date.parse(l.updated_at);
      if ((conv.get(l.cliente_id) || []).some(c => (entradas.get(c) || 0) >= desdeLead)) { respondeu++; continue; }
      const dias = Math.floor((t - desdeLead) / D);
      try {
        await tarefas.criar({ titulo: corta(`Cobrar orçamento: ${l.nome || 'cliente'}`, 200), descricao: `Orçamento sem resposta há ${dias} dias${l.servico ? ` (${corta(l.servico, 80)})` : ''}. Chame o cliente e veja se ficou alguma dúvida.`,
          responsavel_id: l.responsavel_id, lead_id: l.id, prioridade: dias >= 7 ? 1 : 2, vence_em: iso(t + 4 * H) }, null, { origem: 'automacao' });
        criadas++;
      } catch (e) { log('tarefa de orçamento:', e.message); }
    }
    return { avaliados: leads.length, semDono: leads.length - comDono.length, respondeu, tarefas: criadas };
  }

  /* ---------- 3. parado há 14 dias → sugestão de perdido ---------- */
  async function regraParados() {
    const t = agora();
    const { data: leads, error } = await sb.from('leads').select('id,nome,status,origem,servico,cliente_id,responsavel_id,observacoes,telefone,updated_at,created_at')
      .in('status', ['novo', 'contato', 'orcamento']).lte('updated_at', iso(t - cfg.diasParado * D))
      .order('updated_at', { ascending: true }).limit(200);
    if (error) throw falha(503, 'Não consegui ler os leads parados.');
    if (!leads?.length) return { avaliados: 0, sugestoes: 0 };
    const ids = leads.map(l => l.id);
    const { data: jaTem, error: e2 } = await sb.from('ia_acoes').select('lead_id,status,created_at').eq('origem', 'crm').eq('tipo', TIPO_PERDIDO).in('lead_id', ids);
    if (e2) throw falha(503, 'Não consegui ler as sugestões.');
    // não repete: proposta ainda esperando, ou recusada/tratada nos últimos 30 dias
    const bloqueado = new Set((jaTem || []).filter(a => a.status === 'proposta' || Date.parse(a.created_at) >= t - 30 * D).map(a => a.lead_id));
    const novos = leads.filter(l => !bloqueado.has(l.id)).slice(0, cfg.limiteSugestoes);
    if (!novos.length) return { avaliados: leads.length, sugestoes: 0 };
    const linhas = novos.map(l => {
      const dias = Math.floor((t - Date.parse(l.updated_at || l.created_at)) / D);
      const motivo = l.status === 'orcamento' ? `Orçamento sem resposta há ${dias} dias` : l.status === 'contato' ? `Sem retorno do cliente há ${dias} dias` : `Nunca respondeu (${dias} dias)`;
      const acao = { acao: 'marcar_perdido', prioridade: dias >= 30 ? 'media' : 'baixa', justificativa: `Parado há ${dias} dias na etapa ${l.status}.`, texto_mensagem: null, novo_status: 'perdido', motivo_perda: motivo };
      const plano = planoAcao ? planoAcao(acao, l) : { muda: { lead: { antes: { status: l.status }, depois: { status: 'perdido' } } }, faturamento: true };
      return { origem: 'crm', tipo: TIPO_PERDIDO, status: 'proposta', lead_id: l.id, cliente_id: l.cliente_id || null, perfil_id: null,
        resumo: corta(`Marcar perdido — ${motivo}`, 300), entrada: { regra: 'parado_14d', dias, status: l.status },
        saida: { ...acao, plano, regra: 'parado_14d', dias, porIA: false, automacao: true, lead: { id: l.id, nome: corta(l.nome, 80), status: l.status, origem: l.origem } },
        modelo: null, tokens_entrada: 0, tokens_saida: 0 };
    });
    const { error: e3 } = await sb.from('ia_acoes').insert(linhas);
    if (e3) throw falha(503, 'Não consegui registrar as sugestões.');
    // um aviso por responsável por dia (sem dono: nada — aparece na triagem)
    const porDono = new Map();
    for (const l of novos) if (l.responsavel_id) porDono.set(l.responsavel_id, (porDono.get(l.responsavel_id) || 0) + 1);
    let avisos = 0;
    for (const [p, n] of porDono) {
      if (await notificar(p, 'sugestao_perdido', `${n} lead(s) parado(s) há ${cfg.diasParado}+ dias`, 'A IA sugere marcar como perdido. Confira na triagem antes de confirmar.', '/?aba=ia', `auto:parados:${p}:${diaBRT(t)}`)) avisos++;
    }
    return { avaliados: leads.length, sugestoes: linhas.length, avisos };
  }

  /* ---------- 4. meta do mês em risco ---------- */
  async function regraMetas() {
    if (!equipe) return { ligado: false };
    const t = agora();
    const m = await equipe.lerMetas({ mes: mesBRT(t) });
    const emRisco = [];
    if (m.loja.status === 'risco') emRisco.push({ quem: 'loja', nome: 'Loja', itens: m.loja.itens });
    for (const p of m.pessoas) if (p.status === 'risco') emRisco.push({ quem: p.perfil_id, nome: p.nome, itens: p.itens });
    if (!emRisco.length) return { metas: m.pessoas.filter(p => p.meta).length + (m.loja.meta ? 1 : 0), emRisco: 0, avisos: 0 };
    const gest = await gestores();
    const semana = Math.ceil(Number(diaBRT(t).slice(8, 10)) / 7);
    const rotulo = { leads: 'leads', agendamentos: 'agendamentos', vendas: 'vendas', faturamento: 'faturamento' };
    let avisos = 0;
    for (const r of emRisco) {
      const partes = Object.entries(r.itens).filter(([, it]) => it.risco).map(([c, it]) => {
        const f = c === 'faturamento' ? v => `R$ ${Math.round(v).toLocaleString('pt-BR')}` : v => String(Math.round(v));
        return `${rotulo[c]}: projeção ${f(it.projecao)} de ${f(it.meta)}`;
      });
      for (const g of gest) {
        if (await notificar(g.id, 'meta_risco', `Meta em risco — ${r.nome}`, partes.join(' · '), '/?aba=dashboard', `auto:meta_risco:${m.mes}:${r.quem}:s${semana}`)) avisos++;
      }
    }
    return { emRisco: emRisco.length, avisos };
  }

  const FUNCOES = { rodizio: regraRodizio, sem_contato: regraSemContato, orcamento: regraOrcamento, parados: regraParados, metas: regraMetas };

  /** Um ciclo completo (ou só as regras pedidas). Nunca roda dois ao mesmo tempo. */
  async function ciclo({ origem = 'timer', quem = null, regras = REGRAS } = {}) {
    const pedidas = (Array.isArray(regras) ? regras : REGRAS).filter(r => REGRAS.includes(r));
    if (!pedidas.length) throw falha(400, `Regras válidas: ${REGRAS.join(', ')}.`);
    if (rodando) return { ok: false, ocupado: true, erro: 'As automações já estão rodando.' };
    rodando = true;
    const inicio = agora();
    try {
      if (!(await pegarTrava())) return { ok: false, ocupado: true, erro: 'Outra instância está rodando as automações.' };
      const resultado = {}, erros = [];
      for (const r of pedidas) {
        try { resultado[r] = await FUNCOES[r](); }
        catch (e) { erros.push({ regra: r, erro: e.status ? e.message : 'falha inesperada' }); log(`automação ${r}:`, e && e.message); }
      }
      const fim = agora();
      ultimo = { ok: !erros.length, origem, inicio: iso(inicio), fim: iso(fim), duracao_ms: fim - inicio, regras: resultado, erros };
      try { await sb.from('crm_automacoes_execucoes').insert({ origem, perfil_id: quem?.id || null, iniciado_em: iso(inicio), terminado_em: iso(fim), resultado: { regras: resultado, erros } }); } catch { /* histórico é opcional */ }
      const fez = Object.values(resultado).some(x => x && (x.atribuidos || x.notificados || x.tarefas || x.sugestoes || x.avisos));
      if (fez || quem) await auditar(quem, 'automacoes_ciclo', { tabela: null, detalhes: { origem, regras: resultado, erros } });
      return ultimo;
    } finally { await soltarTrava(); rodando = false; }
  }

  return { ciclo, ultimo: () => ultimo, rodando: () => rodando, REGRAS, regras: FUNCOES, dono };
}

module.exports = { criarAutomacoes, REGRAS, TIPO_PERDIDO };
