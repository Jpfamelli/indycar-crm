/* ============================================================
   IndyCar CRM — IA na tela (módulo independente do app.js)

   Contrato com a tela:
   - escuta  window 'indycar:lead'  { leadId, clienteId }  (leadId null = fechou)
   - usa     window.IndyCar = { authCabecalhos, toast, recarregarLeads, abrirLead, papel }
   - desenha nos slots  #iaSlotLead (ficha do lead), #iaSlotPainel (dashboard)
                        e #iaSlotTela (aba IA), quando existirem.
   - reserva: sem slot nenhum, aparece o botão flutuante "✨ IA" com uma gaveta.
   Todo dado vindo do servidor passa por esc() antes de ir para o HTML.
   ============================================================ */
(function () {
  'use strict';

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const IC = () => window.IndyCar || {};
  const $ = (s, el = document) => el.querySelector(s);

  /* ---------------- comunicação ---------------- */
  async function cabecalhos() {
    if (typeof IC().authCabecalhos === 'function') return IC().authCabecalhos();
    // reserva: token salvo pelo supabase-js no navegador
    const cab = { 'Content-Type': 'application/json' };
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (/^sb-.*-auth-token$/.test(k)) { const t = JSON.parse(localStorage.getItem(k))?.access_token; if (t) cab.Authorization = 'Bearer ' + t; }
      }
    } catch { /* sem armazenamento */ }
    return cab;
  }
  async function api(url, opts = {}) {
    let r;
    try {
      r = await fetch(url, { signal: AbortSignal.timeout(opts.prazo || 90000), ...opts, headers: { ...(await cabecalhos()), ...(opts.headers || {}) } });
    } catch (e) {
      if (/sessão/i.test(e.message)) throw e;
      throw new Error(e.name === 'TimeoutError' ? 'A IA demorou demais. Tente de novo.' : 'Sem conexão com o servidor.');
    }
    let corpo = null;
    try { corpo = await r.json(); } catch { /* sem corpo */ }
    if (!r.ok) throw Object.assign(new Error((corpo && corpo.erro) || `Erro ${r.status}`), { status: r.status, corpo });
    return corpo;
  }
  const post = (url, corpo) => api(url, { method: 'POST', body: JSON.stringify(corpo || {}) });

  let toastEl;
  function toast(msg) {
    if (typeof IC().toast === 'function') return IC().toast(msg);
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'cia-toast'; toastEl.setAttribute('role', 'status'); toastEl.setAttribute('aria-live', 'polite'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.hidden = false;
    clearTimeout(toastEl._t); toastEl._t = setTimeout(() => { toastEl.hidden = true; }, 3500);
  }
  async function copiar(texto) {
    try { await navigator.clipboard.writeText(texto); return true; } catch { return false; }
  }
  function abrirLink(url) {
    if (!url) return;
    if (/^tel:/.test(url)) { location.href = url; return; }
    if (/^https:\/\//.test(url)) window.open(url, '_blank', 'noopener,noreferrer');
  }
  const quando = iso => {
    const t = Date.parse(iso || ''); if (!Number.isFinite(t)) return '';
    const min = Math.round((Date.now() - t) / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return `há ${min} min`;
    if (min < 1440) return `há ${Math.round(min / 60)} h`;
    return new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  };
  const brl = v => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  /* ---------------- vocabulário ---------------- */
  const ACAO = {
    ligar: { ico: '📞', nome: 'Ligar', botao: 'Ligar agora' },
    mensagem: { ico: '💬', nome: 'Mandar mensagem', botao: 'Copiar e abrir conversa' },
    agendar: { ico: '📅', nome: 'Agendar', botao: 'Abrir a Agenda' },
    cobrar_orcamento: { ico: '🧾', nome: 'Cobrar orçamento', botao: 'Copiar e abrir conversa' },
    marcar_perdido: { ico: '🏳️', nome: 'Marcar perdido', botao: 'Marcar como perdido' },
    mover_status: { ico: '➡️', nome: 'Mudar etapa', botao: 'Mudar etapa' },
    aguardar: { ico: '⏳', nome: 'Aguardar', botao: 'Ok, aguardar' },
  };
  const ETAPA = { novo: 'Novo', contato: 'Em contato', orcamento: 'Orçamento', agendado: 'Agendado', em_servico: 'Em serviço', concluido: 'Concluído', perdido: 'Perdido' };
  const TIPO = { crm_proxima_acao: 'Próxima ação', crm_qualificacao: 'Qualificação', crm_preencher: 'Preencher', crm_triagem: 'Triagem', crm_pergunta: 'Pergunta', crm_resumo: 'Resumo' };
  const STATUS = { proposta: 'Esperando você', executada: 'Feita', recusada: 'Recusada', erro: 'Erro', desfeita: 'Desfeita' };
  const CAMPO = { carro_modelo: 'Carro', carro_ano: 'Ano', placa: 'Placa', servico: 'Serviço', origem: 'Origem' };
  const ORIGEM = { meta: 'Instagram/Facebook', google: 'Google', indicacao: 'Indicação', organico: 'Orgânico', whatsapp: 'WhatsApp', passagem: 'Passagem', telefone: 'Telefone' };
  const valorCampo = (c, v) => c === 'origem' ? (ORIGEM[v] || v) : v;
  const REGRA = { parado: 'Parado', orcamento_sem_resposta: 'Orçamento sem resposta', servico_velho: 'Em serviço há muito tempo', agendado_velho: 'Agendado sem novidade' };
  const nomeAcao = a => a.acao === 'mover_status' ? `Mover para ${ETAPA[a.novo_status] || a.novo_status}` : (ACAO[a.acao]?.nome || a.acao);
  const fat = a => !!a?.plano?.faturamento;

  /* ---------------- estado ---------------- */
  const E = { leadId: null, clienteId: null, geracao: 0, uso: null, usoEm: 0 };
  async function uso(forcar) {
    if (!forcar && E.uso && Date.now() - E.usoEm < 60000) return E.uso;
    try { E.uso = await api('/api/ia/uso', { prazo: 15000 }); E.usoEm = Date.now(); } catch (e) { E.uso = E.uso || { erro: e.message, autonomia: 'confirmar' }; }
    return E.uso;
  }
  const sugerir = () => E.uso?.autonomia === 'sugerir';

  function carregando(btn, sim, txt) {
    if (!btn) return;
    if (sim) { btn.dataset.txt = btn.innerHTML; btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.innerHTML = `<span class="cia-spin" aria-hidden="true"></span>${esc(txt || 'Pensando…')}`; }
    else { btn.disabled = false; btn.removeAttribute('aria-busy'); if (btn.dataset.txt) btn.innerHTML = btn.dataset.txt; }
  }

  /* ---------------- executar / recusar / desfazer ---------------- */
  async function executar(id, btn, { proposta } = {}) {
    carregando(btn, true, 'Aplicando…');
    try {
      let r;
      try { r = await post(`/api/ia/acoes/${encodeURIComponent(id)}/executar`); }
      catch (e) {
        if (e.status !== 428) throw e;
        const ok = window.confirm('Isto mexe em faturamento (concluído/perdido). Confirmar?');
        if (!ok) { carregando(btn, false); return null; }
        r = await post(`/api/ia/acoes/${encodeURIComponent(id)}/executar`, { confirmarFaturamento: true });
      }
      if (r.texto) toast((await copiar(r.texto)) ? 'Texto copiado. Cole na conversa.' : 'Não consegui copiar; selecione o texto.');
      if (r.abrir) abrirLink(r.abrir);
      if (r.mudou) { toast('Feito pela IA. Dá para desfazer no histórico.'); try { await IC().recarregarLeads?.(); } catch { /* tela recarrega depois */ } }
      else if (!r.texto && !r.abrir) toast('Marcado como feito.');
      return r;
    } catch (e) { toast(e.message); carregando(btn, false); return null; }
  }
  async function recusar(id, btn) {
    carregando(btn, true, '…');
    try { await post(`/api/ia/acoes/${encodeURIComponent(id)}/recusar`); toast('Sugestão recusada.'); return true; }
    catch (e) { toast(e.message); carregando(btn, false); return false; }
  }
  async function desfazer(id, btn) {
    carregando(btn, true, 'Desfazendo…');
    try { await post(`/api/ia/acoes/${encodeURIComponent(id)}/desfazer`); toast('Desfeito.'); try { await IC().recarregarLeads?.(); } catch { /* ok */ } return true; }
    catch (e) { toast(e.message); carregando(btn, false); return false; }
  }

  /* ============================================================
     PAINEL DO LEAD
     ============================================================ */
  function htmlLeadBase() {
    return `<div class="cia cia-lead">
      <div class="cia-topo">
        <span class="cia-marca"><span aria-hidden="true">✨</span> IA do CRM</span>
        <span class="cia-temp" data-temp hidden></span>
        <span class="cia-modo" data-modo></span>
      </div>
      <div class="cia-sinais" data-sinais><span class="cia-esqueleto" aria-label="Carregando a ficha"></span></div>
      <div class="cia-botoes" role="group" aria-label="Pedir à IA">
        <button type="button" class="cia-btn cia-btn-forte" data-ia="proxima"><span aria-hidden="true">🎯</span> Próxima ação</button>
        <button type="button" class="cia-btn" data-ia="qualificar"><span aria-hidden="true">🌡️</span> Qualificar</button>
        <button type="button" class="cia-btn" data-ia="preencher"><span aria-hidden="true">🧩</span> Preencher pela conversa</button>
      </div>
      <div class="cia-saida" data-saida aria-live="polite"></div>
      <details class="cia-hist" data-hist><summary>Histórico da IA <span data-qtd></span></summary><ul class="cia-lista" data-lista></ul></details>
    </div>`;
  }

  function htmlSinais(ctx) {
    const s = ctx.sinais || {}, out = [];             // [texto, alerta?]
    const h = v => v == null ? '?' : v < 24 ? `${v} h` : `${Math.round(v / 24)} d`;
    if (ctx.mensagens?.length) out.push([`💬 ${ctx.mensagens.length} msgs${s.ultimaMensagemDe ? ` · última ${s.ultimaMensagemDe === 'cliente' ? 'do cliente' : 'nossa'} há ${h(s.horasDesdeUltimaMensagem)}` : ''}`]);
    else out.push(['💬 sem conversa no WhatsApp']);
    if (s.clienteEsperandoResposta) out.push(['⚠ cliente esperando resposta', true]);
    if (ctx.etapa) out.push([`📍 ${ctx.etapa.nome}`]);
    if (s.orcamentoPendenteDias != null) out.push([`🧾 orçamento esperando há ${s.orcamentoPendenteDias} d`, s.orcamentoPendenteDias >= 3]);
    if (s.temHorarioFuturo) out.push(['📅 tem horário marcado']);
    if (s.faltas) out.push([`🚫 ${s.faltas} falta${s.faltas > 1 ? 's' : ''}`]);
    if (ctx.c360 && Number(ctx.c360.total_gasto) > 0) out.push([`💰 já gastou ${brl(ctx.c360.total_gasto)}`]);
    if (s.respondeuComunicar) out.push(['✉️ respondeu o Comunicar']);
    if (s.insatisfeito) out.push(['😟 já reclamou', true]);
    if (s.aceitaMensagens === false) out.push(['🔕 não aceita mensagens', true]);
    const links = ctx.links || {};
    const lk = (u, t) => u && /^https:\/\//.test(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${t}</a>` : '';
    return out.map(([x, al]) => `<span${al ? ' class="cia-alerta"' : ''}>${esc(x)}</span>`).join('') +
      `<span class="cia-links">${lk(links.atendimento, 'Conversa ↗')}${lk(links.agenda, 'Agenda ↗')}${lk(links.comunicar, 'Comunicar ↗')}</span>`;
  }

  function htmlProposta(acao, { autonomia, avisos = [], automatico = false, compacto = false } = {}) {
    const p = acao.saida || acao, a = ACAO[p.acao] || { ico: '✨', botao: 'Executar' };
    const st = acao.status;
    const botoes = st === 'proposta' ? (autonomia === 'sugerir'
      ? `<span class="cia-dica">Modo só sugerir: faça pela ficha.</span>${p.texto_mensagem ? `<button type="button" class="cia-btn" data-copiar>Copiar texto</button>` : ''}`
      : `<button type="button" class="cia-btn cia-btn-forte" data-exec="${esc(acao.id)}">${esc(a.botao)}${fat(p) ? ' <span class="cia-fat" title="Mexe em faturamento">R$</span>' : ''}</button>
         <button type="button" class="cia-btn" data-recusar="${esc(acao.id)}">Recusar</button>`)
      : `<span class="cia-pilula s-${esc(st)}">${esc(automatico ? 'Feito pela IA' : STATUS[st] || st)}</span>${acao.desfazivel || (automatico && st === 'executada') ? `<button type="button" class="cia-btn" data-desfazer="${esc(acao.id)}">Desfazer</button>` : ''}`;
    return `<article class="cia-card${compacto ? ' cia-compacto' : ''}" data-card="${esc(acao.id)}">
      <header><span class="cia-ico" aria-hidden="true">${a.ico}</span><b>${esc(nomeAcao(p))}</b><span class="cia-prio p-${esc(p.prioridade)}">${esc(p.prioridade || '')}</span></header>
      <p class="cia-just">${esc(p.justificativa || '')}</p>
      ${p.motivo_perda ? `<p class="cia-just">Motivo: ${esc(p.motivo_perda)}</p>` : ''}
      ${p.texto_mensagem ? `<blockquote class="cia-texto" data-texto>${esc(p.texto_mensagem)}</blockquote>` : ''}
      ${avisos.map(x => `<p class="cia-aviso">${esc(x)}</p>`).join('')}
      <div class="cia-acoes">${botoes}</div>
    </article>`;
  }

  function htmlQualificacao(q) {
    const cor = { quente: 'q', morno: 'm', frio: 'f' }[q.temperatura] || 'm';
    return `<article class="cia-card">
      <header><span class="cia-ico" aria-hidden="true">🌡️</span><b>Qualificação</b><span class="cia-tempchip t-${cor}">${esc(q.temperatura)}</span></header>
      <div class="cia-prob"><meter min="0" max="100" low="35" high="65" optimum="100" value="${Number(q.probabilidade) || 0}" aria-label="Chance de fechar"></meter><b>${Number(q.probabilidade) || 0}%</b><span>de chance de fechar</span></div>
      <p class="cia-just">${esc(q.motivo)}</p>
      ${q.sinais?.length ? `<ul class="cia-tags">${q.sinais.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
    </article>`;
  }

  function htmlPreencher(r, autonomia) {
    if (!r.campos?.length) return `<article class="cia-card"><header><span class="cia-ico" aria-hidden="true">🧩</span><b>Nada novo na conversa</b></header>${(r.avisos || []).map(x => `<p class="cia-aviso">${esc(x)}</p>`).join('')}</article>`;
    const pend = r.automatico ? r.pendente : r.acao;
    const linhas = r.campos.map(c => `<tr><th scope="row">${esc(CAMPO[c.campo] || c.campo)}</th><td>${c.atual == null || c.atual === '' ? '<i>vazio</i>' : esc(valorCampo(c.campo, c.atual))}</td><td><b>${esc(valorCampo(c.campo, c.sugerido))}</b></td></tr>`).join('');
    const botoes = !pend ? '' : autonomia === 'sugerir' ? '<span class="cia-dica">Modo só sugerir: copie para a ficha.</span>'
      : `<button type="button" class="cia-btn cia-btn-forte" data-exec="${esc(pend.id)}">Aplicar na ficha</button><button type="button" class="cia-btn" data-recusar="${esc(pend.id)}">Recusar</button>`;
    return `<article class="cia-card">
      <header><span class="cia-ico" aria-hidden="true">🧩</span><b>${r.automatico ? 'A IA preencheu os campos vazios' : 'A conversa diz'}</b></header>
      <div class="cia-tabela"><table><thead><tr><th scope="col">Campo</th><th scope="col">Agora</th><th scope="col">Sugerido</th></tr></thead><tbody>${linhas}</tbody></table></div>
      ${(r.avisos || []).map(x => `<p class="cia-aviso">${esc(x)}</p>`).join('')}
      <div class="cia-acoes">${r.automatico ? `<button type="button" class="cia-btn" data-desfazer="${esc(r.acao.id)}">Desfazer o automático</button>` : ''}${botoes}</div>
    </article>`;
  }

  function htmlHistorico(acoes) {
    if (!acoes.length) return '<li class="cia-vazio">Nada ainda. Peça uma sugestão acima.</li>';
    return acoes.map(a => `<li data-card="${esc(a.id)}">
      <span class="cia-pilula s-${esc(a.status)}">${esc(STATUS[a.status] || a.status)}</span>
      <span class="cia-hist-txt"><b>${esc(TIPO[a.tipo] || a.tipo)}</b> ${esc(a.resumo || '')}<small>${esc(quando(a.created_at))}</small></span>
      <span class="cia-acoes">${a.status === 'proposta' && !sugerir() ? `<button type="button" class="cia-btn sm" data-exec="${esc(a.id)}">Executar</button><button type="button" class="cia-btn sm" data-recusar="${esc(a.id)}">Recusar</button>` : ''}${a.desfazivel ? `<button type="button" class="cia-btn sm" data-desfazer="${esc(a.id)}">Desfazer</button>` : ''}</span>
    </li>`).join('');
  }

  async function carregarHistorico(raiz, leadId, ger) {
    try {
      const r = await api(`/api/ia/acoes?leadId=${encodeURIComponent(leadId)}&limite=20`, { prazo: 20000 });
      if (ger !== E.geracao) return;
      $('[data-lista]', raiz).innerHTML = htmlHistorico(r.acoes || []);
      $('[data-qtd]', raiz).textContent = r.acoes?.length ? `(${r.acoes.length})` : '';
      const q = (r.acoes || []).find(a => a.tipo === 'crm_qualificacao' && a.status === 'executada');
      mostrarTemp(raiz, q?.saida);
    } catch { /* histórico é extra */ }
  }
  function mostrarTemp(raiz, q) {
    const el = $('[data-temp]', raiz);
    if (!q || !q.temperatura) { el.hidden = true; return; }
    const cor = { quente: 'q', morno: 'm', frio: 'f' }[q.temperatura] || 'm';
    el.className = `cia-temp cia-tempchip t-${cor}`; el.hidden = false;
    el.textContent = `${q.temperatura} · ${Number(q.probabilidade) || 0}%`;
  }

  async function renderLead(raiz, leadId) {
    const ger = ++E.geracao;
    raiz.innerHTML = htmlLeadBase();
    const u = await uso();
    if (ger !== E.geracao) return;
    $('[data-modo]', raiz).textContent = u.ativo === false ? 'desligada' : ({ sugerir: 'só sugere', confirmar: 'você confirma', automatico: 'automática' }[u.autonomia] || '');
    if (u.ativo === false || u.configurada === false) {
      $('[data-saida]', raiz).innerHTML = `<p class="cia-aviso">${u.ativo === false ? 'A IA está desligada nas configurações.' : 'IA sem chave configurada no servidor.'}</p>`;
      raiz.querySelectorAll('[data-ia]').forEach(b => { b.disabled = true; });
    }
    try {
      const ctx = await api(`/api/ia/lead/${encodeURIComponent(leadId)}/contexto`, { prazo: 20000 });
      if (ger !== E.geracao) return;
      $('[data-sinais]', raiz).innerHTML = htmlSinais(ctx);
      if (!ctx.mensagens?.length) { const b = $('[data-ia="preencher"]', raiz); b.disabled = true; b.title = 'Sem conversa no WhatsApp para ler'; }
    } catch (e) { if (ger === E.geracao) $('[data-sinais]', raiz).innerHTML = `<span class="cia-aviso">${esc(e.message)}</span>`; }
    carregarHistorico(raiz, leadId, ger);
  }

  /* clique no painel do lead (delegação; o painel é redesenhado a cada lead) */
  async function cliqueLead(ev, raiz) {
    const b = ev.target.closest('button'); if (!b || !raiz.contains(b)) return;
    const leadId = E.leadId, ger = E.geracao, saida = $('[data-saida]', raiz);
    if (b.dataset.ia) {
      const rota = { proxima: 'proxima-acao', qualificar: 'qualificar', preencher: 'preencher' }[b.dataset.ia];
      carregando(b, true, b.dataset.ia === 'preencher' ? 'Lendo a conversa…' : 'Pensando…');
      try {
        const r = await post(`/api/ia/lead/${encodeURIComponent(leadId)}/${rota}`);
        if (ger !== E.geracao) return;
        if (b.dataset.ia === 'proxima') saida.innerHTML = htmlProposta({ ...r.acao, saida: r.proposta, desfazivel: r.automatico }, { autonomia: r.autonomia, avisos: r.avisos, automatico: r.automatico });
        if (b.dataset.ia === 'qualificar') { saida.innerHTML = htmlQualificacao(r.qualificacao); mostrarTemp(raiz, r.qualificacao); }
        if (b.dataset.ia === 'preencher') saida.innerHTML = htmlPreencher(r, r.autonomia);
        if (r.automatico) { try { await IC().recarregarLeads?.(); } catch { /* ok */ } }
        carregarHistorico(raiz, leadId, ger);
      } catch (e) { if (ger === E.geracao) saida.innerHTML = `<p class="cia-aviso" role="alert">${esc(e.message)}</p>`; }
      finally { carregando(b, false); }
      return;
    }
    if (b.hasAttribute('data-copiar')) { const t = b.closest('.cia-card')?.querySelector('[data-texto]')?.textContent || ''; toast((await copiar(t)) ? 'Texto copiado.' : 'Não consegui copiar.'); return; }
    let feito = null;
    if (b.dataset.exec) feito = await executar(b.dataset.exec, b);
    else if (b.dataset.recusar) feito = await recusar(b.dataset.recusar, b);
    else if (b.dataset.desfazer) feito = await desfazer(b.dataset.desfazer, b);
    if (feito && ger === E.geracao) {
      const card = saida.querySelector(`[data-card="${CSS.escape(b.dataset.exec || b.dataset.recusar || b.dataset.desfazer)}"]`);
      if (card) card.querySelector('.cia-acoes').innerHTML = `<span class="cia-pilula s-${b.dataset.exec ? 'executada' : b.dataset.recusar ? 'recusada' : 'desfeita'}">${b.dataset.exec ? 'Feita' : b.dataset.recusar ? 'Recusada' : 'Desfeita'}</span>`;
      carregarHistorico(raiz, leadId, ger);
    }
  }

  /* ============================================================
     PERGUNTE AO CRM  +  TRIAGEM  (dashboard, aba IA e gaveta)
     ============================================================ */
  const EXEMPLOS = ['Quantos leads do Google fecharam este mês?', 'Quem está esperando orçamento há mais de 3 dias?', 'Qual canal trouxe mais clientes que fecharam?'];

  function htmlPergunte() {
    return `<section class="cia cia-bloco" aria-label="Pergunte ao CRM">
      <h3 class="cia-titulo"><span aria-hidden="true">💬</span> Pergunte ao CRM</h3>
      <form class="cia-form" data-perg>
        <input type="text" name="pergunta" maxlength="300" minlength="3" required autocomplete="off" placeholder="Ex.: quem está esperando orçamento há mais de 3 dias?" aria-label="Pergunta para a IA do CRM" />
        <button type="submit" class="cia-btn cia-btn-forte">Perguntar</button>
      </form>
      <div class="cia-exemplos">${EXEMPLOS.map(x => `<button type="button" class="cia-chip" data-ex="${esc(x)}">${esc(x)}</button>`).join('')}</div>
      <ol class="cia-respostas" data-respostas aria-live="polite"></ol>
    </section>`;
  }
  function htmlResposta(r) {
    return `<li class="cia-resp">
      <p class="cia-perg">${esc(r.pergunta)}</p>
      <p class="cia-txt${r.semDados ? ' cia-semdados' : ''}">${esc(r.resposta).replace(/\n/g, '<br>')}</p>
      ${r.leads?.length ? `<div class="cia-leads">${r.leads.map(l => `<button type="button" class="cia-chip" data-lead="${esc(l.id)}">${esc(l.nome)} <small>${esc(ETAPA[l.status] || l.status)}</small></button>`).join('')}</div>` : ''}
    </li>`;
  }

  function htmlTriagem() {
    return `<section class="cia cia-bloco" aria-label="Triagem de hoje">
      <div class="cia-titulo-linha"><h3 class="cia-titulo"><span aria-hidden="true">🧹</span> Triagem de hoje</h3>
        <label class="cia-dias">parado há <select data-dias aria-label="Dias parado"><option value="3">3+ dias</option><option value="7">7+ dias</option><option value="15">15+ dias</option></select></label>
        <button type="button" class="cia-btn cia-btn-forte" data-rodar>Rodar triagem</button></div>
      <p class="cia-dica" data-tri-info>A IA olha os leads parados e sugere o que fazer com cada um. Nada muda sem o seu clique.</p>
      <div class="cia-lote" data-lote hidden><label><input type="checkbox" data-todos /> Todas</label><button type="button" class="cia-btn" data-exec-lote>Executar selecionadas (<span data-nsel>0</span>)</button></div>
      <ul class="cia-lista cia-tri" data-tri></ul>
    </section>`;
  }
  function htmlItemTriagem(it) {
    const p = it.saida || {}, l = p.lead || it.lead || {}, prop = it.status === 'proposta';
    return `<li class="cia-tri-item" data-card="${esc(it.id)}">
      ${prop && !sugerir() ? `<input type="checkbox" class="cia-sel" data-sel="${esc(it.id)}" aria-label="Selecionar ${esc(l.nome || 'lead')}" />` : '<span></span>'}
      <div class="cia-tri-corpo">
        <div class="cia-tri-top"><button type="button" class="cia-link" data-lead="${esc(it.lead_id || l.id || '')}">${esc(l.nome || 'Lead')}</button>
          <span class="cia-tag">${esc(REGRA[p.regra] || p.regra || '')}${p.dias != null ? ` · ${esc(p.dias)} d` : ''}</span>
          <span class="cia-prio p-${esc(p.prioridade)}">${esc(p.prioridade || '')}</span></div>
        <p><span aria-hidden="true">${(ACAO[p.acao] || {}).ico || '✨'}</span> <b>${esc(nomeAcao(p))}</b>${fat(p) ? ' <span class="cia-fat" title="Mexe em faturamento">R$</span>' : ''} — ${esc(p.justificativa || '')}</p>
        ${p.texto_mensagem ? `<details><summary>Texto pronto</summary><blockquote class="cia-texto" data-texto>${esc(p.texto_mensagem)}</blockquote></details>` : ''}
      </div>
      <div class="cia-acoes">${prop ? (sugerir() ? '' : `<button type="button" class="cia-btn sm cia-btn-forte" data-exec="${esc(it.id)}">${esc((ACAO[p.acao] || {}).botao || 'Executar')}</button><button type="button" class="cia-btn sm" data-recusar="${esc(it.id)}">Recusar</button>`) : `<span class="cia-pilula s-${esc(it.status)}">${esc(STATUS[it.status] || it.status)}</span>`}</div>
    </li>`;
  }

  function montarBloco(raiz) {
    raiz.innerHTML = htmlPergunte() + htmlTriagem();
    raiz.classList.add('cia-painel');
    const lista = $('[data-tri]', raiz), info = $('[data-tri-info]', raiz), lote = $('[data-lote]', raiz);
    const atualizarLote = () => {
      const n = raiz.querySelectorAll('[data-sel]:checked').length;
      $('[data-nsel]', raiz).textContent = n;
      $('[data-exec-lote]', raiz).disabled = !n;
      lote.hidden = !raiz.querySelector('[data-sel]');
    };
    const pintar = itens => {
      lista.innerHTML = itens.length ? itens.map(htmlItemTriagem).join('') : '<li class="cia-vazio">Nenhum lead parado. 🎉</li>';
      atualizarLote();
    };

    // propostas de triagem que ainda esperam clique (sem gastar IA)
    (async () => {
      await uso();
      try {
        const r = await api('/api/ia/acoes?limite=60', { prazo: 20000 });
        const pend = (r.acoes || []).filter(a => a.tipo === 'crm_triagem' && a.status === 'proposta');
        if (pend.length) { pintar(pend); info.textContent = `${pend.length} sugest${pend.length > 1 ? 'ões esperam' : 'ão espera'} você.`; }
      } catch { /* sem histórico: só o botão */ }
    })();

    $('[data-perg]', raiz).addEventListener('submit', async ev => {
      ev.preventDefault();
      const inp = ev.target.pergunta, btn = ev.target.querySelector('button'), q = inp.value.trim();
      if (q.length < 3) { inp.focus(); return; }
      carregando(btn, true, 'Pensando…');
      try {
        const r = await post('/api/ia/perguntar', { pergunta: q });
        $('[data-respostas]', raiz).insertAdjacentHTML('afterbegin', htmlResposta(r));
        const todas = raiz.querySelectorAll('.cia-resp'); for (let i = 5; i < todas.length; i++) todas[i].remove();
        inp.value = '';
      } catch (e) { toast(e.message); }
      finally { carregando(btn, false); }
    });

    raiz.addEventListener('change', ev => {
      if (ev.target.matches('[data-todos]')) raiz.querySelectorAll('[data-sel]').forEach(c => { c.checked = ev.target.checked; });
      if (ev.target.matches('[data-sel],[data-todos]')) atualizarLote();
    });

    raiz.addEventListener('click', async ev => {
      const b = ev.target.closest('button'); if (!b || !raiz.contains(b)) return;
      if (b.dataset.ex) { const inp = $('[data-perg] input', raiz); inp.value = b.dataset.ex; $('[data-perg]', raiz).requestSubmit(); return; }
      if (b.dataset.lead) { if (typeof IC().abrirLead === 'function') { fecharGaveta(); IC().abrirLead(b.dataset.lead); } return; }
      if (b.hasAttribute('data-rodar')) {
        carregando(b, true, 'Olhando os leads…');
        try {
          const r = await post('/api/ia/triagem', { dias: Number($('[data-dias]', raiz).value) || 3 });
          pintar(r.itens || []);
          info.textContent = r.novos ? `${r.novos} nova${r.novos > 1 ? 's' : ''} sugest${r.novos > 1 ? 'ões' : 'ão'}${r.porIA ? '' : ' pelas regras (IA indisponível agora)'} · ${r.total} lead${r.total === 1 ? '' : 's'} parado${r.total === 1 ? '' : 's'} no total.`
            : (r.itens?.length ? 'Estas sugestões ainda esperam você.' : 'Nenhum lead parado. 🎉');
        } catch (e) { toast(e.message); }
        finally { carregando(b, false); }
        return;
      }
      if (b.hasAttribute('data-exec-lote')) {
        const ids = [...raiz.querySelectorAll('[data-sel]:checked')].map(c => c.dataset.sel);
        if (!ids.length) return;
        const temFat = ids.some(id => raiz.querySelector(`[data-card="${CSS.escape(id)}"] .cia-fat`));
        const conf = temFat ? window.confirm('Algumas mexem em faturamento (concluído/perdido). Executar também essas?') : false;
        carregando(b, true, 'Executando…');
        try {
          const r = await post('/api/ia/acoes/executar-lote', { ids, confirmarFaturamento: conf });
          for (const x of r.resultados || []) {
            const li = raiz.querySelector(`[data-card="${CSS.escape(x.id)}"]`); if (!li) continue;
            li.querySelector('.cia-acoes').innerHTML = x.ok ? '<span class="cia-pilula s-executada">Feita</span>' : `<span class="cia-pilula s-erro" title="${esc(x.erro)}">${x.precisaConfirmar ? 'Precisa confirmar' : 'Não deu'}</span>`;
            if (x.ok) li.querySelector('[data-sel]')?.remove();
          }
          toast(`${r.ok} feita${r.ok === 1 ? '' : 's'}${r.falhas ? `, ${r.falhas} não` : ''}. Mensagens: abra cada conversa pelo item.`);
          try { await IC().recarregarLeads?.(); } catch { /* ok */ }
        } catch (e) { toast(e.message); }
        finally { carregando(b, false); atualizarLote(); }
        return;
      }
      let feito = null, id = b.dataset.exec || b.dataset.recusar;
      if (b.dataset.exec) feito = await executar(b.dataset.exec, b);
      else if (b.dataset.recusar) feito = await recusar(b.dataset.recusar, b);
      if (feito && id) {
        const li = raiz.querySelector(`[data-card="${CSS.escape(id)}"]`);
        if (li) { li.querySelector('.cia-acoes').innerHTML = `<span class="cia-pilula s-${b.dataset.exec ? 'executada' : 'recusada'}">${b.dataset.exec ? 'Feita' : 'Recusada'}</span>`; li.querySelector('[data-sel]')?.remove(); atualizarLote(); }
      }
    });
  }

  /* aba IA: uso do dia em cima */
  async function montarTela(raiz) {
    const u = await uso(true);
    const pct = u.limite ? Math.min(100, Math.round((u.hoje / u.limite) * 100)) : 0;
    const topo = document.createElement('div');
    topo.className = 'cia cia-uso';
    topo.innerHTML = u.erro ? `<p class="cia-aviso">${esc(u.erro)}</p>` : `
      <div><span class="cia-marca"><span aria-hidden="true">✨</span> IA do CRM</span>
        <span class="cia-pilula ${u.ativo ? 's-executada' : 's-erro'}">${u.ativo ? (u.configurada ? 'ligada' : 'sem chave') : 'desligada'}</span>
        <span class="cia-modo">${esc({ sugerir: 'só sugere', confirmar: 'você confirma', automatico: 'automática' }[u.autonomia] || u.autonomia)}</span></div>
      <div class="cia-uso-barra"><meter min="0" max="${Number(u.limite) || 1}" high="${Math.round((Number(u.limite) || 1) * 0.8)}" value="${Number(u.hoje) || 0}" aria-label="Uso da IA hoje"></meter>
        <span>${Number(u.hoje) || 0} de ${Number(u.limite) || 0} chamadas hoje (${pct}%) · CRM: ${Number(u.doCrmHoje) || 0}</span></div>`;
    const blocos = document.createElement('div');
    raiz.replaceChildren(topo, blocos);
    montarBloco(blocos);
  }

  /* ============================================================
     RESERVA: botão flutuante + gaveta (quando não há slot)
     ============================================================ */
  let fab = null, gaveta = null, focoAntes = null;
  function criarReserva() {
    if (fab) return;
    fab = document.createElement('button');
    fab.type = 'button'; fab.className = 'cia-fab'; fab.setAttribute('aria-haspopup', 'dialog');
    fab.innerHTML = '<span aria-hidden="true">✨</span> IA';
    fab.setAttribute('aria-label', 'Abrir a IA do CRM');
    gaveta = document.createElement('div');
    gaveta.className = 'cia-gaveta-bg'; gaveta.hidden = true;
    gaveta.innerHTML = `<div class="cia-gaveta" role="dialog" aria-modal="true" aria-labelledby="ciaGavTit" tabindex="-1">
      <div class="cia-gav-topo"><h2 id="ciaGavTit"><span aria-hidden="true">✨</span> IA do CRM</h2><button type="button" class="cia-x" data-fechar aria-label="Fechar a IA">×</button></div>
      <div data-gav-lead></div><div data-gav-painel></div></div>`;
    document.body.append(fab, gaveta);
    fab.addEventListener('click', abrirGaveta);
    gaveta.addEventListener('click', ev => { if (ev.target === gaveta || ev.target.closest('[data-fechar]')) fecharGaveta(); });
    gaveta.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') { ev.stopPropagation(); fecharGaveta(); }
      if (ev.key === 'Tab') {                 // foco preso na gaveta
        const f = [...gaveta.querySelectorAll('button:not([disabled]),input:not([disabled]),select,a[href],summary,[tabindex]:not([tabindex="-1"])')].filter(x => x.offsetParent !== null);
        if (!f.length) return;
        if (ev.shiftKey && document.activeElement === f[0]) { ev.preventDefault(); f.at(-1).focus(); }
        else if (!ev.shiftKey && document.activeElement === f.at(-1)) { ev.preventDefault(); f[0].focus(); }
      }
    });
    const lead = $('[data-gav-lead]', gaveta);
    lead.addEventListener('click', ev => cliqueLead(ev, lead));
    montarBloco($('[data-gav-painel]', gaveta));
  }
  function abrirGaveta() {
    focoAntes = document.activeElement;
    gaveta.hidden = false;
    const lead = $('[data-gav-lead]', gaveta);
    if (E.leadId && !$('#iaSlotLead')) renderLead(lead, E.leadId); else lead.replaceChildren();
    $('.cia-gaveta', gaveta).focus();
  }
  function fecharGaveta() {
    if (!gaveta || gaveta.hidden) return;
    gaveta.hidden = true;
    if (focoAntes && document.contains(focoAntes)) focoAntes.focus();
  }

  /* ============================================================
     LIGAÇÃO COM A TELA
     ============================================================ */
  const montados = new WeakSet();
  function montarSlots() {
    const painel = $('#iaSlotPainel'), tela = $('#iaSlotTela'), lead = $('#iaSlotLead');
    if (painel && !montados.has(painel)) { montados.add(painel); montarBloco(painel); }
    if (tela && !montados.has(tela)) { montados.add(tela); montarTela(tela); }
    if (lead && !montados.has(lead)) { montados.add(lead); lead.addEventListener('click', ev => cliqueLead(ev, lead)); }
    if (!painel && !tela && !lead) criarReserva();
    else if (fab) { fab.remove(); gaveta.remove(); fab = gaveta = null; }
  }

  window.addEventListener('indycar:lead', ev => {
    const d = ev.detail || {};
    E.leadId = d.leadId || null; E.clienteId = d.clienteId || null;
    const slot = $('#iaSlotLead');
    if (slot) {
      if (!montados.has(slot)) montarSlots();
      if (E.leadId) renderLead(slot, E.leadId); else { E.geracao++; slot.replaceChildren(); }
    } else if (gaveta && !gaveta.hidden && E.leadId) renderLead($('[data-gav-lead]', gaveta), E.leadId);
  });

  function iniciar() {
    // só depois do login: com a tela do CRM, espera o papel (perfil carregado);
    // sem a tela (window.IndyCar ausente), monta assim que a página carrega
    const temTela = !!window.IndyCar;
    if (temTela ? !!IC().papel : document.readyState !== 'loading') montarSlots();
    else setTimeout(iniciar, 400);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();

  // para testes e para a tela, se quiser chamar
  window.IndyCarIA = Object.freeze({ versao: 1, renderLead: id => { const s = $('#iaSlotLead'); if (s) { E.leadId = id; renderLead(s, id); } }, abrirGaveta: () => { criarReserva(); abrirGaveta(); } });
})();
