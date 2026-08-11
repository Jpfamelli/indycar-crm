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

/* PERFIL   = quem está logado (nome, e-mail, papel)
   SOU_ADMIN é só para a apresentação: o servidor confere de novo em cada rota. */
let PERFIL = null, SOU_ADMIN = false;
let CATALOGO = [];              // os 138 serviços, como vieram do banco

/* ---------------- Navegação ---------------- */
const TITULOS = {
  dashboard:     ['Dashboard', 'Visão geral da operação comercial'],
  leads:         ['Leads', 'Todos os contatos, carros e serviços'],
  clientes:      ['Clientes', 'A base compartilhada com a agenda e o atendimento'],
  pipeline:      ['Funil de Vendas', 'Acompanhe cada lead até o fechamento'],
  origem:        ['Origem dos Leads', 'De onde vem cada cliente — e quanto rende'],
  servicos:      ['Serviços', 'O catálogo que a IA usa para responder o cliente'],
  integracoes:   ['Integrações', 'Meta Ads, Google Ads e o ROI de cada canal'],
  ia:            ['Resumo com IA', 'Análise inteligente da semana'],
  configuracoes: ['Configurações', 'Sua conta, sua senha e a equipe'],
};
// a busca do topo só filtra estas abas — nas outras ela ficava visível e inerte
// (Clientes e Serviços têm a própria busca, dentro da aba)
const ABAS_COM_BUSCA = new Set(['leads', 'pipeline']);
// "+ Novo Lead" não faz sentido no catálogo nem nas configurações
const ABAS_SEM_NOVO = new Set(['servicos', 'configuracoes']);

function irPara(v) {
  if (!TITULOS[v]) return;
  $$('.nav-item').forEach(x => x.classList.toggle('active', x.dataset.view === v));
  $$('.view').forEach(x => x.classList.remove('active'));
  $(`#view-${v}`)?.classList.add('active');
  $('#viewTitle').textContent = TITULOS[v][0];
  $('#viewSub').textContent = TITULOS[v][1];
  $('.search').style.display = ABAS_COM_BUSCA.has(v) ? '' : 'none';
  $('#btnNovo').style.display = ABAS_SEM_NOVO.has(v) ? 'none' : '';
  if (v === 'integracoes')   carregarIntegracoes();
  if (v === 'clientes')      carregarClientes();
  if (v === 'servicos')      carregarCatalogo();
  if (v === 'configuracoes') carregarConfiguracoes();
}
$$('.nav-item').forEach(b => b.addEventListener('click', () => irPara(b.dataset.view)));

/* ---------------- Tema claro / escuro ----------------
   O <html data-tema> já foi definido pelo script inline do <head> (para não
   piscar). Aqui só sincronizamos o botão, o meta e a persistência. */
const TEMA_KEY = 'indycar_tema';
const temaAtual = () =>
  document.documentElement.getAttribute('data-tema') === 'claro' ? 'claro' : 'escuro';

function aplicarTema(tema) {
  const claro = tema === 'claro';
  const raiz = document.documentElement;

  /* Desliga as transições durante a troca. Sem isto, o Chrome congela a cor
     antiga de tudo que tem transition e a variável mudou — medido aqui: a
     barra lateral ficava em rgb(13,13,15) com --sidebar já valendo #ffffff. */
  raiz.classList.add('trocando-tema');
  raiz.setAttribute('data-tema', claro ? 'claro' : 'escuro');
  void document.body.offsetHeight;              // força o recálculo já, sem transição
  const soltar = () => raiz.classList.remove('trocando-tema');
  requestAnimationFrame(() => requestAnimationFrame(soltar));
  // rede de segurança: requestAnimationFrame não roda em aba oculta, e sem
  // isso as transições ficariam desligadas até a aba voltar para a frente
  setTimeout(soltar, 150);

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', claro ? '#eaecf0' : '#0a0a0b');

  const ico = $('#temaIco'), txt = $('#temaTxt');
  if (ico) ico.textContent = claro ? '☀️' : '🌙';
  if (txt) txt.textContent = claro ? 'Tema claro' : 'Tema escuro';

  try { localStorage.setItem(TEMA_KEY, claro ? 'claro' : 'escuro'); } catch { /* ignora */ }
}

$('#btnTema')?.addEventListener('click', () =>
  aplicarTema(temaAtual() === 'claro' ? 'escuro' : 'claro'));

// deixa o botão e o meta coerentes com o que o script do <head> já aplicou
aplicarTema(temaAtual());

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
  // quem sou eu: define o que a tela mostra (o servidor confere de novo, sempre)
  try {
    PERFIL = await api('/api/perfil');
    SOU_ADMIN = PERFIL?.papel === 'admin';
  } catch { PERFIL = null; SOU_ADMIN = false; }

  /* Esconde o que só admin usa. É só apresentação — o servidor devolve 403
     de qualquer forma; isto evita o atendente clicar e levar erro na cara.
     O "Dados de exemplo" APAGA todos os leads: fora da vista de quem não pode. */
  const btnSeed = $('#btnSeed');
  if (btnSeed) btnSeed.hidden = !SOU_ADMIN;
  const navInteg = $('.nav-item[data-view="integracoes"]');
  if (navInteg) navInteg.hidden = !SOU_ADMIN;

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
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  fecharModal();
  fecharFichaCliente();
});

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
   CLIENTES — a base compartilhada com a Agenda e o Atendimento
   ============================================================ */
const LABEL_AGENDAMENTO = {
  agendado:'Agendado', confirmado:'Confirmado', em_atendimento:'Em atendimento',
  concluido:'Concluído', compareceu:'Compareceu', nao_veio:'Não veio', cancelado:'Cancelado',
};
/* Data com ano — na ficha do cliente o histórico atravessa meses e
   "12/03" sozinho não diz de qual ano é. */
const dtAno = s => s ? new Date(s).toLocaleDateString('pt-BR',
  { day:'2-digit', month:'2-digit', year:'2-digit' }) : '—';
/* Data pura do banco ("2026-07-16") — new Date() nela assume UTC e o
   fuso do Brasil jogaria o dia para trás. Por isso montamos na mão. */
const dtSimples = s => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? ''));
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : '—';
};
const iniciais = nome => String(nome ?? '?').trim().split(/\s+/)
  .slice(0, 2).map(p => p[0] || '').join('').toUpperCase() || '?';

const modalCli = $('#modalCliBg');

async function carregarClientes() {
  const alvo = $('#tblClientes');
  const q = $('#buscaCliente').value.trim();
  try {
    const r = await api('/api/clientes' + (q ? `?q=${encodeURIComponent(q)}` : ''));
    const lista = r.clientes || [];

    $('#cliKpis').innerHTML = `
      <div class="kpi"><div class="kpi-label">${r.filtrado ? 'Clientes encontrados' : 'Clientes na base'}</div>
        <div class="kpi-value">${r.total}</div>
        <div class="kpi-delta"><span class="flat">${r.filtrado
          ? `de ${r.totalBase} na base` : 'compartilhada com a agenda'}</span></div></div>
      <div class="kpi"><div class="kpi-label">Já faturado</div>
        <div class="kpi-value">${brl(r.faturamento)}</div>
        <div class="kpi-delta"><span class="flat">${r.filtrado
          ? `de ${brl(r.faturamentoBase)} no total`
          : 'serviços concluídos, sem contar duas vezes'}</span></div></div>
      <div class="kpi"><div class="kpi-label">Ticket por cliente</div>
        <div class="kpi-value">${brl(r.total ? r.faturamento / r.total : 0)}</div>
        <div class="kpi-delta"><span class="flat">média ${r.filtrado
          ? 'de quem apareceu na busca' : 'da base inteira'}</span></div></div>`;

    $('#cliCount').textContent = `${lista.length} cliente${lista.length === 1 ? '' : 's'}`
      + (q ? ' encontrados' : '');

    if (!lista.length) {
      alvo.innerHTML = `<tbody><tr><td class="muted" style="padding:26px;text-align:center">
        ${q ? 'Nenhum cliente com esse termo.' : 'A base de clientes ainda está vazia.'}</td></tr></tbody>`;
      return;
    }

    alvo.innerHTML = `<thead><tr><th>Cliente</th><th>Carro</th><th>Origem</th>
        <th>Serviços</th><th>Em aberto</th><th>Já gastou</th><th>Último contato</th></tr></thead>
      <tbody>${lista.map(c => `<tr data-id="${esc(c.id)}" tabindex="0">
        <td><div class="cell-main">${esc(c.nome)}</div><div class="cell-sub">${esc(c.telefone)}</div></td>
        <td><div class="cell-main">${esc(c.carro_modelo) || '—'}</div><div class="cell-sub">${esc(c.placa)}</div></td>
        <td><span class="tag">${esc(LABEL_ORIGEM[c.origem] ?? c.origem ?? '—')}</span></td>
        <td class="num">${c.servicos}</td>
        <td class="num">${c.emAberto ? brl(c.emAberto) : '—'}</td>
        <td class="num">${brl(c.gasto)}</td>
        <td class="cell-sub">${dtAno(c.ultimoContato)}</td>
      </tr>`).join('')}</tbody>`;

    $$('tbody tr', alvo).forEach(tr => {
      const abrir = () => abrirFichaCliente(tr.dataset.id);
      tr.addEventListener('click', abrir);
      // teclado: a linha é focável, então Enter/Espaço têm de abrir também
      tr.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); }
      });
    });
  } catch (err) {
    alvo.innerHTML = `<tbody><tr><td style="padding:26px" class="muted">
      <div class="alert">Não consegui carregar os clientes: ${esc(err.message)}</div></td></tr></tbody>`;
  }
}

let buscaCliT;
$('#buscaCliente').addEventListener('input', () => {
  clearTimeout(buscaCliT);
  buscaCliT = setTimeout(carregarClientes, 280);
});

function fecharFichaCliente() {
  if (!modalCli.classList.contains('open')) return;
  modalCli.classList.remove('open');
  document.body.style.overflow = '';
}
$('#modalCliX').addEventListener('click', fecharFichaCliente);
modalCli.addEventListener('click', e => { if (e.target === modalCli) fecharFichaCliente(); });

async function abrirFichaCliente(id) {
  const alvo = $('#fichaCliente');
  alvo.innerHTML = '<p class="muted"><span class="spinner"></span>Montando a ficha…</p>';
  modalCli.classList.add('open');
  document.body.style.overflow = 'hidden';

  try {
    const f = await api('/api/clientes/' + encodeURIComponent(id));
    const c = f.cliente, r = f.resumo;

    const linhasLeads = f.leads.length ? f.leads.map(l => `<tr>
        <td><div class="cell-main">${esc(l.servico) || 'Serviço não informado'}</div>
            <div class="cell-sub">${esc(LABEL_ORIGEM[l.origem] ?? l.origem ?? '')} · ${dtAno(l.created_at)}</div></td>
        <td><span class="badge b-${esc(l.status)}">${esc(LABEL_STATUS[l.status] ?? l.status)}</span></td>
        <td class="num">${brl(l.status === 'concluido' ? l.valor_pago : l.valor_orcado)}</td>
      </tr>`).join('') : '';

    const linhasAg = f.agendamentos.length ? f.agendamentos.map(a => `<tr>
        <td><div class="cell-main">${esc(a.servico) || 'Serviço não informado'}</div>
            <div class="cell-sub">${dtSimples(a.data)} às ${esc(String(a.hora ?? '').slice(0, 5))} · ${esc(a.veiculo) || '—'}</div></td>
        <td><span class="badge b-${esc(a.status)}">${esc(LABEL_AGENDAMENTO[a.status] ?? a.status)}</span></td>
        <td class="num">${a.valor ? brl(a.valor) : '—'}</td>
      </tr>`).join('') : '';

    alvo.innerHTML = `
      <div class="ficha-topo">
        <span class="avatar">${esc(iniciais(c.nome))}</span>
        <div>
          <div class="ficha-nome">${esc(c.nome)}</div>
          <div class="ficha-sub">${esc(c.telefone)}${c.email ? ' · ' + esc(c.email) : ''}</div>
          <div class="ficha-sub">${esc(c.carro_modelo) || 'Carro não informado'}${c.placa ? ' · ' + esc(c.placa) : ''}
            · cliente desde ${dtAno(c.created_at)}</div>
        </div>
      </div>

      <div class="ficha-kpis">
        <div class="ficha-kpi"><span>Já gastou</span><b>${brl(r.gasto)}</b></div>
        <div class="ficha-kpi"><span>Serviços feitos</span><b>${r.servicosFeitos}</b></div>
        <div class="ficha-kpi"><span>Ticket médio</span><b>${brl(r.ticket)}</b></div>
        <div class="ficha-kpi"><span>Em aberto</span><b>${brl(r.emAberto)}</b></div>
        <div class="ficha-kpi"><span>Leads</span><b>${r.leads}</b></div>
        <div class="ficha-kpi"><span>Agendamentos</span><b>${r.agendamentos}</b></div>
      </div>

      <div class="ficha-bloco">
        <h4>Serviços já feitos</h4>
        ${f.servicos.length
          ? `<div class="chips">${f.servicos.map(s =>
              `<span class="chip-servico">${esc(s.nome)}<b>${s.vezes}×</b></span>`).join('')}</div>`
          : '<p class="muted" style="font-size:.88rem">Nenhum serviço concluído até agora.</p>'}
      </div>

      <div class="ficha-bloco">
        <h4>Últimos leads</h4>
        ${linhasLeads ? `<table class="mini-tabela"><tbody>${linhasLeads}</tbody></table>`
                      : '<p class="muted" style="font-size:.88rem">Sem leads registrados.</p>'}
      </div>

      <div class="ficha-bloco">
        <h4>Últimos agendamentos</h4>
        ${linhasAg ? `<table class="mini-tabela"><tbody>${linhasAg}</tbody></table>`
                   : '<p class="muted" style="font-size:.88rem">Sem horários marcados.</p>'}
      </div>

      ${c.observacoes ? `<div class="ficha-bloco"><h4>Observações</h4>
        <p class="muted" style="font-size:.9rem;line-height:1.6">${esc(c.observacoes)}</p></div>` : ''}

      <p class="muted" style="font-size:.78rem;margin-top:18px">
        "Já gastou" soma os leads concluídos mais os agendamentos concluídos que não vieram de
        um lead — assim o mesmo serviço não entra na conta duas vezes.</p>`;
  } catch (err) {
    alvo.innerHTML = `<div class="alert">Não consegui abrir a ficha: ${esc(err.message)}</div>`;
  }
}

/* ============================================================
   SERVIÇOS — o catálogo que alimenta a IA do WhatsApp
   ============================================================ */
const LABEL_ESCOPO = { LEVES:'Veículos leves', TODOS:'Todos os veículos', ESPECIFICO:'Caso a caso' };
let filtroFaz = '';   // '' = todos | '1' = fazemos | '0' = não fazemos

async function carregarCatalogo() {
  const alvo = $('#listaServicos');
  if (!CATALOGO.length) {
    alvo.innerHTML = '<p class="muted"><span class="spinner"></span>Carregando o catálogo…</p>';
  }
  try {
    const r = await api('/api/catalogo');
    CATALOGO = r.servicos || [];
    SOU_ADMIN = !!r.souAdmin;
    $('#srvAviso').hidden = SOU_ADMIN;
    renderCatalogo();
  } catch (err) {
    alvo.innerHTML = `<div class="alert">Não consegui carregar o catálogo: ${esc(err.message)}</div>`;
  }
}

function renderCatalogo() {
  const alvo = $('#listaServicos');
  const termo = $('#buscaServico').value.trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  const semAcento = s => String(s ?? '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');

  const lista = CATALOGO.filter(s => {
    if (filtroFaz === '1' && !s.fazemos) return false;
    if (filtroFaz === '0' && s.fazemos)  return false;
    if (!termo) return true;
    return semAcento(`${s.servico} ${s.categoria} ${s.tipo_veiculo}`).includes(termo);
  });

  const fazemos = CATALOGO.filter(s => s.fazemos).length;
  $('#srvCount').textContent =
    `${lista.length} de ${CATALOGO.length} · ${fazemos} que fazemos, ${CATALOGO.length - fazemos} que não`;

  if (!lista.length) {
    alvo.innerHTML = '<div class="vazio">Nenhum serviço com esse filtro.</div>';
    return;
  }

  // agrupa por categoria mantendo a ordem que veio do banco
  const porCategoria = new Map();
  for (const s of lista) {
    if (!porCategoria.has(s.categoria)) porCategoria.set(s.categoria, []);
    porCategoria.get(s.categoria).push(s);
  }

  alvo.innerHTML = [...porCategoria.entries()].map(([categoria, itens]) => `
    <div class="cat-bloco">
      <div class="cat-head">
        <h4>${esc(categoria)}</h4>
        <span class="cat-conta">${itens.length}</span>
      </div>
      <div class="srv-lista">
        ${itens.map(s => `
          <div class="srv-item${s.fazemos ? '' : ' nao'}">
            <div class="srv-txt">
              <div class="srv-nome">${esc(s.servico)}
                <span class="chip-escopo">${esc(LABEL_ESCOPO[s.escopo] ?? s.escopo ?? '')}</span></div>
              ${s.tipo_veiculo ? `<div class="srv-veiculo">${esc(s.tipo_veiculo)}</div>` : ''}
              ${s.observacao ? `<div class="srv-veiculo">${esc(s.observacao)}</div>` : ''}
            </div>
            <button type="button" class="srv-toggle ${s.fazemos ? 'faz' : 'naofaz'}"
                    data-id="${esc(s.id)}" data-fazemos="${s.fazemos ? '1' : '0'}"
                    ${SOU_ADMIN ? '' : 'disabled'}
                    title="${SOU_ADMIN ? 'Clique para alternar' : 'Só o administrador altera'}">
              ${s.fazemos ? 'Fazemos' : 'Não fazemos'}
            </button>
          </div>`).join('')}
      </div>
    </div>`).join('');

  if (!SOU_ADMIN) return;
  $$('#listaServicos .srv-toggle').forEach(b => b.addEventListener('click', async () => {
    const id = b.dataset.id, novo = b.dataset.fazemos !== '1';
    b.disabled = true;
    try {
      const r = await api('/api/catalogo/' + encodeURIComponent(id),
        { method: 'PATCH', body: JSON.stringify({ fazemos: novo }) });
      const i = CATALOGO.findIndex(s => s.id === id);
      if (i >= 0) CATALOGO[i] = r.servico;
      toast(novo ? `✅ A IA passa a oferecer "${r.servico.servico}"`
                 : `🚫 A IA para de oferecer "${r.servico.servico}"`);
      renderCatalogo();
    } catch (err) {
      toast('⚠️ ' + err.message);
      b.disabled = false;
    }
  }));
}

let buscaSrvT;
$('#buscaServico').addEventListener('input', () => {
  clearTimeout(buscaSrvT);
  buscaSrvT = setTimeout(renderCatalogo, 200);
});
$$('#filtrosServico .filtro-pill').forEach(b => b.addEventListener('click', () => {
  filtroFaz = b.dataset.faz;
  $$('#filtrosServico .filtro-pill').forEach(x => x.classList.toggle('ativo', x === b));
  renderCatalogo();
}));

/* ============================================================
   CONFIGURAÇÕES — minha conta · equipe e sistema
   ============================================================ */
const LABEL_PAPEL = { admin:'Administrador', atendente:'Atendente' };

/* Seletor interno: "Minha conta" x "Equipe e sistema" */
$$('#configTabs .config-pilula').forEach(b => b.addEventListener('click', () => {
  const secao = b.dataset.secao;
  $$('#configTabs .config-pilula').forEach(x => x.classList.toggle('ativo', x === b));
  $$('.config-secao').forEach(s => s.classList.toggle('ativa', s.id === `config-${secao}`));
}));

async function carregarConfiguracoes() {
  try {
    PERFIL = await api('/api/perfil');
    SOU_ADMIN = PERFIL?.papel === 'admin';
    $('#perfilNome').value  = PERFIL?.nome ?? '';
    $('#perfilEmail').value = PERFIL?.email ?? '';
    $('#perfilPapel').value = LABEL_PAPEL[PERFIL?.papel] ?? (PERFIL?.papel || '—');
  } catch (err) { toast('⚠️ ' + err.message); }

  renderSistemaInfo();
  await carregarEquipe();
}

function renderSistemaInfo() {
  $('#sistemaInfo').innerHTML = `
    <div class="howto-step"><span class="howto-n">1</span><p>
      <strong>Banco único.</strong> CRM, Agenda e Atendimento gravam nas mesmas tabelas.
      O cliente é reconhecido pelo <strong>telefone</strong> nos três.</p></div>
    <div class="howto-step"><span class="howto-n">2</span><p>
      <strong>Login único.</strong> O mesmo e-mail e senha entram nos três sistemas.
      Tirar o acesso aqui tira em todos.</p></div>
    <div class="howto-step"><span class="howto-n">3</span><p>
      <strong>Catálogo é a boca da IA.</strong> A aba <strong>Serviços</strong> define o que a IA
      oferece no WhatsApp. Mudou lá, muda no atendimento.</p></div>
    <div class="howto-step"><span class="howto-n">4</span><p>
      <strong>Chave da IA fica no servidor.</strong> Ela vive no arquivo <code>.env</code>,
      em <code>ANTHROPIC_API_KEY</code>. Por segurança, esta tela não pede nem aceita a chave.</p></div>`;
}

async function carregarEquipe() {
  const el = $('#listaEquipe');
  el.innerHTML = '<p class="muted"><span class="spinner"></span>Carregando a equipe…</p>';
  try {
    const r = await api('/api/equipe');
    const lista = r.equipe || [];
    SOU_ADMIN = !!r.souAdmin;
    $('#blocoCadastro').hidden = !SOU_ADMIN;
    $('#avisoCadastro').hidden = SOU_ADMIN;

    el.innerHTML = lista.length ? lista.map(p => {
      const papel = p.papel === 'admin' ? 'admin' : 'atendente';
      return `
      <div class="equipe-item${p.ativo ? '' : ' inativo'}">
        <span class="avatar">${esc(iniciais(p.nome))}</span>
        <div class="equipe-txt">
          <strong>${esc(p.nome)}</strong>${p.id === r.meuId ? ' <em class="voce">(você)</em>' : ''}<br>
          <small>${esc(p.email)}${p.ativo ? '' : ' · sem acesso'}</small>
        </div>
        ${SOU_ADMIN
          ? `<select class="equipe-papel" data-papel="${esc(p.id)}" data-antes="${papel}"
                title="O que esta pessoa pode fazer">
               <option value="atendente"${papel === 'admin' ? '' : ' selected'}>Atendente</option>
               <option value="admin"${papel === 'admin' ? ' selected' : ''}>Administrador</option>
             </select>`
          : `<span class="equipe-papel-txt">${esc(LABEL_PAPEL[papel])}</span>`}
        ${SOU_ADMIN && p.id !== r.meuId
          ? `<button type="button" class="btn btn-ghost sm" data-membro="${esc(p.id)}"
                data-ativar="${p.ativo ? '0' : '1'}">${p.ativo ? 'Tirar acesso' : 'Devolver acesso'}</button>`
          : ''}
      </div>`;
    }).join('')
      : '<div class="vazio">Só você por enquanto.</div>';

    /* Trocar a função de alguém. O servidor recusa rebaixar o último
       administrador — sem isso dá para se trancar para fora do próprio CRM. */
    $$('#listaEquipe [data-papel]').forEach(s => s.addEventListener('change', async () => {
      const antes = s.dataset.antes;
      s.disabled = true;
      try {
        await api('/api/equipe/papel', { method: 'POST',
          body: JSON.stringify({ id: s.dataset.papel, papel: s.value }) });
        toast(s.value === 'admin' ? '✅ Agora é administrador' : '✅ Agora é atendente');
        // mudar o próprio papel muda o que a tela mostra: recarrega tudo
        if (s.dataset.papel === r.meuId) { location.reload(); return; }
        await carregarEquipe();
      } catch (err) {
        toast('⚠️ ' + err.message);
        s.value = antes; s.disabled = false;      // volta para a função que era antes
      }
    }));

    // ligar/desligar o acesso de alguém
    $$('#listaEquipe [data-membro]').forEach(b => b.addEventListener('click', async () => {
      const ativar = b.dataset.ativar === '1';
      if (!ativar && !confirm('Tirar o acesso desta pessoa? Ela não conseguirá mais entrar '
        + 'no CRM, na agenda nem no atendimento.')) return;
      b.disabled = true;
      try {
        await api('/api/equipe/ativo', { method: 'POST',
          body: JSON.stringify({ id: b.dataset.membro, ativo: ativar }) });
        toast(ativar ? '✅ Acesso devolvido' : '🔒 Acesso removido');
        await carregarEquipe();
      } catch (err) { toast('⚠️ ' + err.message); b.disabled = false; }
    }));
  } catch (err) {
    el.innerHTML = `<div class="alert">Não consegui carregar a equipe: ${esc(err.message)}</div>`;
  }
}

/* Salvar o próprio nome. O servidor pega o id do token — o corpo só leva o nome. */
$('#formPerfil').addEventListener('submit', async e => {
  e.preventDefault();
  const nome = $('#perfilNome').value.trim();
  const msg = $('#perfilMsg'), btn = $('#btnSalvarPerfil');
  const mostrar = (texto, ok) => {
    msg.textContent = texto;
    msg.className = 'form-msg ' + (ok ? 'ok' : 'erro');
    msg.hidden = false;
  };
  if (!nome) return mostrar('Escreva o seu nome.', false);

  btn.disabled = true;
  try {
    await api('/api/perfil', { method: 'PATCH', body: JSON.stringify({ nome }) });
    if (PERFIL) PERFIL.nome = nome;
    mostrar('✅ Nome salvo.', true);
    toast('✅ Perfil salvo');
    await carregarEquipe();
  } catch (err) {
    mostrar('⚠️ Não consegui salvar: ' + err.message, false);
  } finally { btn.disabled = false; }
});

/* Trocar a própria senha — direto no Supabase Auth, sem passar pelo servidor.
   Regras: mínimo 8 caracteres e as duas iguais. */
$('#formSenha').addEventListener('submit', async e => {
  e.preventDefault();
  const s1 = $('#senhaNova').value, s2 = $('#senhaNova2').value;
  const msg = $('#senhaMsg'), btn = $('#btnTrocarSenha');
  const mostrar = (texto, ok) => {
    msg.textContent = texto;
    msg.className = 'form-msg ' + (ok ? 'ok' : 'erro');
    msg.hidden = false;
  };
  if (s1.length < 8) return mostrar('A senha precisa ter pelo menos 8 caracteres.', false);
  if (s1 !== s2)     return mostrar('As duas senhas não são iguais. Confira e tente de novo.', false);
  if (!sb)           return mostrar('Conexão com o Supabase não configurada.', false);

  btn.disabled = true; btn.textContent = 'Trocando…';
  try {
    const { error } = await sb.auth.updateUser({ password: s1 });
    if (error) throw error;
    $('#formSenha').reset();
    mostrar('✅ Senha trocada. Use a nova da próxima vez que entrar.', true);
    toast('✅ Senha alterada com sucesso');
  } catch (err) {
    mostrar('⚠️ Não consegui trocar: ' + (err.message || 'erro desconhecido'), false);
  } finally {
    btn.disabled = false; btn.textContent = 'Trocar senha';
  }
});

/* Cadastro feito pelo SERVIDOR: no plano free o Supabase limita o e-mail de
   confirmação, então signUp pela tela trava. E cadastro aberto num sistema com
   dado de cliente seria porta destrancada — entra quem o dono cadastrou. */
$('#formNovoMembro').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, btn = $('#btnNovoMembro');
  btn.disabled = true; btn.textContent = 'Cadastrando…';
  try {
    const r = await api('/api/equipe', { method: 'POST', body: JSON.stringify({
      nome:  f.nome.value.trim(),
      email: f.email.value.trim(),
      senha: f.senha.value,
      papel: f.papel.value,
    }) });
    toast(`✅ ${r.nome} cadastrado — entregue o e-mail e a senha para a pessoa`);
    if (r.aviso) toast('⚠️ ' + r.aviso);
    f.reset();
    await carregarEquipe();
  } catch (err) {
    toast('⚠️ ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Cadastrar';
  }
});

/* ============================================================
   LOGIN — nada do CRM aparece antes de entrar
   ============================================================ */
function mostrarLogin(mensagem) {
  document.body.classList.add('deslogado');
  $('#telaLogin').hidden = false;
  const erro = $('#erroLogin');
  // recado de login só se lê no formulário de login: traz ele de volta
  if (mensagem) { mostrarFormPrimeiro(false); erro.textContent = mensagem; erro.hidden = false; }
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

/* ============================================================
   PRIMEIRO ACESSO — a conta do dono, antes de existir alguém
   O botão só aparece enquanto o sistema não tem NINGUÉM cadastrado;
   quem criar a primeira conta vira administrador. Depois disso a
   rota do servidor responde 403 e a tela some.
   Não usa sb.auth.signUp: ele exige confirmação por e-mail e recusa
   endereço de domínio próprio ("Email address is invalid"). Quem cria
   é o servidor, com a chave de serviço, e a conta já entra valendo.
   ============================================================ */
function mostrarFormPrimeiro(mostrar) {
  $('#formLogin').hidden    = mostrar;
  $('#formPrimeiro').hidden = !mostrar;
}

async function verPrimeiroAcesso() {
  try {
    const j = await (await fetch('/api/primeiro-acesso')).json();
    $('#btnCriarConta').hidden = !j.aberto;
    if (j.aberto) mostrarFormPrimeiro(true);
  } catch { /* servidor fora do ar: a tela de login normal já avisa */ }
}

$('#btnCriarConta').addEventListener('click', () => mostrarFormPrimeiro(true));
$('#btnVoltarLogin').addEventListener('click', () => mostrarFormPrimeiro(false));

$('#formPrimeiro').addEventListener('submit', async e => {
  e.preventDefault();
  const erro = $('#pnErro'), btn = $('#btnPrimeiro');
  const falha = m => { erro.textContent = m; erro.hidden = false; };
  erro.hidden = true;

  const nome  = $('#pnNome').value.trim();
  const email = $('#pnEmail').value.trim().toLowerCase();
  const senha = $('#pnSenha').value;
  if (!nome)            return falha('Escreva o seu nome.');
  if (senha.length < 8) return falha('A senha precisa ter pelo menos 8 caracteres.');
  if (senha !== $('#pnSenha2').value) {
    return falha('As duas senhas não são iguais. Confira e digite de novo.');
  }

  btn.disabled = true; btn.textContent = 'CRIANDO…';
  try {
    // sem token ainda: esta é a única rota do CRM que roda sem login
    const r = await fetch('/api/primeiro-acesso', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, email, senha }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.erro || 'Não consegui criar a conta.');

    // já entra, sem obrigar a digitar tudo de novo
    if (!sb) throw new Error('Conexão com o Supabase não configurada.');
    const { error } = await sb.auth.signInWithPassword({ email, password: senha });
    if (error) {
      mostrarFormPrimeiro(false);
      toast('✅ Conta criada! Entre com o seu e-mail e a senha.');
      return;
    }
    $('#pnSenha').value = ''; $('#pnSenha2').value = '';
    esconderLogin();
    await carregar();
  } catch (err) {
    falha(err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'CRIAR MINHA CONTA';
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
  } else {
    // ninguém logado: pode ser a primeira vez que o sistema abre
    await verPrimeiroAcesso();
  }
})();
