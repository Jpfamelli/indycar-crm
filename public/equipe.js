// Rodada 3 (13/10/2026): responsável do lead, tarefas (tabela tarefas), metas e desempenho da equipe.
// Carrega depois de acesso.js e usa o escopo global (api, sb, PERFIL, TODOS, U…).
'use strict';
let EQUIPE = [];                         // [{id, nome, avatar_cor, papel}] — quem pode ser responsável
const LS_RESP = 'indycar_crm_resp';

function iniciarEquipeETarefas() {
  carregarEquipeNomes();
  carregarMetasPainel();
  recarregarTarefas();
  ouvirTarefas();
  oferecerImportacao();
}

/* ---------------- equipe (nomes para responsável e tarefas) ---------------- */
async function carregarEquipeNomes() {
  let lista = null;
  // servidor: GET /api/vendedores {vendedores:[…]}; contrato antigo: GET /api/equipe/nomes […]
  for (const rota of ['/api/vendedores', '/api/equipe/nomes']) {
    try { lista = U.normalizarEquipe(await api(rota)); if (lista) break; }
    catch (e) { if (e.codigo && e.codigo !== 'rede' && ![404, 405].includes(e.status)) return; }
  }
  if (!lista) {
    // reserva: a equipe lê os perfis ativos direto (RLS) — só id, nome e papel
    try { const {data, error} = await sb.from('perfis').select('id,nome,papel,avatar_cor,preferencias,ativo').eq('ativo', true).order('nome'); if (!error) lista = U.normalizarEquipe((data || []).map(p => ({...p, avatar_cor: p.avatar_cor || p.preferencias?.avatar_cor || null}))); } catch { /* ignora */ }
  }
  EQUIPE = lista || [];
  if (PERFIL?.id && U.ehUuid(PERFIL.id) && !EQUIPE.some(p => p.id === String(PERFIL.id))) EQUIPE.unshift({id: String(PERFIL.id), nome: PERFIL.nome || 'Você', papel: PERFIL.papel, avatar_cor: PERFIL.avatar_cor});
  EQUIPE.sort((a, b) => (b.id === String(PERFIL?.id)) - (a.id === String(PERFIL?.id)) || a.nome.localeCompare(b.nome, 'pt-BR'));
  preencherSelectsResp();
  redesenhar();
  if (LEAD_ABERTO && modal.classList.contains('open')) { const l = TODOS.find(x => String(x.id) === String(LEAD_ABERTO)); if (l) renderRespFicha(l); }
  renderTarefas();
  if ($('#view-equipe').classList.contains('active')) renderFunilResp();
}
const pessoa = id => EQUIPE.find(p => p.id === String(id)) || null;
const primeiroNome = n => String(n || '').trim().split(/\s+/)[0] || '—';
function nomeResponsavel(id) { if (!id) return ''; const p = pessoa(id); return p ? p.nome : 'Fora da equipe'; }
function chipResponsavel(id, compacto = false) {
  if (!id) return compacto ? '' : '<span class="resp-chip vazio" title="Sem responsável">Sem responsável</span>';
  const p = pessoa(id) || {id, nome: 'Fora da equipe'}, eu = String(id) === String(PERFIL?.id);
  const nome = eu ? 'Você' : primeiroNome(p.nome);
  return `<span class="resp-chip${compacto ? ' compacto' : ''}" title="Responsável: ${esc(p.nome)}${eu ? ' (você)' : ''}"><span class="avatar xs" style="--cor-avatar:${esc(U.corAvatar(p))}" aria-hidden="true">${esc(iniciais(p.nome))}</span><span class="${compacto ? 'sr' : ''}">${compacto ? 'Responsável: ' : ''}${esc(nome)}</span></span>`;
}
function opcoesPessoas(selecionado, {vazio = null} = {}) {
  const eu = String(PERFIL?.id || '');
  return (vazio !== null ? `<option value="">${esc(vazio)}</option>` : '') + EQUIPE.map(p => `<option value="${esc(p.id)}"${p.id === String(selecionado || '') ? ' selected' : ''}>${esc(p.nome)}${p.id === eu ? ' (você)' : ''}</option>`).join('');
}
function preencherSelectsResp() {
  const salvo = lerLS(LS_RESP, null);
  // padrão para atendente: "Meus leads"; gestor começa vendo todos
  const padrao = SOU_GESTOR ? '' : 'meus';
  const semDono = TODOS.filter(l => !l.responsavel_id && U.ABERTAS.includes(l.status)).length;
  const filtro = sel => `<option value="">Todos os responsáveis</option><option value="meus">Meus leads</option><option value="sem">Sem responsável${semDono ? ` (${semDono})` : ''}</option><optgroup label="Pessoa">${EQUIPE.map(p => `<option value="${esc(p.id)}">${esc(p.nome)}</option>`).join('')}</optgroup>`;
  for (const [id, chave] of [['#fResp', 'lista'], ['#fRespFunil', 'funil']]) {
    const el = $(id), atual = el.dataset.pronto ? el.value : (salvo && chave in salvo ? salvo[chave] : padrao);
    el.innerHTML = filtro();
    el.value = [...el.options].some(o => o.value === atual) ? atual : '';
    el.dataset.pronto = '1';
  }
  $('#loteResp').innerHTML = '<option value="">Passar para…</option>' + opcoesPessoas(null) + '<option value="__sem">Tirar o responsável</option>';
  $('#loteResp').hidden = !SOU_GESTOR;               // distribuir em lote é do gestor (o servidor confere)
  const eu = PERFIL?.id;
  $('#tarefaPara').innerHTML = opcoesPessoas(eu); $('#tarefaPara').hidden = EQUIPE.length < 2;
  $('#tarefaLeadPara').innerHTML = opcoesPessoas(eu); $('#tarefaLeadPara').hidden = EQUIPE.length < 2;
}
function salvarResp() { gravarLS(LS_RESP, {lista: $('#fResp').value, funil: $('#fRespFunil').value}); }
$('#fResp').addEventListener('change', () => { salvarResp(); PAG_LEADS = 1; refiltrar(); renderTabelaLeads(); $('#leadCount').textContent = `${LEADS.length} registro${LEADS.length === 1 ? '' : 's'}`; });
$('#fRespFunil').addEventListener('change', () => { salvarResp(); renderKanban(); });
$('#limparFiltros').addEventListener('click', () => { $('#fResp').value = ''; salvarResp(); });

/* ---------------- reatribuir: ficha e lote ---------------- */
function renderRespFicha(l) {
  const eu = String(PERFIL?.id || ''), meu = String(l.responsavel_id || '') === eu, pode = U.podeReatribuir(l, PERFIL, eu);
  $('#lfResp').innerHTML = `<label class="lf-resp-l"><span>Responsável</span>
      <select id="lfRespSel" aria-label="Responsável pelo lead" ${pode ? '' : 'disabled title="Só o responsável pelo lead ou um gestor passa para outra pessoa"'}>${opcoesPessoas(l.responsavel_id, {vazio: SOU_GESTOR || !l.responsavel_id ? 'Sem responsável' : null})}${l.responsavel_id && !pessoa(l.responsavel_id) ? `<option value="${esc(l.responsavel_id)}" selected>Fora da equipe</option>` : ''}</select></label>
    ${!meu && U.ehUuid(eu) && pode ? '<button type="button" class="btn btn-ghost sm" id="lfPegar">Pegar para mim</button>' : ''}${pode ? '' : '<small class="muted lf-resp-nota">Só quem cuida do lead ou um gestor passa para outra pessoa.</small>'}`;
  // tarefa criada na ficha vai, por padrão, para quem cuida do lead
  const para = $('#tarefaLeadPara'), alvo = String(l.responsavel_id || eu);
  if ([...para.options].some(o => o.value === alvo)) para.value = alvo;
}
$('#lfResp').addEventListener('change', async e => {
  if (e.target.id !== 'lfRespSel') return;
  const l = TODOS.find(x => String(x.id) === String(LEAD_ABERTO)); if (!l) return;
  const novo = e.target.value || null; e.target.disabled = true;
  await atribuirResponsavel([l.id], novo);
  if ($('#lfRespSel')) $('#lfRespSel').disabled = false;
});
$('#lfResp').addEventListener('click', async e => {
  if (e.target.id !== 'lfPegar') return;
  const l = TODOS.find(x => String(x.id) === String(LEAD_ABERTO)); if (l) { e.target.disabled = true; await atribuirResponsavel([l.id], PERFIL.id); }
});
/* PATCH /api/leads/:id/responsavel {responsavel_id} · POST /api/leads/responsavel-lote {ids[], responsavel_id} */
async function gravarResponsavel(ids, novo) {
  if (ids.length === 1) {
    const r = await api(`/api/leads/${encodeURIComponent(ids[0])}/responsavel`, {method: 'PATCH', body: JSON.stringify({responsavel_id: novo})});
    // servidor: {ok, mudou, lead:{id,…,responsavel_id}}; contrato antigo: o próprio lead
    const l = r?.lead || (r?.id ? r : null);
    return l ? [{...l, responsavel_id: l.responsavel_id ?? novo}] : null;
  }
  const r = await api('/api/leads/responsavel-lote', {method: 'POST', body: JSON.stringify({ids, responsavel_id: novo})});
  if (Array.isArray(r)) return r;
  if (Array.isArray(r?.leads)) return r.leads;
  // servidor: {ok, atualizados, ids:[…]} — só os que mudaram de verdade
  if (Array.isArray(r?.ids)) return r.ids.map(id => ({...TODOS.find(l => String(l.id) === String(id)), id, responsavel_id: novo}));
  return null;
}
async function atribuirResponsavel(ids, novo, {desfazer = true} = {}) {
  ids = ids.map(String); novo = novo ? String(novo) : null;
  const antes = TODOS.filter(l => ids.includes(String(l.id))).map(l => ({id: String(l.id), r: l.responsavel_id ? String(l.responsavel_id) : null}));
  const mudam = antes.filter(a => a.r !== novo).map(a => a.id);
  if (!mudam.length) { toast(novo ? 'Já está com essa pessoa.' : 'Já está sem responsável.'); return false; }
  try {
    const voltou = await gravarResponsavel(mudam, novo);
    if (voltou) voltou.forEach(substituirLocal); else mudam.forEach(id => substituirLocal({...TODOS.find(l => String(l.id) === id), responsavel_id: novo}));
    redesenhar();
    const quem = novo ? (String(novo) === String(PERFIL?.id) ? 'você' : primeiroNome(nomeResponsavel(novo))) : 'ninguém';
    const msg = mudam.length === 1 ? `Lead passado para ${quem}` : `${mudam.length} leads passados para ${quem}`;
    if (desfazer) toastAcao(msg, 'Desfazer', async () => {
      // volta cada um para quem estava (agrupa por pessoa para usar o lote)
      const grupos = new Map(); for (const a of antes.filter(x => mudam.includes(x.id))) { const k = a.r || ''; grupos.set(k, [...(grupos.get(k) || []), a.id]); }
      for (const [r, lista] of grupos) { const v = await gravarResponsavel(lista, r || null); if (v) v.forEach(substituirLocal); else lista.forEach(id => substituirLocal({...TODOS.find(l => String(l.id) === id), responsavel_id: r || null})); }
      redesenhar(); toast('Responsável desfeito');
    }); else toast(msg);
    return true;
  } catch (e) { toast('⚠️ ' + (e.status === 403 ? 'Você não pode passar este lead: ' : '') + e.message); redesenhar(); return false; }
}
$('#loteResp').addEventListener('change', async e => {
  const v = e.target.value; e.target.value = ''; if (!v || !SEL.size) return;
  const ok = await atribuirResponsavel([...SEL], v === '__sem' ? null : v);
  if (ok) { SEL.clear(); renderTabelaLeads(); }
});

/* ---------------- tarefas (tabela tarefas, direto pelo supabase-js com RLS da equipe) ---------------- */
let MINHAS = [], VISTA = [], TAREFAS_LEAD = [], FEITAS_AGORA = new Map(), FILTRO_TAREFA = 'minhas', GER_TAREFAS = 0;
const COLS_TAREFA = 'id,titulo,descricao,responsavel_id,criado_por,lead_id,cliente_id,prioridade,vence_em,status,concluida_em,created_at,origem';
async function buscarTarefas(filtro) {
  let q = sb.from('tarefas').select(COLS_TAREFA).eq('status', 'aberta');
  if (filtro === 'minhas') q = q.eq('responsavel_id', PERFIL.id);
  else if (filtro === 'criei') q = q.eq('criado_por', PERFIL.id).neq('responsavel_id', PERFIL.id);
  const {data, error} = await q.order('vence_em', {ascending: true, nullsFirst: false}).limit(300);
  if (error) throw error;
  return data || [];
}
async function recarregarTarefas() {
  if (!PERFIL?.id || !sb) return;
  const ger = ++GER_TAREFAS;
  try {
    const [m, v] = await Promise.all([buscarTarefas('minhas'), FILTRO_TAREFA === 'minhas' ? null : buscarTarefas(FILTRO_TAREFA)]);
    if (ger !== GER_TAREFAS) return;
    MINHAS = m; VISTA = v || m; TAREFAS_ERRO = null;
  } catch (e) { TAREFAS_ERRO = e.message || 'erro'; }
  renderTarefas();
  if (LEAD_ABERTO) carregarTarefasLead(LEAD_ABERTO);
}
let TAREFAS_ERRO = null;
async function carregarTarefasLead(leadId) {
  if (!sb || !U.ehUuid(leadId)) { TAREFAS_LEAD = []; renderTarefas(); return; }
  try {
    const {data, error} = await sb.from('tarefas').select(COLS_TAREFA).eq('lead_id', leadId).in('status', ['aberta', 'feita']).order('created_at', {ascending: false}).limit(50);
    if (error) throw error;
    if (String(LEAD_ABERTO) === String(leadId)) { TAREFAS_LEAD = data || []; renderTarefas(); }
  } catch { TAREFAS_LEAD = []; $('#tarefasLead').innerHTML = '<p class="vazio-curto">Não consegui carregar as tarefas deste lead.</p>'; }
}
window.addEventListener('indycar:lead', e => { TAREFAS_LEAD = []; if (e.detail?.leadId) carregarTarefasLead(e.detail.leadId); });
function ouvirTarefas() {
  try {
    let t = null; const depois = () => { clearTimeout(t); t = setTimeout(recarregarTarefas, 400); };
    const canal = sb.channel('crm-tarefas-' + PERFIL.id)
      .on('postgres_changes', {event: '*', schema: 'public', table: 'tarefas', filter: 'responsavel_id=eq.' + PERFIL.id}, depois)
      .subscribe();
    CANAIS.push(canal);
  } catch { /* sem realtime: atualiza ao voltar para a aba */ }
}
const quandoTarefa = t => { const d = new Date(t.vence_em); if (!Number.isFinite(+d)) return ''; const hoje = new Date(); const mesmoDia = d.toDateString() === hoje.toDateString();
  const amanha = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 1).toDateString() === d.toDateString();
  return (mesmoDia ? 'hoje' : amanha ? 'amanhã' : d.toLocaleDateString('pt-BR', {day: '2-digit', month: '2-digit'})) + ' ' + d.toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'}); };
function itemTarefa(t, {comLead = true} = {}) {
  const s = U.situacaoTarefaDb(t), feita = t.status === 'feita', eu = String(PERFIL?.id || '');
  const lead = comLead && t.lead_id ? TODOS.find(l => String(l.id) === String(t.lead_id)) : null;
  const podeCancelar = SOU_GESTOR || String(t.criado_por || '') === eu;
  return `<div class="tarefa ${s}${Number(t.prioridade) === 3 ? ' urgente' : ''}" data-tarefa="${esc(t.id)}">
    <input type="checkbox" class="tarefa-ok" aria-label="${feita ? 'Reabrir' : 'Concluir'}: ${esc(t.titulo)}" ${feita ? 'checked' : ''}>
    <span class="tarefa-txt">${Number(t.prioridade) === 3 ? '<b class="tarefa-urg">Urgente</b> ' : ''}${esc(t.titulo)}
      ${lead ? ` <button type="button" class="tarefa-lead" data-lead="${esc(lead.id)}">${esc(lead.nome)}</button>` : comLead && t.lead_id ? ` <button type="button" class="tarefa-lead" data-lead="${esc(t.lead_id)}">abrir lead</button>` : ''}
      ${t.responsavel_id && String(t.responsavel_id) !== eu ? ' ' + chipResponsavel(t.responsavel_id) : ''}${t.origem && t.origem !== 'crm' && t.origem !== 'manual' ? ` <span class="tag mini">${esc(t.origem)}</span>` : ''}</span>
    ${t.vence_em ? `<span class="tarefa-data">${s === 'atrasada' ? '<b>Atrasada</b> · ' : s === 'hoje' ? '<b>Hoje</b> · ' : ''}${esc(s === 'hoje' ? quandoTarefa(t).replace(/^hoje /, '') : quandoTarefa(t))}</span>` : ''}
    ${podeCancelar && !feita ? `<button type="button" class="tarefa-x" aria-label="Cancelar tarefa: ${esc(t.titulo)}" title="Cancelar tarefa">×</button>` : ''}</div>`;
}
function grupoTarefas(rot, lista, classe) { return lista.length ? `<h4 class="tarefa-grupo ${classe}">${rot} <span>${lista.length}</span></h4>` + lista.map(t => itemTarefa(t)).join('') : ''; }
function renderTarefas() {
  const painel = $('#tarefasPainel'); if (!painel) return;
  const g = U.agruparTarefas(MINHAS), feitas = [...FEITAS_AGORA.values()];
  const nav = $('.nav-item[data-view="dashboard"]'), pend = g.atrasadas.length + g.hoje.length;
  nav.dataset.badge = pend || ''; nav.setAttribute('aria-label', 'Dashboard' + (pend ? `, ${pend} tarefa(s) para hoje ou atrasadas` : ''));
  $('#tarefasResumo').textContent = [g.atrasadas.length && `${g.atrasadas.length} atrasada${g.atrasadas.length === 1 ? '' : 's'}`, g.hoje.length && `${g.hoje.length} hoje`].filter(Boolean).join(' · ');
  if (TAREFAS_ERRO && !MINHAS.length) painel.innerHTML = `<p class="vazio-curto">Não consegui carregar as tarefas agora (${esc(TAREFAS_ERRO)}).</p>`;
  else if (FILTRO_TAREFA === 'minhas') {
    const html = grupoTarefas('Atrasadas', g.atrasadas, 'g-atrasada') + grupoTarefas('Agenda de hoje', g.hoje, 'g-hoje') + grupoTarefas('Próximas', g.proximas.slice(0, 15), '') + grupoTarefas('Sem data', g.semData.slice(0, 10), '') + grupoTarefas('Feitas agora', feitas, 'g-feita');
    painel.innerHTML = html || '<p class="vazio-curto">Nenhuma tarefa aberta. Anote o próximo passo para não esquecer. 🏁</p>';
  } else {
    const lista = U.ordenarTarefasDb(VISTA);
    painel.innerHTML = lista.length ? lista.slice(0, 60).map(t => itemTarefa(t)).join('') : '<p class="vazio-curto">Nada por aqui.</p>';
  }
  if (LEAD_ABERTO) {
    const doLead = TAREFAS_LEAD.filter(t => String(t.lead_id) === String(LEAD_ABERTO)), lista = U.ordenarTarefasDb(doLead);
    $('#tarefasLead').innerHTML = lista.length ? lista.map(t => itemTarefa(t, {comLead: false})).join('') : '<p class="vazio-curto">Nenhuma tarefa para este lead.</p>';
    const abertas = doLead.filter(t => t.status === 'aberta').length; $('#lfQtdLembretes').textContent = abertas || '';
  }
}
$('#tarefaFiltro').addEventListener('click', e => {
  const b = e.target.closest('[data-tf]'); if (!b) return;
  FILTRO_TAREFA = b.dataset.tf;
  $$('#tarefaFiltro [data-tf]').forEach(x => { const on = x === b; x.classList.toggle('ativo', on); x.setAttribute('aria-pressed', String(on)); });
  recarregarTarefas();
});
async function criarTarefa(dados) {
  const row = U.validarTarefa(dados);
  if (!row.responsavel_id && U.ehUuid(PERFIL?.id)) row.responsavel_id = PERFIL.id;
  const {data, error} = await sb.from('tarefas').insert(row).select(COLS_TAREFA).single();
  if (error) throw new Error(error.message || 'Não consegui criar a tarefa.');
  return data;
}
$('#formTarefaPainel').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
  try {
    const t = await criarTarefa({titulo: $('#tarefaTexto').value, vence_em: U.vencimentoDe($('#tarefaData').value, $('#tarefaHora').value || undefined), prioridade: $('#tarefaPrioridade').value, responsavel_id: $('#tarefaPara').value || PERFIL?.id});
    $('#tarefaTexto').value = ''; $('#tarefaData').value = ''; $('#tarefaHora').value = ''; $('#tarefaPrioridade').value = '2';
    toast(String(t.responsavel_id) === String(PERFIL?.id) ? '✅ Tarefa criada' : `✅ Tarefa passada para ${primeiroNome(nomeResponsavel(t.responsavel_id))}`);
    await recarregarTarefas(); $('#tarefaTexto').focus();
  } catch (err) { toast('⚠️ ' + err.message); }
  finally { btn.disabled = false; }
});
async function criarTarefaDoLead(titulo, data, hora) {
  const l = TODOS.find(x => String(x.id) === String(LEAD_ABERTO)); if (!l) return;
  const t = await criarTarefa({titulo, vence_em: U.vencimentoDe(data, hora || undefined), lead_id: U.ehUuid(l.id) ? l.id : null, cliente_id: U.ehUuid(l.cliente_id) ? l.cliente_id : null, responsavel_id: $('#tarefaLeadPara').value || l.responsavel_id || PERFIL?.id});
  TAREFAS_LEAD.unshift(t); renderTarefas(); recarregarTarefas();
  toast('✅ Tarefa criada para ' + l.nome);
}
$('#formTarefaLead').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
  try { await criarTarefaDoLead($('#tarefaLeadTexto').value, $('#tarefaLeadData').value, $('#tarefaLeadHora').value); $('#tarefaLeadTexto').value = ''; $('#tarefaLeadData').value = ''; $('#tarefaLeadHora').value = ''; $('#tarefaLeadTexto').focus(); }
  catch (err) { toast('⚠️ ' + err.message); }
  finally { btn.disabled = false; }
});
const isoDia = d => new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
$('#atalhosTarefa').addEventListener('click', async e => {
  const b = e.target.closest('[data-rapida]'); if (!b) return;
  const h = new Date(); const dia = new Date(h.getFullYear(), h.getMonth(), h.getDate() + Number(b.dataset.dias || 0));
  // "ligar hoje" depois das 17h30 vai para a próxima hora cheia
  const hora = Number(b.dataset.dias) === 0 ? String(Math.min(23, Math.max(h.getHours() + 1, 9))).padStart(2, '0') + ':00' : '09:00';
  b.disabled = true;
  try { await criarTarefaDoLead(b.dataset.rapida, isoDia(dia), hora); } catch (err) { toast('⚠️ ' + err.message); } finally { b.disabled = false; }
});
async function mudarStatusTarefa(t, status) {
  const {data, error} = await sb.from('tarefas').update({status}).eq('id', t.id).select(COLS_TAREFA).maybeSingle();
  if (error) throw new Error(error.message || 'Não consegui atualizar a tarefa.');
  return data || {...t, status};
}
for (const alvo of ['#tarefasPainel', '#tarefasLead']) $(alvo).addEventListener('click', async e => {
  const box = e.target.closest('[data-tarefa]'); if (!box) return;
  if (e.target.closest('.tarefa-lead')) return abrirModal(e.target.closest('.tarefa-lead').dataset.lead);
  const id = box.dataset.tarefa, t = [...MINHAS, ...VISTA, ...TAREFAS_LEAD, ...FEITAS_AGORA.values()].find(x => x.id === id); if (!t) return;
  const ok = e.target.classList.contains('tarefa-ok'), cancelar = e.target.closest('.tarefa-x');
  if (!ok && !cancelar) return;
  const novo = cancelar ? 'cancelada' : (e.target.checked ? 'feita' : 'aberta');
  try {
    const salvo = await mudarStatusTarefa(t, novo);
    if (novo === 'feita') FEITAS_AGORA.set(id, salvo); else FEITAS_AGORA.delete(id);
    TAREFAS_LEAD = TAREFAS_LEAD.map(x => x.id === id ? salvo : x).filter(x => x.status !== 'cancelada');
    await recarregarTarefas();
    toastAcao(novo === 'feita' ? '✅ Tarefa concluída' : novo === 'cancelada' ? 'Tarefa cancelada' : 'Tarefa reaberta', 'Desfazer', async () => {
      const v = await mudarStatusTarefa(t, 'aberta'); FEITAS_AGORA.delete(id); TAREFAS_LEAD = TAREFAS_LEAD.filter(x => x.id !== id); if (String(LEAD_ABERTO) === String(v.lead_id)) TAREFAS_LEAD.unshift(v);
      await recarregarTarefas(); toast('Tarefa de volta');
    });
  } catch (err) { toast('⚠️ ' + err.message); if (ok) e.target.checked = !e.target.checked; }
});
/* lembretes antigos (só neste aparelho) → tabela tarefas, uma vez */
const chaveImportado = () => 'indycar_crm_tarefas_importadas_' + (PERFIL?.id || 'anon');
function oferecerImportacao() {
  const antigos = lerTarefas().filter(t => !t.feita && t.texto);
  let adiado = false; try { adiado = sessionStorage.getItem(chaveImportado()) === 'adiado'; } catch { /* ignora */ }
  const box = $('#importarLembretes');
  box.hidden = !antigos.length || !!lerLS(chaveImportado(), false) || adiado || !U.ehUuid(PERFIL?.id);
  if (!box.hidden) $('#importarTxt').textContent = `Você tem ${antigos.length} lembrete${antigos.length === 1 ? '' : 's'} guardado${antigos.length === 1 ? '' : 's'} só neste aparelho. Quer passar para as tarefas? Assim aparecem no celular e no computador.`;
}
$('#btnImportar').addEventListener('click', async () => {
  const btn = $('#btnImportar'), antigos = lerTarefas().filter(t => !t.feita && t.texto);
  btn.disabled = true; btn.textContent = 'Importando…';
  try {
    const linhas = []; for (const l of antigos) { try { linhas.push(U.lembreteParaTarefa(l, PERFIL.id)); } catch { /* lembrete inválido fica de fora */ } }
    if (linhas.length) { const {error} = await sb.from('tarefas').insert(linhas); if (error) throw error; }
    gravarLS(chaveImportado(), new Date().toISOString());
    // guarda uma cópia antes de limpar, por segurança
    try { localStorage.setItem(chaveTarefas() + '_copia', localStorage.getItem(chaveTarefas()) || '[]'); localStorage.removeItem(chaveTarefas()); } catch { /* ignora */ }
    $('#importarLembretes').hidden = true;
    toast(`✅ ${linhas.length} lembrete${linhas.length === 1 ? '' : 's'} importado${linhas.length === 1 ? '' : 's'} para as tarefas`);
    await recarregarTarefas();
  } catch (err) { toast('⚠️ Não consegui importar: ' + (err.message || 'erro')); }
  finally { btn.disabled = false; btn.textContent = 'Importar'; }
});
$('#btnImportarNao').addEventListener('click', () => { try { sessionStorage.setItem(chaveImportado(), 'adiado'); } catch { /* ignora */ } $('#importarLembretes').hidden = true; });

/* ---------------- metas (GET/PUT /api/metas?mes=AAAA-MM) ---------------- */
let METAS_PAINEL = null, METAS_ERRO = null;
const ROT_META = {faturamento: 'Faturamento', vendas: 'Vendas', agendamentos: 'Agendamentos', leads: 'Leads novos'};
const fmtMeta = (k, v) => k === 'faturamento' ? brl(v) : Math.round(Number(v) || 0).toLocaleString('pt-BR');
async function buscarMetas(mes) {
  return U.normalizarMetas(await api('/api/metas?mes=' + encodeURIComponent(mes)));
}
/* Realizado de reserva (a tela calcula pelos leads quando o servidor não manda). */
function realizadoLocal(mes, perfilId) {
  const {de} = U.intervaloMes(mes), [a, m] = de.split('-').map(Number);
  const ini = new Date(a, m - 1, 1), fim = new Date(a, m, 1);
  const leads = perfilId ? TODOS.filter(l => String(l.responsavel_id || '') === String(perfilId)) : TODOS;
  const r = U.metricas(leads, ini, fim);
  return {leads: r.entradas, vendas: r.ganhos, faturamento: r.faturamento, agendamentos: null};
}
function blocoMetas(meta, mes, {compacto = false} = {}) {
  const real = {...realizadoLocal(mes, meta.perfil_id), ...(meta.realizado || {})};
  const itens = U.CAMPOS_META.slice().reverse().filter(k => Number(meta[k]) > 0);
  if (!itens.length) return '';
  return itens.map(k => {
    const r = Number(real[k]) || 0, alvo = Number(meta[k]), p = U.progressoMeta(r, alvo, mes);
    const proj = meta.projecao && meta.projecao[k] != null ? Number(meta.projecao[k]) : p.projecao, ritmo = proj >= alvo;
    const ehMes = mes === U.mesAtual();
    return `<div class="meta${compacto ? ' compacta' : ''}"><div class="meta-topo"><span>${ROT_META[k]}</span><b>${fmtMeta(k, r)} <small>de ${fmtMeta(k, alvo)}</small></b></div>
      <div class="meta-barra" role="progressbar" aria-label="${ROT_META[k]}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.pct}" aria-valuetext="${esc(fmtMeta(k, r))} de ${esc(fmtMeta(k, alvo))}, ${p.pct}%"><div style="width:${p.pct}%"></div></div>
      <div class="meta-pe"><span>${p.pct}%${p.falta ? ' · faltam ' + esc(fmtMeta(k, p.falta)) : ' · batida! 🏁'}</span>${ehMes ? (ritmo ? '<span class="up">no ritmo</span>' : `<span class="down">projeção ${esc(fmtMeta(k, proj))}</span>`) : ''}</div></div>`;
  }).join('');
}
async function carregarMetasPainel() {
  try { METAS_PAINEL = await buscarMetas(U.mesAtual()); METAS_ERRO = null; }
  catch (e) { METAS_PAINEL = null; METAS_ERRO = e; }
  renderMetas();
}
function renderMetas() {
  const el = $('#metasMes'); if (!el) return;
  if (!METAS_PAINEL) { el.innerHTML = `<p class="vazio-curto">${METAS_ERRO ? 'As metas aparecem aqui quando o servidor estiver no ar.' : 'Carregando metas…'}</p>`; return; }
  const mes = U.mesAtual(), loja = METAS_PAINEL.find(m => !m.perfil_id), minha = METAS_PAINEL.find(m => String(m.perfil_id || '') === String(PERFIL?.id || '-'));
  const bm = minha && blocoMetas(minha, mes, {compacto: true}), bl = loja && blocoMetas(loja, mes, {compacto: true});
  const html = (bm ? `<h4 class="meta-quem">Minha meta</h4><div class="metas-dupla">${bm}</div>` : '') + (bl ? `${bm ? '<h4 class="meta-quem">Loja</h4>' : ''}<div class="metas-dupla">${bl}</div>` : '');
  el.innerHTML = html || `<p class="vazio-curto">${SOU_GESTOR ? 'Defina as metas do mês da loja e de cada vendedor.' : 'O gestor ainda não definiu as metas deste mês.'}</p>`;
}
$('#btnMetas').addEventListener('click', () => irPara('equipe'));

/* ---------------- tela Equipe e metas (gestor/admin) ---------------- */
let METAS_EQ = [], DESEMP = [], EQ_PERIODO = 'mes', GER_EQ = 0;
function periodoRanking() {
  const mes = $('#eqMes').value || U.mesAtual();
  if (EQ_PERIODO === 'mes') { const {de, ate} = U.intervaloMes(mes); return {de, ate, mes, txt: new Date(de + 'T12:00').toLocaleDateString('pt-BR', {month: 'long', year: 'numeric'})}; }
  const h = new Date(), n = Number(EQ_PERIODO), ini = new Date(h.getFullYear(), h.getMonth(), h.getDate() - (n - 1));
  return {de: isoDia(ini), ate: isoDia(h), dias: n, txt: `últimos ${n} dias`};
}
async function carregarEquipeMetas() {
  if (!SOU_GESTOR) { irPara('dashboard'); return; }
  if (!$('#eqMes').value) $('#eqMes').value = U.mesAtual();
  const mes = $('#eqMes').value, per = periodoRanking(), ger = ++GER_EQ;
  $('#eqTxt').textContent = 'Ranking: ' + per.txt;
  $('#eqMetaLoja').innerHTML = '<div class="skeleton" aria-label="Carregando metas"></div>';
  $('#eqBarras').innerHTML = '<div class="skeleton" aria-label="Carregando ranking"></div>';
  const [m, d] = await Promise.allSettled([buscarMetas(mes), api(`/api/desempenho?${per.mes ? 'mes=' + per.mes : 'dias=' + per.dias}&de=${per.de}&ate=${per.ate}`)]);
  if (ger !== GER_EQ) return;
  METAS_EQ = m.status === 'fulfilled' ? m.value : null;
  DESEMP = d.status === 'fulfilled' ? U.normalizarDesempenho(d.value) : null;
  renderMetaLoja(); renderTabelaMetas(); renderRanking(); renderFunilResp();
  if (m.status === 'rejected') $('#eqMetaLoja').innerHTML = `<div class="alert">Não consegui carregar as metas: ${esc(m.reason?.message || 'erro')}</div>`;
}
function metaDe(id) { return (METAS_EQ || []).find(x => String(x.perfil_id || '') === String(id || '')) || {perfil_id: id || null}; }
function renderMetaLoja() {
  if (!METAS_EQ) return;
  const mes = $('#eqMes').value, html = blocoMetas(metaDe(null), mes);
  $('#eqMetaLoja').innerHTML = html || '<p class="vazio-curto">Sem meta da loja para este mês. Preencha a primeira linha da tabela abaixo.</p>';
  const {dias} = U.intervaloMes(mes), atual = mes === U.mesAtual();
  $('#eqLojaTxt').textContent = atual ? `dia ${new Date().getDate()} de ${dias}` : mes < U.mesAtual() ? 'mês fechado' : 'mês futuro';
}
function renderTabelaMetas() {
  const el = $('#tblMetasEquipe'), mes = $('#eqMes').value;
  if (!METAS_EQ) { el.innerHTML = ''; return; }
  const linhas = [{id: null, nome: 'Loja (meta geral)'}, ...EQUIPE.filter(p => p.papel !== 'agenda')];
  const campo = (p, k) => { const m = metaDe(p.id), real = {...realizadoLocal(mes, p.id), ...(m.realizado || {})};
    return `<td><input type="number" min="0" max="${k === 'faturamento' ? 10000000 : 100000}" step="${k === 'faturamento' ? 100 : 1}" inputmode="${k === 'faturamento' ? 'decimal' : 'numeric'}" data-meta="${esc(p.id || '')}" data-campo="${k}" value="${Number(m[k]) || ''}" placeholder="0" aria-label="Meta de ${esc(ROT_META[k])} — ${esc(p.nome)}" ${SOU_GESTOR ? '' : 'disabled'}>
      <small>${real[k] == null ? '—' : 'feito ' + esc(fmtMeta(k, real[k]))}</small></td>`; };
  el.innerHTML = `<thead><tr><th>Pessoa</th>${U.CAMPOS_META.map(k => `<th>${ROT_META[k]}</th>`).join('')}</tr></thead>
    <tbody>${linhas.map(p => `<tr class="sem-clique${p.id ? '' : ' linha-loja'}"><td>${p.id ? chipResponsavel(p.id) : '<strong>🏁 Loja</strong>'}</td>${U.CAMPOS_META.map(k => campo(p, k)).join('')}</tr>`).join('')}</tbody>`;
  $('#eqSalvar').hidden = !SOU_GESTOR;
}
$('#eqSalvar').addEventListener('click', async () => {
  const msg = $('#eqMsg'), btn = $('#eqSalvar'), mes = $('#eqMes').value || U.mesAtual();
  const porPessoa = new Map();
  for (const i of $$('#tblMetasEquipe input[data-meta]')) { const id = i.dataset.meta || null; const m = porPessoa.get(id) || {perfil_id: id}; m[i.dataset.campo] = i.value === '' ? 0 : Number(i.value); porPessoa.set(id, m); }
  let lista;
  try { lista = U.validarMetas([...porPessoa.values()]).filter(m => U.CAMPOS_META.some(k => m[k] > 0) || (METAS_EQ || []).some(x => String(x.perfil_id || '') === String(m.perfil_id || '') && U.CAMPOS_META.some(k => Number(x[k]) > 0))); if (!lista.length) throw new Error('Preencha ao menos uma meta.'); } catch (e) { msg.textContent = '⚠️ ' + e.message; msg.className = 'form-msg erro'; msg.hidden = false; return; }
  btn.disabled = true; btn.textContent = 'Salvando…';
  try {
    await api('/api/metas?mes=' + encodeURIComponent(mes), {method: 'PUT', body: JSON.stringify({mes, metas: lista})});
    METAS_EQ = await buscarMetas(mes);            // relê com realizado e projeção
    if (mes === U.mesAtual()) { METAS_PAINEL = METAS_EQ; renderMetas(); }
    renderMetaLoja(); renderTabelaMetas();
    msg.textContent = '✅ Metas do mês salvas. A equipe já vê no painel.'; msg.className = 'form-msg ok'; toast('✅ Metas salvas');
  } catch (e) { msg.textContent = '⚠️ ' + e.message; msg.className = 'form-msg erro'; }
  finally { msg.hidden = false; btn.disabled = false; btn.textContent = 'Salvar metas do mês'; }
});
$('#eqMes').addEventListener('change', carregarEquipeMetas);
$('#eqPeriodo').addEventListener('click', e => {
  const b = e.target.closest('[data-eqp]'); if (!b) return;
  EQ_PERIODO = b.dataset.eqp;
  $$('#eqPeriodo [data-eqp]').forEach(x => { const on = x === b; x.classList.toggle('ativo', on); x.setAttribute('aria-pressed', String(on)); });
  carregarEquipeMetas();
});
$('#eqCriterio').addEventListener('change', renderRanking);
const ROT_CRIT = {faturamento: 'Faturamento', vendas: 'Vendas', conversao: 'Conversão', agendados: 'Agendados', leads: 'Leads', tempo_resposta_min: 'Tempo de resposta'};
const fmtCrit = (k, v) => v == null || v === '' ? '—' : k === 'faturamento' ? brl(v) : k === 'conversao' ? Math.round(Number(v)).toLocaleString('pt-BR') + '%' : k === 'tempo_resposta_min' ? (Number(v) >= 60 ? (Number(v) / 60).toLocaleString('pt-BR', {maximumFractionDigits: 1}) + ' h' : Math.round(Number(v)) + ' min') : Math.round(Number(v)).toLocaleString('pt-BR');
function renderRanking() {
  const k = $('#eqCriterio').value, barras = $('#eqBarras'), tbl = $('#tblDesempenho');
  $('#eqRankingT').textContent = 'Ranking por ' + ROT_CRIT[k].toLowerCase() + (k === 'tempo_resposta_min' ? ' (menor é melhor)' : '');
  if (!DESEMP) { barras.innerHTML = '<div class="alert">Não consegui carregar o desempenho da equipe agora.</div>'; tbl.innerHTML = ''; return; }
  const lista = U.ordenarDesempenho(DESEMP, k);
  if (!lista.length) { barras.innerHTML = '<p class="vazio-curto">Sem movimento da equipe neste período.</p>'; tbl.innerHTML = ''; return; }
  const vals = lista.map(x => Number(x[k]) || 0), max = Math.max(1, ...vals), min = Math.min(...vals.filter(v => v > 0), max);
  const largura = v => k === 'tempo_resposta_min' ? (v > 0 ? Math.max(6, Math.round(min / v * 100)) : 0) : Math.round(v / max * 100);
  barras.innerHTML = `<ol class="rk">${lista.map((x, i) => { const p = pessoa(x.perfil_id) || {id: x.perfil_id, nome: x.nome}; return `<li class="${String(x.perfil_id) === String(PERFIL?.id) ? 'eu' : ''}">
      <span class="rk-pos">${i + 1}º</span>${chipResponsavel(x.perfil_id, true)}<span class="rk-nome">${esc(x.nome || p.nome)}</span>
      <span class="rk-barra" aria-hidden="true"><i style="width:${largura(Number(x[k]) || 0)}%"></i></span><b class="rk-val">${esc(fmtCrit(k, x[k]))}</b></li>`; }).join('')}</ol>`;
  tbl.innerHTML = `<caption class="sr">Desempenho por vendedor</caption><thead><tr><th>#</th><th>Vendedor</th><th class="num">Leads</th><th class="num">Agendados</th><th class="num">Vendas</th><th class="num">Faturamento</th><th class="num">Conversão</th><th class="num">Resposta</th></tr></thead>
    <tbody>${lista.map((x, i) => `<tr class="sem-clique"><td>${i + 1}</td><td>${esc(x.nome || nomeResponsavel(x.perfil_id))}</td><td class="num">${fmtCrit('leads', x.leads)}</td><td class="num">${fmtCrit('agendados', x.agendados)}</td><td class="num">${fmtCrit('vendas', x.vendas)}</td><td class="num">${fmtCrit('faturamento', x.faturamento)}</td><td class="num">${fmtCrit('conversao', x.conversao)}</td><td class="num">${fmtCrit('tempo_resposta_min', x.tempo_resposta_min)}</td></tr>`).join('')}</tbody>`;
}
function renderFunilResp() {
  const linhas = U.funilPorResponsavel(TODOS, EQUIPE), el = $('#tblFunilResp');
  if (!linhas.length) { el.innerHTML = '<tbody><tr><td class="vazio-celula">Sem leads ainda.</td></tr></tbody>'; return; }
  el.innerHTML = `<caption class="sr">Quantos leads cada pessoa tem em cada etapa</caption><thead><tr><th>Responsável</th>${U.ETAPAS.map(s => `<th class="num">${esc(LABEL_STATUS[s] ?? s)}</th>`).join('')}<th class="num">Em aberto</th></tr></thead>
    <tbody>${linhas.map(x => `<tr data-resp="${esc(x.perfil_id || 'sem')}" tabindex="0" aria-label="Ver o funil de ${esc(x.nome)}"><td>${x.perfil_id ? chipResponsavel(x.perfil_id) : '<span class="resp-chip vazio">Sem responsável</span>'}</td>${U.ETAPAS.map(s => `<td class="num">${x.porEtapa[s] || '<span class="muted">·</span>'}</td>`).join('')}<td class="num"><b>${brl(x.valorAberto)}</b></td></tr>`).join('')}</tbody>`;
}
function abrirFunilDe(id) { const sel = $('#fRespFunil'); sel.value = id === String(PERFIL?.id) ? 'meus' : id; salvarResp(); irPara('pipeline'); renderKanban(); }
$('#tblFunilResp').addEventListener('click', e => { const tr = e.target.closest('tr[data-resp]'); if (tr) abrirFunilDe(tr.dataset.resp); });
$('#tblFunilResp').addEventListener('keydown', e => { const tr = e.target.closest('tr[data-resp]'); if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); abrirFunilDe(tr.dataset.resp); } });
