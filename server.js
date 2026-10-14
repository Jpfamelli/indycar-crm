/* ============================================================
   IndyCar CRM — servidor HTTP (Node puro, sem framework)
   API REST de leads + dashboard + resumo semanal com IA (Claude).
   ============================================================ */
'use strict';

const http = require('node:http');
const utils = require('./public/crm-utils');
let statsCache = null;
const statsEmCache = async () => { if (!statsCache || statsCache.expira < Date.now()) statsCache = { valor: await store.getStats(), expira: Date.now() + 60000 }; return statsCache.valor; };
const fs = require('node:fs');
const path = require('node:path');

/* Lê o arquivo .env da pasta do projeto, se existir. Evita depender de
   variáveis de ambiente do Windows (o `setx` exige acesso ao Registro,
   que costuma vir bloqueado). Variáveis já definidas no sistema têm
   prioridade — o .env só preenche o que estiver faltando. */
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    process.loadEnvFile(envPath);
    console.log('📄 Configuração lida de .env');
  }
} catch (e) {
  console.warn('⚠️  Não consegui ler o .env:', e.message);
}
/* Banco: Supabase (nuvem, compartilhado com a Agenda) ou SQLite local.
   Usa o Supabase automaticamente quando as variáveis estiverem definidas;
   force o local com CRM_DB=sqlite. */
const USA_SUPABASE = process.env.CRM_DB !== 'sqlite'
  && !!process.env.SUPABASE_URL
  && !!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY);

const store = USA_SUPABASE ? require('./db-supabase') : require('./db');
const { gerarResumoSemanal, montarBriefing } = require('./ia');
const { criarIACrm, ErroIA, planoAcao } = require('./lib/ia-crm');
const { criarAcesso } = require('./lib/acesso');
const { criarAuditoria } = require('./lib/auditoria');
const { criarEquipe } = require('./lib/equipe-crm');
const { criarTarefas } = require('./lib/tarefas');
const { criarAutomacoes } = require('./lib/automacoes');
const { rotasR3 } = require('./lib/rotas');
const SEG = require('./lib/seguranca');
const U = require('./lib/util-servidor');
const R4 = require('./lib/rodada4');
const ESTATICOS = R4.criarEstaticos({ fs });
const IDEM = R4.criarIdempotencia();
const VERSAO = (() => { try { return require('./package.json').version + '-r4'; } catch { return 'r4'; } })();

const PORT = process.env.PORT || 3100;
const PUBLIC = path.join(__dirname, 'public');

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
               '.js': 'text/javascript; charset=utf-8', '.png': 'image/png',
               '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
               // sem isto o manifesto sai como octet-stream e o navegador
               // pode recusar instalar o app
               '.json': 'application/json; charset=utf-8',
               '.webmanifest': 'application/manifest+json' };

/* Resposta JSON. Rodada 4: comprime (br/gzip) o que passa de 1 KB — a lista de
   leads cai de ~400 KB para ~40 KB — e guarda a resposta das escritas com chave
   de idempotência (a tela repete o pedido quando o Render está acordando). */
const json = (res, code, data) => {
  const buf = Buffer.from(JSON.stringify(data));
  if (res._idem) { res._idem.terminar(code, data); res._idem = null; }
  const { corpo, cod } = R4.corpoParaEnviar(res._req, buf, 'application/json');
  const vary = res.getHeader('Vary');
  const cab = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': corpo.length, Vary: vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding' };
  if (cod) cab['Content-Encoding'] = cod;
  res.writeHead(code, cab);
  res.end(res._req?.method === 'HEAD' ? undefined : corpo);
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    // corpo com conteúdo tem de ser JSON (formulário de outro site não passa)
    const tipo = String(req.headers['content-type'] || '');
    const temCorpo = Number(req.headers['content-length'] || 0) > 0 || !!req.headers['transfer-encoding'];
    if (temCorpo && !/^application\/json(\s*;|$)/i.test(tipo.trim())) {
      req.resume();
      return reject(Object.assign(new Error('Envie o corpo como JSON (Content-Type: application/json).'), { status: 415 }));
    }
    let raw = '', bytes = 0, excedeu = false;
    req.on('data', c => {
      bytes += c.length;
      if (bytes > 65536) { excedeu = true; return; }
      raw += c;
    });
    req.on('end', () => {
      if (excedeu) return reject(Object.assign(new Error('Corpo maior que 64 KB.'), { status: 413 }));
      if (!raw) return resolve({});
      let v;
      try { v = JSON.parse(raw); } catch { return reject(Object.assign(new Error('JSON inválido'), {status:400})); }
      // sempre um objeto: lista, número ou texto soltos não chegam às rotas
      if (!v || typeof v !== 'object' || Array.isArray(v)) return reject(Object.assign(new Error('O corpo precisa ser um objeto JSON.'), { status: 400 }));
      resolve(v);
    });
    req.on('error', reject);
  });
}

/* Estáticos (rodada 4): lidos do disco uma vez por versão, com ETag (304 quando
   não mudou) e já comprimidos em br/gzip. no-cache = o navegador sempre confere,
   mas a conferência sem mudança custa só os cabeçalhos. */
function serveStatic(req, res, urlPath) {
  let rel;
  try { rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath.slice(1)); } catch { res.writeHead(400).end('Pedido inválido'); return; }
  // impede path traversal
  const file = path.resolve(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403).end('Proibido'); return; }
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
  let item;
  const ext = path.extname(file);
  try {
    // a página ganha a CSP com o hash dos scripts embutidos (a API fica com default-src 'none')
    item = ESTATICOS.ler(file, ext === '.html' ? raw => ({ csp: SEG.cspPagina({ hashes: SEG.hashesScripts(raw.toString('utf8')), supabaseUrl: SUPABASE_URL }) }) : null);
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Não encontrado'); return; }
  const tipo = MIME[ext] || 'application/octet-stream';
  const cab = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache', 'Content-Type': tipo, ETag: item.etag, Vary: 'Accept-Encoding' };
  if (item.csp) cab['Content-Security-Policy'] = item.csp;
  const inm = String(req.headers['if-none-match'] || '');
  // o proxy do Render devolve a ETag como fraca (W/"..."): compara sem o W/
  if (inm && inm.split(/\s*,\s*/).map(x => x.replace(/^W\//, '')).includes(item.etag)) { res.writeHead(304, cab); res.end(); return; }
  const { corpo, cod } = R4.COMPRIMIVEL_TIPO(tipo) ? ESTATICOS.versao(item, R4.codificacao(req)) : { corpo: item.raw, cod: null };
  if (cod) cab['Content-Encoding'] = cod;
  cab['Content-Length'] = corpo.length;
  res.writeHead(200, cab);
  res.end(req.method === 'HEAD' ? undefined : corpo);
}

/* ------------------------------------------------------------
   Porteiro — o CRM guarda dados de clientes e credenciais de
   Meta/Google. Publicado na internet, não pode ficar aberto.
   O navegador faz login no Supabase Auth (mesma conta do app de
   Atendimento) e manda o token; aqui a gente confere se ele é
   válido E se o perfil ainda está ativo.
   ------------------------------------------------------------ */
const SUPABASE_URL      = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SERVICE_KEY       = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';

/* Cliente com poderes de servidor (ignora RLS). Precisamos dele para mexer em
   perfis, equipe e catálogo — coisas que a tela nunca pode fazer sozinha.
   Fica guardado: criar um cliente novo a cada requisição é desperdício. */
let SB_ADMIN = null;
function adminSupabase() {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  if (!SB_ADMIN) {
    const { createClient } = require('@supabase/supabase-js');
    SB_ADMIN = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  }
  return SB_ADMIN;
}

/** Texto vindo de fora: só aceita string/número e corta no limite.
    Objetos e arrays viram vazio, para não gravar lixo no banco. */
function texto1(v, max) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return '';
  return String(v).slice(0, max);
}

const ehUuid = v =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v ?? ''));

/* Freio por pessoa/IP (lib/seguranca): limpa sozinho as chaves vencidas. */
const FREIO = SEG.criarFreio();
const dentroDoLimite = (chave, teto, janelaMs) => FREIO.dentro(chave, teto, janelaMs);

/* Porteiro (lib/acesso): token válido + perfil ativo + papel da equipe +
   'crm' em perfis.apps (admin sempre). 401/403 com codigo. Grava o último
   acesso no máximo a cada 5 min. */
let ACESSO = null;
function acesso() {
  if (!ACESSO) ACESSO = criarAcesso({ supabaseUrl: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY, sb: adminSupabase(), fetch, log: (...a) => console.warn('[acesso]', ...a) });
  return ACESSO;
}

/* Auditoria, equipe, tarefas e automações (só no banco compartilhado). */
let AUDITAR = null, EQUIPE = null, TAREFAS = null, AUTOMACOES = null;
const auditar = (...a) => { if (!AUDITAR) AUDITAR = criarAuditoria({ sb: USA_SUPABASE ? adminSupabase() : null, log: (...x) => console.warn('[auditoria]', ...x) }); return AUDITAR(...a); };
function equipe() { if (!EQUIPE && USA_SUPABASE && adminSupabase()) EQUIPE = criarEquipe({ sb: adminSupabase(), auditar, log: (...a) => console.warn('[equipe]', ...a) }); return EQUIPE; }
function tarefas() { if (!TAREFAS && USA_SUPABASE && adminSupabase()) TAREFAS = criarTarefas({ sb: adminSupabase(), auditar }); return TAREFAS; }
function automacoes() {
  if (!AUTOMACOES && USA_SUPABASE && adminSupabase()) AUTOMACOES = criarAutomacoes({ sb: adminSupabase(), equipe: equipe(), tarefas: tarefas(), auditar, planoAcao,
    opcoes: { rodizio: process.env.CRM_RODIZIO !== '0' }, log: (...a) => console.warn('[automações]', ...a) });
  return AUTOMACOES;
}
const AUTOMACOES_LIGADAS = process.env.CRM_AUTOMACOES !== '0';
const INTERVALO_MIN = Math.max(5, Math.min(240, Number(process.env.CRM_AUTOMACOES_MIN) || 15));
const TOKEN_AGENDADOR = process.env.CRM_AGENDADOR_TOKEN || '';
/* Na nuvem o IP verdadeiro vem do proxy do Render (x-forwarded-for). */
const ATRAS_DE_PROXY = !!process.env.RENDER || process.env.CRM_ATRAS_DE_PROXY === '1';
const CORS_OK = SEG.origensPermitidas({ extra: process.env.CRM_CORS_EXTRA, local: !process.env.RENDER });
const ipDe = req => SEG.ipDe(req, { atrasDeProxy: ATRAS_DE_PROXY });

/* ------------------------------------------------------------
   IA DO CRM — criada sob demanda (precisa do banco compartilhado)
   ------------------------------------------------------------ */
let IA_CRM = null;
function iaCrm() {
  if (!USA_SUPABASE) return null;
  if (!IA_CRM) {
    const sb = adminSupabase();
    if (!sb) return null;
    IA_CRM = criarIACrm({ sb, store, tarefas: tarefas(), log: (...a) => console.warn('[ia-crm]', ...a) });
  }
  return IA_CRM;
}
/** Erro da IA vira resposta clara; o resto não vaza detalhe interno. */
function erroIA(res, e) {
  if (e instanceof ErroIA || (e && e.status && e.status < 600)) {
    return json(res, e.status || 500, { erro: e.message, ...(e.precisaConfirmar ? { precisaConfirmar: true } : {}) });
  }
  console.error('IA do CRM:', e && e.message);
  return json(res, 500, { erro: 'A IA do CRM falhou. Tente de novo.' });
}

/* ------------------------------------------------------------
   BASE COMPARTILHADA DE CLIENTES
   A tabela `clientes` é a mesma da Agenda e do Atendimento. Aqui a
   gente costura cliente + leads + agendamentos para montar a ficha
   360: quanto já gastou, o que já fez e o histórico recente.
   ------------------------------------------------------------ */
const semAcento = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const normaliza = s => semAcento(s).replace(/[^a-z0-9]+/g, ' ').trim();
const soDigitos  = s => String(s ?? '').replace(/\D/g, '');
/* Chave de telefone: os últimos 8 dígitos. Ignora DDI, DDD escrito de jeitos
   diferentes e o nono dígito que às vezes vem e às vezes não. */
const chaveTel = s => { const d = soDigitos(s); return d.length >= 8 ? d.slice(-8) : d; };
const nDinheiro = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Lê clientes + leads + agendamentos de uma vez e devolve tudo já ligado. */
/* Rodada 4: a base passou de 1.000 clientes (2.464) e o Supabase corta cada
   consulta em 1.000 linhas — a busca não achava quem estava depois do milésimo.
   Agora lê de 1.000 em 1.000 (ordem estável pelo id) e guarda 30 s: a busca
   por letra não relê as três tabelas a cada tecla. */
let CLIENTES_CACHE = null;
const CLIENTES_CACHE_MS = Number(process.env.CRM_CACHE_CLIENTES_MS ?? 30000);
async function carregarBaseClientes() {
  if (CLIENTES_CACHE && CLIENTES_CACHE.expira > Date.now()) return CLIENTES_CACHE.valor;
  if (CLIENTES_CACHE?.lendo) return CLIENTES_CACHE.lendo;
  const lendo = montarBaseClientes();
  CLIENTES_CACHE = { lendo, expira: 0 };
  try { const valor = await lendo; if (CLIENTES_CACHE?.lendo === lendo) CLIENTES_CACHE = { valor, expira: Date.now() + CLIENTES_CACHE_MS }; return valor; }
  catch (e) { if (CLIENTES_CACHE?.lendo === lendo) CLIENTES_CACHE = null; throw e; }
}
async function montarBaseClientes() {
  const sb = adminSupabase();
  if (!sb) throw new Error('Servidor sem a chave do banco configurada.');

  const [rc, rl, ra] = await Promise.all([
    U.todas(() => sb.from('clientes')
      .select('id,nome,telefone,email,carro_modelo,carro_ano,placa,origem,observacoes,created_at,nascimento,aceita_mensagens,aceita_mensagens_em')
      .order('id')),
    U.todas(() => sb.from('leads')
      .select('id,cliente_id,nome,telefone,servico,valor_orcado,valor_pago,status,origem,utm_campaign,observacoes,created_at,closed_at')
      .order('id')),
    U.todas(() => sb.from('agendamentos')
      .select('id,cliente_id,lead_id,cliente_nome,telefone,servico,veiculo,placa,data,hora,status,valor,origem,compareceu,created_at')
      .order('id')),
  ]);
  for (const r of [rc, rl, ra]) if (r.error) throw new Error(r.error.message);

  const clientes = (rc.data || []).sort((a, b) => String(a.nome ?? '').localeCompare(String(b.nome ?? ''), 'pt-BR'));
  const leads = (rl.data || []).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const agendamentos = (ra.data || []).sort((a, b) => String(b.data).localeCompare(String(a.data)));

  // índice por id e por telefone — registros antigos podem não ter cliente_id
  const porId  = new Map(clientes.map(c => [c.id, c]));
  const porTel = new Map();
  for (const c of clientes) {
    const k = chaveTel(c.telefone);
    if (k && !porTel.has(k)) porTel.set(k, c);
  }
  const donoDe = r => {
    if (r.cliente_id && porId.has(r.cliente_id)) return porId.get(r.cliente_id).id;
    const k = chaveTel(r.telefone);
    return (k && porTel.get(k)?.id) || null;
  };

  const fichas = new Map(clientes.map(c => [c.id, {
    cliente: c, leads: [], agendamentos: [],
    gasto: 0, emAberto: 0, servicos: new Map(), ultimoContato: c.created_at,
  }]));

  for (const l of leads) {
    const id = donoDe(l);
    const f = id && fichas.get(id);
    if (!f) continue;
    f.leads.push(l);
    if (l.status === 'concluido') {
      f.gasto += nDinheiro(l.valor_pago);
      if (l.servico) f.servicos.set(l.servico, (f.servicos.get(l.servico) || 0) + 1);
    } else if (l.status !== 'perdido') {
      f.emAberto += nDinheiro(l.valor_orcado);
    }
    if (l.created_at > f.ultimoContato) f.ultimoContato = l.created_at;
  }

  for (const a of agendamentos) {
    const id = donoDe(a);
    const f = id && fichas.get(id);
    if (!f) continue;
    f.agendamentos.push(a);
    if (a.status === 'concluido') {
      // Agendamento que nasceu de um lead já teve o valor contado no lead
      // (o gatilho copia o pago para lá). Somar de novo dobraria o gasto.
      if (!a.lead_id) f.gasto += nDinheiro(a.valor);
      if (a.servico) f.servicos.set(a.servico, (f.servicos.get(a.servico) || 0) + 1);
    }
    if (a.created_at > f.ultimoContato) f.ultimoContato = a.created_at;
  }

  return fichas;
}

/** Filtra a base por nome, telefone, placa ou carro — sem acento e sem pontuação. */
function filtrarClientes(fichas, q) {
  const termo = normaliza(q);
  const dig = soDigitos(q);
  const tel = dig.length >= 4 ? chaveTel(q) : null;
  const placa = semAcento(q).replace(/[^a-z0-9]/g, '');

  const lista = [...fichas.values()];
  if (!termo) return lista;

  return lista.filter(f => {
    const c = f.cliente;
    const texto = normaliza([c.nome, c.telefone, c.placa, c.carro_modelo, c.email].join(' '));
    if (texto.includes(termo)) return true;
    if (tel && chaveTel(c.telefone) === tel) return true;
    if (placa && semAcento(c.placa).replace(/[^a-z0-9]/g, '').includes(placa)) return true;
    return false;
  });
}

const server = http.createServer(async (req, res) => {
  try {
    // dentro do try: um Host malformado faria o parser de URL lançar
    let url;
    try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); }
    catch { return json(res, 400, { erro: 'requisição malformada' }); }
    const { pathname } = url;
    res._req = req;
    SEG.aplicarCabecalhos(res, { https: NA_NUVEM });

    // ---------- API ----------
    if (pathname.startsWith('/api/')) {
      if (SEG.tratarCors(req, res, CORS_OK)) return;
      const ip = ipDe(req);
      // freio geral por IP e bloqueio de quem erra o login sem parar
      if (!dentroDoLimite(`ip:${ip}`, 3000, 300_000)) return json(res, 429, { erro: 'Muitos pedidos deste endereço. Espere alguns minutos.', codigo: 'limite' });
      if (FREIO.estourou(`login-falhou:${ip}`, 40)) return json(res, 429, { erro: 'Muitas tentativas sem login válido. Espere alguns minutos.', codigo: 'limite' });
      if (!['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) return json(res, 405, { erro: 'método não permitido' });

      // A tela precisa saber onde fica o Supabase para montar o login.
      // A chave publicável é pública por design.
      /* Rodada 4: ping sem login e barato. A tela chama para acordar o Render
         enquanto a pessoa digita a senha e para saber quando o servidor voltou. */
      if (pathname === '/api/ping' && (req.method === 'GET' || req.method === 'HEAD')) {
        return json(res, 200, { ok: true, versao: VERSAO, hora: new Date().toISOString(), noArDesde: NO_AR_DESDE });
      }

      if (pathname === '/api/config' && req.method === 'GET') {
        return json(res, 200, {
          supabaseUrl: SUPABASE_URL,
          supabaseAnonKey: SUPABASE_ANON_KEY,
          configurado: !!(SUPABASE_URL && SUPABASE_ANON_KEY && SERVICE_KEY),
          iaConfigurada: !!process.env.ANTHROPIC_API_KEY,
        });
      }

      /* ============================================================
         PRIMEIRO ACESSO — enquanto o sistema não tem NINGUÉM
         Fica acima do porteiro de propósito: quem vai criar a primeira
         conta ainda não tem como fazer login. Assim que existir um
         perfil, esta porta fecha sozinha.
         ============================================================ */
      if (pathname === '/api/primeiro-acesso' && req.method === 'GET') {
        const sb = adminSupabase();
        if (!sb) return json(res, 503, { aberto: false, erro: 'Servidor sem a chave do banco.' });
        const { count } = await sb.from('perfis').select('id', { count: 'exact', head: true });
        return json(res, 200, { aberto: (count ?? 0) === 0 });
      }

      if (pathname === '/api/primeiro-acesso' && req.method === 'POST') {
        const sb = adminSupabase();
        if (!sb) return json(res, 503, { erro: 'Servidor sem a chave do banco configurada.' });

        // Ninguém precisa estar logado para chegar aqui, então o freio é o IP
        if (!dentroDoLimite(`primeiro:${ip}`, 5, 600_000)) {
          return json(res, 429, { erro: 'Muitas tentativas. Espere alguns minutos.' });
        }

        const { count } = await sb.from('perfis').select('id', { count: 'exact', head: true });
        if ((count ?? 0) > 0) {
          return json(res, 403, {
            erro: 'O sistema já tem gente cadastrada. Peça ao administrador para criar o seu acesso.' });
        }

        const bruto = await readBody(req);
        const nome  = texto1(bruto.nome, 80).trim();
        const email = texto1(bruto.email, 160).trim().toLowerCase();
        const senha = texto1(bruto.senha, 200);

        if (!nome) return json(res, 400, { erro: 'Informe o seu nome.' });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
          return json(res, 400, { erro: 'Esse e-mail não parece válido.' });
        }
        if (senha.length < 8) {
          return json(res, 400, { erro: 'A senha precisa ter pelo menos 8 caracteres.' });
        }

        /* Criado aqui, com a chave de serviço, e não por signUp na tela: o
           Supabase exige confirmação por e-mail e recusa endereço de domínio
           próprio ("Email address is invalid"). email_confirm já entra valendo. */
        const { data, error } = await sb.auth.admin.createUser({
          email, password: senha, email_confirm: true, user_metadata: { nome },
        });
        if (error) {
          const jaExiste = /already been registered|already exists/i.test(error.message);
          return json(res, jaExiste ? 409 : 400, {
            erro: jaExiste ? 'Já existe uma conta com esse e-mail. Tente entrar por ela.'
                           : 'Não consegui criar a conta. Confira o e-mail e a senha.' });
        }

        /* O gatilho do banco já marca o primeiro cadastro como admin. Reforçado
           aqui porque uma corrida entre dois cadastros simultâneos poderia
           deixar o dono como atendente no próprio sistema. */
        await sb.from('perfis').update({ nome, papel: 'admin', ativo: true }).eq('id', data.user.id);
        await auditar({ id: data.user.id }, 'primeiro_acesso', { tabela: 'perfis', registro: data.user.id, detalhes: { email } });
        return json(res, 201, { ok: true, email });
      }

      /* Agendador externo (o Render gratuito dorme): POST /api/automacoes/rodar
         com o cabeçalho x-agendador-token = CRM_AGENDADOR_TOKEN. Sem login. */
      if (pathname === '/api/automacoes/rodar' && req.method === 'POST' && req.headers['x-agendador-token'] !== undefined) {
        if (!TOKEN_AGENDADOR) return json(res, 503, { erro: 'Agendador não configurado (CRM_AGENDADOR_TOKEN).' });
        if (!SEG.segredoConfere(req.headers['x-agendador-token'], TOKEN_AGENDADOR)) {
          FREIO.contar(`login-falhou:${ip}`, 40, 600_000);
          return json(res, 401, { erro: 'Token do agendador inválido.', codigo: 'agendador_invalido' });
        }
        const a = automacoes();
        if (!a) return json(res, 503, { erro: 'Automações só com o banco compartilhado.' });
        if (!dentroDoLimite('agendador', 12, 600_000)) return json(res, 429, { erro: 'O agendador está chamando rápido demais.' });
        const b = await readBody(req);
        const r = await a.ciclo({ origem: 'agendador', regras: b.regras });
        return json(res, r.ocupado ? 409 : 200, r);
      }

      // Daqui para baixo, só com login válido (papel da equipe + 'crm' nos apps).
      const porta = await acesso().autenticar(req);
      if (!porta.ok) {
        // só token recusado pelo Auth conta (sessão vencida é normal e a loja divide o mesmo IP)
        if (porta.codigo === 'sessao_invalida') FREIO.contar(`login-falhou:${ip}`, 40, 600_000);
        return json(res, porta.status, { erro: porta.erro, codigo: porta.codigo, ...(porta.apps ? { apps: porta.apps } : {}) });
      }
      const quem = porta.usuario;
      const ehAdmin = quem.papel === 'admin';
      const ehGestor = U.ehGestor(quem.papel);
      if (!dentroDoLimite(`pessoa:${quem.id}`, 900, 300_000)) return json(res, 429, { erro: 'Muitos pedidos seguidos. Espere um pouco.', codigo: 'limite' });
      if (pathname === '/api/saude' && req.method === 'GET') {
        const sb = adminSupabase();
        if (!sb) return json(res, 503, {erro:'Saúde indisponível.'});
        const {data,error} = await sb.from('vigia_estado').select('problema,desde,ultimo_resumo');
        if (error) return json(res,503,{erro:'Não foi possível consultar a saúde.'});
        // status da IA junto: a tela mostra se ela está ligada e quanto já usou hoje
        let ia = { configurada: !!process.env.ANTHROPIC_API_KEY, ativo: false };
        try { const u = await iaCrm()?.uso(); if (u) ia = { configurada: u.configurada, ativo: u.ativo, autonomia: u.autonomia, hoje: u.hoje, limite: u.limite }; } catch { ia.indisponivel = true; }
        return json(res,200,{avisos:(data || []).filter(x => x.problema).map(x => ({problema:texto1(x.problema,240),desde:x.desde})), ia});
      }
      if (req.method !== 'GET') statsCache = null;

      /* Idempotência (rodada 4): a mesma escrita repetida com a mesma chave
         devolve a primeira resposta, sem fazer a ação duas vezes. */
      const chaveIdem = IDEM.chaveDe(req, quem.id);
      if (chaveIdem) {
        let r = IDEM.comecar(chaveIdem);
        if (r.aguardar) { const prim = await r.aguardar; if (prim) { req.resume(); return json(res, prim.status, prim.corpo); } r = IDEM.comecar(chaveIdem); }
        if (r.repetida) { req.resume(); res.setHeader('x-idempotencia-repetida', '1'); return json(res, r.repetida.status, r.repetida.corpo); }
        if (r.entrada) res._idem = r.entrada;
      }
      const limparTudo = () => { statsCache = null; CLIENTES_CACHE = null; store.esquecerCache?.(); };
      if (req.method !== 'GET') { CLIENTES_CACHE = null; }

      /* Rodada 4: valor pago (sem valor + lote) e distribuição em lote. */
      if (await R4.rotasR4({ req, res, url, pathname, quem, json, lerCorpo: () => readBody(req), freio: FREIO, auditar,
        equipe: equipe(), sb: USA_SUPABASE ? adminSupabase() : null, limparStats: limparTudo })) return;

      /* Rodada 3: eu, vendedores, responsável, rodízio, desempenho, metas,
         tarefas, automações, auditoria, equipe (apps / recebe leads / senha). */
      if (await rotasR3({ req, res, url, pathname, quem, json, lerCorpo: () => readBody(req), freio: FREIO, auditar,
        acesso: acesso(), equipe: equipe(), tarefas: tarefas(), automacoes: automacoes(), sb: USA_SUPABASE ? adminSupabase() : null,
        automacoesLigadas: AUTOMACOES_LIGADAS && USA_SUPABASE, intervaloMin: INTERVALO_MIN, tokenAgendador: !!TOKEN_AGENDADOR,
        limparStats: limparTudo })) return;

      /* ============================================================
         IA DO CRM — /api/ia/*  (login exigido acima; toda ação em ia_acoes)
         ============================================================ */
      if (pathname === '/api/lead-por-telefone' && req.method === 'GET') {
        if (!store.leadsPorTelefone) return json(res, 503, { erro: 'Disponível no banco compartilhado.' });
        // aceita ?t= e ?tel= ; 'lead' = o aberto (ou o mais recente), para abrir a ficha direto
        try { const r = await store.leadsPorTelefone(url.searchParams.get('t') || url.searchParams.get('tel') || ''); return json(res, 200, { ...r, lead: r.aberto || r.leads[0] || null }); }
        catch (e) { return erroIA(res, e); }
      }

      if (pathname.startsWith('/api/ia/')) {
        const ia = iaCrm();
        if (!ia) return json(res, 503, { erro: 'A IA do CRM precisa do banco compartilhado (Supabase).' });
        // freio por pessoa nas rotas que chamam a Claude
        const chamaIA = req.method === 'POST' && /^\/api\/ia\/(lead\/[^/]+\/(proxima-acao|qualificar|preencher)|triagem|perguntar)$/.test(pathname);
        if (chamaIA && !dentroDoLimite(`ia:${quem.id}`, 40, 600_000)) {
          return json(res, 429, { erro: 'Muitos pedidos à IA em pouco tempo. Espere alguns minutos.' });
        }
        try {
          if (pathname === '/api/ia/uso' && req.method === 'GET') return json(res, 200, await ia.uso());
          if (pathname === '/api/ia/acoes' && req.method === 'GET') {
            const leadId = url.searchParams.get('leadId') || undefined;
            return json(res, 200, { acoes: await ia.listarAcoes({ leadId, limite: Number(url.searchParams.get('limite')) || 30 }) });
          }
          const ml = pathname.match(/^\/api\/ia\/lead\/([^/]+)\/(contexto|proxima-acao|qualificar|preencher)$/);
          if (ml) {
            const [, leadId, oque] = ml;
            if (!ehUuid(leadId)) return json(res, 400, { erro: 'Lead inválido.' });
            if (oque === 'contexto' && req.method === 'GET') {
              const ctx = await ia.contexto.montar({ leadId });
              return ctx ? json(res, 200, ctx) : json(res, 404, { erro: 'Lead não encontrado.' });
            }
            if (req.method !== 'POST') return json(res, 405, { erro: 'método não permitido' });
            if (oque === 'proxima-acao') return json(res, 200, await ia.proximaAcao(leadId, quem));
            if (oque === 'qualificar') return json(res, 200, await ia.qualificar(leadId, quem));
            if (oque === 'preencher') return json(res, 200, await ia.preencher(leadId, quem));
          }
          if (pathname === '/api/ia/triagem' && req.method === 'POST') {
            const b = await readBody(req);
            return json(res, 200, await ia.triagem({ dias: b.dias, limite: b.limite, usarIA: b.usarIA !== false }, quem));
          }
          if (pathname === '/api/ia/perguntar' && req.method === 'POST') {
            const b = await readBody(req);
            if (typeof b.pergunta !== 'string') return json(res, 400, { erro: 'Escreva a pergunta.' });
            return json(res, 200, await ia.perguntar(b.pergunta, quem));
          }
          if (pathname === '/api/ia/triagem/tarefas' && req.method === 'POST') {
            const b = await readBody(req);
            const r = await ia.tarefasDaTriagem(b.ids, quem);
            if (r.criadas) await auditar(quem, 'ia_tarefas_triagem', { tabela: 'tarefas', detalhes: { criadas: r.criadas } });
            return json(res, 200, r);
          }
          if (pathname === '/api/ia/acoes/executar-lote' && req.method === 'POST') {
            const b = await readBody(req);
            const ids = Array.isArray(b.ids) ? [...new Set(b.ids.filter(ehUuid))] : [];
            if (!ids.length || ids.length > 30) return json(res, 400, { erro: 'Escolha de 1 a 30 ações.' });
            const resultados = [];
            for (const id of ids) {           // em série: cada uma confere o lead de novo
              try { resultados.push({ id, ...(await ia.executar(id, quem, { confirmarFaturamento: b.confirmarFaturamento === true })) }); }
              catch (e) { resultados.push({ id, ok: false, erro: e.message, status: e.status || 500, precisaConfirmar: !!e.precisaConfirmar }); }
            }
            await auditar(quem, 'ia_executar_lote', { tabela: 'ia_acoes', detalhes: { ok: resultados.filter(r => r.ok).map(r => r.id), falhas: resultados.filter(r => !r.ok).length, confirmouFaturamento: b.confirmarFaturamento === true } });
            return json(res, 200, { resultados, ok: resultados.filter(r => r.ok).length, falhas: resultados.filter(r => !r.ok).length });
          }
          const ma = pathname.match(/^\/api\/ia\/acoes\/([^/]+)\/(executar|recusar|desfazer)$/);
          if (ma && req.method === 'POST') {
            const [, id, oque] = ma;
            if (!ehUuid(id)) return json(res, 400, { erro: 'Ação inválida.' });
            const b = await readBody(req);
            if (oque === 'executar') {
              const r = await ia.executar(id, quem, { confirmarFaturamento: b.confirmarFaturamento === true });
              await auditar(quem, 'ia_executar', { tabela: 'ia_acoes', registro: id, detalhes: { mudou: r.mudou, tarefa: r.tarefa?.id || null, confirmouFaturamento: b.confirmarFaturamento === true } });
              return json(res, 200, r);
            }
            if (oque === 'recusar') return json(res, 200, await ia.recusar(id, quem, b.motivo));
            // desfazer: quem executou, ou admin/gestor
            if (!ehGestor) {
              const dono = await ia.donoDaAcao(id);
              if (dono && dono !== quem.id) return json(res, 403, { erro: 'Só quem executou (ou um gestor) pode desfazer.' });
            }
            const r = await ia.desfazer(id, quem);
            await auditar(quem, 'ia_desfazer', { tabela: 'ia_acoes', registro: id });
            return json(res, 200, r);
          }
          return json(res, 404, { erro: 'rota da IA não encontrada' });
        } catch (e) { return erroIA(res, e); }
      }

      // GET /api/leads?status=&origem=&q=
      if (pathname === '/api/leads' && req.method === 'GET') {
        // responsável: ?minhas=1 | ?responsavel=eu|nenhum|<uuid>
        let responsavel = url.searchParams.get('responsavel') || undefined;
        if (url.searchParams.get('minhas') === '1' || responsavel === 'eu') responsavel = quem.id;
        if (responsavel && responsavel !== 'nenhum' && !U.ehUuid(responsavel)) return json(res, 400, { erro: 'Responsável inválido.' });
        const q = url.searchParams.get('q') || undefined;
        if (q && q.length > 120) return json(res, 400, { erro: 'Busca longa demais.' });
        return json(res, 200, await store.listLeads({
          status: url.searchParams.get('status') || undefined,
          origem: url.searchParams.get('origem') || undefined,
          q, responsavel,
        }));
      }

      // POST /api/leads
      if (pathname === '/api/leads' && req.method === 'POST') {
        const body = await readBody(req);
        const falha = utils.validarLead(body); if (falha) return json(res,400,{erro:falha});
        if (!dentroDoLimite(`criar-lead:${quem.id}`, 60, 60_000)) return json(res, 429, { erro: 'Muitos leads seguidos. Espere um minuto.' });
        /* O gatilho do banco põe como responsável quem cuida da conversa do
           cliente; sem conversa, quem criou. Aqui o servidor fala com a chave de
           serviço (auth.uid() vazio), então mandamos quem criou explicitamente. */
        let responsavel_id = quem.id;
        if (body.responsavel_id !== undefined && body.responsavel_id !== quem.id) {
          if (body.responsavel_id === null) responsavel_id = null;
          else if (!U.ehUuid(body.responsavel_id) || !equipe() || !(await equipe().vendedor(body.responsavel_id))) return json(res, 400, { erro: 'Essa pessoa não pode receber leads do CRM.' });
          else responsavel_id = body.responsavel_id;
        }
        const novo = await store.createLead({ ...body, responsavel_id: USA_SUPABASE ? responsavel_id : undefined });
        if (novo && ['concluido', 'perdido'].includes(novo.status)) await auditar(quem, 'lead_fechado', { tabela: 'leads', registro: novo.id, detalhes: { de: null, para: novo.status, valor_pago: novo.valor_pago } });
        return json(res, 201, novo);
      }

      // /api/leads/:id  (PATCH | DELETE | GET)
      // aceita id numérico (SQLite) OU uuid (Supabase)
      const m = pathname.match(/^\/api\/leads\/([0-9a-fA-F-]{1,36})$/);
      if (m) {
        const id = /^\d+$/.test(m[1]) ? Number(m[1]) : m[1];
        if (req.method === 'GET') {
          const lead = await store.getLead(id);
          return lead ? json(res, 200, lead) : json(res, 404, { erro: 'lead não encontrado' });
        }
        if (req.method === 'PATCH') {
          const body = await readBody(req); const falha = utils.validarLead(body,true); if (falha) return json(res,400,{erro:falha});
          const antes = await store.getLead(id);
          if (!antes) return json(res, 404, { erro: 'lead não encontrado' });
          const updated = await store.updateLead(id, body);
          if (!updated) return json(res, 404, { erro: 'lead não encontrado' });
          // auditoria: fechamento (concluído/perdido), reabertura e mudança de valores
          if (updated.status !== antes.status && ['concluido', 'perdido'].includes(updated.status)) {
            await auditar(quem, 'lead_fechado', { tabela: 'leads', registro: id, detalhes: { de: antes.status, para: updated.status, valor_pago: Number(updated.valor_pago) || 0 } });
          } else if (updated.status !== antes.status && ['concluido', 'perdido'].includes(antes.status)) {
            await auditar(quem, 'lead_reaberto', { tabela: 'leads', registro: id, detalhes: { de: antes.status, para: updated.status } });
          }
          const valores = ['valor_orcado', 'valor_pago'].filter(k => Number(antes[k] || 0) !== Number(updated[k] || 0));
          if (valores.length) await auditar(quem, 'lead_valores', { tabela: 'leads', registro: id, detalhes: Object.fromEntries(valores.map(k => [k, { antes: Number(antes[k]) || 0, depois: Number(updated[k]) || 0 }])) });
          return json(res, 200, updated);
        }
        if (req.method === 'DELETE') {
          // apagar é só de gestor/admin (mesma regra do banco para o navegador)
          if (!ehGestor) return json(res, 403, { erro: 'Só um gestor pode apagar leads.', codigo: 'so_gestor' });
          const antes = await store.getLead(id);
          if (!antes) return json(res, 404, { erro: 'lead não encontrado' });
          if (!(await store.deleteLead(id))) return json(res, 404, { erro: 'lead não encontrado' });
          await auditar(quem, 'apagar_lead', { tabela: 'leads', registro: id, detalhes: { nome: antes.nome, status: antes.status, origem: antes.origem, valor_orcado: antes.valor_orcado, valor_pago: antes.valor_pago, responsavel_id: antes.responsavel_id || null } });
          return json(res, 200, { ok: true });
        }
        return json(res, 405, { erro: 'método não permitido' });
      }

      // GET /api/stats
      if (pathname === '/api/stats' && req.method === 'GET') {
        return json(res, 200, await statsEmCache());
      }

      // POST /api/resumo-ia  → resumo semanal gerado pela Claude
      if (pathname === '/api/resumo-ia' && req.method === 'POST') {
        const b = await readBody(req);
        const periodo = b.periodo === 'mes' ? 'mes' : 'semana';
        const ia = iaCrm();
        if (!ia) {
          const resultado = await gerarResumoSemanal(await store.weeklyData(), { periodo: 'semana' });
          return json(res, resultado.ok ? 200 : 503, resultado);
        }
        if (!dentroDoLimite(`ia:${quem.id}`, 40, 600_000)) return json(res, 429, { erro: 'Muitos pedidos à IA em pouco tempo. Espere alguns minutos.' });
        try {
          const cfg = await ia.config();
          const dados = await ia.dadosResumo(periodo);
          if (!cfg.ativo) return json(res, 503, { ok: false, erro: 'A IA está desligada nas configurações.', briefing: montarBriefing({ ...dados, periodo }) });
          const u = await ia.uso();
          if (u.restante <= 0) return json(res, 429, { ok: false, erro: 'Limite diário da IA atingido.' });
          const resultado = await gerarResumoSemanal(dados, { periodo, modelo: cfg.modelo_forte, clienteIA: ia.obterIA() });
          await ia.registrar({ tipo: 'crm_resumo', status: resultado.ok ? 'executada' : 'erro', perfil_id: quem.id,
            executada_em: resultado.ok ? new Date().toISOString() : null, modelo: resultado.modelo || cfg.modelo_forte,
            tokens_entrada: resultado.tokens?.entrada || 0, tokens_saida: resultado.tokens?.saida || 0, duracao_ms: resultado.duracaoMs || null,
            entrada: { periodo }, resumo: `Resumo ${periodo === 'mes' ? 'mensal' : 'semanal'}`, erro: resultado.ok ? null : String(resultado.erro || '').slice(0, 300),
            saida: resultado.ok ? { truncado: resultado.truncado, tamanho: resultado.resumo.length } : null });
          return json(res, resultado.ok ? 200 : 503, resultado);
        } catch (e) { return erroIA(res, e); }
      }

      /* /api/seed foi REMOVIDA de propósito.
         Ela apagava TODOS os leads para inserir 10 de exemplo. Foi o que
         encheu o CRM de 56 cadastros inventados, misturados aos reais —
         mesmo nome com vários telefones, telefone com espaço sobrando.
         Ficava atrás de admin + CRM_PERMITE_SEED=1, mas com a oficina
         atendendo de verdade não existe motivo para essa porta continuar
         no prédio: o banco é o mesmo do Atendimento e da Agenda, e não há
         desfazer. Se um dia precisar de massa de teste, use um projeto
         Supabase separado. */
      if (pathname === '/api/seed' && req.method === 'POST') {
        return json(res, 410, {
          erro: 'Esta função saiu do sistema. Ela apagava todos os leads para '
              + 'criar exemplos, e o CRM agora tem cliente de verdade.' });
      }

      // ---------- Integrações de mídia (Meta Ads / Google Ads) ----------
      // GET /api/integracoes → credenciais MASCARADAS + status de cada canal
      if (pathname === '/api/integracoes' && req.method === 'GET') {
        return json(res, 200, { canais: await store.getIntegracoes() });
      }

      // PATCH /api/integracoes/:canal → salva credenciais (segredo em branco/máscara é ignorado)
      // DELETE /api/integracoes/:canal → apaga as credenciais do canal
      const mi = pathname.match(/^\/api\/integracoes\/([a-z]+)$/);
      if (mi) {
        const canal = mi[1];
        if (!store.CANAIS_INTEGRACAO.includes(canal)) {
          return json(res, 404, { erro: 'canal desconhecido' });
        }
        // Credenciais de Meta e Google são segredo da oficina: só admin mexe.
        if (req.method === 'PATCH' || req.method === 'DELETE') {
          if (!ehAdmin) {
            return json(res, 403, { erro: 'Só o administrador mexe nas integrações.' });
          }
        }
        if (req.method === 'PATCH') {
          const b = await readBody(req);
          const r = await store.salvarIntegracao(canal, b);
          await auditar(quem, 'integracao_salvar', { tabela: 'integracoes_ads', registro: canal, detalhes: { campos: Object.keys(b).slice(0, 20) } });
          return json(res, 200, r);
        }
        if (req.method === 'DELETE') {
          const r = await store.limparIntegracao(canal);
          await auditar(quem, 'integracao_apagar', { tabela: 'integracoes_ads', registro: canal });
          return json(res, 200, r);
        }
        return json(res, 405, { erro: 'método não permitido' });
      }

      // GET /api/roi?competencia=AAAA-MM → investimento × faturamento real por canal
      if (pathname === '/api/roi' && req.method === 'GET') {
        return json(res, 200, await store.getROI(url.searchParams.get('competencia') || undefined));
      }

      // POST /api/metricas → grava investimento/cliques do mês (entrada manual)
      if (pathname === '/api/metricas' && req.method === 'POST') {
        // mexe no investimento e, com ele, no ROI de todo mundo
        if (!ehAdmin) {
          return json(res, 403, { erro: 'Só o administrador registra investimento.' });
        }
        const dados = await readBody(req);
        if (!dados || !dados.canal) return json(res, 400, { erro: 'informe o canal' });
        const roi = await store.salvarMetrica(dados);
        await auditar(quem, 'investimento_salvar', { tabela: 'metricas_canal', registro: String(dados.canal).slice(0, 20), detalhes: { competencia: dados.competencia || null, investimento: Number(dados.investimento) || 0 } });
        return json(res, 200, roi);
      }

      /* ============================================================
         MINHA CONTA — nome, e-mail e função de quem está logado
         A senha NÃO passa por aqui: a tela troca direto no Supabase
         Auth (sb.auth.updateUser). Servidor nenhum precisa vê-la.
         ============================================================ */
      if (pathname === '/api/perfil' && req.method === 'GET') {
        const sb = adminSupabase();
        if (!sb) return json(res, 503, { erro: 'Servidor sem a chave do banco configurada.' });
        const { data, error } = await sb.from('perfis')
          .select('id,nome,email,papel,ativo,cargo,telefone,avatar_cor,apps,recebe_leads,precisa_trocar_senha').eq('id', quem.id).maybeSingle();
        if (error) return json(res, 503, { erro: 'Não consegui ler o seu perfil.' });
        return json(res, 200, data || {
          id: quem.id, nome: '', email: quem.email || '',
          papel: quem.papel || 'atendente', ativo: true,
        });
      }

      // PATCH /api/perfil → troca só o PRÓPRIO nome (o id vem do token, não do corpo)
      if (pathname === '/api/perfil' && req.method === 'PATCH') {
        const b = await readBody(req);
        const patch = {};
        if ('nome' in b || !Object.keys(b).length) { const nome = texto1(b.nome, 80).trim(); if (!nome) return json(res, 400, { erro: 'Informe o seu nome.' }); patch.nome = nome; }
        if ('cargo' in b) patch.cargo = texto1(b.cargo, 60).trim() || null;
        if ('telefone' in b) {
          const t = texto1(b.telefone, 30).replace(/\D/g, '');
          if (t && (t.length < 10 || t.length > 13)) return json(res, 400, { erro: 'Telefone com DDD, por favor.' });
          patch.telefone = t || null;
        }
        if ('avatar_cor' in b) {
          if (b.avatar_cor !== null && !/^#[0-9a-f]{6}$/i.test(String(b.avatar_cor))) return json(res, 400, { erro: 'Cor inválida (use #RRGGBB).' });
          patch.avatar_cor = b.avatar_cor;
        }
        if ('preferencias' in b) {
          if (!b.preferencias || typeof b.preferencias !== 'object' || Array.isArray(b.preferencias) || JSON.stringify(b.preferencias).length > 4000) return json(res, 400, { erro: 'Preferências inválidas.' });
          patch.preferencias = b.preferencias;
        }
        const sb = adminSupabase();
        if (!sb) return json(res, 503, { erro: 'Servidor sem a chave do banco configurada.' });
        const { error } = await sb.from('perfis').update(patch).eq('id', quem.id);
        if (error) return json(res, 503, { erro: 'Não consegui salvar o seu perfil.' });
        acesso().esquecer(quem.id);
        return json(res, 200, { ok: true, ...patch });
      }

      /* ============================================================
         EQUIPE — mesmo login do Atendimento e da Agenda
         Cadastro e corte de acesso exigem papel admin AQUI NO SERVIDOR:
         esconder o botão na tela não protege nada.
         ============================================================ */
      if (pathname === '/api/equipe' && req.method === 'GET') {
        const sb = adminSupabase();
        if (!sb) return json(res, 503, { erro: 'Servidor sem a chave do banco configurada.' });
        // quem não é admin enxerga apenas o próprio cadastro
        // admin e gestor veem todo mundo; atendente só o próprio cadastro
        let consulta = sb.from('perfis')
          .select('id,nome,email,papel,ativo,created_at,apps,cargo,telefone,avatar_cor,recebe_leads,ultimo_acesso_em,ultimo_app,precisa_trocar_senha,desativado_em').order('created_at');
        if (!ehGestor) consulta = consulta.eq('id', quem.id);
        const { data, error } = await consulta;
        if (error) return json(res, 503, { erro: 'Não consegui ler a equipe.' });
        return json(res, 200, { equipe: data || [], souAdmin: ehAdmin, souGestor: ehGestor, meuId: quem.id, papeis: U.PAPEIS, apps: U.APPS });
      }

      if (pathname === '/api/equipe' && req.method === 'POST') {
        if (!ehAdmin) return json(res, 403, { erro: 'Só o administrador cadastra a equipe.' });
        if (!dentroDoLimite(`equipe:${quem.id}`, 10, 60_000)) {
          return json(res, 429, { erro: 'Muitos cadastros seguidos. Espere um minuto.' });
        }

        const bruto = await readBody(req);
        const nome  = texto1(bruto.nome, 80).trim();
        const email = texto1(bruto.email, 160).trim().toLowerCase();
        const senha = texto1(bruto.senha, 200);
        const papel = U.PAPEIS.includes(bruto.papel) ? bruto.papel : 'atendente'; // 'agenda' = so presenca
        if (bruto.apps !== undefined && (!Array.isArray(bruto.apps) || bruto.apps.some(a => !U.APPS.includes(a)))) return json(res, 400, { erro: `Apps válidos: ${U.APPS.join(', ')}.` });
        const apps = papel === 'agenda' ? ['agenda'] : (Array.isArray(bruto.apps) ? [...new Set(bruto.apps)] : U.APPS);
        const cargo = texto1(bruto.cargo, 60).trim() || null;

        if (!nome) return json(res, 400, { erro: 'Informe o nome da pessoa.' });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
          return json(res, 400, { erro: 'Esse e-mail não parece válido.' });
        }
        if (senha.length < 8) {
          return json(res, 400, { erro: 'A senha precisa ter pelo menos 8 caracteres.' });
        }

        const sb = adminSupabase();
        if (!sb) return json(res, 503, { erro: 'Servidor sem a chave do banco configurada.' });

        // email_confirm: já entra valendo, sem depender de e-mail de confirmação
        const { data, error } = await sb.auth.admin.createUser({
          email, password: senha, email_confirm: true, user_metadata: { nome },
        });
        if (error) {
          const jaExiste = /already been registered|already exists/i.test(error.message);
          return json(res, jaExiste ? 409 : 400, {
            erro: jaExiste ? 'Já existe alguém cadastrado com esse e-mail.' : 'Não consegui criar o usuário. Confira o e-mail e a senha.' });
        }

        // o gatilho do banco cria o perfil; aqui acertamos nome, papel, apps e a troca obrigatória da senha
        const precisa_trocar_senha = bruto.trocar_senha !== false;
        const { error: erroPerfil } = await sb.from('perfis')
          .update({ nome, papel, ativo: true, apps, cargo, convidado_por: quem.id, precisa_trocar_senha }).eq('id', data.user.id);
        await auditar(quem, 'equipe_criar', { tabela: 'perfis', registro: data.user.id, detalhes: { email, papel, apps } });
        if (erroPerfil) {
          return json(res, 200, { ok: true, id: data.user.id, nome, email, papel,
            aviso: 'Usuário criado, mas não consegui ajustar o perfil. Confira na lista da equipe.' });
        }
        return json(res, 201, { ok: true, id: data.user.id, nome, email, papel, apps, precisa_trocar_senha });
      }

      /* ---- Equipe: quem é atendente e quem é administrador ---- */
      if (pathname === '/api/equipe/papel' && req.method === 'POST') {
        if (!ehAdmin) return json(res, 403, { erro: 'Só o administrador muda a função da equipe.' });

        const bruto = await readBody(req);
        const id    = texto1(bruto.id, 60);
        const papel = U.PAPEIS.includes(bruto.papel) ? bruto.papel : 'atendente'; // 'agenda' = so presenca
        if (!ehUuid(id)) return json(res, 400, { erro: 'Informe quem você quer alterar.' });

        const sb = adminSupabase();
        if (!sb) return json(res, 503, { erro: 'Servidor sem a chave do banco configurada.' });

        /* Rebaixar o último administrador tranca todo mundo para fora: ninguém
           mais cadastra ninguém, ninguém mexe nas integrações, e a tela de
           primeiro acesso não reabre porque já existem perfis.
           Olha o cadastro de quem vai mudar antes de contar: rebaixar quem já
           era atendente não tira administrador nenhum e não pode ser barrado. */
        if (papel !== 'admin') {
          const { data: alvo } = await sb.from('perfis')
            .select('papel,ativo').eq('id', id).maybeSingle();
          if (alvo?.papel === 'admin' && alvo.ativo) {
            const { count } = await sb.from('perfis')
              .select('id', { count: 'exact', head: true }).eq('papel', 'admin').eq('ativo', true);
            if ((count ?? 0) <= 1) {
              return json(res, 409, {
                erro: 'Este é o único administrador. Promova outra pessoa antes de rebaixar esta.' });
            }
          }
        }

        const { data: antesPapel } = await sb.from('perfis').select('papel,apps').eq('id', id).maybeSingle();
        if (!antesPapel) return json(res, 404, { erro: 'Pessoa não encontrada.' });
        const mudanca = { papel };
        // 'agenda' só marca presença: fica só com a Agenda; quem sai dela volta a ter todos os apps
        if (papel === 'agenda') mudanca.apps = ['agenda'];
        else if (antesPapel.papel === 'agenda' && (antesPapel.apps || []).join() === 'agenda') mudanca.apps = U.APPS;
        const { error } = await sb.from('perfis').update(mudanca).eq('id', id);
        if (error) return json(res, 503, { erro: 'Não consegui mudar a função.' });
        acesso().esquecer(id);
        await auditar(quem, 'equipe_papel', { tabela: 'perfis', registro: id, detalhes: { de: antesPapel.papel, para: papel } });
        return json(res, 200, { ok: true, papel, ...(mudanca.apps ? { apps: mudanca.apps } : {}) });
      }

      /* ---- Equipe: ligar/desligar o acesso de alguém ---- */
      if (pathname === '/api/equipe/ativo' && req.method === 'POST') {
        if (!ehAdmin) return json(res, 403, { erro: 'Só o administrador faz isso.' });

        const bruto = await readBody(req);
        const id = texto1(bruto.id, 60);
        if (!ehUuid(id)) return json(res, 400, { erro: 'Informe quem você quer alterar.' });
        if (id === quem.id) {
          return json(res, 400, { erro: 'Você não pode desligar o próprio acesso.' });
        }
        const sb = adminSupabase();
        if (!sb) return json(res, 503, { erro: 'Servidor sem a chave do banco configurada.' });

        /* Tirar o acesso do último administrador tranca o sistema para todo
           mundo, do mesmo jeito que rebaixá-lo. A regra de "não desligar a si
           mesmo" acima não cobre isto: dois admins podem se desligar em
           sequência e o segundo sai deixando zero. */
        if (bruto.ativo !== true) {
          const { data: alvo } = await sb.from('perfis').select('papel').eq('id', id).maybeSingle();
          if (alvo?.papel === 'admin') {
            const { count } = await sb.from('perfis')
              .select('id', { count: 'exact', head: true }).eq('papel', 'admin').eq('ativo', true);
            if ((count ?? 0) <= 1) {
              return json(res, 409, {
                erro: 'Este é o único administrador ativo. Promova outra pessoa antes de '
                    + 'tirar o acesso desta.' });
            }
          }
        }

        const ligar = bruto.ativo === true;
        const { error } = await sb.from('perfis')
          .update({ ativo: ligar, desativado_em: ligar ? null : new Date().toISOString(), desativado_por: ligar ? null : quem.id }).eq('id', id);
        if (error) return json(res, 503, { erro: 'Não consegui mudar o acesso.' });
        acesso().esquecer(id);                 // corta na hora neste servidor (sem esperar o cache)
        await auditar(quem, ligar ? 'equipe_reativar' : 'equipe_desativar', { tabela: 'perfis', registro: id });
        return json(res, 200, { ok: true, ativo: ligar });
      }

      /* ============================================================
         CLIENTES — a base compartilhada com a Agenda e o Atendimento
         ============================================================ */
      // GET /api/clientes?q= → lista resumida (gasto, serviços, último contato)
      if (pathname === '/api/clientes' && req.method === 'GET') {
        if (!dentroDoLimite(`clientes:${quem.id}`, 40, 60_000)) return json(res, 429, { erro: 'Muitas buscas seguidas. Espere um pouco.' });
        try {
          const busca = url.searchParams.get('q') || '';
          const fichas = await carregarBaseClientes();
          const lista = filtrarClientes(fichas, busca)
            .map(f => ({
              id: f.cliente.id,
              nome: f.cliente.nome,
              telefone: f.cliente.telefone,
              carro_modelo: f.cliente.carro_modelo,
              placa: f.cliente.placa,
              origem: f.cliente.origem,
              gasto: Math.round(f.gasto * 100) / 100,
              emAberto: Math.round(f.emAberto * 100) / 100,
              servicos: f.servicos.size,
              leads: f.leads.length,
              agendamentos: f.agendamentos.length,
              ultimoContato: f.ultimoContato,
            })
            // quem gastou mais aparece primeiro; empate desempata pelo contato recente
            ).sort((a, b) => b.gasto - a.gasto ||
                   String(b.ultimoContato).localeCompare(String(a.ultimoContato)));

          /* Dois pares de números, nunca misturados: o da BUSCA e o da BASE.
             Antes vinha "total" da base inteira com o "faturamento" só do que a
             busca devolveu — e a tela dividia um pelo outro. Buscar "Maria"
             mostrava o gasto das Marias dividido por 84 clientes. */
          const somar = (arr) => Math.round(arr.reduce((s, c) => s + c.gasto, 0) * 100) / 100;
          const todos = [...fichas.values()].map(f => ({ gasto: f.gasto }));

          return json(res, 200, {
            clientes: lista,
            filtrado: !!busca.trim(),
            // o que a busca devolveu
            total: lista.length,
            faturamento: somar(lista),
            // a base inteira, para o rótulo "de X clientes"
            totalBase: fichas.size,
            faturamentoBase: somar(todos),
          });
        } catch (e) { console.error('clientes:', e && e.message); return json(res, 503, { erro: 'Não consegui ler a base de clientes agora.' }); }
      }

      // GET /api/clientes/:id → ficha 360 de um cliente
      const mc = pathname.match(/^\/api\/clientes\/([0-9a-fA-F-]{36})$/);
      if (mc && req.method === 'PATCH') {
        if (!ehUuid(mc[1])) return json(res,400,{erro:'Cliente inválido.'});
        if (!store.atualizarPreferenciasCliente) return json(res,503,{erro:'Disponível no banco compartilhado.'});
        const cliente = await store.atualizarPreferenciasCliente(mc[1], await readBody(req));
        return cliente ? json(res,200,{cliente}) : json(res,404,{erro:'Cliente não encontrado.'});
      }
      if (mc && req.method === 'GET') {
        if (!ehUuid(mc[1])) return json(res, 400, { erro: 'cliente inválido' });
        try {
          const fichas = await carregarBaseClientes();
          const f = fichas.get(mc[1]);
          if (!f) return json(res, 404, { erro: 'cliente não encontrado' });

          const concluidos = f.leads.filter(l => l.status === 'concluido').length;
          return json(res, 200, {
            cliente: f.cliente,
            resumo: {
              gasto: Math.round(f.gasto * 100) / 100,
              emAberto: Math.round(f.emAberto * 100) / 100,
              servicosFeitos: [...f.servicos.values()].reduce((s, n) => s + n, 0),
              leads: f.leads.length,
              ganhos: concluidos,
              agendamentos: f.agendamentos.length,
              faltas: f.agendamentos.filter(a => a.status === 'nao_veio').length,
              ultimoServico: [...f.agendamentos.filter(a => a.status === 'concluido').map(a => a.data), ...f.leads.filter(l => l.status === 'concluido').map(l => l.closed_at)].filter(Boolean).sort().at(-1) || null,
              ticket: concluidos ? Math.round((f.gasto / concluidos) * 100) / 100 : 0,
            },
            servicos: [...f.servicos.entries()]
              .map(([nome, vezes]) => ({ nome, vezes }))
              .sort((a, b) => b.vezes - a.vezes || a.nome.localeCompare(b.nome)),
            leads: f.leads.slice(0, 10),
            agendamentos: f.agendamentos.slice(0, 10),
          });
        } catch (e) { console.error('clientes:', e && e.message); return json(res, 503, { erro: 'Não consegui ler a base de clientes agora.' }); }
      }

      /* ============================================================
         CATÁLOGO DE SERVIÇOS — é o que a IA usa para responder o cliente
         ============================================================ */
      if (pathname === '/api/catalogo' && req.method === 'GET') {
        const sb = adminSupabase();
        if (!sb) return json(res, 503, { erro: 'Servidor sem a chave do banco configurada.' });
        const { data, error } = await sb.from('catalogo_servicos')
          .select('id,categoria,servico,escopo,fazemos,tipo_veiculo,observacao')
          .order('categoria', { ascending: true })
          .order('servico', { ascending: true });
        if (error) return json(res, 503, { erro: 'Não consegui ler o catálogo.' });
        return json(res, 200, { servicos: data || [], souAdmin: ehAdmin });
      }

      // PATCH /api/catalogo/:id → liga/desliga o "fazemos". Só admin.
      const mcat = pathname.match(/^\/api\/catalogo\/([0-9a-fA-F-]{36})$/);
      if (mcat && req.method === 'PATCH') {
        if (!ehAdmin) return json(res, 403, { erro: 'Só o administrador muda o catálogo.' });
        if (!ehUuid(mcat[1])) return json(res, 400, { erro: 'serviço inválido' });
        const bruto = await readBody(req);
        if (typeof bruto.fazemos !== 'boolean') {
          return json(res, 400, { erro: 'informe fazemos: true ou false' });
        }
        const sb = adminSupabase();
        if (!sb) return json(res, 503, { erro: 'Servidor sem a chave do banco configurada.' });
        const { data, error } = await sb.from('catalogo_servicos')
          .update({ fazemos: bruto.fazemos }).eq('id', mcat[1])
          .select('id,categoria,servico,escopo,fazemos,tipo_veiculo,observacao').maybeSingle();
        if (error) return json(res, 503, { erro: 'Não consegui salvar o serviço.' });
        if (!data) return json(res, 404, { erro: 'serviço não encontrado' });
        await auditar(quem, 'catalogo_fazemos', { tabela: 'catalogo_servicos', registro: mcat[1], detalhes: { servico: data.servico, fazemos: data.fazemos } });
        return json(res, 200, { ok: true, servico: data });
      }

      return json(res, 404, { erro: 'rota não encontrada' });
    }

    // ---------- Arquivos estáticos ----------
    serveStatic(req, res, pathname);

  } catch (err) {
    const st = err && Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
    if (st >= 500) console.error('Falha na requisição:', err && err.name, err && err.message);
    if (res.headersSent) { try { res.end(); } catch { /* conexão já foi */ } return; }
    json(res, st, { erro: err && err.status ? err.message : 'Não foi possível concluir. Tente novamente.', ...(err && err.codigo ? { codigo: err.codigo } : {}), ...(err && err.precisaConfirmar ? { precisaConfirmar: true } : {}) });
  }
});

/* Onde escutar:
   - Na nuvem (Render), TEM de ser 0.0.0.0 — o roteador do Render fala com o
     processo de fora do container; preso em 127.0.0.1 o serviço nunca responde.
     Lá o acesso é protegido pelo login (toda rota /api exige token válido).
   - Na máquina da oficina, fica em 127.0.0.1: o CRM guarda tokens do Meta e do
     Google, e abrir para o Wi-Fi local não traz ganho nenhum.
   Force com CRM_HOST se precisar de outra coisa. */
const NA_NUVEM = !!(process.env.RENDER || process.env.PORT);
const NO_AR_DESDE = new Date().toISOString();
const HOST = process.env.CRM_HOST || (NA_NUVEM ? '0.0.0.0' : '127.0.0.1');

/* Automações no próprio servidor: primeira volta 1 min depois de subir, depois
   a cada CRM_AUTOMACOES_MIN (padrão 15). Desligue com CRM_AUTOMACOES=0. Em
   produção gratuita o Render dorme: use também o agendador (rota protegida). */
if (AUTOMACOES_LIGADAS && USA_SUPABASE && typeof setInterval === 'function') {
  const volta = () => { const a = automacoes(); if (a) a.ciclo({ origem: 'timer' }).catch(e => console.warn('[automações]', e && e.message)); };
  const t1 = setTimeout(volta, 60_000); if (t1.unref) t1.unref();
  const t2 = setInterval(volta, INTERVALO_MIN * 60_000); if (t2.unref) t2.unref();
}

server.headersTimeout = 66_000;
/* keep-alive maior que o do proxy do Render (evita 502 por conexão reaproveitada que o Node já fechou) */
server.keepAliveTimeout = 65_000;
server.requestTimeout = 30_000;
server.listen(PORT, HOST, () => {
  console.log(`\n🏁 IndyCar CRM rodando em http://localhost:${PORT}`);
  if (USA_SUPABASE) {
    console.log('   🗄️  Banco: SUPABASE (compartilhado com a Agenda)');
  } else {
    console.log('   🗄️  Banco: SQLite local (crm.db) — isolado da Agenda');
    // diz exatamente o que está faltando, em vez de uma dica genérica
    const temUrl = !!process.env.SUPABASE_URL;
    const temKey = !!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY);
    if (process.env.CRM_DB === 'sqlite') {
      console.log('      (forçado por CRM_DB=sqlite)');
    } else if (temUrl && !temKey) {
      console.log('      ⚠️  Falta a chave: preencha SUPABASE_SERVICE_ROLE_KEY no arquivo .env');
      console.log('         Pegue em: Supabase → Settings → API Keys → service_role (Reveal)');
    } else if (!temUrl) {
      console.log('      Para usar o banco compartilhado, preencha o arquivo .env');
      console.log('         (copie o .env.exemplo se ele não existir)');
    }
  }
  /* O aviso dizia "sem autenticação" — sobra de quando o CRM era aberto.
     Hoje toda rota /api exige login, e o recado errado no console é pior
     que recado nenhum: sugere um buraco que não existe e desvia a atenção. */
  if (HOST === '127.0.0.1') console.log('   (acessível só neste computador)\n');
  else console.log(`   🔒 exposto em ${HOST} — acesso só com login\n`);
});
