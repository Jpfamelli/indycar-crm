// Rodada 3 (13/10/2026): login, acesso por app, perfil, duas etapas, sessão e sino.
// Carrega depois de app.js e melhorias.js e usa o escopo global deles ($, api, sb, PERFIL…).
'use strict';
const LS_EMAIL = 'indycar_crm_email', LS_FALHAS = 'indycar_crm_login_falhas', LS_ACESSO = 'indycar_crm_ultimo_acesso', LS_ESQUECI = 'indycar_crm_esqueci';
const VEIO_DE_RECUPERACAO = /type=recovery/.test(location.hash);
const TELAS_ACESSO = ['formLogin', 'formPrimeiro', 'formEsqueci', 'formNovaSenha', 'formMfa', 'caixaSemAcesso'];
const TITULO_BASE = document.title;
let SESSAO_ATIVA = false, MODO_SENHA = null, TRATANDO_ACESSO = 0;

/* ---------------- telas da capa de login ---------------- */
function telaAcesso(id, focar = true) {
  for (const t of TELAS_ACESSO) { const el = $('#' + t); if (el) el.hidden = t !== id; }
  if (focar) setTimeout(() => $('#' + id)?.querySelector('input:not([type=checkbox]):not([disabled]),.btn-entrar')?.focus(), 30);
}
function mostrarLogin(mensagem, {tipo = 'erro', tela = 'formLogin'} = {}) {
  encerrarSessaoTela();
  document.body.classList.add('deslogado');
  $('#telaLogin').hidden = false;
  telaAcesso(tela, !!mensagem || tela !== 'formLogin');
  const erro = $('#erroLogin'), ok = $('#okLogin');
  erro.hidden = true; ok.hidden = true;
  if (mensagem) { const el = tipo === 'ok' ? ok : erro; el.textContent = mensagem; el.hidden = false; }
}
function esconderLogin() {
  document.body.classList.remove('deslogado');
  $('#telaLogin').hidden = true;
  $('#erroLogin').hidden = true; $('#okLogin').hidden = true;
}
/* Fecha tudo que mostra dado de cliente e para o realtime/temporizadores. */
function encerrarSessaoTela() {
  if (!SESSAO_ATIVA && !CANAIS.length) return;
  SESSAO_ATIVA = false;
  for (const c of CANAIS.splice(0)) { try { sb?.removeChannel(c); } catch { /* ignora */ } }
  clearInterval(TIMER_SINO); TIMER_SINO = null;
  try { if (modal.classList.contains('open')) fecharModal(true); if (modalCli.classList.contains('open')) fecharFichaCliente(); } catch { /* ignora */ }
  $$('dialog[open]').forEach(d => d.close());
  fecharPops();
  NOTIFS = []; renderSino(); document.title = TITULO_BASE;
  PERFIL = null; STATS = null;
}
/* Ação vinda de um 401/403 do servidor (por código) ou do portão da tela. */
async function tratarAcesso(acao) {
  if (Date.now() - TRATANDO_ACESSO < 1500 && acao === 'login') return;   // vários pedidos falhando juntos: um aviso só
  TRATANDO_ACESSO = Date.now();
  if (acao === 'login') { if (document.body.classList.contains('deslogado') && !$('#formLogin').hidden) return; try { await sb?.auth.signOut({scope: 'local'}); } catch { /* ignora */ } mostrarLogin('Sua sessão expirou. Entre de novo.'); }
  else if (acao === 'desativado') { try { await sb?.auth.signOut({scope: 'local'}); } catch { /* ignora */ } mostrarLogin('Seu acesso foi desativado. Fale com o gestor da loja.'); }
  else if (acao === 'sem_acesso') mostrarSemAcesso(PERFIL, 'sem_app');
  else if (acao === 'trocar_senha') mostrarNovaSenha('obrigatoria');
  else if (acao === 'mfa') mostrarMfa();
}

/* ---------------- perfil e portão de acesso ---------------- */
const COLUNAS_PERFIL = 'id,nome,email,papel,ativo,apps,cargo,telefone,avatar_cor,precisa_trocar_senha,preferencias,ultimo_acesso_em';
async function carregarPerfil() {
  let direto = null, usuario = null;
  try {
    usuario = (await sb.auth.getUser())?.data?.user || null;
    if (usuario?.id) { const {data, error} = await sb.from('perfis').select(COLUNAS_PERFIL).eq('id', usuario.id).maybeSingle(); if (!error && data) direto = data; }
  } catch { /* cai na rota do servidor */ }
  // sem leitura direta (RLS/rede): a rota do servidor confere o mesmo e devolve 401/403 com código
  const p = direto || await api('/api/perfil');
  if (!p || !p.id) throw erroApi('Não consegui carregar o seu perfil.', 0, 'rede');
  p.email = p.email || usuario?.email || '';
  p.avatar_cor = p.avatar_cor || p.preferencias?.avatar_cor || null;
  return p;
}
async function portaoDeAcesso(p) {
  if (!p) return true;                          // sem perfil (rede): o servidor decide em cada rota
  const a = CrmUtils.acessoApp(p, 'crm');
  if (a.motivo === 'desativado') { await tratarAcesso('desativado'); return false; }
  if (!a.ok) { mostrarSemAcesso(p, a.motivo); return false; }
  if (p.precisa_trocar_senha) { mostrarNovaSenha('obrigatoria'); return false; }
  return true;
}
function mostrarSemAcesso(p, motivo) {
  mostrarLogin(null, {tela: 'caixaSemAcesso'});
  const apps = CrmUtils.appsPermitidos(p, 'crm');
  $('#saTexto').textContent = motivo === 'papel_agenda' ? 'Seu login é só para marcar presença na Agenda.'
    : apps.length ? 'Seu login não inclui o CRM. Use um destes apps ou peça ao administrador para liberar.' : 'Nenhum app foi liberado para o seu login ainda. Fale com o administrador.';
  $('#saApps').innerHTML = apps.map(a => `<li><a class="acao" href="${esc(a.url)}">${esc(a.nome)} <span aria-hidden="true">→</span></a></li>`).join('');
  setTimeout(() => ($('#saApps a') || $('#caixaSemAcesso [data-sair-login]'))?.focus(), 30);
}

/* ---------------- formulário de entrar ---------------- */
function lerFalhas() { const f = lerLS(LS_FALHAS, {n: 0, ate: 0}); return {n: Number(f.n) || 0, ate: Number(f.ate) || 0}; }
let TIMER_ESPERA = null;
function travarEspera() {
  const btn = $('#btnEntrar'), f = lerFalhas(); clearInterval(TIMER_ESPERA);
  const passo = () => {
    const falta = Math.ceil((f.ate - Date.now()) / 1000);
    if (falta <= 0) { clearInterval(TIMER_ESPERA); btn.disabled = false; btn.textContent = 'ENTRAR'; return; }
    btn.disabled = true; btn.textContent = `AGUARDE ${falta} s`;
  };
  passo(); if (f.ate > Date.now()) TIMER_ESPERA = setInterval(passo, 1000);
}
function registrarFalha() {
  const f = lerFalhas(); f.n++; const s = CrmUtils.esperaLogin(f.n); f.ate = s ? Date.now() + s * 1000 : 0;
  gravarLS(LS_FALHAS, f); return s;
}
(function prepararLogin() {
  const email = lerLS(LS_EMAIL, '');
  if (email) { $('#loginEmail').value = email; $('#lembrarEmail').checked = true; }
  if (lerFalhas().ate > Date.now()) travarEspera();
})();
// mostrar/esconder senha (todos os campos de senha das telas)
document.addEventListener('click', e => {
  const b = e.target.closest('.ver-senha'); if (!b) return;
  const i = b.parentElement.querySelector('input'); const ver = i.type === 'password';
  i.type = ver ? 'text' : 'password'; b.setAttribute('aria-pressed', String(ver)); b.setAttribute('aria-label', ver ? 'Esconder senha' : 'Mostrar senha'); b.textContent = ver ? '🙈' : '👁'; i.focus();
});
// aviso de Caps Lock nos campos de senha
for (const [campo, aviso] of [['#loginSenha', '#capsLogin'], ['#nsSenha', '#capsNs'], ['#nsSenha2', '#capsNs']]) {
  const el = $(campo);
  const ver = e => { if (e.getModifierState) $(aviso).hidden = !e.getModifierState('CapsLock'); };
  el.addEventListener('keydown', ver); el.addEventListener('keyup', ver); el.addEventListener('blur', () => { $(aviso).hidden = true; });
}
$('#formLogin').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#btnEntrar'), email = $('#loginEmail').value.trim().toLowerCase(), senha = $('#loginSenha').value;
  if (lerFalhas().ate > Date.now()) return travarEspera();
  if (!email || !senha) return mostrarLogin('Digite o e-mail e a senha.');
  if (navigator.onLine === false) return mostrarLogin('Sem internet. Confira a conexão e tente de novo.');
  if ($('#lembrarEmail').checked) gravarLS(LS_EMAIL, email); else { try { localStorage.removeItem(LS_EMAIL); } catch { /* ignora */ } }
  btn.disabled = true; btn.textContent = 'ENTRANDO…';
  let travou = false;
  try {
    if (!sb) throw new Error('Conexão com o Supabase não configurada.');
    const {error} = await sb.auth.signInWithPassword({email, password: senha});
    if (error) {
      const msg = CrmUtils.mensagemLogin(error);
      if (msg === 'E-mail ou senha incorretos.') { const s = registrarFalha(); if (s) { travou = true; mostrarLogin(`${msg} Muitas tentativas seguidas: espere ${s >= 60 ? Math.round(s / 60) + ' min' : s + ' s'} para tentar de novo.`); travarEspera(); return; } }
      throw new Error(msg);
    }
    gravarLS(LS_FALHAS, {n: 0, ate: 0});
    $('#loginSenha').value = '';
    await entrarDepoisDoLogin();
  } catch (err) {
    mostrarLogin(err.message === 'Failed to fetch' ? CrmUtils.mensagemLogin(err) : err.message);
  } finally {
    if (!travou) { btn.disabled = false; btn.textContent = 'ENTRAR'; }
  }
});
/* Depois da senha: confere a segunda etapa (TOTP) e só então abre o CRM. */
async function entrarDepoisDoLogin() {
  if (!(await segundaEtapaOk())) return;
  esconderLogin();
  await carregar();
}
async function segundaEtapaOk() {
  try {
    const {data, error} = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (!error && data && data.nextLevel === 'aal2' && data.currentLevel !== 'aal2') { mostrarMfa(); return false; }
  } catch { /* sem suporte a MFA: segue só com a senha */ }
  return true;
}
document.addEventListener('click', async e => {
  if (e.target.closest('[data-voltar-login]')) { telaAcesso('formLogin'); return; }
  if (e.target.closest('[data-sair-login]')) { try { await sb?.auth.signOut({scope: 'local'}); } catch { /* ignora */ } MODO_SENHA = null; mostrarLogin(); }
});

/* ---------------- esqueci a senha ---------------- */
$('#btnEsqueci').addEventListener('click', () => { $('#esqEmail').value = $('#loginEmail').value.trim(); $('#esqErro').hidden = true; $('#esqOk').hidden = true; telaAcesso('formEsqueci'); });
$('#formEsqueci').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('#esqEmail').value.trim().toLowerCase(), erro = $('#esqErro'), ok = $('#esqOk'), btn = $('#btnEsqEnviar');
  erro.hidden = true; ok.hidden = true;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { erro.textContent = 'Digite um e-mail válido.'; erro.hidden = false; $('#esqEmail').focus(); return; }
  const ultimo = Number(lerLS(LS_ESQUECI, 0)) || 0;
  if (Date.now() - ultimo < 60000) { erro.textContent = 'Acabamos de enviar um link. Espere um minuto antes de pedir outro.'; erro.hidden = false; return; }
  btn.disabled = true; btn.textContent = 'ENVIANDO…';
  try {
    const {error} = await sb.auth.resetPasswordForEmail(email, {redirectTo: location.origin + '/'});
    if (error) throw error;
    gravarLS(LS_ESQUECI, Date.now());
    // não diz se o e-mail existe: só que, se existir, o link chega
    ok.textContent = 'Pronto. Se este e-mail tiver acesso, o link chega em alguns minutos. Abra-o neste aparelho.'; ok.hidden = false;
  } catch (err) { erro.textContent = CrmUtils.mensagemLogin(err); erro.hidden = false; }
  finally { btn.disabled = false; btn.textContent = 'ENVIAR LINK'; }
});

/* ---------------- senha nova (link do e-mail ou troca obrigatória) ---------------- */
function mostrarNovaSenha(modo) {
  MODO_SENHA = modo;
  mostrarLogin(null, {tela: 'formNovaSenha'});
  $('#nsTitulo').textContent = modo === 'obrigatoria' ? 'Troque a senha provisória' : 'Crie uma senha nova';
  $('#nsSub').textContent = modo === 'obrigatoria' ? 'Por segurança, escolha a sua própria senha antes de começar. Pelo menos 8 caracteres, diferente do e-mail.' : 'Pelo menos 8 caracteres, diferente do seu e-mail.';
  $('#nsSenha').value = ''; $('#nsSenha2').value = ''; $('#nsErro').hidden = true;
}
$('#formNovaSenha').addEventListener('submit', async e => {
  e.preventDefault();
  const erro = $('#nsErro'), btn = $('#btnNsSalvar');
  erro.hidden = true;
  let email = PERFIL?.email || '';
  try { email = email || (await sb.auth.getUser())?.data?.user?.email || ''; } catch { /* ignora */ }
  const falha = CrmUtils.validarNovaSenha($('#nsSenha').value, $('#nsSenha2').value, email);
  if (falha) { erro.textContent = falha; erro.hidden = false; $('#nsSenha').focus(); return; }
  btn.disabled = true; btn.textContent = 'SALVANDO…';
  try {
    const {error} = await sb.auth.updateUser({password: $('#nsSenha').value});
    if (error) throw error;
    if (MODO_SENHA === 'obrigatoria' || PERFIL?.precisa_trocar_senha) {
      const id = PERFIL?.id || (await sb.auth.getUser())?.data?.user?.id;
      // o gatilho do banco deixa a própria pessoa desligar este aviso
      const {error: e2} = await sb.from('perfis').update({precisa_trocar_senha: false}).eq('id', id);
      if (e2) throw new Error('A senha foi trocada, mas não consegui tirar o aviso de senha provisória. Avise o administrador.');
      if (PERFIL) PERFIL.precisa_trocar_senha = false;
    }
    $('#nsSenha').value = ''; $('#nsSenha2').value = '';
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    MODO_SENHA = null; PERFIL = null;
    toast('✅ Senha nova salva');
    await entrarDepoisDoLogin();
  } catch (err) { erro.textContent = CrmUtils.mensagemLogin(err).replace(/^Não deu certo: /, ''); erro.hidden = false; }
  finally { btn.disabled = false; btn.textContent = 'SALVAR SENHA'; }
});

/* ---------------- duas etapas no login ---------------- */
function mostrarMfa() { mostrarLogin(null, {tela: 'formMfa'}); $('#mfaCodigo').value = ''; $('#mfaErro').hidden = true; }
$('#mfaCodigo').addEventListener('input', e => { const d = e.target.value.replace(/\D/g, '').slice(0, 6); e.target.value = d.length > 3 ? d.slice(0, 3) + ' ' + d.slice(3) : d; if (d.length === 6) $('#formMfa').requestSubmit(); });
$('#formMfa').addEventListener('submit', async e => {
  e.preventDefault();
  const erro = $('#mfaErro'), btn = $('#btnMfaEntrar'), codigo = $('#mfaCodigo').value.replace(/\s/g, '');
  erro.hidden = true;
  if (!CrmUtils.codigoMfaValido(codigo)) { erro.textContent = 'O código tem 6 números.'; erro.hidden = false; return; }
  if (btn.disabled) return;
  btn.disabled = true; btn.textContent = 'CONFERINDO…';
  try {
    const {data: f, error: e1} = await sb.auth.mfa.listFactors(); if (e1) throw e1;
    const fator = (f?.totp || []).find(x => x.status === 'verified'); if (!fator) throw new Error('Nenhum autenticador ativo nesta conta.');
    const {data: ch, error: e2} = await sb.auth.mfa.challenge({factorId: fator.id}); if (e2) throw e2;
    const {error: e3} = await sb.auth.mfa.verify({factorId: fator.id, challengeId: ch.id, code: codigo}); if (e3) throw e3;
    await entrarDepoisDoLogin();
  } catch (err) { erro.textContent = CrmUtils.mensagemLogin(err).replace(/^Não deu certo: /, ''); erro.hidden = false; $('#mfaCodigo').select(); }
  finally { btn.disabled = false; btn.textContent = 'CONFIRMAR'; }
});

/* ---------------- sessão: papel na tela, último acesso, avatar ---------------- */
function aplicarPapelNaTela() {
  const nav = $('.nav-item[data-view="equipe"]'); if (nav) nav.hidden = !SOU_GESTOR;
  $('#btnMetas').hidden = !SOU_GESTOR;
  const pEquipe = $('#tarefaFiltro [data-tf="equipe"]'); if (pEquipe) pEquipe.hidden = !SOU_GESTOR;
  if (modal.classList.contains('open') && editId) $('#btnExcluir').style.display = SOU_GESTOR ? 'inline-flex' : 'none';
  renderAvatar();
}
function renderAvatar() {
  const p = PERFIL || {}, cor = CrmUtils.corAvatar(p), ini = iniciais(p.nome || p.email || '?');
  for (const id of ['#perfilAvatar', '#mpAvatar']) { const el = $(id); el.textContent = ini; el.style.setProperty('--cor-avatar', cor); }
  $('#mpNome').textContent = p.nome || 'Sem nome';
  $('#mpEmail').textContent = p.email || '';
  $('#mpPapel').textContent = [LABEL_PAPEL[p.papel] || p.papel, p.cargo].filter(Boolean).join(' · ');
  $('#btnPerfil').setAttribute('aria-label', 'Menu do perfil de ' + (p.nome || 'você'));
}
function iniciarSessao() {
  if (SESSAO_ATIVA || !PERFIL?.id) return;
  SESSAO_ATIVA = true;
  gravarUltimoAcesso();
  iniciarSino();
  iniciarEquipeETarefas();
}
async function gravarUltimoAcesso() {
  const chave = LS_ACESSO + '_' + PERFIL?.id;
  if (!PERFIL?.id || !CrmUtils.deveGravarAcesso(lerLS(chave, null))) return;
  gravarLS(chave, Date.now());
  try { await sb.from('perfis').update({ultimo_acesso_em: new Date().toISOString(), ultimo_app: 'crm'}).eq('id', PERFIL.id); } catch { /* não atrapalha o uso */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && SESSAO_ATIVA) { gravarUltimoAcesso(); carregarNotificacoes(); recarregarTarefas(); } });

/* ---------------- menus do topo (perfil e sino) ---------------- */
function fecharPops(exceto) {
  for (const [btn, pop] of [['#btnPerfil', '#menuPerfil'], ['#btnSino', '#painelSino']]) if (pop !== exceto && !$(pop).hidden) { $(pop).hidden = true; $(btn).setAttribute('aria-expanded', 'false'); }
}
function alternarPop(btn, pop) {
  const abrir = $(pop).hidden; fecharPops(pop);
  $(pop).hidden = !abrir; $(btn).setAttribute('aria-expanded', String(abrir));
  if (abrir) setTimeout(() => $(pop).querySelector('[role=menuitem],button,a')?.focus(), 20);
}
$('#btnPerfil').addEventListener('click', () => alternarPop('#btnPerfil', '#menuPerfil'));
$('#btnSino').addEventListener('click', () => { alternarPop('#btnSino', '#painelSino'); if (!$('#painelSino').hidden) carregarNotificacoes(); });
document.addEventListener('click', e => { if (!e.target.closest('.topo-icones')) fecharPops(); });
document.addEventListener('keydown', e => {
  const aberto = ['#menuPerfil', '#painelSino'].find(p => !$(p).hidden); if (!aberto) return;
  if (e.key === 'Escape') { e.stopImmediatePropagation(); fecharPops(); $(aberto === '#menuPerfil' ? '#btnPerfil' : '#btnSino').focus(); return; }
  if (aberto === '#menuPerfil' && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
    const itens = $$('#menuPerfil [role=menuitem]'), i = itens.indexOf(document.activeElement); e.preventDefault();
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? itens.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + itens.length) % itens.length;
    itens[n].focus();
  }
}, true);
function irParaConta(alvo) {
  irPara('configuracoes');
  $('#configTabs [data-secao="conta"]').click();
  const el = $(alvo); if (!el) return;
  el.scrollIntoView({block: 'start'}); (el.matches('input,button') ? el : el.querySelector('input,button'))?.focus();
}
$('#menuPerfil').addEventListener('click', async e => {
  const b = e.target.closest('[data-mp]'); if (!b) return;
  fecharPops();
  const acao = b.dataset.mp;
  if (acao === 'perfil') irParaConta('#perfilNome');
  if (acao === 'senha') irParaConta('#senhaNova');
  if (acao === 'mfa') irParaConta('#cardMfa');
  if (acao === 'notif') irParaConta('#cardNotif');
  if (acao === 'tarefas') { irPara('dashboard'); $('#cardTarefas').scrollIntoView({block: 'start'}); $('#tarefaTexto').focus(); }
  if (acao === 'tema') $('#btnTema').click();
  if (acao === 'ajuda') window.abrirAjuda?.();
  if (acao === 'sair') sair('local');
  if (acao === 'sairTodos') sair('global');
});
async function sair(escopo) {
  if (escopo === 'global' && !confirm('Sair de todos os aparelhos? Você e quem estiver usando a sua conta em outro celular ou computador vão precisar entrar de novo.')) return;
  try { const {error} = await sb.auth.signOut({scope: escopo}); if (error) throw error; }
  catch (err) { if (escopo === 'global') { toast('⚠️ ' + CrmUtils.mensagemLogin(err)); return; } }
  mostrarLogin(escopo === 'global' ? 'Você saiu de todos os aparelhos.' : 'Você saiu da conta.', {tipo: 'ok'});
}
$('#btnSair').addEventListener('click', () => sair('local'));
$('#btnSairTodos').addEventListener('click', () => sair('global'));

/* ---------------- Minha conta: perfil, cor, notificações, duas etapas ---------------- */
function preencherMinhaConta() {
  const p = PERFIL || {};
  $('#perfilNome').value = p.nome ?? ''; $('#perfilCargo').value = p.cargo ?? '';
  $('#perfilTelefone').value = p.telefone ? CrmUtils.formatarTelefone(p.telefone) : '';
  $('#perfilEmail').value = p.email ?? ''; $('#perfilPapel').value = LABEL_PAPEL[p.papel] ?? (p.papel || '—');
  const cor = CrmUtils.corAvatar(p);
  $('#perfilCores').innerHTML = '<legend>Cor do avatar</legend>' + CrmUtils.CORES_AVATAR.map((c, i) => `<label class="cor-avatar" style="--cor-avatar:${c}"><input type="radio" name="corAvatar" value="${c}" ${c === cor ? 'checked' : ''} aria-label="Cor ${i + 1}"><span aria-hidden="true">${esc(iniciais(p.nome || '?'))}</span></label>`).join('');
  const apps = CrmUtils.appsPermitidos(p, '').map(a => a.nome);
  $('#perfilAcesso').textContent = (apps.length ? 'Apps liberados: ' + apps.join(', ') + '.' : '') + (p.ultimo_acesso_em ? ' Último acesso: ' + new Date(p.ultimo_acesso_em).toLocaleString('pt-BR', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}) + '.' : '');
  const n = prefsNotif();
  $('#notifToast').checked = n.toast; $('#notifSom').checked = n.som; $('#notifTitulo').checked = n.titulo;
  $('#sessaoTxt').textContent = `Conectado como ${p.email || 'você'}. "Sair de todos os aparelhos" encerra também o celular e outros computadores.`;
  renderMfa();
}
$('#perfilCores').addEventListener('change', () => { const c = $('input[name=corAvatar]:checked')?.value; if (c) $$('#perfilAvatar,#mpAvatar').forEach(el => el.style.setProperty('--cor-avatar', c)); });
async function salvarMeuPerfil(d) {
  // a cor mora na coluna perfis.avatar_cor (a mesma que o Atendimento e o servidor leem)
  const linha = {nome: d.nome, cargo: d.cargo || null, telefone: d.telefone || null, ...(d.avatar_cor ? {avatar_cor: d.avatar_cor} : {})};
  const {error} = await sb.from('perfis').update(linha).eq('id', PERFIL.id);
  // sem permissão de gravar direto: a rota do servidor grava (pelo menos o nome)
  if (error) await api('/api/perfil', {method: 'PATCH', body: JSON.stringify({nome: d.nome, cargo: linha.cargo, telefone: linha.telefone, avatar_cor: d.avatar_cor})});
  Object.assign(PERFIL, linha);
  renderAvatar(); carregarEquipeNomes();
}
const prefsNotif = () => ({toast: true, som: false, titulo: true, ...(PERFIL?.preferencias?.notificacoes || {})});
$('#formNotif').addEventListener('submit', async e => {
  e.preventDefault();
  const msg = $('#notifMsg'), novas = {notificacoes: {toast: $('#notifToast').checked, som: $('#notifSom').checked, titulo: $('#notifTitulo').checked}};
  const preferencias = CrmUtils.mesclarPreferencias(PERFIL?.preferencias, novas);
  try {
    const {error} = await sb.from('perfis').update({preferencias}).eq('id', PERFIL.id); if (error) throw error;
    PERFIL.preferencias = preferencias; renderSino();
    msg.textContent = '✅ Preferências salvas (valem em qualquer aparelho).'; msg.className = 'form-msg ok';
    if (novas.notificacoes.som) bipe();
  } catch (err) { msg.textContent = '⚠️ Não consegui salvar: ' + (err.message || 'erro'); msg.className = 'form-msg erro'; }
  msg.hidden = false;
});
let MFA_PENDENTE = null;
async function renderMfa() {
  const box = $('#mfaBox');
  if (!sb?.auth?.mfa) { box.innerHTML = '<p class="muted">Indisponível neste navegador.</p>'; return; }
  box.innerHTML = '<p class="muted"><span class="spinner"></span>Conferindo…</p>';
  try {
    const {data, error} = await sb.auth.mfa.listFactors(); if (error) throw error;
    const ativo = (data?.totp || []).find(f => f.status === 'verified');
    if (ativo) {
      box.innerHTML = `<p class="mfa-estado on">✅ Ativada${ativo.created_at ? ' desde ' + esc(dtAno(ativo.created_at)) : ''}. Depois da senha, o CRM pede o código do app.</p>
        <button type="button" class="btn btn-ghost sm" id="mfaDesativar">Desativar</button>`;
      $('#mfaDesativar').onclick = async () => {
        if (!confirm('Desativar a verificação em duas etapas? A conta fica protegida só pela senha.')) return;
        const {error: e2} = await sb.auth.mfa.unenroll({factorId: ativo.id});
        if (e2) { toast('⚠️ ' + (/aal2|assurance/i.test(e2.message) ? 'Para desativar, saia e entre de novo usando o código do app.' : CrmUtils.mensagemLogin(e2))); return; }
        toast('Verificação em duas etapas desativada'); renderMfa();
      };
    } else {
      box.innerHTML = '<p class="mfa-estado">Desativada.</p><button type="button" class="btn btn-primary sm" id="mfaAtivar">Ativar verificação em duas etapas</button>';
      $('#mfaAtivar').onclick = ativarMfa;
    }
  } catch (err) { box.innerHTML = `<p class="muted">Não consegui conferir agora: ${esc(CrmUtils.mensagemLogin(err))}</p>`; }
}
async function ativarMfa() {
  const box = $('#mfaBox');
  try {
    // limpa tentativa anterior que ficou pela metade (fator não verificado)
    const {data: l} = await sb.auth.mfa.listFactors();
    for (const f of (l?.all || []).filter(x => x.status !== 'verified')) await sb.auth.mfa.unenroll({factorId: f.id});
    const {data, error} = await sb.auth.mfa.enroll({factorType: 'totp', friendlyName: 'CRM IndyCar ' + new Date().toISOString().slice(0, 10)});
    if (error) throw error;
    MFA_PENDENTE = data.id;
    const qr = String(data.totp?.qr_code || ''), src = qr.startsWith('data:') ? qr : 'data:image/svg+xml;utf8,' + encodeURIComponent(qr);
    box.innerHTML = `<ol class="mfa-passos"><li>No celular, abra o app autenticador e leia o QR:</li></ol>
      <img class="mfa-qr" alt="QR code para o app autenticador" src="${esc(src)}" width="180" height="180">
      <p class="muted mini-nota">Sem câmera? Digite a chave: <code id="mfaSegredo">${esc(data.totp?.secret || '')}</code></p>
      <form id="formMfaAtivar" class="form-vertical"><label>2. Digite o código de 6 números que apareceu<input id="mfaNovoCodigo" inputmode="numeric" autocomplete="one-time-code" maxlength="7" class="codigo-mfa" required></label>
      <p class="form-erro" id="mfaAtivarErro" role="alert"></p>
      <div class="int-actions"><button type="button" class="btn btn-ghost sm" id="mfaCancelar">Cancelar</button><div class="spacer"></div><button type="submit" class="btn btn-primary sm">Confirmar e ativar</button></div></form>`;
    $('#mfaNovoCodigo').focus();
    $('#mfaCancelar').onclick = async () => { try { await sb.auth.mfa.unenroll({factorId: MFA_PENDENTE}); } catch { /* ignora */ } MFA_PENDENTE = null; renderMfa(); };
    $('#formMfaAtivar').onsubmit = async ev => {
      ev.preventDefault();
      const code = $('#mfaNovoCodigo').value.replace(/\s/g, '');
      if (!CrmUtils.codigoMfaValido(code)) { $('#mfaAtivarErro').textContent = 'O código tem 6 números.'; return; }
      const {data: ch, error: e1} = await sb.auth.mfa.challenge({factorId: MFA_PENDENTE});
      const {error: e2} = e1 ? {error: e1} : await sb.auth.mfa.verify({factorId: MFA_PENDENTE, challengeId: ch.id, code});
      if (e2) { $('#mfaAtivarErro').textContent = CrmUtils.mensagemLogin(e2).replace(/^Não deu certo: /, ''); $('#mfaNovoCodigo').select(); return; }
      MFA_PENDENTE = null; toast('🛡️ Verificação em duas etapas ativada'); renderMfa();
    };
  } catch (err) { box.innerHTML = `<p class="form-erro">${esc(CrmUtils.mensagemLogin(err))}</p><button type="button" class="btn btn-ghost sm" id="mfaDeNovo">Tentar de novo</button>`; $('#mfaDeNovo').onclick = renderMfa; }
}

/* ---------------- sino de notificações (tabela notificacoes + realtime) ---------------- */
let NOTIFS = [], TIMER_SINO = null, SINO_OK = true;
const CANAIS = [];
const ICONE_NOTIF = {tarefa: '✅', tarefa_atribuida: '✅', lead: '🎯', lead_atribuido: '🎯', conversa: '💬', conversa_atribuida: '💬', aguardando_consultor: '⏳', cliente_aguardando: '⏳', meta: '🏁', sistema: '⚙️'};
function iniciarSino() {
  carregarNotificacoes();
  try {
    const canal = sb.channel('crm-notif-' + PERFIL.id)
      .on('postgres_changes', {event: '*', schema: 'public', table: 'notificacoes', filter: 'perfil_id=eq.' + PERFIL.id}, chegouNotificacao)
      .subscribe(st => { if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') SINO_OK = false; if (st === 'SUBSCRIBED') SINO_OK = true; });
    CANAIS.push(canal);
  } catch { SINO_OK = false; }
  // rede de segurança: se o realtime cair, confere a cada 2 minutos
  clearInterval(TIMER_SINO); TIMER_SINO = setInterval(() => { if (!SINO_OK || document.visibilityState === 'visible') carregarNotificacoes(); }, 120000);
}
let GER_SINO = 0;
async function carregarNotificacoes() {
  if (!PERFIL?.id || !sb) return;
  const ger = ++GER_SINO;
  try {
    const {data, error} = await sb.from('notificacoes').select('id,tipo,titulo,corpo,link,app,lida_em,created_at').eq('perfil_id', PERFIL.id).order('created_at', {ascending: false}).limit(40);
    if (error) throw error;
    if (ger !== GER_SINO) return;
    NOTIFS = data || []; renderSino();
  } catch { $('#sinoPe').textContent = 'Não consegui buscar as notificações agora.'; }
}
function chegouNotificacao(p) {
  const n = p.new, velho = p.old;
  if (p.eventType === 'INSERT' && n?.id && !NOTIFS.some(x => x.id === n.id)) {
    NOTIFS.unshift(n); NOTIFS = NOTIFS.slice(0, 60); renderSino();
    const pr = prefsNotif();
    if (pr.toast) toastAcao('🔔 ' + (n.titulo || 'Nova notificação'), 'Abrir', () => abrirNotificacao(n), 8000);
    if (pr.som) bipe();
  } else if (p.eventType === 'UPDATE' && n?.id) { NOTIFS = NOTIFS.map(x => x.id === n.id ? {...x, ...n} : x); renderSino(); }
  else if (p.eventType === 'DELETE' && velho?.id) { NOTIFS = NOTIFS.filter(x => x.id !== velho.id); renderSino(); }
}
function renderSino() {
  const naoLidas = NOTIFS.filter(n => !n.lida_em).length, qtd = $('#sinoQtd');
  qtd.hidden = !naoLidas; qtd.textContent = naoLidas > 99 ? '99+' : String(naoLidas);
  $('#btnSino').setAttribute('aria-label', naoLidas ? `Notificações: ${naoLidas} não lida${naoLidas === 1 ? '' : 's'}` : 'Notificações');
  $('#btnSino').classList.toggle('tem', !!naoLidas);
  document.title = (naoLidas && prefsNotif().titulo ? `(${naoLidas}) ` : '') + TITULO_BASE;
  $('#sinoTodas').disabled = !naoLidas;
  $('#sinoLista').innerHTML = NOTIFS.length ? NOTIFS.map(n => `<li class="${n.lida_em ? '' : 'nova'}">
      <button type="button" class="sino-item" data-notif="${esc(n.id)}"><span class="sino-ico" aria-hidden="true">${ICONE_NOTIF[n.tipo] || '🔔'}</span>
        <span class="sino-txt"><strong>${n.lida_em ? '' : '<span class="sr">Não lida: </span>'}${esc(n.titulo || 'Notificação')}</strong>${n.corpo ? `<small>${esc(n.corpo)}</small>` : ''}
        <time datetime="${esc(n.created_at)}">${esc(CrmUtils.tempoRelativo(n.created_at))}${n.app && n.app !== 'crm' ? ' · ' + esc(CrmUtils.NOME_APPS[n.app] || n.app) : ''}</time></span></button>
      <button type="button" class="sino-x" data-apagar="${esc(n.id)}" aria-label="Apagar notificação: ${esc(n.titulo || '')}">×</button></li>`).join('')
    : '<li class="sino-vazio">Nada por aqui. Quando passarem um lead, uma conversa ou uma tarefa para você, aparece aqui.</li>';
  $('#sinoPe').textContent = SINO_OK ? '' : 'Atualização ao vivo fora do ar: confiro a cada 2 minutos.';
}
async function marcarLida(ids) {
  const agora = new Date().toISOString(), alvo = ids.filter(id => NOTIFS.some(n => n.id === id && !n.lida_em));
  if (!alvo.length) return;
  NOTIFS = NOTIFS.map(n => alvo.includes(n.id) ? {...n, lida_em: agora} : n); renderSino();
  try { const {error} = await sb.from('notificacoes').update({lida_em: agora}).in('id', alvo); if (error) throw error; }
  catch { toast('⚠️ Não consegui marcar como lida.'); carregarNotificacoes(); }
}
async function abrirNotificacao(n) {
  marcarLida([n.id]);
  const dest = CrmUtils.linkNotificacao(n, 'crm');
  fecharPops();
  if (dest.interno?.lead) { await abrirModal(dest.interno.lead); return; }
  if (dest.interno?.busca) { history.replaceState(null, '', location.pathname + dest.interno.busca); await abrirPorLink(); return; }
  if (dest.url) window.open(dest.url, '_blank', 'noopener,noreferrer');
}
$('#sinoLista').addEventListener('click', async e => {
  const x = e.target.closest('[data-apagar]');
  if (x) {
    const id = x.dataset.apagar, antes = NOTIFS; NOTIFS = NOTIFS.filter(n => n.id !== id); renderSino();
    try { const {error} = await sb.from('notificacoes').delete().eq('id', id); if (error) throw error; }
    catch { NOTIFS = antes; renderSino(); toast('⚠️ Não consegui apagar.'); }
    $('#sinoLista .sino-item')?.focus(); return;
  }
  const b = e.target.closest('[data-notif]'); if (!b) return;
  const n = NOTIFS.find(x => x.id === b.dataset.notif); if (n) abrirNotificacao(n);
});
$('#sinoTodas').addEventListener('click', () => marcarLida(NOTIFS.filter(n => !n.lida_em).map(n => n.id)));
let AUDIO = null;
function bipe() {
  try { AUDIO = AUDIO || new (window.AudioContext || window.webkitAudioContext)(); const o = AUDIO.createOscillator(), g = AUDIO.createGain();
    o.frequency.value = 880; g.gain.setValueAtTime(.08, AUDIO.currentTime); g.gain.exponentialRampToValueAtTime(.0001, AUDIO.currentTime + .25);
    o.connect(g).connect(AUDIO.destination); o.start(); o.stop(AUDIO.currentTime + .26); } catch { /* sem áudio */ }
}

/* ---------------- configuração com espera (rodada 4) ---------------- */
const LS_CONFIG = 'indycar_crm_config';
async function buscarConfig() {
  const esperas = CrmR4.esperasAcordar();
  for (let i = 0; ; i++) {
    let status = 0, corpo = null;
    try { const r = await fetch('/api/config', {cache: 'no-store', signal: AbortSignal.timeout(25000)}); status = r.status; try { corpo = await r.json(); } catch { /* sem JSON */ } } catch { /* rede */ }
    if (status === 200 && corpo && 'configurado' in corpo) { servidorRespondeu(); return corpo; }
    if (i >= esperas.length) return null;
    mostrarAcordando(i + 1, esperas.length, esperas[i]); await esperarAcordar(esperas[i]);
  }
}
async function carregarConfig() {
  const salvo = lerLS(LS_CONFIG, null);
  const valido = c => c && c.configurado && /^https?:\/\//.test(c.supabaseUrl || '') && typeof c.supabaseAnonKey === 'string';
  const atualizar = buscarConfig().then(c => { if (valido(c)) gravarLS(LS_CONFIG, {configurado: true, supabaseUrl: c.supabaseUrl, supabaseAnonKey: c.supabaseAnonKey, iaConfigurada: !!c.iaConfigurada}); return c; });
  if (valido(salvo)) { atualizar.catch(() => {}); return salvo; }
  return atualizar;
}

/* ---------------- boot ---------------- */
(async function iniciar() {
  mostrarLogin();                       // capa primeiro: nada vaza antes da senha
  /* Rodada 4: com a configuração guardada o boot não espera a rede — então espera
     os outros scripts (equipe.js, rodada4.js) terminarem de carregar antes de entrar. */
  if (document.readyState === 'loading') await new Promise(r => document.addEventListener('DOMContentLoaded', r, {once: true}));
  /* Rodada 4: a configuração (endereço e chave PÚBLICA do Supabase) fica guardada
     no aparelho. Com o Render dormindo, o login abre na hora (fala direto com o
     Supabase) e o servidor acorda enquanto a pessoa digita a senha. */
  fetch('/api/ping', {cache: 'no-store'}).catch(() => {});   // já cutuca o servidor
  CONFIG = await carregarConfig();
  if (!CONFIG) return mostrarLogin('Não consegui falar com o servidor depois de 3 minutos. Confira a internet e recarregue a página.');
  if (!CONFIG.configurado) {
    return mostrarLogin('Falta configurar o Supabase no servidor (SUPABASE_URL, '
      + 'SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY).');
  }
  if (!window.supabase?.createClient) {
    return mostrarLogin('A biblioteca do Supabase não carregou. Verifique sua conexão.');
  }
  sb = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true}});
  sb.auth.onAuthStateChange(ev => {
    if (ev === 'PASSWORD_RECOVERY') { mostrarNovaSenha('recuperacao'); return; }
    // saiu por outro caminho (outra aba, "sair de todos" em outro aparelho, token revogado)
    if (ev === 'SIGNED_OUT' && !document.body.classList.contains('deslogado')) mostrarLogin('Sua sessão foi encerrada. Entre de novo.');
  });
  if (VEIO_DE_RECUPERACAO) { await sb.auth.getSession(); mostrarNovaSenha('recuperacao'); return; }

  // já estava logado? entra direto (com a segunda etapa, se a conta tiver)
  const {data} = await sb.auth.getSession();
  if (data?.session) {
    try { await entrarDepoisDoLogin(); }
    catch (err) { mostrarLogin(err.message); }
  } else {
    // ninguém logado: pode ser a primeira vez que o sistema abre
    await verPrimeiroAcesso();
  }
})();
