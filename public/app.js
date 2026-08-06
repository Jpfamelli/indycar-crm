/* ============================================================
   IndyCar CRM — front-end (JS puro)
   ============================================================ */
'use strict';

const $  = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];

/* Escapa texto que vai para innerHTML. Sem isto, um cliente chamado
   "<img src=x onerror=...>" executaria script em todo carregamento. */
const esc = v => String(v ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

/* Sessão do Supabase Auth — a mesma conta do app de Atendimento. */
let sb = null, CONFIG = null;

/* Cabeçalhos com o token do login. Todas as rotas do CRM exigem estar logado. */
async function authCabecalhos() {
  const cab = { 'Content-Type': 'application/json' };
  if (!sb) return cab;
  const { data } = await sb.auth.getSession();
  const t = data?.session?.access_token;
  if (!t) throw new Error('Sua sessão expirou. Entre de novo para continuar.');
  cab.Authorization = `Bearer ${t}`;
  return cab;
}

/* Lança em status HTTP de erro — antes, um 400 do servidor virava "salvo com sucesso". */
const api = async (url, opts) => {
  let r;
  try {
    r = await fetch(url, { ...opts, headers: { ...(await authCabecalhos()), ...(opts?.headers || {}) } });
  } catch (e) {
    if (/sessão expirou/i.test(e.message)) throw e;
    throw new Error('Sem conexão com o servidor. Verifique se ele está rodando.');
  }
  let corpo = null;
  try { corpo = await r.json(); } catch { /* resposta sem corpo JSON */ }
  if (r.status === 401) { mostrarLogin('Sua sessão expirou. Entre de novo.'); throw new Error('Sessão expirada'); }
  if (!r.ok) throw new Error((corpo && (corpo.erro || corpo.error)) || `Erro ${r.status} do servidor`);
  return corpo;
};
const brl = n => (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dt  = s => new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

const LABEL_STATUS = { novo:'Novo', contato:'Em contato', orcamento:'Orçamento',
  agendado:'Agendado', em_servico:'Em serviço', concluido:'Concluído', perdido:'Perdido' };
const LABEL_ORIGEM = { meta:'Meta / Instagram', google:'Google', indicacao:'Indicação',
  organico:'Orgânico', whatsapp:'WhatsApp', passagem:'Passagem / Fachada' };
const COR_ORIGEM = { meta:'#3b82f6', google:'#e50914', indicacao:'#22c55e',
  organico:'#a855f7', whatsapp:'#25d366', passagem:'#f59e0b' };
const SERVICOS = ['Troca de Óleo de Motor','Troca de Óleo de Câmbio','Freios','Suspensão','Direção',
  'Correia Dentada','Pneus','Alinhamento 3D','Embreagem','Diagnóstico com Scanner',
  'Revisão de Motor','Revisão de Suspensão','Limpeza de Bicos','Outro'];

/* LEADS  = recorte filtrado (só a tabela da aba Leads usa)
   TODOS  = base completa (dashboard, funil e o modal usam) */
let STATUSES = [], ORIGENS = [], LEADS = [], TODOS = [], STATS = null;

/* ---------------- Navegação ---------------- */
const TITULOS = {
  dashboard:   ['Dashboard', 'Visão geral da operação comercial'],
  leads:       ['Leads & Clientes', 'Todos os contatos, carros e serviços'],
  pipeline:    ['Funil de Vendas', 'Acompanhe cada lead até o fechamento'],
  origem:      ['Origem dos Leads', 'De onde vem cada cliente — e quanto rende'],
  integracoes: ['Integrações', 'Meta Ads, Google Ads e o ROI de cada canal'],
  ia:          ['Resumo com IA', 'Análise inteligente da semana'],
};
// a busca só filtra estas abas — nas outras ela ficava visível e inerte
const ABAS_COM_BUSCA = new Set(['leads', 'pipeline']);

function irPara(v) {
  $$('.nav-item').forEach(x => x.classList.toggle('active', x.dataset.view === v));
  $$('.view').forEach(x => x.classList.remove('active'));
  $(`#view-${v}`)?.classList.add('active');
  $('#viewTitle').textContent = TITULOS[v][0];
  $('#viewSub').textContent = TITULOS[v][1];
  $('.search').style.display = ABAS_COM_BUSCA.has(v) ? '' : 'none';
  if (v === 'integracoes') carregarIntegracoes();
}
$$('.nav-item').forEach(b => b.addEventListener('click', () => irPara(b.dataset.view)));

/* ---------------- Toast ---------------- */
let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 3200);
}

/* ---------------- Carregar dados ---------------- */
async function carregar() {
  try {
    STATS = await api('/api/stats');
    STATUSES = STATS.dominios.STATUSES;
    ORIGENS  = STATS.dominios.ORIGENS;
    preencherSelects();
    await carregarLeads();
    renderDashboard();
    renderOrigem();
    renderHowto();
  } catch (err) {
    // antes, uma falha aqui deixava a tela em branco sem explicação
    toast('⚠️ ' + err.message);
    const alvo = $('#kpis');
    if (alvo && !alvo.children.length) {
      alvo.innerHTML = `<div class="alert" style="grid-column:1/-1">
        Não foi possível carregar os dados: ${esc(err.message)}</div>`;
    }
  }
}

async function carregarLeads() {
  const p = new URLSearchParams();
  if ($('#fStatus').value) p.set('status', $('#fStatus').value);
  if ($('#fOrigem').value) p.set('origem', $('#fOrigem').value);
  if ($('#search').value.trim()) p.set('q', $('#search').value.trim());

  // base completa: o funil e o dashboard nunca podem herdar o filtro da aba Leads
  TODOS = await api('/api/leads');
  LEADS = p.toString() ? await api('/api/leads?' + p) : TODOS;

  renderTabelaLeads();
  renderKanban();               // sempre sobre TODOS
  $('#leadCount').textContent = `${LEADS.length} registro${LEADS.length === 1 ? '' : 's'}`;
}

function preencherSelects() {
  const opt = (v, l) => `<option value="${v}">${esc(l)}</option>`;

  // preserva o que o usuário escolheu — antes, salvar um lead zerava o filtro
  const stAtual = $('#fStatus').value, ogAtual = $('#fOrigem').value;

  $('#fStatus').innerHTML = '<option value="">Todos os status</option>' +
    STATUSES.map(s => opt(s, LABEL_STATUS[s] ?? s)).join('');
  $('#fOrigem').innerHTML = '<option value="">Todas as origens</option>' +
    ORIGENS.map(o => opt(o, LABEL_ORIGEM[o] ?? o)).join('');

  if (stAtual && STATUSES.includes(stAtual)) $('#fStatus').value = stAtual;
  if (ogAtual && ORIGENS.includes(ogAtual))  $('#fOrigem').value = ogAtual;

  $('#fStatusForm').innerHTML = STATUSES.map(s => opt(s, LABEL_STATUS[s] ?? s)).join('');
  $('#fOrigemForm').innerHTML = ORIGENS.map(o => opt(o, LABEL_ORIGEM[o] ?? o)).join('');
  $('#fServico').innerHTML = '<option value="">—</option>' + SERVICOS.map(s => opt(s, s)).join('');
}

/* ---------------- Dashboard ---------------- */
function delta(atual, anterior) {
  if (!anterior) return atual ? `<span class="up">▲ novo</span>` : `<span class="flat">—</span>`;
  const p = ((atual - anterior) / anterior) * 100;
  const cls = p > 0 ? 'up' : p < 0 ? 'down' : 'flat';
  const seta = p > 0 ? '▲' : p < 0 ? '▼' : '—';
  return `<span class="${cls}">${seta} ${Math.abs(p).toFixed(0)}% vs. semana anterior</span>`;
}

function renderDashboard() {
  const s = STATS.semana, c = STATS.comparativo, g = STATS.geral;
  $('#kpis').innerHTML = `
    <div class="kpi"><div class="kpi-label">Leads na semana</div>
      <div class="kpi-value">${s.total}</div><div class="kpi-delta">${delta(c.leads.atual, c.leads.anterior)}</div></div>
    <div class="kpi"><div class="kpi-label">Faturamento (7d)</div>
      <div class="kpi-value">${brl(s.faturamento)}</div><div class="kpi-delta">${delta(c.faturamento.atual, c.faturamento.anterior)}</div></div>
    <div class="kpi"><div class="kpi-label">Taxa de conversão</div>
      <div class="kpi-value">${s.conversao.toFixed(0)}%</div><div class="kpi-delta"><span class="flat">${s.ganhos} fechados · ${s.perdidos} perdidos</span></div></div>
    <div class="kpi"><div class="kpi-label">Ticket médio</div>
      <div class="kpi-value">${brl(s.ticket)}</div><div class="kpi-delta"><span class="flat">por serviço concluído</span></div></div>
    <div class="kpi"><div class="kpi-label">Em aberto</div>
      <div class="kpi-value">${brl(s.emAberto)}</div><div class="kpi-delta"><span class="flat">orçamentos aguardando</span></div></div>
    <div class="kpi"><div class="kpi-label">Base total</div>
      <div class="kpi-value">${g.total}</div><div class="kpi-delta"><span class="flat">${brl(g.faturamento)} acumulado</span></div></div>`;

  // spotlight nos KPIs
  $$('.kpi').forEach(k => k.addEventListener('pointermove', e => {
    const r = k.getBoundingClientRect();
    k.style.setProperty('--mx', `${e.clientX - r.left}px`);
    k.style.setProperty('--my', `${e.clientY - r.top}px`);
  }));

  // funil
  const max = Math.max(...Object.values(g.porStatus), 1);
  $('#funnelMini').innerHTML = STATUSES.map(st => `
    <div class="fm-row"><span class="fm-name">${LABEL_STATUS[st]}</span>
      <div class="fm-bar"><div class="fm-fill" style="width:${(g.porStatus[st] / max) * 100}%"></div></div>
      <span class="fm-num">${g.porStatus[st]}</span></div>`).join('');

  // origem (7d)
  $('#originMini').innerHTML = s.porOrigem.length ? s.porOrigem.map(o => `
    <div class="origin-row">
      <span class="origin-name"><span class="dot" style="background:${COR_ORIGEM[o.origem]}"></span>${LABEL_ORIGEM[o.origem]}</span>
      <span class="origin-stats"><span><b>${o.leads}</b>leads</span><span><b>${o.ganhos}</b>fechou</span><span><b>${brl(o.faturamento)}</b>faturou</span></span>
    </div>`).join('') : '<p class="muted">Nenhum lead nos últimos 7 dias.</p>';

  // últimos leads — sempre a base completa, nunca o recorte filtrado da aba Leads
  renderTabela('#tblRecent', TODOS.slice(0, 8));
}

/* ---------------- Tabelas ---------------- */
function linhaLead(l) {
  return `<tr data-id="${l.id}">
    <td><div class="cell-main">${esc(l.nome)}</div><div class="cell-sub">${esc(l.telefone)}</div></td>
    <td><div class="cell-main">${esc(l.carro_modelo) || '—'}</div><div class="cell-sub">${esc(l.placa)}</div></td>
    <td>${esc(l.servico) || '—'}</td>
    <td><span class="tag">${esc(LABEL_ORIGEM[l.origem] ?? l.origem)}</span></td>
    <td class="num">${brl(l.status === 'concluido' ? l.valor_pago : l.valor_orcado)}</td>
    <td><span class="badge b-${l.status}">${LABEL_STATUS[l.status]}</span></td>
    <td class="cell-sub">${dt(l.created_at)}</td>
  </tr>`;
}
function renderTabela(sel, rows) {
  const el = $(sel);
  if (!rows.length) { el.innerHTML = '<tbody><tr><td style="padding:26px;text-align:center" class="muted">Nenhum lead encontrado.</td></tr></tbody>'; return; }
  el.innerHTML = `<thead><tr><th>Cliente</th><th>Carro</th><th>Serviço</th><th>Origem</th><th>Valor</th><th>Status</th><th>Entrada</th></tr></thead>
    <tbody>${rows.map(linhaLead).join('')}</tbody>`;
  // id fica como string: no Supabase é uuid, no SQLite é número — Number() quebraria o uuid
  $$('tbody tr', el).forEach(tr => tr.addEventListener('click', () => abrirModal(tr.dataset.id)));
}
const renderTabelaLeads = () => renderTabela('#tblLeads', LEADS);

/* ---------------- Kanban ---------------- */
function renderKanban() {
  $('#kanban').innerHTML = STATUSES.map(st => {
    // o funil mostra o pipeline inteiro — filtro da aba Leads não se aplica aqui
    const its = TODOS.filter(l => l.status === st);
    return `<div class="kb-col">
      <div class="kb-head"><span>${esc(LABEL_STATUS[st] ?? st)}</span><span class="kb-count">${its.length}</span></div>
      ${its.map(l => `<div class="kb-card" data-id="${l.id}">
        <div class="kb-nome">${esc(l.nome)}</div>
        <div class="kb-meta">${esc(l.carro_modelo) || '—'} · ${esc(l.servico) || 'serviço n/d'}</div>
        <div class="kb-valor">${brl(l.status === 'concluido' ? l.valor_pago : l.valor_orcado)}</div>
      </div>`).join('') || '<p class="muted" style="font-size:.82rem">Vazio</p>'}
    </div>`;
  }).join('');
  $$('.kb-card').forEach(c => c.addEventListener('click', () => abrirModal(c.dataset.id)));
}

/* ---------------- Origem ---------------- */
function renderOrigem() {
  const o = STATS.semana.porOrigem;
  const el = $('#tblOrigem');
  if (!o.length) { el.innerHTML = '<tbody><tr><td class="muted" style="padding:26px;text-align:center">Sem dados na semana.</td></tr></tbody>'; return; }
  el.innerHTML = `<thead><tr><th>Canal</th><th>Leads</th><th>Fechados</th><th>Conversão</th><th>Faturamento</th><th>R$ por lead</th></tr></thead>
    <tbody>${o.map(x => {
      const conv = x.leads ? (x.ganhos / x.leads) * 100 : 0;
      return `<tr>
        <td><span class="origin-name"><span class="dot" style="background:${COR_ORIGEM[x.origem]}"></span>${LABEL_ORIGEM[x.origem]}</span></td>
        <td class="num">${x.leads}</td><td class="num">${x.ganhos}</td>
        <td class="num">${conv.toFixed(0)}%</td><td class="num">${brl(x.faturamento)}</td>
        <td class="num">${brl(x.leads ? x.faturamento / x.leads : 0)}</td></tr>`;
    }).join('')}</tbody>`;
}

function renderHowto() {
  $('#howto').innerHTML = `
    <div class="howto-step"><span class="howto-n">1</span><p>
      <strong>Marque seus anúncios com UTM.</strong> No Meta Ads e no Google Ads, adicione parâmetros ao link do site:
      <br><code>indycartaubateoficial.com.br/?utm_source=facebook&utm_medium=cpc&utm_campaign=cambio-automatico</code></p></div>
    <div class="howto-step"><span class="howto-n">2</span><p>
      <strong>O site repassa a origem para o WhatsApp.</strong> A landing page lê a UTM e inclui um código na mensagem —
      assim você sabe de qual anúncio veio antes mesmo de responder.</p></div>
    <div class="howto-step"><span class="howto-n">3</span><p>
      <strong>Cadastre o lead aqui com a origem certa.</strong> Ao salvar, escolha o canal em <em>Origem</em>.
      O CRM cruza tudo e mostra qual anúncio traz cliente que <strong>realmente fecha</strong>.</p></div>
    <div class="howto-step"><span class="howto-n">4</span><p>
      <strong>Integração automática (próxima fase).</strong> Com as credenciais das APIs do Meta e do Google Ads,
      dá pra puxar custo e cliques por campanha e calcular o <strong>ROI real de cada anúncio</strong> automaticamente.</p></div>`;
}

/* ---------------- Modal ---------------- */
const modal = $('#modalBg');
let editId = null;

async function abrirModal(id) {
  // Resolve o lead ANTES de mexer no estado. Antes, um id que não estivesse no
  // recorte filtrado abria o modal em branco com editId setado — e salvar
  // sobrescrevia o cliente com campos vazios.
  let l = null;
  if (id) {
    // compara como texto: uuid (Supabase) e número (SQLite) convivem
    const mesmo = x => String(x.id) === String(id);
    l = TODOS.find(mesmo) || LEADS.find(mesmo) || null;
    if (!l) {
      try { const r = await api('/api/leads/' + id); l = r && r.id ? r : null; } catch { l = null; }
    }
    if (!l) { toast('Lead não encontrado — atualize a página.'); return; }
  }
  editId = l ? l.id : null;
  $('#modalTitle').textContent = l ? 'Editar Lead' : 'Novo Lead';
  $('#btnExcluir').style.display = l ? 'inline-flex' : 'none';
  $('#fId').value = l?.id ?? '';
  $('#fNome').value = l?.nome ?? '';
  $('#fTelefone').value = l?.telefone ?? '';
  $('#fCarro').value = l?.carro_modelo ?? '';
  $('#fPlaca').value = l?.placa ?? '';
  $('#fServico').value = l?.servico ?? '';
  $('#fOrigemForm').value = l?.origem ?? 'organico';
  $('#fOrcado').value = l?.valor_orcado ?? '';
  $('#fPago').value = l?.valor_pago ?? '';
  $('#fStatusForm').value = l?.status ?? 'novo';
  $('#fCampanha').value = l?.utm_campaign ?? '';
  $('#fObs').value = l?.observacoes ?? '';
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function fecharModal() {
  modal.classList.remove('open');
  document.body.style.overflow = '';
}
$('#btnNovo').addEventListener('click', () => abrirModal(null));
$('#modalX').addEventListener('click', fecharModal);
$('#btnCancelar').addEventListener('click', fecharModal);
modal.addEventListener('click', e => { if (e.target === modal) fecharModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharModal(); });

$('#leadForm').addEventListener('submit', async e => {
  e.preventDefault();
  const payload = {
    nome: $('#fNome').value.trim(), telefone: $('#fTelefone').value.trim(),
    carro_modelo: $('#fCarro').value.trim(), placa: $('#fPlaca').value.trim().toUpperCase(),
    servico: $('#fServico').value, origem: $('#fOrigemForm').value,
    valor_orcado: $('#fOrcado').value || 0, valor_pago: $('#fPago').value || 0,
    status: $('#fStatusForm').value, utm_campaign: $('#fCampanha').value.trim(),
    observacoes: $('#fObs').value.trim(),
  };
  if (!payload.nome || !payload.telefone) { toast('⚠️ Preencha nome e telefone.'); return; }

  const btnSalvar = $('#leadForm button[type="submit"]');
  btnSalvar.disabled = true;
  try {
    const editando = editId;
    if (editando) await api(`/api/leads/${editando}`, { method: 'PATCH', body: JSON.stringify(payload) });
    else await api('/api/leads', { method: 'POST', body: JSON.stringify(payload) });
    fecharModal();
    toast(editando ? '✅ Lead atualizado' : '✅ Lead cadastrado');
    await carregar();
  } catch (err) {
    toast('⚠️ ' + err.message);   // erro do servidor não pode mais virar "sucesso"
  } finally {
    btnSalvar.disabled = false;
  }
});

$('#btnExcluir').addEventListener('click', async () => {
  if (!editId || !confirm('Excluir este lead? Essa ação não pode ser desfeita.')) return;
  try {
    await api(`/api/leads/${editId}`, { method: 'DELETE' });
    fecharModal();
    toast('🗑️ Lead excluído');
    await carregar();
  } catch (err) {
    toast('⚠️ ' + err.message);
  }
});

/* ---------------- Filtros ---------------- */
let buscaT;
$('#search').addEventListener('input', () => { clearTimeout(buscaT); buscaT = setTimeout(carregarLeads, 250); });
$('#fStatus').addEventListener('change', carregarLeads);
$('#fOrigem').addEventListener('change', carregarLeads);

/* ---------------- IA ---------------- */
/* Converte o markdown da IA em HTML. Processa BLOCO A BLOCO — a versão antiga
   fundia uma lista com marcadores e uma numerada num único <ul>, e ainda
   aninhava esse <ul> dentro de um <p> (HTML inválido). O texto é escapado
   antes, então a resposta da IA nunca injeta HTML na página. */
function markdownSimples(md) {
  const inline = t => esc(t)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>');

  return String(md ?? '').split(/\n{2,}/).map(bloco => {
    const linhas = bloco.split('\n').map(l => l.trim()).filter(Boolean);
    if (!linhas.length) return '';

    // bloco inteiro de lista (marcadores OU numerada — nunca misturados)
    const ehItem = l => /^([-*]|\d+\.)\s+/.test(l);
    if (linhas.every(ehItem)) {
      const numerada = /^\d+\.\s+/.test(linhas[0]);
      const tag = numerada ? 'ol' : 'ul';
      return `<${tag}>` + linhas.map(l =>
        `<li>${inline(l.replace(/^([-*]|\d+\.)\s+/, ''))}</li>`).join('') + `</${tag}>`;
    }

    // heading (#, ## ou ###) na primeira linha
    const h = linhas[0].match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      const nivel = h[1].length === 1 ? 2 : h[1].length;   // # vira h2 (h1 é da página)
      const resto = linhas.slice(1);
      return `<h${nivel}>${inline(h[2])}</h${nivel}>` +
             (resto.length ? `<p>${resto.map(inline).join('<br>')}</p>` : '');
    }

    return `<p>${linhas.map(inline).join('<br>')}</p>`;
  }).join('');
}

$('#btnIA').addEventListener('click', async () => {
  const btn = $('#btnIA'), out = $('#iaOut');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Analisando a semana…';
  out.innerHTML = '<p class="muted"><span class="spinner"></span>A IA está lendo os dados do CRM…</p>';
  try {
    const r = await api('/api/resumo-ia', { method: 'POST' });
    if (r.ok && (r.resumo || '').trim()) {
      out.innerHTML =
        (r.truncado ? '<div class="alert">⚠️ O resumo foi cortado por limite de tamanho. Gere de novo se faltar conteúdo.</div>' : '') +
        markdownSimples(r.resumo) +
        `<p class="muted" style="margin-top:18px;font-size:.8rem">Gerado por ${esc(r.modelo)} · ${new Date(r.geradoEm).toLocaleString('pt-BR')}</p>`;
      toast('✨ Resumo gerado');
    } else {
      out.innerHTML = `<div class="alert"><strong>IA não configurada.</strong><br>${esc(r.erro || 'A IA devolveu uma resposta vazia.')}
        ${r.instrucao ? `<br><br>${esc(r.instrucao)}` : ''}</div>
        <p class="muted" style="margin-top:16px">Enquanto isso, este é o briefing que seria enviado para a IA:</p>
        <div class="briefing">${esc(r.briefing || '')}</div>`;
    }
  } catch (err) {
    out.innerHTML = `<div class="alert">Erro ao gerar o resumo: ${esc(err.message)}</div>`;
  }
  btn.disabled = false;
  btn.textContent = '✨ Gerar resumo da semana';
});

/* ---------------- Seed ---------------- */
$('#btnSeed').addEventListener('click', async () => {
  if (!confirm('Isso apaga os dados atuais e recria exemplos. Continuar?')) return;
  try {
    const r = await api('/api/seed', { method: 'POST' });
    toast(`↻ ${r.criados} leads de exemplo criados`);
    await carregar();
  } catch (err) { toast('⚠️ ' + err.message); }
});

/* ============================================================
   INTEGRAÇÕES — Meta Ads / Google Ads + ROI por canal
   ============================================================ */
const ROTULO_CANAL = { meta:'Meta Ads', google:'Google Ads' };

/** Preenche um formulário com o que veio da API. Segredos NUNCA chegam aqui —
 *  o campo fica vazio e a máscara aparece embaixo como confirmação. */
function preencherFormIntegracao(dados) {
  const form = $(`.int-form[data-canal="${dados.canal}"]`);
  if (!form) return;

  for (const campo of Object.keys(dados)) {
    const input = form.querySelector(`[name="${campo}"]`);
    if (!input || input.type === 'checkbox') continue;
    if (input.dataset.secreto) { input.value = ''; continue; }
    input.value = dados[campo] ?? '';
  }
  form.querySelector('[name="ativo"]').checked = !!dados.ativo;

  // máscara sob cada segredo
  form.querySelectorAll('.int-mask').forEach(el => {
    const campo = el.dataset.for;
    el.textContent = dados[`${campo}_definido`]
      ? `Salvo: ${dados[`${campo}_mask`]} — deixe em branco para manter.`
      : '';
  });

  // selo de status
  const selo = $(dados.canal === 'meta' ? '#stMeta' : '#stGoogle');
  if (dados.conectado)      { selo.textContent = 'Conectado';  selo.className = 'int-status on'; }
  else if (dados.faltando.length && dados.faltando.length < OBRIG_TOTAL(dados.canal))
                            { selo.textContent = 'Incompleto'; selo.className = 'int-status pend'; }
  else if (!dados.faltando.length && !dados.ativo)
                            { selo.textContent = 'Desativado'; selo.className = 'int-status pend'; }
  else                      { selo.textContent = 'Não configurado'; selo.className = 'int-status'; }
}
const OBRIG_TOTAL = canal => (canal === 'meta' ? 2 : 5);

async function carregarIntegracoes() {
  try {
    const r = await api('/api/integracoes');
    r.canais.forEach(preencherFormIntegracao);
    if (!$('#mesROI').value) $('#mesROI').value = new Date().toISOString().slice(0, 7);
    if (!$('#mCanal').options.length) {
      $('#mCanal').innerHTML = ORIGENS.map(o =>
        `<option value="${o}">${esc(LABEL_ORIGEM[o] ?? o)}</option>`).join('');
    }
    await carregarROI();
  } catch (err) { toast('⚠️ ' + err.message); }
}

async function carregarROI() {
  try {
    const mes = $('#mesROI').value || undefined;
    const r = await api('/api/roi' + (mes ? `?competencia=${mes}` : ''));
    const t = r.totais;
    const fmtRoi = v => v === null ? '—' : `${v.toFixed(2)}x`;

    $('#roiKpis').innerHTML = `
      <div class="kpi"><div class="kpi-label">Investido no mês</div>
        <div class="kpi-value">${brl(t.investimento)}</div>
        <div class="kpi-delta"><span class="flat">${t.leads} leads captados</span></div></div>
      <div class="kpi"><div class="kpi-label">Faturamento atribuído</div>
        <div class="kpi-value">${brl(t.faturamento)}</div>
        <div class="kpi-delta"><span class="flat">${t.ganhos} serviços fechados</span></div></div>
      <div class="kpi"><div class="kpi-label">Resultado</div>
        <div class="kpi-value">${brl(t.lucro)}</div>
        <div class="kpi-delta"><span class="${t.lucro >= 0 ? 'up' : 'down'}">
          ${t.lucro >= 0 ? '▲ lucro' : '▼ prejuízo'}</span></div></div>
      <div class="kpi"><div class="kpi-label">Retorno geral</div>
        <div class="kpi-value">${fmtRoi(t.roi)}</div>
        <div class="kpi-delta"><span class="flat">por real investido</span></div></div>`;

    const el = $('#tblROI');
    if (!r.linhas.length) {
      el.innerHTML = '<tbody><tr><td class="muted" style="padding:26px;text-align:center">Sem dados neste mês. Cadastre o investimento acima.</td></tr></tbody>';
      return;
    }
    el.innerHTML = `<thead><tr><th>Canal</th><th>Investido</th><th>Leads</th><th>Fechou</th>
        <th>Faturamento</th><th>Custo/lead</th><th>Custo/venda</th><th>Retorno</th></tr></thead>
      <tbody>${r.linhas.map(l => `<tr>
        <td><span class="origin-name"><span class="dot" style="background:${COR_ORIGEM[l.canal] || '#888'}"></span>${esc(LABEL_ORIGEM[l.canal] ?? l.canal)}</span></td>
        <td class="num">${l.investimento ? brl(l.investimento) : '—'}</td>
        <td class="num">${l.leads}</td>
        <td class="num">${l.ganhos}</td>
        <td class="num">${brl(l.faturamento)}</td>
        <td class="num">${l.custoPorLead ? brl(l.custoPorLead) : '—'}</td>
        <td class="num">${l.custoPorVenda ? brl(l.custoPorVenda) : '—'}</td>
        <td class="num ${l.roi === null ? '' : l.roi >= 1 ? 'roi-pos' : 'roi-neg'}">${fmtRoi(l.roi)}</td>
      </tr>`).join('')}</tbody>`;
  } catch (err) { toast('⚠️ ' + err.message); }
}

// salvar credenciais de um canal
$$('.int-form').forEach(form => {
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const canal = form.dataset.canal;
    const payload = {};
    form.querySelectorAll('input').forEach(i => {
      if (i.name === 'ativo') payload.ativo = i.checked;
      else if (i.value.trim()) payload[i.name] = i.value.trim();   // vazio = "não mexi neste campo"
    });
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const r = await api(`/api/integracoes/${canal}`, { method: 'PATCH', body: JSON.stringify(payload) });
      preencherFormIntegracao(r);
      toast(r.conectado ? `✅ ${ROTULO_CANAL[canal]} conectado`
                        : `💾 Salvo — falta: ${r.faltando.join(', ') || 'ativar o canal'}`);
    } catch (err) { toast('⚠️ ' + err.message); }
    finally { btn.disabled = false; }
  });

  form.querySelector('[data-acao="limpar"]').addEventListener('click', async () => {
    const canal = form.dataset.canal;
    if (!confirm(`Apagar as credenciais do ${ROTULO_CANAL[canal]}?`)) return;
    try {
      preencherFormIntegracao(await api(`/api/integracoes/${canal}`, { method: 'DELETE' }));
      toast('🗑️ Credenciais apagadas');
    } catch (err) { toast('⚠️ ' + err.message); }
  });
});

// salvar investimento do mês
$('#formMetrica').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const payload = {
    canal: f.canal.value,
    competencia: $('#mesROI').value || undefined,
    investimento: f.investimento.value || 0,
    cliques: f.cliques.value || 0,
    impressoes: f.impressoes.value || 0,
  };
  try {
    await api('/api/metricas', { method: 'POST', body: JSON.stringify(payload) });
    toast('💰 Investimento registrado');
    f.investimento.value = f.cliques.value = f.impressoes.value = '';
    await carregarROI();
  } catch (err) { toast('⚠️ ' + err.message); }
});

$('#mesROI').addEventListener('change', carregarROI);

/* ============================================================
   LOGIN — nada do CRM aparece antes de entrar
   ============================================================ */
function mostrarLogin(mensagem) {
  document.body.classList.add('deslogado');
  $('#telaLogin').hidden = false;
  const erro = $('#erroLogin');
  if (mensagem) { erro.textContent = mensagem; erro.hidden = false; }
  else { erro.hidden = true; }
}

function esconderLogin() {
  document.body.classList.remove('deslogado');
  $('#telaLogin').hidden = true;
  $('#erroLogin').hidden = true;
}

$('#formLogin').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, btn = $('#btnEntrar');
  btn.disabled = true; btn.textContent = 'ENTRANDO…';
  try {
    if (!sb) throw new Error('Conexão com o Supabase não configurada.');
    const { error } = await sb.auth.signInWithPassword({
      email: f.loginEmail.value.trim(),
      password: f.loginSenha.value,
    });
    if (error) {
      throw new Error(/invalid login/i.test(error.message)
        ? 'E-mail ou senha incorretos.' : error.message);
    }
    f.loginSenha.value = '';
    esconderLogin();
    await carregar();
  } catch (err) {
    mostrarLogin(err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'ENTRAR';
  }
});

/* ---------------- Boot ---------------- */
(async function iniciar() {
  mostrarLogin();                       // capa primeiro: nada vaza antes da senha
  try {
    CONFIG = await (await fetch('/api/config')).json();
  } catch {
    return mostrarLogin('Não consegui falar com o servidor. Ele está rodando?');
  }
  if (!CONFIG.configurado) {
    return mostrarLogin('Falta configurar o Supabase no servidor (SUPABASE_URL, '
      + 'SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY).');
  }
  if (!window.supabase?.createClient) {
    return mostrarLogin('A biblioteca do Supabase não carregou. Verifique sua conexão.');
  }
  sb = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);

  // já estava logado? entra direto
  const { data } = await sb.auth.getSession();
  if (data?.session) {
    esconderLogin();
    try { await carregar(); }
    catch (err) { mostrarLogin(err.message); }
  }
})();
