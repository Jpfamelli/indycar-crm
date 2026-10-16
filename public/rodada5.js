// Rodada 5 (16/10/2026): ficha 360 em uma chamada (rpc cliente_360), busca global Ctrl+K,
// filtros salvos, leads sem dono com rodízio sugerido, campanha do Comunicar em lote,
// previsão pelo funil, origem detalhada (utm), teclado na lista e no funil, CSV auditado.
// Carrega por último e usa o escopo global (api, TODOS, PERFIL, U, abrirModal, …) e IndyCarApps.
'use strict';

const A5 = window.IndyCarApps;

/* ================= ecossistema: endereços vindos de apps.js (solto ou Central) ================= */
(function montarEcossistema() {
  const sel = $('#ecossistema'); if (!sel) return;
  sel.innerHTML = '<option value="">CRM · atual</option>' + A5.lista().map(a => `<option value="${esc(a.url)}">${esc(a.nome)}</option>`).join('');
  if (A5.CENTRAL) { const casa = document.createElement('option'); casa.value = A5.RAIZ_CENTRAL; casa.textContent = 'Central · início'; sel.insertBefore(casa, sel.options[1]); }
})();
// na Central os apps irmãos abrem na mesma aba (é o mesmo site); fora dela, em outra aba
$('#ecossistema').addEventListener('change', e => {
  const v = e.target.value; if (!v) return;
  if (A5.CENTRAL && v.startsWith('/')) { e.stopImmediatePropagation(); location.href = v; }
}, true);

/* ================= busca global (Ctrl+K): leads e clientes por nome, telefone ou placa ================= */
const BG = { itens: [], foco: -1, timer: null, geracao: 0 };
function abrirBusca(texto = '') {
  if (document.body.classList.contains('deslogado')) return;
  const dlg = $('#dlgBusca'); if (dlg.open) { $('#buscaGlobal').focus(); return; }
  $('#buscaGlobal').value = texto; renderBusca({ leads: [], clientes: [] }, '');
  abrirDlg(dlg); setTimeout(() => { $('#buscaGlobal').focus(); if (texto) buscarGlobal(); }, 30);
}
$('#btnBuscaGlobal').addEventListener('click', () => abrirBusca());
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); abrirBusca(); }
}, true);
function telDigitado(q) { const d = String(q).replace(/\D/g, ''); return d.length >= 10 ? d : ''; }
async function buscarGlobal() {
  const q = $('#buscaGlobal').value.trim(), ger = ++BG.geracao;
  if (q.replace(/\D/g, '').length < 4 && U.normalizar(q).length < 2) { renderBusca({ leads: [], clientes: [] }, q); return; }
  // primeiro o que já está na tela (resposta imediata), depois o servidor (clientes da base inteira)
  const local = { leads: TODOS.filter(l => U.buscar(l, q)).slice(0, 8).map(l => ({ ...l, por: 'tela' })), clientes: [] };
  renderBusca(local, q, true);
  try {
    const r = await api('/api/busca?q=' + encodeURIComponent(q), undefined, false, { tentativas: 1 });
    if (ger !== BG.geracao || $('#buscaGlobal').value.trim() !== q) return;
    renderBusca(r, q);
  } catch { if (ger === BG.geracao) renderBusca(local, q); }
}
$('#buscaGlobal').addEventListener('input', () => { clearTimeout(BG.timer); BG.timer = setTimeout(buscarGlobal, 180); });
const POR = { nome: 'nome', telefone: 'telefone', placa: 'placa', carro: 'carro', tela: '' };
function renderBusca(r, q, parcial = false) {
  const el = $('#buscaResultados');
  const abas = q.length >= 3 ? Object.entries(TITULOS).filter(([v, t]) => !$(`.nav-item[data-view="${v}"]`)?.hidden && U.normalizar(t[0]).includes(U.normalizar(q))).slice(0, 3).map(([v, t]) => ({ tipo: 'aba', id: v, nome: 'Ir para ' + t[0], telefone: '', por: '' })) : [];
  const leads = (r.leads || []).map(l => ({ tipo: 'lead', ...l })), clientes = (r.clientes || []).filter(c => !leads.some(l => U.telE164(l.telefone) && U.telE164(l.telefone) === U.telE164(c.telefone))).map(c => ({ tipo: 'cliente', ...c }));
  BG.itens = [...leads, ...clientes, ...abas]; BG.foco = BG.itens.length ? 0 : -1;
  const tel = telDigitado(q);
  if (!q) { el.innerHTML = '<p class="vazio-curto">Digite 2 letras do nome, 4 números do telefone ou a placa. <kbd>↑</kbd> <kbd>↓</kbd> escolhem, <kbd>Enter</kbd> abre.</p>'; return; }
  if (!BG.itens.length) {
    el.innerHTML = `<p class="vazio-curto">${parcial ? 'Procurando na base…' : `Nada com “${esc(q)}”.`}${!parcial && tel ? ` <button type="button" class="link-btn" data-bg-novo="${esc(tel)}">Cadastrar lead com este telefone</button>` : ''}${!parcial && !tel ? ' Tente só o final do telefone ou a placa sem traço.' : ''}</p>`;
    return;
  }
  const item = (x, i) => `<button type="button" class="bg-item${i === BG.foco ? ' foco' : ''}" role="option" aria-selected="${i === BG.foco}" data-bg="${i}" id="bg-op-${i}">
      <span class="bg-ico" aria-hidden="true">${x.tipo === 'lead' ? '🎯' : x.tipo === 'aba' ? '➜' : '🪪'}</span>
      <span class="bg-txt2"><strong>${esc(x.nome)}</strong><small>${esc(U.formatarTelefone(x.telefone))}${x.placa ? ' · ' + esc(x.placa) : ''}${x.carro_modelo ? ' · ' + esc(x.carro_modelo) : ''}</small></span>
      <span class="bg-meta">${x.tipo === 'lead' ? `<span class="badge b-${esc(x.status)}">${esc(LABEL_STATUS[x.status] ?? x.status)}</span>` : x.tipo === 'aba' ? '<span class="tag">tela</span>' : '<span class="tag">cliente</span>'}${POR[x.por] ? `<small>por ${POR[x.por]}</small>` : ''}</span></button>`;
  el.innerHTML = (leads.length ? `<h4 class="bg-grupo">Leads</h4>` + leads.map((x, i) => item(x, i)).join('') : '')
    + (clientes.length ? `<h4 class="bg-grupo">Clientes</h4>` + clientes.map((x, i) => item(x, leads.length + i)).join('') : '')
    + (abas.length ? `<h4 class="bg-grupo">Telas</h4>` + abas.map((x, i) => item(x, leads.length + clientes.length + i)).join('') : '')
    + (parcial ? '<p class="bg-nota">Procurando também na base de clientes…</p>' : '');
  $('#buscaGlobal').setAttribute('aria-activedescendant', BG.foco >= 0 ? 'bg-op-' + BG.foco : '');
}
function abrirResultado(i) {
  const x = BG.itens[i]; if (!x) return;
  $('#dlgBusca').close();
  if (x.tipo === 'lead') abrirModal(x.id); else if (x.tipo === 'aba') irPara(x.id); else abrirFichaCliente(x.id);
}
$('#buscaResultados').addEventListener('click', e => {
  const n = e.target.closest('[data-bg-novo]'); if (n) { $('#dlgBusca').close(); abrirModal(null, { telefone: n.dataset.bgNovo }); return; }
  const b = e.target.closest('[data-bg]'); if (b) abrirResultado(Number(b.dataset.bg));
});
$('#dlgBusca').addEventListener('keydown', e => {
  // Esc em <input type=search> só limpa o texto; aqui fecha a busca de uma vez
  if (e.key === 'Escape') { e.preventDefault(); $('#dlgBusca').close(); return; }
  if (!BG.itens.length) { if (e.key === 'Enter') e.preventDefault(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); BG.foco = (BG.foco + (e.key === 'ArrowDown' ? 1 : BG.itens.length - 1)) % BG.itens.length;
    $$('#buscaResultados .bg-item').forEach((b, i) => { b.classList.toggle('foco', i === BG.foco); b.setAttribute('aria-selected', String(i === BG.foco)); });
    $('#buscaGlobal').setAttribute('aria-activedescendant', 'bg-op-' + BG.foco); $(`#bg-op-${BG.foco}`)?.scrollIntoView({ block: 'nearest' });
  }
  if (e.key === 'Enter') { e.preventDefault(); abrirResultado(BG.foco < 0 ? 0 : BG.foco); }
});

/* ================= filtros salvos (por pessoa, valem em qualquer aparelho) ================= */
let FILTROS = [];
const filtroAtual = () => ({ status: $('#fStatus').value, origem: $('#fOrigem').value, resp: $('#fResp').value, ordem: $('#ordemLeads').value, parados: $('#soParados').checked, semValor: !!$('#soSemValor')?.checked });
function descreverFiltro(f) {
  const p = [];
  if (f.status) p.push(LABEL_STATUS[f.status] || f.status); if (f.origem) p.push(LABEL_ORIGEM[f.origem] || f.origem);
  if (f.resp === 'meus') p.push('meus leads'); else if (f.resp === 'sem') p.push('sem responsável'); else if (f.resp) p.push(primeiroNome(nomeResponsavel(f.resp)));
  if (f.parados) p.push('só parados'); if (f.semValor) p.push('concluídos sem valor');
  if (f.ordem && f.ordem !== 'recente') p.push('ordem: ' + ($('#ordemLeads option[value="' + f.ordem + '"]')?.textContent || f.ordem).toLowerCase());
  return p.length ? p.join(' · ') : 'todos os leads';
}
function renderFiltrosSalvos() {
  const sel = $('#filtrosSalvos');
  sel.innerHTML = '<option value="">—</option>' + FILTROS.map((f, i) => `<option value="${i}">${esc(f.nome)}</option>`).join('') + (FILTROS.length ? '<option value="__apagar">Apagar um filtro…</option>' : '');
  sel.closest('label').hidden = false;
}
async function carregarFiltrosSalvos() {
  try { const r = await api('/api/filtros', undefined, false, { tentativas: 2 }); FILTROS = Array.isArray(r.filtros) ? r.filtros : []; }
  catch { FILTROS = Array.isArray(PERFIL?.preferencias?.crm_filtros) ? PERFIL.preferencias.crm_filtros : []; }
  renderFiltrosSalvos();
}
async function gravarFiltros(lista) {
  const r = await api('/api/filtros', { method: 'PUT', body: JSON.stringify({ filtros: lista }) });
  FILTROS = r.filtros || lista; if (PERFIL) PERFIL.preferencias = U.mesclarPreferencias(PERFIL.preferencias, { crm_filtros: FILTROS }); renderFiltrosSalvos();
}
function aplicarFiltro(f) {
  $('#fStatus').value = f.status || ''; $('#fOrigem').value = f.origem || ''; $('#ordemLeads').value = f.ordem || 'recente';
  $('#soParados').checked = !!f.parados; if ($('#soSemValor')) $('#soSemValor').checked = !!f.semValor;
  $('#fResp').value = [...$('#fResp').options].some(o => o.value === (f.resp || '')) ? (f.resp || '') : ''; salvarResp();
  irPara('leads'); refiltrarTela();
}
$('#filtrosSalvos').addEventListener('change', async e => {
  const v = e.target.value; e.target.value = '';
  if (v === '__apagar') {
    const nomes = FILTROS.map((f, i) => `${i + 1}. ${f.nome}`).join('\n');
    const n = Number(prompt(`Qual filtro apagar? Digite o número:\n${nomes}`)); if (!n || !FILTROS[n - 1]) return;
    const apagado = FILTROS[n - 1];
    try { await gravarFiltros(FILTROS.filter((_, i) => i !== n - 1)); toastAcao(`Filtro "${apagado.nome}" apagado`, 'Desfazer', () => gravarFiltros([...FILTROS, apagado])); } catch (err) { toast('⚠️ ' + err.message); }
    return;
  }
  const f = FILTROS[Number(v)]; if (f) { aplicarFiltro(f.filtro || {}); toast(`Filtro "${f.nome}" aplicado`); }
});
$('#btnSalvarFiltro').addEventListener('click', async () => {
  const f = filtroAtual();
  $('#dlgFiltroResumo').textContent = 'Guarda: ' + descreverFiltro(f) + '.'; $('#filtroNome').value = ''; $('#filtroErro').textContent = '';
  const nome = await abrirDlg($('#dlgFiltro')); if (!nome) return;
  try {
    const lista = FILTROS.filter(x => x.nome.toLowerCase() !== nome.toLowerCase()).concat([{ nome, filtro: f, em: new Date().toISOString() }]);
    await gravarFiltros(lista); toast(`✅ Filtro "${nome}" salvo (vale em qualquer aparelho)`);
  } catch (err) { toast('⚠️ ' + err.message, 6000); }
});
$('#formFiltro').addEventListener('submit', e => {
  e.preventDefault(); const nome = $('#filtroNome').value.replace(/\s+/g, ' ').trim();
  if (!nome) { $('#filtroErro').textContent = 'Dê um nome ao filtro.'; return; }
  if (FILTROS.length >= 12 && !FILTROS.some(x => x.nome.toLowerCase() === nome.toLowerCase())) { $('#filtroErro').textContent = 'Você já tem 12 filtros. Apague um antes.'; return; }
  $('#dlgFiltro')._ok(nome);
});

/* ================= CSV: só o filtrado, e fica na auditoria ================= */
const _baixarCsvR4 = baixarCsv;
baixarCsv = function (lista, nome) {
  _baixarCsvR4(lista, nome);
  const f = filtroAtual(), q = $('#search').value.trim();
  api('/api/auditoria/exportacao', { method: 'POST', body: JSON.stringify({ tipo: 'leads', quantidade: lista.length, filtros: { ...Object.fromEntries(Object.entries(f).filter(([, v]) => v && v !== 'recente')), ...(q ? { busca: 'sim' } : {}), arquivo: nome } }) }).catch(() => {});
};

/* ================= ficha do lead: origem detalhada (origem + utm) ================= */
const _renderFichaLeadR4 = renderFichaLead;
renderFichaLead = function (l) {
  _renderFichaLeadR4(l);
  const det = U.origemDetalhada(l, o => LABEL_ORIGEM[o] ?? o ?? '');
  const tag = $('#lfTopo .lf-tags .tag'); if (tag && det && (l.utm_source || l.utm_medium || l.utm_campaign)) { tag.textContent = det; tag.title = 'Origem · fonte · mídia · campanha (UTM)'; }
};

/* ================= ficha 360 do cliente: UMA chamada (rpc cliente_360) ================= */
const ROT_TAREFA_ORIGEM = { manual: 'manual', atendimento: 'Atendimento', crm: 'CRM', agenda: 'Agenda', comunicar: 'Comunicar', orcador: 'Orçador', ia: 'IA', automacao: 'automação' };
const quandoH = iso => iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const _abrirFichaClienteR4 = abrirFichaCliente;
abrirFichaCliente = async function (id, opcoes = {}) {
  const alvo = $('#fichaCliente');
  alvo.innerHTML = '<div class="skeleton" aria-label="Carregando ficha"></div>';
  if (modal.classList.contains('open') && !fecharModal()) return;
  modalCli.classList.add('open'); ativarDialogo(modalCli);
  document.body.style.overflow = 'hidden';
  // aceita o id do cliente OU { tel } (lead ainda sem cliente_id: a rpc acha pelo telefone)
  const porTel = id && typeof id === 'object' ? id.tel : null;
  let f;
  try { f = await api('/api/clientes/360?' + (porTel ? 'tel=' + encodeURIComponent(porTel) : 'cliente=' + encodeURIComponent(id)), undefined, false, { tentativas: 2 }); }
  catch (e) {
    // a rpc ainda não existe no banco (ou o papel não pode): a ficha antiga continua valendo
    if ([503, 403, 404].includes(e.status) && !porTel) return _abrirFichaClienteR4(id, opcoes);
    alvo.innerHTML = `<div class="alert">Não consegui abrir a ficha: ${esc(e.message)}</div>`; return;
  }
  if (!f.cliente) { if (!porTel) return _abrirFichaClienteR4(id, opcoes); alvo.innerHTML = `<div class="alert">Esse telefone ainda não tem cadastro de cliente. ${f.leads?.length ? `Há ${f.leads.length} lead${f.leads.length === 1 ? '' : 's'} com ele; ` : ''}o cadastro nasce quando o cliente marca horário ou manda mensagem.</div>`; return; }
  renderFicha360(f, opcoes);
};
function renderFicha360(f, opcoes = {}) {
  const alvo = $('#fichaCliente'), c = f.cliente, r = f.resumo || {}, L = f.links || {};
  const ind = f.indicacoes || {};
  const bloco = (titulo, html, vazio) => `<div class="ficha-bloco"><h4>${titulo}</h4>${html || `<p class="muted" style="font-size:.88rem">${vazio}</p>`}</div>`;
  const kpi = (r1, v, alerta) => `<div class="ficha-kpi${alerta ? ' alerta' : ''}"><span>${r1}</span><b>${v}</b></div>`;
  const naOficina = (f.patio || []).find(o => !['entregue', 'cancelado'].includes(o.etapa));
  alvo.innerHTML = `
    <h3 class="sr" id="fichaCliTitulo">Ficha de ${esc(c.nome)}</h3>
    <div class="ficha-topo">
      <span class="avatar">${esc(iniciais(c.nome))}</span>
      <div>
        <div class="ficha-nome">${esc(c.nome)}</div>
        <div class="ficha-sub">${esc(U.formatarTelefone(c.telefone))}${c.email ? ' · ' + esc(c.email) : ''}</div>
        <div class="ficha-sub">${esc(c.carro_modelo) || 'Carro não informado'}${c.carro_ano ? ' ' + esc(c.carro_ano) : ''}${c.placa ? ' · ' + esc(c.placa) : ''} · cliente desde ${dtAno(c.cliente_desde)}</div>
        <div class="lf-tags">${c.origem ? `<span class="tag">${esc(LABEL_ORIGEM[c.origem] ?? c.origem)}</span>` : ''}
          ${ind.foi_indicado_por ? `<span class="tag tag-area" title="Indicado pela Área do Cliente">🤝 Veio por indicação de ${esc(ind.foi_indicado_por.nome || 'um cliente')}</span>` : ''}
          ${naOficina ? `<span class="tag tag-patio">🔧 Carro na oficina · ${esc(ETAPA_PATIO[naOficina.etapa] || naOficina.etapa)}</span>` : ''}
          ${c.aceita_mensagens === false ? '<span class="tag">🔕 não aceita mensagens</span>' : ''}</div>
      </div>
    </div>
    <div class="ficha-kpis">
      ${kpi('Já gastou', brl(r.total_gasto))}${kpi('Serviços feitos', esc(r.servicos_feitos ?? 0))}${kpi('Última visita', esc(dtAno(r.ultima_visita)))}
      ${kpi('Próximo horário', r.proximo_horario ? esc(quandoH(r.proximo_horario)) : '—')}${kpi('Faltas', esc(r.faltas ?? 0), Number(r.faltas) > 1)}${kpi('Não fechou', esc(r.nao_fechou ?? 0))}
      ${kpi('Leads', `${esc(r.total_leads ?? 0)}${Number(r.leads_abertos) ? ` <small>${esc(r.leads_abertos)} aberto${r.leads_abertos === 1 ? '' : 's'}</small>` : ''}`)}${kpi('Mensagens', esc(r.mensagens_total ?? 0))}
    </div>
    <div class="lf-acoes">${botaoAcao(L.conversa || L.atendimento, L.conversa ? 'Abrir conversa' : 'Atendimento', '💬') + botaoAcao(L.whatsapp, 'WhatsApp', '🟢') + botaoAcao(L.ligar, 'Ligar', '📞') + botaoAcao(L.agenda, 'Agendar', '📅') + botaoAcao(L.comunicar, 'Mandar mensagem', '✉️')}
      <button type="button" class="acao acao-forte" id="novoLeadCliente"><span aria-hidden="true">＋</span>Criar lead</button></div>

    ${f.conversa ? bloco('Conversa no WhatsApp', `<p class="ficha-sub">${esc(f.conversa.etapa || f.conversa.status || 'sem etapa')}${f.conversa.atribuida_a_nome ? ' · com ' + esc(primeiroNome(f.conversa.atribuida_a_nome)) : ''}${f.conversa.aguardando_consultor ? ' · <b class="parado-txt">cliente esperando consultor</b>' : ''}${f.conversa.ultima_mensagem_em ? ' · última ' + esc(U.tempoRelativo(f.conversa.ultima_mensagem_em)) : ''}</p>
      ${(f.mensagens || []).length ? `<ul class="f360-msgs">${f.mensagens.slice(0, 5).map(m => `<li class="${m.direcao === 'entrada' ? 'de-cliente' : 'de-oficina'}"><small>${m.direcao === 'entrada' ? 'Cliente' : (m.gerada_por_ia ? 'IA' : 'Oficina')} · ${esc(quandoH(m.created_at))}</small>${esc(m.corpo || (m.anexo ? '[anexo]' : ''))}</li>`).join('')}</ul>` : ''}`) : ''}

    ${bloco('Leads', (f.leads || []).length ? `<table class="mini-tabela"><tbody>${f.leads.map(l => `<tr data-lead="${esc(l.id)}" tabindex="0" class="clicavel" aria-label="Abrir lead ${esc(l.servico || '')}">
        <td><div class="cell-main">${esc(l.servico) || 'Serviço não informado'}</div><div class="cell-sub">${esc(LABEL_ORIGEM[l.origem] ?? l.origem ?? '')}${l.utm_source && l.utm_source !== l.origem ? ' · ' + esc(l.utm_source) : ''} · ${dtAno(l.created_at)}${l.responsavel_nome ? ' · ' + esc(primeiroNome(l.responsavel_nome)) : ''}</div></td>
        <td><span class="badge b-${esc(l.status)}">${esc(LABEL_STATUS[l.status] ?? l.status)}</span></td>
        <td class="num">${brl(l.status === 'concluido' ? l.valor_pago : l.valor_orcado)}</td></tr>`).join('')}</tbody></table>` : '', 'Sem leads registrados.')}

    ${bloco('Agendamentos', (f.agendamentos || []).length ? `<table class="mini-tabela"><tbody>${f.agendamentos.map(a => `<tr>
        <td><div class="cell-main">${esc(a.servico) || 'Serviço não informado'}</div><div class="cell-sub">${dtSimples(a.data)} às ${esc(String(a.hora ?? '').slice(0, 5))}${a.consultor ? ' · ' + esc(primeiroNome(a.consultor)) : ''}${a.veiculo ? ' · ' + esc(a.veiculo) : ''}</div></td>
        <td><span class="badge b-${esc(a.status)}">${esc(LABEL_AGENDAMENTO[a.status] ?? a.status)}</span></td>
        <td class="num">${a.valor ? brl(a.valor) : '—'}</td>
        <td>${L.agendamentos?.[a.id] ? `<a class="acao" href="${esc(L.agendamentos[a.id])}" target="_blank" rel="noopener" aria-label="Abrir na Agenda">📅</a>` : ''}</td></tr>`).join('')}</tbody></table>` : '', 'Sem horários marcados.')}

    ${(f.patio || []).length ? bloco('Pátio (carro na oficina)', `<table class="mini-tabela"><tbody>${f.patio.map(o => `<tr>
        <td><div class="cell-main">Ordem nº ${esc(o.numero ?? '—')} · ${esc(ETAPA_PATIO[o.etapa] || o.etapa)}${Number(o.extras_pendentes) ? ` <span class="tag">${esc(o.extras_pendentes)} extra${o.extras_pendentes === 1 ? '' : 's'} esperando o cliente</span>` : ''}</div>
          <div class="cell-sub">${esc([o.veiculo, o.placa, o.servico].filter(Boolean).join(' · '))} · entrou ${dtAno(o.created_at)}${o.entregue_em ? ' → entregue ' + dtAno(o.entregue_em) : o.previsao_entrega ? ' · previsão ' + dtAno(o.previsao_entrega) : ''}${o.mecanico ? ' · ' + esc(primeiroNome(o.mecanico)) : ''}</div></td>
        <td class="col-acao">${L.patio?.[o.id] ? `<a class="acao" href="${esc(L.patio[o.id])}" target="_blank" rel="noopener">🔧 Pátio</a>` : ''}${o.link_cliente ? ` <button type="button" class="acao" data-copiar="${esc(o.link_cliente)}" title="Copiar o link de acompanhamento do cliente">🔗 Link do cliente</button>` : ''}</td></tr>`).join('')}</tbody></table>`) : ''}

    ${(f.orcamentos || []).length ? bloco('Orçamentos', `<table class="mini-tabela"><tbody>${f.orcamentos.map(o => `<tr>
        <td><div class="cell-main">Orçamento nº ${esc(o.numero ?? '—')}</div><div class="cell-sub">${esc(o.status || '')}${o.enviado_em ? ' · enviado ' + dtAno(o.enviado_em) : ''}${o.decidido_em ? ' · decidido ' + dtAno(o.decidido_em) : ''}${o.motivo_recusa ? ' · ' + esc(o.motivo_recusa) : ''}</div></td>
        <td class="num">${o.total != null ? brl(o.total) : '—'}</td>
        <td>${L.orcamentos?.[o.id] ? `<a class="acao" href="${esc(L.orcamentos[o.id])}" target="_blank" rel="noopener" aria-label="Abrir no Orçador">🧾</a>` : ''}</td></tr>`).join('')}</tbody></table>`) : ''}

    ${(f.comunicar || []).length ? bloco('Comunicar (mensagens automáticas)', `<ul class="f360-lista">${f.comunicar.slice(0, 8).map(e => `<li><span class="tag">${esc(String(e.tipo || '').replace(/_/g, ' '))}</span> ${esc(e.status || '')} · ${esc(dtAno(e.enviado_em || e.enviar_em))}${e.respondido_em ? ` · <b>respondeu</b>${e.resposta_tipo ? ' (' + esc(e.resposta_tipo) + ')' : ''}` : ''}${e.motivo_pulado ? ' · ' + esc(e.motivo_pulado) : ''}</li>`).join('')}</ul>`) : ''}

    ${(f.tarefas || []).length ? bloco('Tarefas abertas', `<ul class="f360-lista">${f.tarefas.map(t => `<li>${Number(t.prioridade) === 1 ? '<b class="tarefa-urg">Urgente</b> ' : ''}${esc(t.titulo)}${t.responsavel_nome ? ' · ' + esc(primeiroNome(t.responsavel_nome)) : ''}${t.vence_em ? ' · vence ' + esc(quandoH(t.vence_em)) : ''}${t.origem && t.origem !== 'crm' ? ` <span class="tag mini">${esc(ROT_TAREFA_ORIGEM[t.origem] || t.origem)}</span>` : ''}</li>`).join('')}</ul>`) : ''}

    ${(ind.fez || []).length ? bloco('Indicações', `<table class="mini-tabela"><tbody>${ind.fez.map(i => `<tr${i.lead_id ? ` data-lead="${esc(i.lead_id)}" tabindex="0" class="clicavel" aria-label="Abrir o lead de ${esc(i.nome)}"` : ''}>
        <td><div class="cell-main">🤝 ${esc(i.nome)}</div><div class="cell-sub">indicou em ${dtAno(i.created_at)}</div></td>
        <td><span class="badge b-ind-${esc(i.status)}">${esc(STATUS_INDICACAO[i.status] || i.status)}</span></td></tr>`).join('')}</tbody></table>`) : ''}

    ${c.observacoes ? bloco('Observações', `<p class="muted" style="font-size:.9rem;line-height:1.6">${esc(c.observacoes)}</p>`) : ''}
    <p class="muted" style="font-size:.78rem;margin-top:18px">Ficha montada em uma consulta só (cliente_360): conversa, leads, horários, pátio, orçamentos, Comunicar, tarefas e indicações pelo telefone ${esc(U.formatarTelefone(f.telefone))}.</p>
    <div id="preferenciasCliente"></div>`;
  montarPreferencias({ ...c, id: c.id });
  modalCli.firstElementChild.setAttribute('aria-labelledby', 'fichaCliTitulo');
  if (opcoes.criarLead) $('#novoLeadCliente').focus();
  $('#novoLeadCliente').onclick = () => { fecharFichaCliente(); abrirModal(null, { nome: c.nome, telefone: c.telefone, carro_modelo: c.carro_modelo, placa: c.placa }); };
  $$('tr[data-lead]', alvo).forEach(tr => { const ir = () => { fecharFichaCliente(); abrirModal(tr.dataset.lead); }; tr.onclick = ir; tr.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ir(); } }; });
  $$('[data-copiar]', alvo).forEach(b => { b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copiar); toast('Link do cliente copiado'); } catch { toast('Não consegui copiar. Link: ' + b.dataset.copiar, 8000); } }; });
}

/* ================= lote: mandar os selecionados para uma campanha do Comunicar ================= */
$('#loteCampanha').addEventListener('click', async () => {
  const ids = [...SEL]; if (!ids.length) return;
  const alvos = TODOS.filter(l => ids.includes(String(l.id)));
  const tels = new Set(alvos.map(l => U.telE164(l.telefone)).filter(Boolean));
  $('#campTxt').textContent = `${alvos.length} lead${alvos.length === 1 ? '' : 's'} selecionado${alvos.length === 1 ? '' : 's'} · ${tels.size} telefone${tels.size === 1 ? '' : 's'} diferente${tels.size === 1 ? '' : 's'}.`;
  if (!$('#campCorpo').value) $('#campCorpo').value = 'Oi {nome}! Aqui é da IndyCar. Vi que a gente conversou sobre o seu {carro} e queria saber se ainda posso ajudar. Quer que eu reserve um diagnóstico digital gratuito (uns 30 min)?';
  $('#campErro').textContent = ''; $('#campQuando').value = '';
  const ok = await abrirDlg($('#dlgCampanha')); if (!ok) return;
});
$('#formCampanha').addEventListener('submit', async e => {
  e.preventDefault();
  const corpo = $('#campCorpo').value.trim(), ids = [...SEL];
  if (corpo.length < 10) { $('#campErro').textContent = 'Escreva a mensagem (pelo menos 10 caracteres).'; return; }
  if (/\bprezad|\befetuar\b|\bcomparecer\b|\bve[ií]culo/i.test(corpo)) { $('#campErro').textContent = 'Troque "prezado", "efetuar", "comparecer" e "veículo" por palavras da casa (ex.: "carro").'; return; }
  if (/R\$\s*\d|\d+\s*reais/i.test(corpo)) { $('#campErro').textContent = 'Sem preço na mensagem: o valor se combina na conversa.'; return; }
  const btn = $('#campEnviar'); btn.disabled = true; btn.textContent = 'Mandando…'; $('#campErro').textContent = '';
  try {
    const r = await api('/api/leads/campanha', { method: 'POST', body: JSON.stringify({ ids, corpo, enviar_em: $('#campQuando').value ? new Date($('#campQuando').value).toISOString() : null, detalhe: $('#campDetalhe').value.trim() || null }) });
    $('#dlgCampanha')._ok(true); SEL.clear(); renderTabelaLeads();
    const msg = `✉️ Campanha proposta para ${r.destinos} cliente${r.destinos === 1 ? '' : 's'}${r.pulados ? ` (${r.pulados} sem telefone válido)` : ''}. O gestor aprova no Comunicar${r.avisados ? ` — ${r.avisados} avisado${r.avisados === 1 ? '' : 's'}` : ''}.`;
    if (r.abrir) toastAcao(msg, 'Abrir no Comunicar', () => window.open(r.abrir, A5.CENTRAL ? '_self' : '_blank', 'noopener'), 10000); else toast(msg, 8000);
  } catch (err) { $('#campErro').textContent = err.message; }
  finally { btn.disabled = false; btn.textContent = 'Mandar para o Comunicar'; }
});

/* ================= leads sem dono: resumo + rodízio sugerido (gestor aplica) ================= */
const SD = { dados: null, carregando: false };
async function carregarSemDono() {
  if (!SOU_GESTOR || SD.carregando) return;
  SD.carregando = true;
  const el = $('#sdRodizio'); el.innerHTML = '<div class="skeleton" aria-label="Calculando o rodízio"></div>';
  try { SD.dados = await api('/api/leads/sem-dono'); renderSemDono(); }
  catch (e) { el.innerHTML = `<p class="vazio-curto">Não consegui calcular agora: ${esc(e.message)}</p>`; $('#sdAplicar').disabled = true; }
  finally { SD.carregando = false; }
}
function renderSemDono() {
  const d = SD.dados; if (!d) return;
  const r = d.resumo, s = d.sugestao;
  $('#sdTxt').textContent = r.total ? `${r.total} lead${r.total === 1 ? '' : 's'} aberto${r.total === 1 ? '' : 's'} sem responsável · ${brl(r.valorOrcado)} orçado · o mais antigo entrou há ${r.maisAntigo} dias` : '';
  const chip = (rot, n) => n ? `<span class="sd-chip"><b>${esc(n)}</b> ${esc(rot)}</span>` : '';
  $('#sdResumo').innerHTML = r.total ? Object.entries(r.porEtapa).sort((a, b) => b[1] - a[1]).map(([k, n]) => chip(LABEL_STATUS[k] || k, n)).join('')
    + '<span class="sd-sep" aria-hidden="true"></span>' + r.porIdade.filter(x => x.qtd).map(x => chip(x.rotulo, x.qtd)).join('') : '';
  const el = $('#sdRodizio'), btn = $('#sdAplicar');
  if (!r.total) { el.innerHTML = '<p class="vazio-curto"><strong>Todos os leads abertos têm dono. 🏁</strong><br>Os novos entram no rodízio automático em até 48 h.</p>'; btn.disabled = true; return; }
  if (s.semGente) { el.innerHTML = '<p class="vazio-curto">Ninguém está marcado para receber leads. Em Configurações › Equipe, ligue "recebe leads" para os vendedores.</p>'; btn.disabled = true; return; }
  el.innerHTML = `<p class="muted mini-nota">Rodízio sugerido (quem tem menos leads abertos recebe mais; orçamentos e agendados saem primeiro):</p>
    <div class="table-wrap"><table class="table"><thead><tr><th>Pessoa</th><th class="num">Abertos hoje</th><th class="num">Recebe</th><th>Por etapa</th><th class="num">Fica com</th></tr></thead>
    <tbody>${s.resumo.map(x => `<tr class="sem-clique"><td>${chipResponsavel(x.id)}</td><td class="num">${esc(x.antes)}</td><td class="num"><b>+${esc(x.recebe)}</b></td>
      <td class="cell-sub">${Object.entries(x.porEtapa).map(([k, n]) => `${esc(LABEL_STATUS[k] || k)} ${n}`).join(' · ') || '—'}</td><td class="num">${esc(x.depois)}</td></tr>`).join('')}</tbody></table></div>
    ${s.total < r.total ? `<p class="muted mini-nota">Sugestão para os primeiros ${s.total} de ${r.total}; aplique e recalcule para o resto.</p>` : ''}`;
  el.insertAdjacentHTML('beforeend', `<details class="ds-detalhe"><summary>Ver lead por lead (${s.plano.length})</summary><div class="table-wrap"><table class="table"><thead><tr><th>Lead</th><th>Etapa</th><th>Há</th><th>Vai para</th></tr></thead><tbody>${s.plano.slice(0, 200).map(x => `<tr class="sem-clique"><td>${esc(x.nome)}</td><td>${esc(LABEL_STATUS[x.status] ?? x.status)}</td><td class="cell-sub">${esc(x.dias)} dias</td><td>${chipResponsavel(x.para)}</td></tr>`).join('')}${s.plano.length > 200 ? `<tr class="sem-clique"><td colspan="4" class="muted">…e mais ${s.plano.length - 200}.</td></tr>` : ''}</tbody></table></div></details><p><button type="button" class="link-btn" id="sdVerLista">Ver os sem responsável na lista</button></p>`);
  $('#sdVerLista').onclick = () => { $('#fResp').value = 'sem'; salvarResp(); $('#fStatus').value = ''; irPara('leads'); refiltrarTela(); };
  btn.disabled = !s.total; btn.textContent = `Aplicar o rodízio sugerido (${s.total})`;
}
$('#sdRecarregar').addEventListener('click', carregarSemDono);
$('#sdAplicar').addEventListener('click', async () => {
  const s = SD.dados?.sugestao; if (!s?.total) return;
  if (!confirm(`Passar ${s.total} lead${s.total === 1 ? '' : 's'} para ${s.resumo.filter(x => x.recebe).length} pessoa${s.resumo.filter(x => x.recebe).length === 1 ? '' : 's'} pelo rodízio sugerido? Cada uma recebe um aviso só. Fica na auditoria e dá para desfazer.`)) return;
  const btn = $('#sdAplicar'); btn.disabled = true; btn.textContent = 'Aplicando…';
  try {
    const r = await api('/api/leads/distribuir', { method: 'POST', body: JSON.stringify({ grupos: s.grupos, modo: 'carga', filtros: { rodizio: 'sugerido' } }) });
    for (const it of r.itens || []) substituirLocal({ id: it.id, responsavel_id: it.para });
    redesenhar(); renderFiltrosDs(); carregarHistoricoDs(); carregarDistribuirGente();
    const quem = (r.porPessoa || []).map(p => `${primeiroNome(p.nome)} ${p.recebeu}`).join(', ');
    const msg = `✅ Rodízio aplicado: ${r.atualizados} lead${r.atualizados === 1 ? '' : 's'} (${quem})${r.pulados ? ` · ${r.pulados} já tinham dono` : ''}`;
    if (r.lote) toastAcao(msg, 'Desfazer', () => desfazerDistribuicao(r.lote), 12000); else toast(msg, 7000);
    await carregarSemDono();
  } catch (e) { toast('⚠️ ' + e.message, 7000); btn.disabled = false; btn.textContent = 'Aplicar o rodízio sugerido'; }
});
const _carregarDistribuirR4 = carregarDistribuir;
carregarDistribuir = async function () { await _carregarDistribuirR4(); if (SOU_GESTOR) carregarSemDono(); };
// selo na navegação: quantos leads abertos estão sem dono (só o gestor vê a aba)
function renderSeloSemDono() {
  const nav = $('.nav-item[data-view="distribuir"]'); if (!nav || !SOU_GESTOR) return;
  const n = TODOS.filter(l => !l.responsavel_id && U.ABERTAS.includes(l.status)).length;
  nav.dataset.badge = n || ''; nav.setAttribute('aria-label', 'Leads sem dono' + (n ? `, ${n} sem responsável` : ''));
}

/* ================= previsão de faturamento pelo funil ================= */
let PREVISAO = null, PREVISAO_EM = 0;
async function carregarPrevisao() {
  const card = $('#cardPrevisao'); if (!card || !PERFIL?.id) return;
  if (Date.now() - PREVISAO_EM < 60000 && PREVISAO) return renderPrevisao();
  try { PREVISAO = await api('/api/previsao' + (SOU_GESTOR ? '' : '?meus=1'), undefined, false, { tentativas: 1 }); PREVISAO_EM = Date.now(); renderPrevisao(); }
  catch { card.hidden = true; }
}
function renderPrevisao() {
  const card = $('#cardPrevisao'), p = PREVISAO; if (!card || !p) return;
  card.hidden = !p.leadsAbertos;
  if (!p.leadsAbertos) return;
  $('#pvTxt').textContent = SOU_GESTOR ? 'funil da loja' : 'o seu funil';
  const max = Math.max(1, ...p.porEtapa.map(e => e.valor));
  $('#previsaoFunil').innerHTML = `<div class="pv-topo"><div class="pv-num"><span>Deve entrar</span><b>${brl(p.previsto)}</b><small>de ${brl(p.emAberto)} orçado em aberto</small></div>
      <div class="pv-nota">${p.conversaoHistorica != null ? `Chances ajustadas pela conversão real dos últimos 90 dias (${esc(p.conversaoHistorica)}% em ${esc(p.fechados90)} fechamentos).` : 'Ainda com poucos fechamentos nos últimos 90 dias: chances padrão por etapa.'}${p.semValor ? ` <b class="parado-txt">${esc(p.semValor)} lead${p.semValor === 1 ? '' : 's'} aberto${p.semValor === 1 ? '' : 's'} sem valor orçado</b> fica${p.semValor === 1 ? '' : 'm'} fora da conta — preencha o orçado para a previsão valer.` : ''}</div></div>
    <div class="funnel-mini">${p.porEtapa.filter(e => e.leads).map(e => `<div class="fm-row pv-linha" data-etapa="${esc(e.etapa)}" role="button" tabindex="0" title="Ver esses leads na lista"><span class="fm-name">${esc(LABEL_STATUS[e.etapa])}</span><div class="fm-bar"><div class="fm-fill" style="width:${e.valor / max * 100}%"></div></div><span class="fm-num" title="valor orçado">${brl(e.valor)}</span><span class="fm-taxa" title="chance de fechar">${Math.round(e.chance * 100)}%</span><b class="pv-prev">${brl(e.previsto)}</b></div>`).join('')}</div>`;
}
$('#previsaoFunil').addEventListener('click', e => { const r = e.target.closest('[data-etapa]'); if (!r) return; $('#fStatus').value = r.dataset.etapa; $('#fOrigem').value = ''; $('#soParados').checked = false; if ($('#soSemValor')) $('#soSemValor').checked = false; $('#fResp').value = SOU_GESTOR ? '' : 'meus'; salvarResp(); irPara('leads'); refiltrarTela(); });
$('#previsaoFunil').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-etapa]')) { e.preventDefault(); e.target.click(); } });
const _renderPainelR4b = renderPainel;
renderPainel = function () { _renderPainelR4b(); renderSeloSemDono(); carregarPrevisao(); };
// na aba IA, o resumo volta com a previsão: mostra um cartão junto do texto
const _btnIA = $('#btnIA');
_btnIA?.addEventListener('click', () => {
  const obs = new MutationObserver(() => {
    const out = $('#iaOut'); if (!out || out.querySelector('.spinner')) return;
    obs.disconnect();
    if (PREVISAO && PREVISAO.leadsAbertos && !out.querySelector('.pv-ia')) out.insertAdjacentHTML('afterbegin', `<p class="pv-ia muted">📈 Previsão pelo funil agora: <b>${brl(PREVISAO.previsto)}</b> de ${brl(PREVISAO.emAberto)} em aberto (${PREVISAO.leadsAbertos} leads).</p>`);
  });
  obs.observe($('#iaOut'), { childList: true });
  setTimeout(() => obs.disconnect(), 120000);
});

/* ================= teclado: funil (M abre a lista de etapas) e lista (↑ ↓ X) ================= */
$('#kanban').addEventListener('keydown', e => {
  const c = e.target.closest('.kb-card'); if (!c || e.target !== c) return;
  if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); const s = c.querySelector('.kb-etapa'); if (s) { s.focus(); try { s.showPicker?.(); } catch { /* sem showPicker */ } } }
});
$('#tblLeads').addEventListener('keydown', e => {
  const tr = e.target.closest('tbody tr[data-id]'); if (!tr || e.target !== tr) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); const alvo = e.key === 'ArrowDown' ? tr.nextElementSibling : tr.previousElementSibling;
    if (alvo?.matches('tr[data-id]')) alvo.focus(); else if (e.key === 'ArrowDown') $('#pagLeads [data-pag]:not([disabled]):last-child')?.focus();
  }
  if (e.key.toLowerCase() === 'x' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); const cb = tr.querySelector('.sel-lead'); if (cb) { cb.click(); } }
});

/* ================= depois do login: filtros salvos ================= */
const _iniciarSessaoR3 = iniciarSessao;
iniciarSessao = function () { const antes = SESSAO_ATIVA; _iniciarSessaoR3(); if (!antes && SESSAO_ATIVA) carregarFiltrosSalvos(); };
