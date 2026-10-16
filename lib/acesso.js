/* ============================================================
   IndyCar CRM — porteiro (quem pode usar o CRM)

   1. Token do Supabase Auth válido (pergunta ao /auth/v1/user).
   2. Perfil existe e está ATIVO            → senão 401 codigo 'desativado'.
   3. Papel da equipe (admin|gestor|atendente) e 'crm' em perfis.apps
      (admin sempre entra)                  → senão 403 codigo 'sem_acesso_app'.
   4. Grava último acesso (ultimo_acesso_em / ultimo_app) no máximo a
      cada 5 minutos por pessoa.
   Resultado lembrado por 60 s (negado por 30 s) para não martelar o Auth.
   ============================================================ */
'use strict';

const { podeCrm, ehGestor, APPS } = require('./util-servidor');

const MSG = {
  sem_login: 'Faça login para usar o CRM.',
  sessao_expirada: 'Sua sessão venceu. Entre de novo.',
  sessao_invalida: 'Sessão inválida. Entre de novo.',
  desativado: 'Seu acesso foi desativado. Fale com o administrador.',
  sem_perfil: 'Seu usuário ainda não tem cadastro na equipe. Fale com o administrador.',
  sem_acesso_app: 'Você não tem acesso ao CRM.',
  indisponivel: 'Não consegui conferir o seu login agora. Tente de novo.',
  nao_configurado: 'Servidor sem a configuração de login.',
};
const STATUS = { sem_login: 401, sessao_expirada: 401, sessao_invalida: 401, desativado: 401, sem_perfil: 403, sem_acesso_app: 403, indisponivel: 503, nao_configurado: 503 };
const negado = codigo => ({ ok: false, status: STATUS[codigo], codigo, erro: MSG[codigo] });

// rodada 5: um lugar só para os endereços dos apps (lib/apps.js; CRM_URL_* sobrepõe)
const LINKS_APPS = require('./apps').HOSTS;

function validadeDoToken(token) {
  try {
    const [, carga] = token.split('.');
    const { exp } = JSON.parse(Buffer.from(carga, 'base64url').toString('utf8'));
    return Number.isFinite(exp) ? exp * 1000 : 0;
  } catch { return 0; }
}

const COLS_PERFIL = 'id,nome,email,papel,ativo,apps,cargo,telefone,avatar_cor,recebe_leads,precisa_trocar_senha,ultimo_acesso_em,ultimo_app';

function criarAcesso({ supabaseUrl, anonKey, sb, fetch: buscar = globalThis.fetch, agora = () => Date.now(), app = 'crm',
  cacheMs = 60_000, cacheNegadoMs = 30_000, intervaloAcessoMs = 5 * 60_000, log = () => {} } = {}) {
  const cache = new Map();            // token -> { r, expira, id }
  const acessoGravado = new Map();    // perfil -> ms

  function guardar(token, r, ms, id = null) {
    if (cache.size > 2000) { const t = agora(); for (const [k, v] of cache) if (v.expira <= t) cache.delete(k); if (cache.size > 2000) cache.clear(); }
    cache.set(token, { r, expira: agora() + ms, id });
    return r;
  }

  /** Esquece o login lembrado de uma pessoa (ex.: admin acabou de desativar). */
  function esquecer(perfilId) {
    for (const [k, v] of cache) if (!perfilId || v.id === perfilId) cache.delete(k);
  }

  async function gravarAcesso(perfil) {
    const t = agora();
    // no máximo uma gravação a cada 5 min por pessoa (memória deste servidor)…
    if (t - (acessoGravado.get(perfil.id) || 0) < intervaloAcessoMs) return false;
    // …e nem isso se o banco já mostra um acesso recente ao CRM
    const noBanco = Date.parse(perfil.ultimo_acesso_em || '') || 0;
    if (perfil.ultimo_app === app && t - noBanco < intervaloAcessoMs) return false;
    acessoGravado.set(perfil.id, t);
    if (acessoGravado.size > 5000) acessoGravado.clear();
    try {
      const { error } = await sb.from('perfis').update({ ultimo_acesso_em: new Date(t).toISOString(), ultimo_app: app }).eq('id', perfil.id);
      if (error) log('último acesso:', error.message);
    } catch (e) { log('último acesso:', e && e.message); }
    return true;
  }

  /** Confere o pedido. Devolve { ok:true, usuario } ou { ok:false, status, codigo, erro }. */
  async function autenticar(req) {
    if (!supabaseUrl || !anonKey || !sb) return negado('nao_configurado');
    const auth = String(req.headers?.authorization || '');
    const m = /^\s*bearer\s+(\S{10,4096})\s*$/i.exec(auth);
    if (!m) return negado('sem_login');
    const token = m[1];

    const lembrado = cache.get(token);
    if (lembrado && lembrado.expira > agora()) return lembrado.r;

    const vence = validadeDoToken(token);
    if (vence && vence <= agora()) return negado('sessao_expirada');

    let usuario;
    try {
      const r = await buscar(`${supabaseUrl}/auth/v1/user`, {
        headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      });
      if (r.status === 401 || r.status === 403) return guardar(token, negado('sessao_invalida'), cacheNegadoMs);
      if (!r.ok) return negado('indisponivel');
      usuario = await r.json();
    } catch { return negado('indisponivel'); }
    if (!usuario?.id) return guardar(token, negado('sessao_invalida'), cacheNegadoMs);

    let perfil;
    try {
      const { data, error } = await sb.from('perfis').select(COLS_PERFIL).eq('id', usuario.id).maybeSingle();
      if (error) return negado('indisponivel');
      perfil = data;
    } catch { return negado('indisponivel'); }
    if (!perfil) return guardar(token, negado('sem_perfil'), cacheNegadoMs, usuario.id);
    if (perfil.ativo === false) return guardar(token, negado('desativado'), cacheNegadoMs, usuario.id);
    if (!podeCrm(perfil)) {
      const r = { ...negado('sem_acesso_app'), apps: appsDe(perfil) };
      return guardar(token, r, cacheNegadoMs, usuario.id);
    }

    await gravarAcesso(perfil);
    const u = {
      id: perfil.id, email: perfil.email || usuario.email || '', nome: perfil.nome || '',
      papel: perfil.papel, apps: Array.isArray(perfil.apps) ? perfil.apps : [],
      cargo: perfil.cargo || null, avatar_cor: perfil.avatar_cor || null,
      recebe_leads: perfil.recebe_leads !== false, precisa_trocar_senha: !!perfil.precisa_trocar_senha,
      ehAdmin: perfil.papel === 'admin', ehGestor: ehGestor(perfil.papel),
    };
    return guardar(token, { ok: true, usuario: u }, Math.max(1000, Math.min(cacheMs, (vence || Infinity) - agora())), u.id);
  }

  /** Os apps que a pessoa pode abrir, com o link (para a tela "sem acesso"). */
  function appsDe(perfil) {
    const lista = perfil.papel === 'admin' ? APPS : (Array.isArray(perfil.apps) ? perfil.apps : []);
    return lista.filter(a => APPS.includes(a) && a !== app && (perfil.papel !== 'agenda' || a === 'agenda'))
      .map(a => ({ app: a, url: LINKS_APPS[a] })).filter(a => a.url);
  }

  /** GET /api/eu — quem sou eu, lido na hora (não do cache). */
  async function eu(u) {
    const { data, error } = await sb.from('perfis')
      .select(COLS_PERFIL + ',preferencias,created_at').eq('id', u.id).maybeSingle();
    if (error || !data) return { ...u, app, pode: poderes(u) };
    const ehA = data.papel === 'admin', ehG = ehGestor(data.papel);
    const out = {
      id: data.id, email: data.email || u.email, nome: data.nome || '', papel: data.papel,
      cargo: data.cargo || null, telefone: data.telefone || null, avatar_cor: data.avatar_cor || null,
      apps: Array.isArray(data.apps) ? data.apps : [], recebe_leads: data.recebe_leads !== false,
      precisa_trocar_senha: !!data.precisa_trocar_senha,
      preferencias: data.preferencias && typeof data.preferencias === 'object' ? data.preferencias : {},
      ultimo_acesso_em: data.ultimo_acesso_em || null, ultimo_app: data.ultimo_app || null,
      criado_em: data.created_at || null, ehAdmin: ehA, ehGestor: ehG, app,
      outrosApps: appsDe(data),
    };
    out.pode = poderes(out);
    return out;
  }

  return { autenticar, esquecer, eu, appsDe, _cache: cache };
}

/** O que a pessoa pode fazer no CRM (a tela esconde botões; o servidor confere de novo). */
function poderes(u) {
  const g = ehGestor(u.papel), a = u.papel === 'admin';
  return {
    apagarLead: g, atribuirLote: g, reatribuirQualquer: g, metas: g, rodizio: g, automacoes: g,
    desempenhoEquipe: true, equipe: a, integracoes: a, investimento: a, catalogo: a, auditoria: a,
  };
}

module.exports = { criarAcesso, validadeDoToken, poderes, MSG, LINKS_APPS };
