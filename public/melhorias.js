// Camada de tela do CRM (rodadas de 09/10/2026). Funções puras em crm-utils.js.
// Carrega depois de app.js e compartilha o escopo global dele ($, api, esc, TODOS…).
'use strict';
const U = CrmUtils;
let ordem = 'recente', filtrosRestaurados = false;
$$('.nav-item').forEach(b => b.setAttribute('aria-label', TITULOS[b.dataset.view]?.[0] || b.dataset.view));
let geracaoLeads = 0;

/* ---------------- preferências locais (nunca dados de cliente) ---------------- */
function lerLS(chave, padrao) { try { const v = JSON.parse(localStorage.getItem(chave) ?? 'null'); return v ?? padrao; } catch { return padrao; } }
function gravarLS(chave, valor) { try { localStorage.setItem(chave, JSON.stringify(valor)); return true; } catch { return false; } }

function ordenarLeads() {
  ordem = $('#ordemLeads').value;
  const agora = Date.now();
  LEADS.sort((a, b) => ordem === 'nome' ? String(a.nome).localeCompare(String(b.nome), 'pt-BR')
    : ordem === 'valor' ? U.valorLead(b) - U.valorLead(a)
    : ordem === 'antigo' ? String(a.created_at).localeCompare(String(b.created_at))
    : ordem === 'parado' ? U.diasNaEtapa(b, agora) - U.diasNaEtapa(a, agora)
    : String(b.created_at).localeCompare(String(a.created_at)));
}
function salvarFiltros() {
  gravarLS('indycar_crm_filtros', {status: $('#fStatus').value, origem: $('#fOrigem').value, ordem: $('#ordemLeads').value, parados: $('#soParados').checked});
}
$('#ordemLeads').addEventListener('change', () => { ordenarLeads(); salvarFiltros(); PAG_LEADS = 1; renderTabelaLeads(); });
$('#soParados').addEventListener('change', () => { PAG_LEADS = 1; carregarLeads().catch(e => toast(e.message)); });
$('#limparFiltros').addEventListener('click', () => { $('#fStatus').value = ''; $('#fOrigem').value = ''; $('#search').value = ''; $('#ordemLeads').value = 'recente'; $('#soParados').checked = false; PAG_LEADS = 1; carregarLeads().catch(e => toast(e.message)); });
function baixarCsv(lista, nome) {
  const rows = [['Nome','Telefone','Carro','Placa','Serviço','Origem','Status','Orçado','Pago','Entrada','Dias na etapa','Campanha'], ...lista.map(l => [l.nome, l.telefone, l.carro_modelo, l.placa, l.servico, LABEL_ORIGEM[l.origem] || l.origem, LABEL_STATUS[l.status] || l.status, l.valor_orcado, l.valor_pago, l.created_at, U.diasNaEtapa(l), l.utm_campaign])];
  const url = URL.createObjectURL(new Blob([U.csv(rows)], {type: 'text/csv;charset=utf-8'}));
  const a = document.createElement('a'); a.href = url; a.download = nome + '-' + new Date().toISOString().slice(0, 10) + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`${lista.length} lead${lista.length === 1 ? '' : 's'} exportado${lista.length === 1 ? '' : 's'}`);
}
$('#exportarLeads').addEventListener('click', () => baixarCsv(LEADS, 'leads'));
$('#ecossistema').addEventListener('change', e => { if (e.target.value) window.open(e.target.value, '_blank', 'noopener,noreferrer'); e.target.value = ''; });
async function carregarSaude() {
  const el = $('#saudeSistema');
  try { const r = await api('/api/saude'); el.hidden = !r.avisos?.length; el.textContent = r.avisos?.length ? 'Atenção no ecossistema: ' + r.avisos.map(x => x.problema).join(' · ') : ''; }
  catch { el.hidden = false; el.textContent = 'Não foi possível conferir a saúde do ecossistema agora.'; }
}

/* ---------------- diálogos: foco preso, Esc, fundo inerte ---------------- */
const focos = new WeakMap();
function ativarDialogo(bg, titulo) {
  if (!bg.classList.contains('open')) return;
  if (!focos.has(bg) || !bg.contains(document.activeElement)) focos.set(bg, document.activeElement);
  const caixa = bg.firstElementChild; caixa.setAttribute('role', 'dialog'); caixa.setAttribute('aria-modal', 'true');
  if (titulo) caixa.setAttribute('aria-labelledby', titulo.slice(1)); else caixa.setAttribute('aria-label', 'Ficha 360 do cliente');
  $('.sidebar').setAttribute('inert', ''); $('main').setAttribute('inert', '');
  caixa.scrollTop = 0; (caixa.querySelector('.modal-x') || caixa.querySelector('button,input:not([type=hidden])'))?.focus();
}
function restaurarFoco(bg) {
  if (!$('.modal-bg.open')) { $('.sidebar').removeAttribute('inert'); $('main').removeAttribute('inert'); }
  const f = focos.get(bg); focos.delete(bg); if (f && document.contains(f)) f.focus();
}
/* <dialog> nativo para perguntas rápidas: devolve uma Promise com a resposta (ou null). */
function abrirDlg(dlg) {
  return new Promise(resolve => {
    const antes = document.activeElement;
    const fim = v => { dlg.removeEventListener('close', aoFechar); if (dlg.open) dlg.close(); antes?.focus?.(); resolve(v); };
    const aoFechar = () => fim(dlg.returnValue === '__ok' ? dlg._resposta : null);
    dlg.returnValue = ''; dlg._resposta = null; dlg.addEventListener('close', aoFechar);
    dlg._ok = v => { dlg._resposta = v; dlg.close('__ok'); };
    dlg.showModal();
  });
}
document.addEventListener('click', e => { const b = e.target.closest('dialog [data-fechar]'); if (b) b.closest('dialog').close(); });
// clique fora da caixa fecha
$$('dialog.dlg').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));

const MOTIVOS_PERDA = ['Achou caro', 'Foi em outra oficina', 'Sem retorno do cliente', 'Desistiu do serviço', 'Não fazemos o serviço', 'Prazo não atendeu', 'Outro'];
$('#motivosPerdaOpcoes').insertAdjacentHTML('beforeend', MOTIVOS_PERDA.map((m, i) => `<label class="motivo"><input type="radio" name="motivoPerda" value="${esc(m)}" ${i ? '' : ''}> ${esc(m)}</label>`).join(''));
$('#motivosPerdaOpcoes').addEventListener('change', () => { const outro = $('input[name=motivoPerda]:checked')?.value === 'Outro'; $('#perdaOutroL').hidden = !outro; if (outro) $('#perdaOutro').focus(); });
$('#formPerda').addEventListener('submit', e => {
  e.preventDefault();
  const sel = $('input[name=motivoPerda]:checked')?.value;
  const m = sel === 'Outro' ? $('#perdaOutro').value.trim() : sel;
  if (!m) { $('#perdaErro').textContent = sel === 'Outro' ? 'Escreva o motivo.' : 'Escolha um motivo — ele aparece no painel de perdas.'; return; }
  $('#dlgPerda')._ok(m);
});
function perguntarPerda(nome) {
  $('#dlgPerdaNome').textContent = nome ? `Lead: ${nome}` : ''; $('#perdaErro').textContent = '';
  $$('input[name=motivoPerda]').forEach(r => { r.checked = false; }); $('#perdaOutro').value = ''; $('#perdaOutroL').hidden = true;
  return abrirDlg($('#dlgPerda'));
}
$('#formPago').addEventListener('submit', e => {
  e.preventDefault();
  const v = Number($('#pagoValor').value);
  if ($('#pagoValor').value === '' || !Number.isFinite(v) || v < 0 || v > 10000000) { $('#pagoErro').textContent = 'Informe o valor pago (pode ser zero se foi cortesia).'; $('#pagoValor').setAttribute('aria-invalid', 'true'); return; }
  $('#dlgPago')._ok(Math.round(v * 100) / 100);
});
function perguntarPago(lead) {
  const sug = Number(lead.valor_orcado) || 0;
  $('#dlgPagoNome').textContent = `Lead: ${lead.nome || ''}`; $('#pagoErro').textContent = ''; $('#pagoValor').removeAttribute('aria-invalid');
  $('#pagoValor').value = Number(lead.valor_pago) || sug || '';
  const b = $('#pagoSugestao'); b.hidden = !sug; b.textContent = `Usar o orçado: ${brl(sug)}`; b.onclick = () => { $('#pagoValor').value = sug; $('#pagoValor').focus(); };
  const p = abrirDlg($('#dlgPago')); setTimeout(() => $('#pagoValor').select(), 30); return p;
}

/* ---------------- toast com "Desfazer" ---------------- */
function toastAcao(msg, rotulo, acao, ms = 7000) {
  toast(msg, ms);
  const b = $('#toastAcao'); b.hidden = false; b.textContent = rotulo;
  b.onclick = async () => { b.hidden = true; $('#toast').classList.remove('show'); try { await acao(); } catch (e) { toast('⚠️ ' + e.message); } };
}

/* ---------------- mudar etapa (com motivo da perda e valor pago) ---------------- */
function substituirLocal(novo) {
  if (!novo || !novo.id) return;
  const i = TODOS.findIndex(x => String(x.id) === String(novo.id));
  if (i >= 0) TODOS[i] = {...TODOS[i], ...novo}; else TODOS.unshift(novo);
}
function refiltrar() {
  const st = $('#fStatus').value, og = $('#fOrigem').value, q = $('#search').value.trim(), so = $('#soParados').checked, agora = Date.now();
  LEADS = TODOS.filter(l => (!st || l.status === st) && (!og || l.origem === og) && U.buscar(l, q) && (!so || U.parado(l, agora)));
  ordenarLeads();
  for (const id of [...SEL]) if (!TODOS.some(l => String(l.id) === id)) SEL.delete(id);
}
function redesenhar() {
  refiltrar(); renderTabelaLeads(); renderKanban(); if (STATS) renderPainel();
  $('#leadCount').textContent = `${LEADS.length} registro${LEADS.length === 1 ? '' : 's'}`;
  if (LEAD_ABERTO && modal.classList.contains('open')) { const l = TODOS.find(x => String(x.id) === String(LEAD_ABERTO)); if (l) renderFichaLead(l); }
}
async function patchLead(id, corpo) { return api('/api/leads/' + encodeURIComponent(id), {method: 'PATCH', body: JSON.stringify(corpo)}); }
/* Prepara o corpo da mudança: pede motivo ao perder e valor ao concluir. null = cancelado. */
async function corpoMudanca(l, novo) {
  const corpo = {status: novo};
  if (novo === 'perdido') { const m = await perguntarPerda(l.nome); if (!m) return null; corpo.observacoes = U.comMotivoPerda(l.observacoes, m); }
  if (novo === 'concluido') { const v = await perguntarPago(l); if (v === null) return null; corpo.valor_pago = v; }
  return corpo;
}
async function moverEtapa(id, novo, {anunciar} = {}) {
  const l = TODOS.find(x => String(x.id) === String(id));
  if (!l || l.status === novo) return false;
  const corpo = await corpoMudanca(l, novo); if (!corpo) return false;
  const antes = {status: l.status, valor_pago: l.valor_pago ?? 0, observacoes: l.observacoes ?? ''};
  try {
    substituirLocal(await patchLead(l.id, corpo) || {...l, ...corpo});
    redesenhar();
    const msg = `${l.nome} → ${LABEL_STATUS[novo] ?? novo}`;
    if (anunciar) $('#kbAnuncio').textContent = msg;
    toastAcao(msg, 'Desfazer', async () => { substituirLocal(await patchLead(l.id, antes)); redesenhar(); toast('Mudança desfeita'); });
    return true;
  } catch (e) { toast('⚠️ ' + e.message); redesenhar(); return false; }
}

/* ---------------- lista de leads: colunas, seleção, lote, páginas ---------------- */
let PAG_LEADS = 1; const SEL = new Set();
let COLUNAS = U.colunasValidas(lerLS('indycar_crm_colunas', null));
const ROTULO_COLUNA = {cliente: 'Cliente', carro: 'Carro', servico: 'Serviço', origem: 'Origem', valor: 'Valor', status: 'Status', etapa: 'Na etapa', entrada: 'Entrada', campanha: 'Campanha'};
function celula(c, l, agora) {
  switch (c) {
    case 'cliente': return `<td><div class="cell-main">${esc(l.nome)}</div><div class="cell-sub">${esc(U.formatarTelefone(l.telefone))}</div></td>`;
    case 'carro': return `<td><div class="cell-main">${esc(l.carro_modelo) || '—'}</div><div class="cell-sub">${esc(l.placa)}</div></td>`;
    case 'servico': return `<td>${esc(l.servico) || '—'}</td>`;
    case 'origem': return `<td><span class="tag">${esc(LABEL_ORIGEM[l.origem] ?? l.origem)}</span></td>`;
    case 'valor': return `<td class="num">${brl(U.valorLead(l))}</td>`;
    case 'status': return `<td><span class="badge b-${esc(l.status)}">${esc(LABEL_STATUS[l.status] ?? l.status)}</span></td>`;
    case 'etapa': { const d = U.diasNaEtapa(l, agora), p = U.parado(l, agora); return `<td class="cell-sub${p ? ' parado-txt' : ''}">${p ? '<span class="sr">Parado: </span>⚠ ' : ''}${esc(U.textoDias(d))}</td>`; }
    case 'entrada': return `<td class="cell-sub">${dt(l.created_at)}</td>`;
    case 'campanha': return `<td class="cell-sub">${esc(l.utm_campaign) || '—'}</td>`;
  }
  return '<td></td>';
}
function linhaLead(l, {selecao = false, cols = COLUNAS, agora = Date.now()} = {}) {
  const id = String(l.id), marcado = SEL.has(id);
  return `<tr data-id="${esc(id)}" tabindex="0" aria-label="Abrir ${esc(l.nome)}"${marcado ? ' class="sel"' : ''}>
    ${selecao ? `<td class="col-sel"><input type="checkbox" class="sel-lead" aria-label="Selecionar ${esc(l.nome)}" ${marcado ? 'checked' : ''}></td>` : ''}
    ${cols.map(c => celula(c, l, agora)).join('')}</tr>`;
}
const VAZIO_LEADS = '<tbody><tr><td class="vazio-celula"><strong>Nenhum lead encontrado.</strong><br>Limpe os filtros ou use <kbd>N</kbd> / + Novo Lead para começar.</td></tr></tbody>';
function renderTabela(sel, rows, {selecao = false, cols = COLUNAS} = {}) {
  const el = $(sel);
  if (!rows.length) { el.innerHTML = VAZIO_LEADS; return; }
  const agora = Date.now();
  const todosSel = selecao && rows.every(l => SEL.has(String(l.id)));
  el.innerHTML = `<thead><tr>${selecao ? `<th class="col-sel"><input type="checkbox" id="selPagina" aria-label="Selecionar todos desta página" ${todosSel ? 'checked' : ''}></th>` : ''}${cols.map(c => `<th${c === 'valor' ? ' class="num"' : ''}>${ROTULO_COLUNA[c]}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(l => linhaLead(l, {selecao, cols, agora})).join('')}</tbody>`;
}
function renderTabelaLeads() {
  const p = U.paginar(LEADS, PAG_LEADS, 50); PAG_LEADS = p.pagina;
  renderTabela('#tblLeads', p.itens, {selecao: true});
  renderPaginacao($('#pagLeads'), p, n => { PAG_LEADS = n; renderTabelaLeads(); $('#tblLeads').scrollIntoView({block: 'start', behavior: 'smooth'}); });
  atualizarLote();
}
function renderPaginacao(nav, p, ir) {
  if (p.paginas <= 1) { nav.innerHTML = p.total ? `<span class="filter-count">${p.total} no total</span>` : ''; return; }
  nav.innerHTML = `<button type="button" class="btn btn-ghost sm" data-pag="${p.pagina - 1}" ${p.pagina === 1 ? 'disabled' : ''} aria-label="Página anterior">‹</button>
    <span class="filter-count">${p.de}–${p.ate} de ${p.total} · página ${p.pagina} de ${p.paginas}</span>
    <button type="button" class="btn btn-ghost sm" data-pag="${p.pagina + 1}" ${p.pagina === p.paginas ? 'disabled' : ''} aria-label="Próxima página">›</button>`;
  nav.onclick = e => { const b = e.target.closest('[data-pag]'); if (b && !b.disabled) ir(Number(b.dataset.pag)); };
}
// um único ouvinte por tabela (antes: um por linha a cada render)
for (const sel of ['#tblLeads', '#tblRecent']) {
  $(sel).addEventListener('click', e => {
    if (e.target.id === 'selPagina') { const p = U.paginar(LEADS, PAG_LEADS, 50); p.itens.forEach(l => e.target.checked ? SEL.add(String(l.id)) : SEL.delete(String(l.id))); renderTabelaLeads(); return; }
    const cb = e.target.closest('.sel-lead'); const tr = e.target.closest('tbody tr[data-id]');
    if (cb && tr) { cb.checked ? SEL.add(tr.dataset.id) : SEL.delete(tr.dataset.id); tr.classList.toggle('sel', cb.checked); atualizarLote(); const todos = $('#selPagina'); if (todos) todos.checked = $$('.sel-lead', $(sel)).every(x => x.checked); return; }
    if (e.target.closest('.col-sel')) return;
    if (tr) abrirModal(tr.dataset.id);
  });
}
function atualizarLote() {
  const n = SEL.size; $('#barraLote').hidden = !n;
  $('#loteQtd').textContent = `${n} selecionado${n === 1 ? '' : 's'}`;
}
$('#loteLimpar').addEventListener('click', () => { SEL.clear(); renderTabelaLeads(); });
$('#loteExportar').addEventListener('click', () => baixarCsv(TODOS.filter(l => SEL.has(String(l.id))), 'leads-selecionados'));
async function emLote(ids, corpoDe, rotulo) {
  const alvos = TODOS.filter(l => ids.includes(String(l.id)));
  const antes = alvos.map(l => ({id: l.id, corpo: {status: l.status, origem: l.origem, valor_pago: l.valor_pago ?? 0, observacoes: l.observacoes ?? ''}}));
  let ok = 0; const falhas = [];
  for (const l of alvos) { try { substituirLocal(await patchLead(l.id, corpoDe(l))); ok++; } catch (e) { falhas.push(l.nome + ': ' + e.message); } }
  SEL.clear(); redesenhar();
  if (falhas.length) toast(`⚠️ ${ok} atualizados, ${falhas.length} com erro — ${falhas[0]}`, 6000);
  else toastAcao(`${ok} lead${ok === 1 ? '' : 's'} ${rotulo}`, 'Desfazer', async () => {
    for (const a of antes) substituirLocal(await patchLead(a.id, a.corpo)); redesenhar(); toast('Ação em lote desfeita');
  }, 9000);
}
$('#loteStatus').addEventListener('change', async e => {
  const novo = e.target.value; e.target.value = ''; if (!novo || !SEL.size) return;
  const ids = [...SEL];
  let motivo = null;
  if (novo === 'perdido') { motivo = await perguntarPerda(`${ids.length} lead(s) selecionado(s)`); if (!motivo) return; }
  if (novo === 'concluido' && !confirm(`Concluir ${ids.length} lead(s)? O valor pago de cada um será o valor orçado (quando ainda não houver pagamento registrado). Dá para ajustar depois na ficha.`)) return;
  await emLote(ids, l => ({status: novo, ...(motivo ? {observacoes: U.comMotivoPerda(l.observacoes, motivo)} : {}), ...(novo === 'concluido' && !(Number(l.valor_pago) > 0) ? {valor_pago: Number(l.valor_orcado) || 0} : {})}), `movidos para ${LABEL_STATUS[novo]}`);
});
$('#loteOrigem').addEventListener('change', async e => {
  const o = e.target.value; e.target.value = ''; if (!o || !SEL.size) return;
  await emLote([...SEL], () => ({origem: o}), `com origem ${LABEL_ORIGEM[o] ?? o}`);
});
// colunas configuráveis
function montarColunas() {
  $('#painelColunas').innerHTML = U.COLUNAS_LEADS.map(c => `<label><input type="checkbox" value="${c}" ${COLUNAS.includes(c) ? 'checked' : ''} ${c === 'cliente' ? 'disabled' : ''}> ${ROTULO_COLUNA[c]}</label>`).join('') + '<button type="button" class="btn btn-ghost sm" id="colunasPadrao">Voltar ao padrão</button>';
}
$('#btnColunas').addEventListener('click', () => { const p = $('#painelColunas'), abrir = p.hidden; if (abrir) montarColunas(); p.hidden = !abrir; $('#btnColunas').setAttribute('aria-expanded', String(abrir)); if (abrir) p.querySelector('input:not([disabled])')?.focus(); });
$('#painelColunas').addEventListener('change', () => { COLUNAS = U.colunasValidas(['cliente', ...$$('#painelColunas input:checked').map(i => i.value)]); gravarLS('indycar_crm_colunas', COLUNAS); renderTabelaLeads(); });
$('#painelColunas').addEventListener('click', e => { if (e.target.id === 'colunasPadrao') { COLUNAS = U.COLUNAS_PADRAO.slice(); gravarLS('indycar_crm_colunas', COLUNAS); montarColunas(); renderTabelaLeads(); } });
document.addEventListener('click', e => { if (!e.target.closest('.colunas-menu') && !$('#painelColunas').hidden) { $('#painelColunas').hidden = true; $('#btnColunas').setAttribute('aria-expanded', 'false'); } });

/* ---------------- funil (kanban) ---------------- */
const LIMITE_CARTOES = 40; const COLUNAS_ABERTAS = new Set();
function cartaoKanban(l, agora) {
  const d = U.diasNaEtapa(l, agora), p = U.parado(l, agora);
  return `<div class="kb-card${p ? ' parado' : ''}" data-id="${esc(l.id)}" tabindex="0" role="button" aria-roledescription="cartão arrastável" aria-label="${esc(l.nome)}, ${esc(LABEL_STATUS[l.status] ?? l.status)}, ${esc(U.textoDias(d))} na etapa${p ? ', parado' : ''}">
    <span class="kb-alca" aria-hidden="true" title="Arraste para mudar de etapa">⠿</span>
    <div class="kb-nome">${esc(l.nome)}</div>
    <div class="kb-meta">${esc(l.carro_modelo) || '—'} · ${esc(l.servico) || 'serviço n/d'}</div>
    <div class="kb-rodape"><span class="kb-valor">${brl(U.valorLead(l))}</span><span class="kb-tempo${p ? ' alerta' : ''}" title="Tempo desde a última mudança">${p ? '⚠ ' : ''}${esc(U.textoDias(d))}</span></div>
    <select class="kb-etapa" aria-label="Mover ${esc(l.nome)} para outra etapa" data-lead="${esc(l.id)}">
      ${STATUSES.map(s => `<option value="${esc(s)}" ${s === l.status ? 'selected' : ''}>${esc(LABEL_STATUS[s] ?? s)}</option>`).join('')}
    </select>
  </div>`;
}
function renderKanban() {
  const busca = $('#search').value, agora = Date.now();
  let total = 0, parados = 0;
  $('#kanban').innerHTML = STATUSES.map(st => {
    const its = TODOS.filter(l => l.status === st && U.buscar(l, busca));
    const r = U.resumoColuna(its, agora); total += r.qtd; parados += r.parados;
    const mostrar = COLUNAS_ABERTAS.has(st) ? its : its.slice(0, LIMITE_CARTOES);
    return `<div class="kb-col" data-etapa="${esc(st)}" role="group" aria-label="${esc(LABEL_STATUS[st] ?? st)}: ${r.qtd} leads, ${esc(brl(r.valor))}">
      <div class="kb-head"><span>${esc(LABEL_STATUS[st] ?? st)}</span><span class="kb-count">${r.qtd}</span></div>
      <div class="kb-soma"><b>${brl(r.valor)}</b>${r.parados ? `<span class="kb-parados" title="Leads parados nesta etapa">⚠ ${r.parados} parado${r.parados === 1 ? '' : 's'}</span>` : ''}</div>
      <div class="kb-lista">${mostrar.map(l => cartaoKanban(l, agora)).join('') || '<p class="kb-vazio">Solte um cartão aqui</p>'}
      ${its.length > mostrar.length ? `<button type="button" class="btn btn-ghost sm kb-mais" data-etapa="${esc(st)}">Mostrar mais ${its.length - mostrar.length}</button>` : ''}</div>
    </div>`;
  }).join('');
  $('#kbResumo').textContent = `${total} lead${total === 1 ? '' : 's'} no funil${parados ? ` · ${parados} parado${parados === 1 ? '' : 's'}` : ''}`;
}
const kanban = $('#kanban');
let arrastou = false;
kanban.addEventListener('click', e => {
  if (arrastou) { arrastou = false; return; }
  const mais = e.target.closest('.kb-mais'); if (mais) { COLUNAS_ABERTAS.add(mais.dataset.etapa); renderKanban(); return; }
  if (e.target.closest('.kb-etapa')) return;
  const c = e.target.closest('.kb-card'); if (c) abrirModal(c.dataset.id);
});
kanban.addEventListener('change', async e => {
  const s = e.target.closest('.kb-etapa'); if (!s) return;
  const l = TODOS.find(x => String(x.id) === s.dataset.lead); if (!l) return;
  const novo = s.value; s.value = l.status; s.disabled = true;
  await moverEtapa(l.id, novo); s.disabled = false;
});
kanban.addEventListener('keydown', async e => {
  if (e.target.closest('.kb-etapa')) { e.stopPropagation(); return; }
  const c = e.target.closest('.kb-card'); if (!c || !e.shiftKey || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  e.preventDefault(); e.stopPropagation();
  const l = TODOS.find(x => String(x.id) === c.dataset.id); if (!l) return;
  const i = STATUSES.indexOf(l.status) + (e.key === 'ArrowRight' ? 1 : -1);
  if (i < 0 || i >= STATUSES.length) return;
  const id = l.id;
  if (await moverEtapa(id, STATUSES[i], {anunciar: true})) $(`.kb-card[data-id="${CSS.escape(String(id))}"]`)?.focus();
});
// arrastar: com o mouse pelo cartão inteiro; no toque pela alça ⠿ (touch-action:none),
// para o dedo no resto do cartão continuar rolando o funil normalmente
let arrasto = null;
kanban.addEventListener('pointerdown', e => {
  const card = e.target.closest('.kb-card');
  if (!card || e.target.closest('select,button,a') || (e.pointerType === 'mouse' && e.button !== 0)) return;
  if (e.pointerType !== 'mouse' && !e.target.closest('.kb-alca')) return;
  arrasto = {card, id: card.dataset.id, x: e.clientX, y: e.clientY, ativo: false, pid: e.pointerId, toque: e.pointerType !== 'mouse'};
  if (arrasto.toque) { e.preventDefault(); iniciarArrasto(e.clientX, e.clientY); }
});
function iniciarArrasto(x, y) {
  const a = arrasto; a.ativo = true;
  const r = a.card.getBoundingClientRect();
  a.dx = x - r.left; a.dy = y - r.top;
  a.fantasma = a.card.cloneNode(true); a.fantasma.classList.add('kb-fantasma'); a.fantasma.removeAttribute('tabindex'); a.fantasma.setAttribute('aria-hidden', 'true');
  a.fantasma.style.width = r.width + 'px'; document.body.append(a.fantasma);
  a.card.classList.add('arrastando'); document.body.classList.add('arrastando-kb');
  moverFantasma(x, y);
  if (navigator.vibrate && a.toque) navigator.vibrate(15);
}
function moverFantasma(x, y) {
  const a = arrasto; a.fantasma.style.transform = `translate(${x - a.dx}px, ${y - a.dy}px) rotate(2deg)`;
  const kr = kanban.getBoundingClientRect();
  // perto da borda o dedo sai do funil: procura a coluna dentro dele, na mesma altura
  const px = Math.min(Math.max(x, kr.left + 6), kr.right - 6), py = Math.min(Math.max(y, kr.top + 6), kr.bottom - 6);
  const col = document.elementFromPoint(px, py)?.closest('.kb-col');
  $$('.kb-col.alvo').forEach(c => c !== col && c.classList.remove('alvo')); col?.classList.add('alvo'); a.col = col;
  // rola o funil perto das bordas
  if (x > kr.right - 40) kanban.scrollLeft += 18; else if (x < kr.left + 40) kanban.scrollLeft -= 18;
}
document.addEventListener('pointermove', e => {
  const a = arrasto; if (!a || e.pointerId !== a.pid) return;
  if (!a.ativo) {
    if (Math.hypot(e.clientX - a.x, e.clientY - a.y) < 6) return;
    iniciarArrasto(e.clientX, e.clientY);
  }
  moverFantasma(e.clientX, e.clientY);
});
document.addEventListener('touchmove', e => { if (arrasto?.ativo) e.preventDefault(); }, {passive: false});
async function soltar(e, cancelar) {
  const a = arrasto; if (!a || (e && e.pointerId !== a.pid)) return;
  arrasto = null;
  if (!a.ativo) return;
  arrastou = true; setTimeout(() => { arrastou = false; }, 50);
  a.fantasma.remove(); a.card.classList.remove('arrastando'); document.body.classList.remove('arrastando-kb');
  $$('.kb-col.alvo').forEach(c => c.classList.remove('alvo'));
  if (!cancelar && a.col) await moverEtapa(a.id, a.col.dataset.etapa, {anunciar: true});
}
document.addEventListener('pointerup', e => soltar(e, false));
document.addEventListener('pointercancel', e => soltar(e, true));
kanban.addEventListener('contextmenu', e => { if (arrasto) e.preventDefault(); });

/* ---------------- painel (dashboard) ---------------- */
let PERIODO = lerLS('indycar_crm_periodo', {chave: '7', ini: '', fim: ''});
if (!['hoje', '7', '30', 'mes', 'personalizado'].includes(PERIODO.chave)) PERIODO = {chave: '7', ini: '', fim: ''};
function marcarPeriodo() {
  $$('#periodoPilulas [data-periodo]').forEach(b => { const on = b.dataset.periodo === PERIODO.chave; b.classList.toggle('ativo', on); b.setAttribute('aria-pressed', String(on)); });
  $('#periodoDatas').hidden = PERIODO.chave !== 'personalizado';
  $('#perIni').value = PERIODO.ini || ''; $('#perFim').value = PERIODO.fim || '';
}
$('#periodoPilulas').addEventListener('click', e => {
  const b = e.target.closest('[data-periodo]'); if (!b) return;
  PERIODO = {...PERIODO, chave: b.dataset.periodo};
  if (PERIODO.chave === 'personalizado' && !PERIODO.ini) { const h = new Date(), iso = d => new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); PERIODO.fim = iso(h); PERIODO.ini = iso(new Date(h.getFullYear(), h.getMonth() - 1, h.getDate())); }
  gravarLS('indycar_crm_periodo', PERIODO); marcarPeriodo(); renderPainel();
  if (PERIODO.chave === 'personalizado') $('#perIni').focus();
});
$('#periodoDatas').addEventListener('submit', e => { e.preventDefault(); PERIODO = {chave: 'personalizado', ini: $('#perIni').value, fim: $('#perFim').value}; gravarLS('indycar_crm_periodo', PERIODO); renderPainel(); });
function setaDelta(p, sufixo = '%', inverso = false) {
  if (p === null) return '<span class="up">▲ novo</span>';
  if (!p) return '<span class="flat">— igual</span>';
  const bom = inverso ? p < 0 : p > 0;
  return `<span class="${bom ? 'up' : 'down'}">${p > 0 ? '▲' : '▼'} ${Math.abs(p)}${sufixo}</span>`;
}
const fmtData = d => d.toLocaleDateString('pt-BR', {day: '2-digit', month: '2-digit'});
function renderPainel() {
  marcarPeriodo();
  let P;
  try { P = U.periodo(PERIODO.chave, new Date(), PERIODO.ini, PERIODO.fim); }
  catch (e) { $('#periodoTxt').textContent = e.message; return; }
  const a = U.metricas(TODOS, P.ini, P.fim), b = U.metricas(TODOS, P.antIni, P.antFim), agora = Date.now();
  const ultimo = new Date(P.fim.getTime() - 86400000);
  $('#periodoTxt').textContent = `${fmtData(P.ini)}${P.dias > 1 ? ' a ' + fmtData(ultimo) : ''} · comparado com ${fmtData(P.antIni)} a ${fmtData(new Date(P.antFim.getTime() - 86400000))}`;
  const abertos = TODOS.filter(l => U.ABERTAS.includes(l.status)), parados = abertos.filter(l => U.parado(l, agora));
  const emAberto = abertos.reduce((s, l) => s + U.valorLead(l), 0);
  const kpi = (rotulo, valor, delta, extra = '') => `<div class="kpi"><div class="kpi-label">${rotulo}</div><div class="kpi-value">${valor}</div><div class="kpi-delta">${delta}${extra}</div></div>`;
  $('#kpis').innerHTML =
    kpi('Leads novos', a.entradas, setaDelta(U.comparar(a.entradas, b.entradas))) +
    kpi('Faturamento', brl(a.faturamento), setaDelta(U.comparar(a.faturamento, b.faturamento))) +
    kpi('Conversão', a.conversao.toLocaleString('pt-BR') + '%', setaDelta(Math.round(a.conversao - b.conversao) || 0, ' p.p.'), `<span class="flat"> · ${a.ganhos} fechados, ${a.perdidos} perdidos</span>`) +
    kpi('Ticket médio', brl(a.ticket), setaDelta(U.comparar(a.ticket, b.ticket))) +
    kpi('Tempo até fechar', a.cicloMedio === null ? '—' : a.cicloMedio.toLocaleString('pt-BR') + ' d', a.cicloMedio === null || b.cicloMedio === null ? '<span class="flat">média de dias da entrada ao concluído</span>' : setaDelta(U.comparar(a.cicloMedio, b.cicloMedio), '%', true)) +
    kpi('Em aberto', brl(emAberto), `<span class="${parados.length ? 'down' : 'flat'}">${abertos.length} leads · ${parados.length} parado${parados.length === 1 ? '' : 's'}</span>`);
  $$('#kpis .kpi').forEach(k => k.addEventListener('pointermove', e => { const r = k.getBoundingClientRect(); k.style.setProperty('--mx', `${e.clientX - r.left}px`); k.style.setProperty('--my', `${e.clientY - r.top}px`); }));
  renderMetas();
  // precisam de atenção
  $('#paradosCount').textContent = parados.length ? `${parados.length} parado${parados.length === 1 ? '' : 's'}` : '';
  const lista = parados.sort((x, y) => U.diasNaEtapa(y, agora) - U.diasNaEtapa(x, agora)).slice(0, 7);
  $('#listaParados').innerHTML = lista.length ? lista.map(l => `<button type="button" class="item-curto" data-lead="${esc(l.id)}">
      <span><strong>${esc(l.nome)}</strong><small>${esc(LABEL_STATUS[l.status] ?? l.status)} · ${esc(l.servico) || 'serviço n/d'}</small></span>
      <span class="parado-txt">${esc(U.textoDias(U.diasNaEtapa(l, agora)))}</span></button>`).join('') + (parados.length > lista.length ? `<button type="button" class="btn btn-ghost sm" id="verParados">Ver todos os ${parados.length}</button>` : '')
    : '<p class="vazio-curto">Tudo em dia. Nenhum lead parado. 🏁</p>';
  // funil do período
  const entradas = TODOS.filter(l => { const t = Date.parse(l.created_at); return t >= +P.ini && t < +P.fim; });
  const f = U.funilPassagem(entradas), max = Math.max(1, ...f.map(x => x.chegaram));
  $('#funnelMini').innerHTML = entradas.length ? f.map(x => `<div class="fm-row" data-etapa="${esc(x.etapa)}"><span class="fm-name">${esc(LABEL_STATUS[x.etapa])}</span>
      <div class="fm-bar"><div class="fm-fill" style="width:${(x.chegaram / max) * 100}%"></div></div>
      <span class="fm-num">${x.chegaram}</span><span class="fm-taxa" title="Passaram da etapa anterior">${x.taxa}%</span></div>`).join('')
    : '<p class="vazio-curto">Nenhum lead entrou neste período.</p>';
  // conversão por origem
  const o = a.porOrigem;
  $('#tblOrigemPainel').innerHTML = o.length ? `<thead><tr><th>Origem</th><th class="num">Leads</th><th class="num">Fechou</th><th class="num">Conversão</th><th class="num">Faturou</th></tr></thead><tbody>${o.map(x => `<tr class="sem-clique">
      <td><span class="origin-name"><span class="dot" style="background:${COR_ORIGEM[x.origem] || '#888'}"></span>${esc(LABEL_ORIGEM[x.origem] ?? x.origem)}</span></td>
      <td class="num">${x.leads}</td><td class="num">${x.ganhos}</td><td class="num">${x.conversao}%</td><td class="num">${brl(x.faturamento)}</td></tr>`).join('')}</tbody>`
    : '<tbody><tr><td class="vazio-celula">Sem leads neste período.</td></tr></tbody>';
  // motivos de perda
  const mx = Math.max(1, ...a.motivos.map(m => m.qtd));
  $('#motivosPerda').innerHTML = a.motivos.length ? a.motivos.map(m => `<div class="motivo-row"><span>${esc(m.motivo)}</span><div class="fm-bar"><div class="fm-fill perda" style="width:${m.qtd / mx * 100}%"></div></div><b>${m.qtd}</b></div>`).join('')
    : '<p class="vazio-curto">Nenhuma perda neste período.</p>';
  renderTabela('#tblRecent', TODOS.slice(0, 8), {cols: ['cliente', 'carro', 'servico', 'origem', 'valor', 'status', 'entrada']});
  renderTarefas();
}
$('#listaParados').addEventListener('click', e => {
  const b = e.target.closest('[data-lead]'); if (b) return abrirModal(b.dataset.lead);
  if (e.target.id === 'verParados') { $('#soParados').checked = true; $('#ordemLeads').value = 'parado'; irPara('leads'); carregarLeads().catch(x => toast(x.message)); }
});

/* metas do mês (guardadas no aparelho) */
const META_KEY = 'indycar_crm_metas';
function renderMetas() {
  const m = lerLS(META_KEY, {}), P = U.periodo('mes'), r = U.metricas(TODOS, P.ini, P.fim);
  const hoje = new Date(), diasMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate(), passados = hoje.getDate();
  const itens = [['Faturamento', r.faturamento, Number(m.faturamento) || 0, brl], ['Serviços fechados', r.ganhos, Number(m.fechados) || 0, v => String(v)], ['Leads novos', r.entradas, Number(m.leads) || 0, v => String(v)]].filter(x => x[2] > 0);
  if (!itens.length) { $('#metasMes').innerHTML = '<p class="vazio-curto">Defina as metas do mês para acompanhar o ritmo da equipe.</p>'; return; }
  $('#metasMes').innerHTML = itens.map(([rot, atual, alvo, fmt]) => {
    const pct = Math.min(100, Math.round(atual / alvo * 100)), proj = Math.round(atual / passados * diasMes);
    const ritmo = proj >= alvo ? '<span class="up">no ritmo</span>' : `<span class="down">projeção ${fmt(proj)}</span>`;
    return `<div class="meta"><div class="meta-topo"><span>${rot}</span><b>${fmt(atual)} <small>de ${fmt(alvo)}</small></b></div>
      <div class="meta-barra" role="progressbar" aria-label="${rot}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div style="width:${pct}%"></div></div>
      <div class="meta-pe"><span>${pct}%</span>${ritmo}</div></div>`;
  }).join('');
}
$('#btnMetas').addEventListener('click', async () => {
  const m = lerLS(META_KEY, {});
  $('#metaFat').value = m.faturamento || ''; $('#metaFech').value = m.fechados || ''; $('#metaLeads').value = m.leads || '';
  const r = await abrirDlg($('#dlgMetas'));
  if (r) { gravarLS(META_KEY, r); renderMetas(); toast('Metas salvas neste aparelho'); }
});
$('#formMetas').addEventListener('submit', e => {
  e.preventDefault();
  const n = id => Math.max(0, Math.min(10000000, Number($(id).value) || 0));
  $('#dlgMetas')._ok({faturamento: n('#metaFat'), fechados: Math.round(n('#metaFech')), leads: Math.round(n('#metaLeads'))});
});

/* ---------------- lembretes do vendedor (localStorage por usuário) ---------------- */
const chaveTarefas = () => 'indycar_crm_tarefas_' + (PERFIL?.id || 'anon');
const lerTarefas = () => { const t = lerLS(chaveTarefas(), []); return Array.isArray(t) ? t : []; };
function gravarTarefas(t) { if (!gravarLS(chaveTarefas(), t.slice(-300))) toast('⚠️ Não consegui guardar o lembrete neste navegador.'); }
const ROTULO_SIT = {atrasada: 'Atrasado', hoje: 'Hoje', futura: '', sem_data: '', feita: 'Feito'};
function htmlTarefas(lista, comLead) {
  if (!lista.length) return '<p class="vazio-curto">Nenhum lembrete. Anote o próximo passo para não esquecer.</p>';
  return U.ordenarTarefas(lista).map(t => { const s = U.situacaoTarefa(t);
    return `<div class="tarefa ${s}" data-tarefa="${esc(t.id)}">
      <input type="checkbox" class="tarefa-ok" aria-label="Marcar como feito: ${esc(t.texto)}" ${t.feita ? 'checked' : ''}>
      <span class="tarefa-txt">${esc(t.texto)}${comLead && t.leadId ? ` <button type="button" class="tarefa-lead" data-lead="${esc(t.leadId)}">${esc(t.leadNome || 'abrir lead')}</button>` : ''}</span>
      ${t.para ? `<span class="tarefa-data">${ROTULO_SIT[s] ? `<b>${ROTULO_SIT[s]}</b> · ` : ''}${esc(dtSimples(t.para))}</span>` : ''}
      <button type="button" class="tarefa-x" aria-label="Apagar lembrete: ${esc(t.texto)}">×</button></div>`; }).join('');
}
function renderTarefas() {
  const todas = lerTarefas(), pend = todas.filter(t => !t.feita || Date.now() - Date.parse(t.feitaEm || 0) < 86400000);
  $('#tarefasPainel').innerHTML = htmlTarefas(pend.slice(0, 40), true);
  if (LEAD_ABERTO) { const doLead = todas.filter(t => t.leadId === String(LEAD_ABERTO)); $('#tarefasLead').innerHTML = htmlTarefas(doLead, false); $('#lfQtdLembretes').textContent = doLead.filter(t => !t.feita).length || ''; }
  const atrasadas = todas.filter(t => U.situacaoTarefa(t) === 'atrasada' || U.situacaoTarefa(t) === 'hoje').length;
  const nav = $('.nav-item[data-view="dashboard"]'); nav.dataset.badge = atrasadas || ''; nav.setAttribute('aria-label', 'Dashboard' + (atrasadas ? `, ${atrasadas} lembrete(s) para hoje` : ''));
}
function addTarefa(texto, para, lead) {
  try { const t = U.novaTarefa({texto, para, leadId: lead?.id, leadNome: lead?.nome}); gravarTarefas([...lerTarefas(), t]); renderTarefas(); return true; }
  catch (e) { toast('⚠️ ' + e.message); return false; }
}
$('#formTarefaPainel').addEventListener('submit', e => { e.preventDefault(); if (addTarefa($('#tarefaTexto').value, $('#tarefaData').value)) { $('#tarefaTexto').value = ''; $('#tarefaData').value = ''; $('#tarefaTexto').focus(); } });
$('#formTarefaLead').addEventListener('submit', e => { e.preventDefault(); const l = TODOS.find(x => String(x.id) === String(LEAD_ABERTO)); if (addTarefa($('#tarefaLeadTexto').value, $('#tarefaLeadData').value, l)) { $('#tarefaLeadTexto').value = ''; $('#tarefaLeadData').value = ''; $('#tarefaLeadTexto').focus(); } });
for (const alvo of ['#tarefasPainel', '#tarefasLead']) $(alvo).addEventListener('click', e => {
  const box = e.target.closest('[data-tarefa]'); if (!box) return;
  const id = box.dataset.tarefa, todas = lerTarefas(), t = todas.find(x => x.id === id); if (!t) return;
  if (e.target.closest('.tarefa-lead')) return abrirModal(e.target.closest('.tarefa-lead').dataset.lead);
  if (e.target.closest('.tarefa-x')) { gravarTarefas(todas.filter(x => x.id !== id)); renderTarefas(); toastAcao('Lembrete apagado', 'Desfazer', () => { gravarTarefas([...lerTarefas(), t]); renderTarefas(); }); return; }
  if (e.target.classList.contains('tarefa-ok')) { t.feita = e.target.checked; t.feitaEm = t.feita ? new Date().toISOString() : null; gravarTarefas(todas); renderTarefas(); }
});

/* ---------------- ficha do lead (gaveta) ---------------- */
let LEAD_ABERTO = null, LT_GERACAO = 0;
function emitirLead(l) { window.dispatchEvent(new CustomEvent('indycar:lead', {detail: {leadId: l ? l.id : null, clienteId: l ? (l.cliente_id ?? null) : null}})); }
function botaoAcao(href, rotulo, icone, extra = '') { return href ? `<a class="acao" href="${esc(href)}" ${href.startsWith('tel:') ? '' : 'target="_blank" rel="noopener noreferrer"'} ${extra}><span aria-hidden="true">${icone}</span>${rotulo}</a>` : ''; }
function renderFichaLead(l) {
  const agora = Date.now(), d = U.diasNaEtapa(l, agora), p = U.parado(l, agora), motivo = U.motivoPerda(l.observacoes);
  $('#lfTopo').innerHTML = `<span class="avatar">${esc(iniciais(l.nome))}</span>
    <div class="lf-id"><div class="ficha-nome">${esc(l.nome)}</div>
      <div class="ficha-sub">${esc(U.formatarTelefone(l.telefone))}${l.carro_modelo ? ' · ' + esc(l.carro_modelo) : ''}${l.placa ? ' · ' + esc(l.placa) : ''}</div>
      <div class="lf-tags"><span class="badge b-${esc(l.status)}">${esc(LABEL_STATUS[l.status] ?? l.status)}</span><span class="tag">${esc(LABEL_ORIGEM[l.origem] ?? l.origem ?? '')}</span>
        <span class="lf-tempo${p ? ' alerta' : ''}">${p ? '⚠ parado há ' + esc(U.textoDias(d)) : d ? 'na etapa há ' + esc(U.textoDias(d)) : 'mexido hoje'}</span>${motivo ? `<span class="tag">Perda: ${esc(motivo)}</span>` : ''}</div></div>
    <div class="lf-valor"><span>${l.status === 'concluido' ? 'Pago' : 'Orçado'}</span><b>${brl(U.valorLead(l))}</b>${l.servico ? `<small>${esc(l.servico)}</small>` : ''}</div>`;
  $('#lfAcoes').innerHTML = botaoAcao(U.linkConversa(l.telefone), 'Abrir conversa', '💬') + botaoAcao(U.linkWhatsApp(l.telefone), 'WhatsApp', '🟢') +
    botaoAcao(U.linkLigar(l.telefone), 'Ligar', '📞') + botaoAcao(U.linkAgenda(l.telefone), 'Agendar', '📅') + botaoAcao(U.linkComunicar(l.telefone), 'Mandar mensagem', '✉️') +
    `<button type="button" class="acao" data-acao="copiar"><span aria-hidden="true">📋</span>Copiar telefone</button>` +
    (l.cliente_id ? `<button type="button" class="acao" data-acao="ficha360"><span aria-hidden="true">🪪</span>Ficha 360</button>` : '');
  $('#lfEtapas').innerHTML = STATUSES.map(s => `<button type="button" class="etapa-btn" data-etapa="${esc(s)}" aria-pressed="${s === l.status}">${esc(LABEL_STATUS[s] ?? s)}</button>`).join('');
}
$('#lfAcoes').addEventListener('click', async e => {
  const b = e.target.closest('[data-acao]'); if (!b) return;
  const l = TODOS.find(x => String(x.id) === String(LEAD_ABERTO)); if (!l) return;
  if (b.dataset.acao === 'copiar') { try { await navigator.clipboard.writeText(U.telE164(l.telefone) || l.telefone); toast('Telefone copiado'); } catch { toast('Não consegui copiar. Telefone: ' + l.telefone); } }
  if (b.dataset.acao === 'ficha360') { fecharModal(true); abrirFichaCliente(l.cliente_id); }
});
$('#lfEtapas').addEventListener('click', async e => {
  const b = e.target.closest('[data-etapa]'); if (!b || b.getAttribute('aria-pressed') === 'true') return;
  if (formSujo()) { toast('Salve ou desfaça as alterações dos Dados antes de mudar a etapa.'); return; }
  if (await moverEtapa(LEAD_ABERTO, b.dataset.etapa)) { const l = TODOS.find(x => String(x.id) === String(LEAD_ABERTO)); if (l) { preencherForm(l); carregarLinhaTempo(l); } $(`#lfEtapas [data-etapa="${CSS.escape(b.dataset.etapa)}"]`)?.focus(); }
});
// abas da ficha (setas do teclado trocam a aba, padrão WAI-ARIA)
const ABAS = ['abaTl', 'abaDados', 'abaLembretes'];
function mostrarAba(id, focar) {
  for (const a of ABAS) { const on = a === id, el = $('#' + a); el.setAttribute('aria-selected', String(on)); el.tabIndex = on ? 0 : -1; $('#' + el.getAttribute('aria-controls')).hidden = !on; }
  if (focar) $('#' + id).focus();
}
$('.lf-abas').addEventListener('click', e => { const t = e.target.closest('[role=tab]'); if (t) mostrarAba(t.id); });
$('.lf-abas').addEventListener('keydown', e => {
  const i = ABAS.indexOf(document.activeElement.id); if (i < 0) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); mostrarAba(ABAS[(i + (e.key === 'ArrowRight' ? 1 : ABAS.length - 1)) % ABAS.length], true); }
});
const ICONE_TL = {satisfacao: '⭐', mensagem: '💬', agendamento: '📅', orcamento: '🧾', comunicar: '✉️', status: '🔀', entrada: '🟢', fechamento: '🏁', evento: '•', nota: '📝'};
async function carregarLinhaTempo(l) {
  const ger = ++LT_GERACAO, alvo = $('#linhaTempo');
  alvo.innerHTML = '<li class="skeleton" aria-label="Carregando linha do tempo"></li>'.repeat(3);
  const reserva = [{tipo: 'entrada', quando: l.created_at, titulo: 'Lead entrou', detalhe: [LABEL_ORIGEM[l.origem] ?? l.origem, l.servico, l.utm_campaign && 'campanha ' + l.utm_campaign].filter(Boolean).join(' · ')}];
  if (l.closed_at) reserva.push({tipo: 'fechamento', quando: l.closed_at, titulo: l.status === 'perdido' ? 'Perdido' : 'Concluído', detalhe: l.status === 'perdido' ? (U.motivoPerda(l.observacoes) || '') : brl(l.valor_pago)});
  else if (l.updated_at && l.updated_at !== l.created_at) reserva.push({tipo: 'status', quando: l.updated_at, titulo: 'Última mudança · ' + (LABEL_STATUS[l.status] ?? l.status), detalhe: ''});
  let ctx = null, fonte = 'servidor';
  try { ctx = await api('/api/ia/lead/' + encodeURIComponent(l.id) + '/contexto'); }
  catch {
    fonte = 'reserva';
    if (l.cliente_id) { try { const f = await api('/api/clientes/' + encodeURIComponent(l.cliente_id)); ctx = {agendamentos: (f.agendamentos || []).map(a => ({...a, status: LABEL_AGENDAMENTO[a.status] ?? a.status})), eventos: (f.leads || []).filter(x => String(x.id) !== String(l.id)).map(x => ({tipo: 'evento', quando: x.created_at, titulo: 'Outro lead · ' + (LABEL_STATUS[x.status] ?? x.status), detalhe: x.servico || ''}))}; } catch { /* sem reserva extra */ } }
  }
  if (ger !== LT_GERACAO) return;
  // rótulos em português para status vindos do banco (agendamento e etapas do lead)
  if (ctx && fonte === 'servidor') {
    if (Array.isArray(ctx.agendamentos)) ctx = {...ctx, agendamentos: ctx.agendamentos.map(a => ({...a, status: LABEL_AGENDAMENTO[a.status] ?? a.status}))};
    for (const k of ['historico', 'etapas', 'mudancas']) if (Array.isArray(ctx[k])) ctx = {...ctx, [k]: ctx[k].map(h => ({...h, para: LABEL_STATUS[h.para] ?? h.para, status: LABEL_STATUS[h.status] ?? h.status, de: LABEL_STATUS[h.de] ?? h.de}))};
  }
  // outros leads do mesmo cliente entram como marcos da história
  if (ctx && fonte === 'servidor' && Array.isArray(ctx.leads)) for (const x of ctx.leads) if (String(x.id) !== String(l.id)) reserva.push({tipo: 'evento', quando: x.created_at, titulo: 'Outro lead · ' + (LABEL_STATUS[x.status] ?? x.status), detalhe: x.servico || ''});
  const itens = U.linhaDoTempo(ctx, reserva);
  alvo.innerHTML = itens.length ? itens.slice(0, 80).map(i => `<li class="tl-${esc(i.tipo)}"><span class="tl-ico" aria-hidden="true">${ICONE_TL[i.tipo] || '•'}</span>
      <div><div class="tl-topo"><strong>${esc(i.titulo)}</strong><time datetime="${esc(i.quando)}">${esc(new Date(i.quando).toLocaleString('pt-BR', {day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit'}))}</time></div>
      ${i.detalhe ? `<p>${esc(i.detalhe)}</p>` : ''}</div></li>`).join('') + (fonte === 'reserva' ? '<li class="tl-nota">Conversa, orçamentos e Comunicar aparecem aqui quando o servidor da IA estiver no ar.</li>' : '')
    : '<li class="vazio-curto">Nada registrado ainda.</li>';
}
function preencherForm(l, pre = {}) {
  const v = (k, padrao = '') => l?.[k] ?? pre[k] ?? padrao;
  $('#fId').value = l?.id ?? ''; $('#fNome').value = v('nome'); $('#fTelefone').value = v('telefone') ? U.formatarTelefone(v('telefone')) : '';
  $('#fCarro').value = v('carro_modelo'); $('#fPlaca').value = v('placa'); $('#fServico').value = v('servico');
  $('#fOrigemForm').value = v('origem', 'organico'); $('#fOrcado').value = v('valor_orcado'); $('#fPago').value = v('valor_pago');
  $('#fStatusForm').value = v('status', 'novo'); $('#fCampanha').value = v('utm_campaign'); $('#fObs').value = v('observacoes');
  if (l?.servico && $('#fServico').value !== l.servico) { $('#fServico').insertAdjacentHTML('beforeend', `<option value="${esc(l.servico)}">${esc(l.servico)}</option>`); $('#fServico').value = l.servico; }
  limparErros(); $('#avisoDuplicado')?.remove();
  FORM_INICIAL = valoresForm();
}
let FORM_INICIAL = '';
const valoresForm = () => $$('#leadForm input:not([type=hidden]),#leadForm select,#leadForm textarea').map(x => x.value).join('\u0001');
const formSujo = () => modal.classList.contains('open') && valoresForm() !== FORM_INICIAL;
function limparErros() { $$('#leadForm [aria-invalid]').forEach(x => x.removeAttribute('aria-invalid')); $$('#leadForm .campo-erro').forEach(x => { x.textContent = ''; }); }
function erroCampo(id, msg) { const el = $('#' + id); el.setAttribute('aria-invalid', 'true'); $('#erro-' + id).textContent = msg; return el; }
function validarForm() {
  limparErros(); const erros = [];
  if (!$('#fNome').value.trim()) erros.push(erroCampo('fNome', 'Informe o nome.'));
  if (!/^(?:55)?\d{10,11}$/.test(U.digitos($('#fTelefone').value))) erros.push(erroCampo('fTelefone', 'Telefone com DDD, ex.: (12) 99999-0000.'));
  if ($('#fPlaca').value.trim() && !/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/i.test(U.normalizar($('#fPlaca').value))) erros.push(erroCampo('fPlaca', 'Placa ABC1234 ou ABC1D23.'));
  for (const id of ['fOrcado', 'fPago']) { const el = $('#' + id); if (el.value !== '' && (!el.checkValidity() || Number(el.value) < 0 || Number(el.value) > 10000000)) erros.push(erroCampo(id, 'Valor entre zero e R$ 10 milhões.')); }
  if (erros.length) { mostrarAba('abaDados'); erros[0].focus(); }
  return !erros.length;
}
$('#fTelefone').addEventListener('blur', () => {
  const v = $('#fTelefone').value; if (U.telE164(v)) $('#fTelefone').value = U.formatarTelefone(v);
  // telefone que já tem lead aberto: avisa antes de duplicar
  $('#avisoDuplicado')?.remove();
  if (editId || !U.telE164(v)) return;
  const dup = TODOS.find(l => U.ABERTAS.includes(l.status) && U.telE164(l.telefone) === U.telE164(v));
  if (dup) $('#fTelefone').closest('label').insertAdjacentHTML('beforeend', `<small class="aviso-dup" id="avisoDuplicado">Já existe lead aberto deste telefone (${esc(dup.nome)}). <button type="button" data-lead="${esc(dup.id)}">Abrir</button></small>`);
});
$('#leadForm').addEventListener('click', e => { const b = e.target.closest('#avisoDuplicado [data-lead]'); if (b) { const id = b.dataset.lead; fecharModal(true); abrirModal(id); } });
$('#fPlaca').addEventListener('input', e => { const p = e.target.selectionStart; e.target.value = e.target.value.toUpperCase(); e.target.setSelectionRange(p, p); });
$('#leadForm').addEventListener('input', e => { if (e.target.getAttribute('aria-invalid')) { e.target.removeAttribute('aria-invalid'); const m = $('#erro-' + e.target.id); if (m) m.textContent = ''; } });

function montarPreferencias(c) {
  const alvo = $('#preferenciasCliente');
  alvo.innerHTML = `<form id="formPreferencias" class="form-vertical"><h4>Aniversário e mensagens</h4>
    <label>Data de nascimento<input id="clienteNascimento" type="date" value="${esc(c.nascimento || '')}" max="${esc(new Date().toISOString().slice(0, 10))}" min="1900-01-01"></label>
    <label class="chk"><input id="semAnoNascimento" type="checkbox" ${c.nascimento?.startsWith('1904') ? 'checked' : ''}> Só sei o dia e mês (ano 1904)</label>
    <label class="chk"><input id="aceitaMensagens" type="checkbox" ${c.aceita_mensagens === true ? 'checked' : ''}> Aceita mensagens automáticas</label>
    <p class="muted">${c.aceita_mensagens === null || c.aceita_mensagens === undefined ? 'Preferência ainda não registrada.' : 'Preferência registrada: ' + (c.aceita_mensagens ? 'aceita' : 'não aceita')}${c.aceita_mensagens_em ? ' · ' + esc(dtAno(c.aceita_mensagens_em)) : ''}</p>
    <button class="btn btn-primary sm" type="submit">Salvar preferências</button><p role="status" id="preferenciasMsg"></p></form>`;
  $('#formPreferencias').addEventListener('submit', async e => {
    e.preventDefault(); const btn = e.target.querySelector('button'); btn.disabled = true;
    try {
      let data = $('#clienteNascimento').value;
      if (data && $('#semAnoNascimento').checked) data = '1904' + data.slice(4);
      U.nascimento(data);
      await api('/api/clientes/' + encodeURIComponent(c.id), {method: 'PATCH', body: JSON.stringify({nascimento: data || null, aceita_mensagens: $('#aceitaMensagens').checked})});
      $('#preferenciasMsg').textContent = 'Preferências salvas na base compartilhada.'; toast('Preferências salvas');
    } catch (err) { $('#preferenciasMsg').textContent = err.message; } finally { btn.disabled = false; }
  });
}

/* ---------------- teclado: foco preso, atalhos, ajuda "?" ---------------- */
let prefixoG = 0;
const abrirAtalhos = () => { if (!$('#dlgAtalhos').open) abrirDlg($('#dlgAtalhos')); };
$('#btnAtalhos').addEventListener('click', abrirAtalhos);
document.addEventListener('keydown', e => {
  if (document.body.classList.contains('deslogado') || $('dialog[open]')) return;
  const aberto = $('.modal-bg.open');
  if (aberto && e.key === 'Tab') {
    const els = $$('button,input,select,textarea,a[href],[tabindex="0"]', aberto).filter(x => !x.disabled && x.offsetParent !== null && x.tabIndex >= 0);
    if (!els.length) return;
    if (e.shiftKey && document.activeElement === els[0]) { e.preventDefault(); els.at(-1).focus(); }
    if (!e.shiftKey && document.activeElement === els.at(-1)) { e.preventDefault(); els[0].focus(); }
    return;
  }
  if (aberto || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || e.target.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (prefixoG && Date.now() - prefixoG < 1200 && U.ATALHOS_ABA[k]) { e.preventDefault(); prefixoG = 0; const v = U.ATALHOS_ABA[k]; if (!$(`.nav-item[data-view="${v}"]`)?.hidden) { irPara(v); $('#viewTitle').focus(); } return; }
  prefixoG = 0;
  if (k === 'g') { prefixoG = Date.now(); return; }
  if (e.key === '?') { e.preventDefault(); abrirAtalhos(); return; }
  if (k === 'n') { e.preventDefault(); abrirModal(null); }
  if (e.key === '/') { e.preventDefault(); irPara('leads'); $('#search').focus(); }
});
document.addEventListener('keydown', e => {
  if (/INPUT|SELECT|TEXTAREA|BUTTON/.test(e.target.tagName)) return;
  const tr = e.target.closest('#tblLeads tr[data-id],#tblRecent tr[data-id],.kb-card');
  if (tr && !e.shiftKey && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); abrirModal(tr.dataset.id); }
});
$('#viewTitle').tabIndex = -1;

// Observa a primeira montagem dos filtros, sem armazenar termos de busca pessoais.
new MutationObserver(() => {
  if (filtrosRestaurados || $('#fStatus').options.length < 2) return;
  filtrosRestaurados = true;
  const f = lerLS('indycar_crm_filtros', {});
  for (const [id, key] of [['fStatus', 'status'], ['fOrigem', 'origem'], ['ordemLeads', 'ordem']]) if ([...$('#' + id).options].some(o => o.value === f[key])) $('#' + id).value = f[key];
  $('#soParados').checked = !!f.parados;
}).observe($('#fStatus'), {childList: true});
window.addEventListener('offline', () => { document.body.classList.add('sem-rede'); toast('Sem internet. Os dados não serão salvos até a conexão voltar.'); });
window.addEventListener('online', () => { document.body.classList.remove('sem-rede'); toast('Conexão restabelecida.'); });

/* ---------------- contrato com a IA do CRM (public/crm-ia.js) ---------------- */
window.IndyCar = Object.freeze({
  authCabecalhos,
  toast: (msg, ms) => toast(String(msg ?? ''), ms),
  recarregarLeads: async () => { await carregarLeads(); if (STATS) renderPainel(); },
  abrirLead: id => abrirModal(id),
  // null antes do login: o crm-ia.js só se monta quando há papel (nada na tela de login)
  get papel() { return document.body.classList.contains('deslogado') ? null : (PERFIL?.papel ?? null); },
});

/* Link direto vindo de outro app (Atendimento, Comunicar, Agenda):
   /?lead=<id> · /?cliente=<uuid>&tel=<telefone> · /?tel=<telefone>
   Abre o lead MAIS RECENTE do cliente (pelo cliente_id; senão pelo telefone, com ou sem 55).
   Sem lead: mostra a ficha do cliente com o botão "Criar lead". */
const EH_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maisRecente = lista => [...lista].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null;
async function abrirPorLink() {
  const p = new URLSearchParams(location.search), id = p.get('lead'), cli = p.get('cliente'), t = U.telE164(p.get('tel') || p.get('t'));
  if (!id && !cli && !p.get('tel') && !p.get('t')) return;
  history.replaceState(null, '', location.pathname);   // não guarda telefone na barra nem no histórico
  if (id && /^[0-9a-fA-F-]{1,36}$/.test(id)) return abrirModal(id);
  const cliOk = cli && EH_UUID.test(cli) ? cli : null;
  let l = cliOk ? maisRecente(TODOS.filter(x => String(x.cliente_id) === cliOk)) : null;
  if (!l && t) l = maisRecente(TODOS.filter(x => U.telE164(x.telefone) === t));
  let clienteServidor = null;
  if (!l && t) {
    try { const r = await api('/api/lead-por-telefone?tel=' + encodeURIComponent(t)); l = r?.lead || maisRecente(r?.leads || []); clienteServidor = r?.cliente?.id || null; if (l) substituirLocal(l); }
    catch { /* rota pode não existir: segue com o que a tela já tem */ }
  }
  if (l) return abrirModal(l.id);
  const alvoCli = cliOk || clienteServidor;
  if (alvoCli) { await abrirFichaCliente(alvoCli, {criarLead: true}); toast('Este cliente ainda não tem lead. Use “Criar lead”.'); return; }
  if (t) { abrirModal(null, {telefone: t}); toast('Nenhum cliente com esse telefone. Cadastre o lead.'); }
  else toast('Link sem cliente válido.');
}
