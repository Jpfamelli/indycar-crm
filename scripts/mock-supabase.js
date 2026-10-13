// Supabase FALSO para o servidor falso do CRM (roda no navegador, nunca em produção).
// Imita o pedaço do supabase-js que a tela usa: auth (senha, recuperação, MFA TOTP, sair),
// from().select/insert/update/delete com filtros, e realtime (postgres_changes) por SSE.
// A sessão vive no sessionStorage da aba; os dados vivem na memória do mock-server.
(function () {
  'use strict';
  const PAPEL = window.__MOCK_PAPEL || 'admin';
  const EU = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
  const ss = {
    get: (k, p) => { try { const v = sessionStorage.getItem('mock_' + k); return v === null ? p : JSON.parse(v); } catch { return p; } },
    set: (k, v) => { try { sessionStorage.setItem('mock_' + k, JSON.stringify(v)); } catch { /* ignora */ } },
  };
  // estado inicial da aba: deslogado começa sem sessão; mfa já tem um autenticador ativo
  if (ss.get('papel', null) !== PAPEL) {
    ss.set('papel', PAPEL); ss.set('sessao', PAPEL !== 'deslogado'); ss.set('aal', 'aal1'); ss.set('token', 'ficticio');
    ss.set('fatores', PAPEL === 'mfa' ? [{id: 'fator-totp-1', factor_type: 'totp', status: 'verified', friendly_name: 'Celular (fictício)', created_at: '2026-10-01T12:00:00Z'}] : []);
  }
  const ouvintes = [];
  const emitir = (ev) => { const s = sessao(); for (const f of ouvintes) setTimeout(() => f(ev, s), 0); };
  const sessao = () => ss.get('sessao', false) ? {access_token: ss.get('token', 'ficticio'), user: usuario()} : null;
  const usuario = () => ({id: EU, email: PAPEL === 'desativado' ? 'desativado@exemplo.invalid' : 'teste@exemplo.invalid'});
  const err = (message, code) => ({message, code, name: 'AuthApiError'});
  if (/type=recovery/.test(location.hash)) { ss.set('sessao', true); setTimeout(() => emitir('PASSWORD_RECOVERY'), 30); }

  const fatores = () => ss.get('fatores', []);
  const mfa = {
    async listFactors() { const all = fatores(); return {data: {all, totp: all.filter(f => f.factor_type === 'totp' && f.status === 'verified'), phone: []}, error: null}; },
    async getAuthenticatorAssuranceLevel() {
      if (!ss.get('sessao', false)) return {data: {currentLevel: null, nextLevel: null}, error: null};
      const tem = fatores().some(f => f.status === 'verified');
      return {data: {currentLevel: ss.get('aal', 'aal1'), nextLevel: tem ? 'aal2' : 'aal1', currentAuthenticationMethods: []}, error: null};
    },
    async enroll({friendlyName}) {
      const f = {id: 'fator-' + Math.random().toString(36).slice(2, 8), factor_type: 'totp', status: 'unverified', friendly_name: friendlyName, created_at: new Date().toISOString()};
      ss.set('fatores', [...fatores(), f]);
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29"><rect width="29" height="29" fill="#fff"/><path d="M1 1h7v7H1zM21 1h7v7h-7zM1 21h7v7H1zM10 10h3v3h-3zM14 14h4v4h-4zM20 20h3v3h-3z" fill="#000"/></svg>';
      return {data: {id: f.id, type: 'totp', totp: {qr_code: 'data:image/svg+xml;utf-8,' + svg, secret: 'MOCKSEGREDOFICTICIO', uri: 'otpauth://totp/IndyCar:teste'}}, error: null};
    },
    async challenge({factorId}) { return fatores().some(f => f.id === factorId) ? {data: {id: 'desafio-' + factorId, expires_at: Date.now() / 1000 + 300}, error: null} : {data: null, error: err('Factor not found', 'mfa_factor_not_found')}; },
    async verify({factorId, code}) {
      if (code !== '123456') return {data: null, error: err('Invalid TOTP code entered', 'mfa_verification_failed')};
      ss.set('fatores', fatores().map(f => f.id === factorId ? {...f, status: 'verified'} : f)); ss.set('aal', 'aal2');
      emitir('MFA_CHALLENGE_VERIFIED'); return {data: {access_token: 'ficticio'}, error: null};
    },
    async unenroll({factorId}) {
      const f = fatores().find(x => x.id === factorId);
      if (f && f.status === 'verified' && ss.get('aal', 'aal1') !== 'aal2') return {data: null, error: err('AAL2 required to unenroll verified factor', 'insufficient_aal')};
      ss.set('fatores', fatores().filter(x => x.id !== factorId)); return {data: {id: factorId}, error: null};
    },
  };
  const auth = {
    async getSession() { return {data: {session: sessao()}, error: null}; },
    async getUser() { return ss.get('sessao', false) ? {data: {user: usuario()}, error: null} : {data: {user: null}, error: err('Auth session missing!')}; },
    async refreshSession() { if (!ss.get('sessao', false)) return {data: {session: null}, error: err('Refresh Token Not Found')}; ss.set('token', 'ficticio'); emitir('TOKEN_REFRESHED'); return {data: {session: sessao()}, error: null}; },
    async signInWithPassword({email, password}) {
      await new Promise(r => setTimeout(r, 120));
      if (password === 'senha-errada') return {data: {}, error: err('Invalid login credentials', 'invalid_credentials')};
      if (/^banido@/.test(email)) return {data: {}, error: err('User is banned', 'user_banned')};
      if (password === 'sem-rede') return {data: {}, error: new TypeError('Failed to fetch')};
      ss.set('sessao', true); ss.set('aal', 'aal1'); emitir('SIGNED_IN');
      return {data: {session: sessao(), user: usuario()}, error: null};
    },
    async signOut({scope = 'global'} = {}) { window.__mockUltimoSignOut = scope; ss.set('sessao', false); ss.set('aal', 'aal1'); emitir('SIGNED_OUT'); return {error: null}; },
    async resetPasswordForEmail(email, opcoes) { (window.__mockEmails = window.__mockEmails || []).push({email, redirectTo: opcoes && opcoes.redirectTo}); return {data: {}, error: null}; },
    async updateUser({password}) {
      if (!ss.get('sessao', false)) return {data: null, error: err('Auth session missing!')};
      if (password === 'IgualAntiga#1') return {data: null, error: err('New password should be different from the old password.', 'same_password')};
      window.__mockSenhaTrocada = (window.__mockSenhaTrocada || 0) + 1; emitir('USER_UPDATED'); return {data: {user: usuario()}, error: null};
    },
    onAuthStateChange(f) { ouvintes.push(f); setTimeout(() => f('INITIAL_SESSION', sessao()), 0); return {data: {subscription: {unsubscribe() { const i = ouvintes.indexOf(f); if (i >= 0) ouvintes.splice(i, 1); }}}}; },
    mfa,
  };

  /* from(): monta o pedido e manda para /__sb (o servidor falso aplica a "RLS" e grava em memória) */
  function consulta(tabela) {
    const q = {tabela, op: 'select', select: '*', filtros: [], ordem: [], limite: null, unico: null, valores: null, devolver: false};
    const api = {
      select(cols = '*') { if (q.op === 'select') q.select = cols; else q.devolver = cols || '*'; return api; },
      insert(v) { q.op = 'insert'; q.valores = v; return api; },
      update(v) { q.op = 'update'; q.valores = v; return api; },
      delete() { q.op = 'delete'; return api; },
      eq(c, v) { q.filtros.push(['eq', c, v]); return api; },
      neq(c, v) { q.filtros.push(['neq', c, v]); return api; },
      in(c, v) { q.filtros.push(['in', c, v]); return api; },
      is(c, v) { q.filtros.push(['is', c, v]); return api; },
      gte(c, v) { q.filtros.push(['gte', c, v]); return api; },
      lte(c, v) { q.filtros.push(['lte', c, v]); return api; },
      order(c, o = {}) { q.ordem.push([c, o.ascending !== false, !!o.nullsFirst]); return api; },
      limit(n) { q.limite = n; return api; },
      single() { q.unico = 'single'; return api; },
      maybeSingle() { q.unico = 'maybe'; return api; },
      then(ok, falha) {
        if (!ss.get('sessao', false)) return Promise.resolve({data: null, error: {message: 'JWT expired', code: 'PGRST301'}}).then(ok, falha);
        return fetch('/__sb', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(q)})
          .then(r => r.json()).catch(() => ({data: null, error: {message: 'Failed to fetch'}})).then(ok, falha);
      },
    };
    return api;
  }

  /* realtime: um EventSource por aba, repassado aos canais que batem com tabela e filtro */
  let fonte = null; const canais = new Set();
  function ligarFonte() {
    if (fonte) return;
    fonte = new EventSource('/__sb/eventos');
    fonte.onmessage = m => {
      let e; try { e = JSON.parse(m.data); } catch { return; }
      for (const c of canais) for (const o of c.ouvintes) {
        if (o.cfg.table !== e.table || (o.cfg.event !== '*' && o.cfg.event !== e.eventType)) continue;
        const f = /^(\w+)=eq\.(.+)$/.exec(o.cfg.filter || '');
        const linha = e.new && Object.keys(e.new).length ? e.new : e.old;
        if (f && String(linha?.[f[1]]) !== f[2]) continue;
        try { o.cb({eventType: e.eventType, new: e.new || {}, old: e.old || {}, table: e.table, schema: 'public'}); } catch (x) { console.error(x); }
      }
    };
  }
  function channel(nome) {
    const c = {nome, ouvintes: [],
      on(tipo, cfg, cb) { c.ouvintes.push({cfg, cb}); return c; },
      subscribe(cb) { canais.add(c); ligarFonte(); if (cb) setTimeout(() => cb('SUBSCRIBED'), 10); return c; },
      unsubscribe() { canais.delete(c); return Promise.resolve('ok'); }};
    return c;
  }
  window.supabase = {createClient: () => ({auth, from: consulta, channel, removeChannel: c => { canais.delete(c); return Promise.resolve('ok'); }})};
})();
