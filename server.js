/* ============================================================
   IndyCar CRM — servidor HTTP (Node puro, sem framework)
   API REST de leads + dashboard + resumo semanal com IA (Claude).
   ============================================================ */
'use strict';

const http = require('node:http');
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
const { gerarResumoSemanal } = require('./ia');

const PORT = process.env.PORT || 3100;
const PUBLIC = path.join(__dirname, 'public');

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
               '.js': 'text/javascript; charset=utf-8', '.png': 'image/png',
               '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const json = (res, code, data) => {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8',
                        'Content-Length': Buffer.byteLength(body) });
  res.end(body);
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => {
      raw += c;
      if (raw.length > 1e6) { reject(new Error('payload muito grande')); req.destroy(); }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('JSON inválido')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.slice(1);
  // impede path traversal
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) { res.writeHead(403).end('Proibido'); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Não encontrado'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
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

const CACHE_LOGIN = new Map();   // token -> { usuario, expira } | { negado, expira }

function validadeDoToken(token) {
  try {
    const [, carga] = token.split('.');
    const { exp } = JSON.parse(Buffer.from(carga, 'base64url').toString('utf8'));
    return Number.isFinite(exp) ? exp * 1000 : 0;
  } catch { return 0; }
}

async function usuarioLogado(req) {
  const auth = req.headers['authorization'] || '';
  const m = /^\s*bearer\s+(\S+)\s*$/i.exec(auth);       // "Bearer" é case-insensitive
  const token = m ? m[1] : null;
  if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_KEY) return null;

  const lembrado = CACHE_LOGIN.get(token);
  if (lembrado && lembrado.expira > Date.now()) return lembrado.negado ? null : lembrado.usuario;

  const vence = validadeDoToken(token);
  if (vence && vence <= Date.now()) return null;        // já venceu: nem pergunta

  const negar = () => {
    if (CACHE_LOGIN.size > 500) CACHE_LOGIN.clear();
    CACHE_LOGIN.set(token, { negado: true, expira: Date.now() + 30_000 });
    return null;
  };

  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return negar();
    const usuario = await r.json();
    if (!usuario?.id) return negar();

    // o perfil precisa existir e estar ativo (atendente desligado perde o acesso)
    const p = await fetch(
      `${SUPABASE_URL}/rest/v1/perfis?select=ativo,papel&id=eq.${encodeURIComponent(usuario.id)}`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
        signal: AbortSignal.timeout(8000) });
    if (!p.ok) return negar();
    const [perfil] = await p.json();
    if (!perfil?.ativo) return negar();
    usuario.papel = perfil.papel;

    if (CACHE_LOGIN.size > 500) CACHE_LOGIN.clear();
    CACHE_LOGIN.set(token, { usuario, expira: Math.min(Date.now() + 60_000, vence || Infinity) });
    return usuario;
  } catch { return null; }
}

const server = http.createServer(async (req, res) => {
  try {
    // dentro do try: um Host malformado faria o parser de URL lançar
    let url;
    try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); }
    catch { return json(res, 400, { erro: 'requisição malformada' }); }
    const { pathname } = url;

    // ---------- API ----------
    if (pathname.startsWith('/api/')) {

      // A tela precisa saber onde fica o Supabase para montar o login.
      // A chave publicável é pública por design.
      if (pathname === '/api/config' && req.method === 'GET') {
        return json(res, 200, {
          supabaseUrl: SUPABASE_URL,
          supabaseAnonKey: SUPABASE_ANON_KEY,
          configurado: !!(SUPABASE_URL && SUPABASE_ANON_KEY && SERVICE_KEY),
          iaConfigurada: !!process.env.ANTHROPIC_API_KEY,
        });
      }

      // Daqui para baixo, só com login válido.
      if (!await usuarioLogado(req)) {
        return json(res, 401, { erro: 'Faça login para usar o CRM.' });
      }

      // GET /api/leads?status=&origem=&q=
      if (pathname === '/api/leads' && req.method === 'GET') {
        return json(res, 200, await store.listLeads({
          status: url.searchParams.get('status') || undefined,
          origem: url.searchParams.get('origem') || undefined,
          q: url.searchParams.get('q') || undefined,
        }));
      }

      // POST /api/leads
      if (pathname === '/api/leads' && req.method === 'POST') {
        const body = await readBody(req);
        if (!body.nome || !body.telefone) return json(res, 400, { erro: 'nome e telefone são obrigatórios' });
        return json(res, 201, await store.createLead(body));
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
          const updated = await store.updateLead(id, await readBody(req));
          return updated ? json(res, 200, updated) : json(res, 404, { erro: 'lead não encontrado' });
        }
        if (req.method === 'DELETE') {
          return (await store.deleteLead(id)) ? json(res, 200, { ok: true })
                                              : json(res, 404, { erro: 'lead não encontrado' });
        }
      }

      // GET /api/stats
      if (pathname === '/api/stats' && req.method === 'GET') {
        return json(res, 200, await store.getStats());
      }

      // POST /api/resumo-ia  → resumo semanal gerado pela Claude
      if (pathname === '/api/resumo-ia' && req.method === 'POST') {
        const resultado = await gerarResumoSemanal(await store.weeklyData());
        return json(res, resultado.ok ? 200 : 503, resultado);
      }

      // POST /api/seed  → repopula dados de exemplo
      if (pathname === '/api/seed' && req.method === 'POST') {
        return json(res, 200, { ok: true, criados: await store.reseed() });
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
        if (req.method === 'PATCH') {
          return json(res, 200, await store.salvarIntegracao(canal, await readBody(req)));
        }
        if (req.method === 'DELETE') {
          return json(res, 200, await store.limparIntegracao(canal));
        }
        return json(res, 405, { erro: 'método não permitido' });
      }

      // GET /api/roi?competencia=AAAA-MM → investimento × faturamento real por canal
      if (pathname === '/api/roi' && req.method === 'GET') {
        return json(res, 200, await store.getROI(url.searchParams.get('competencia') || undefined));
      }

      // POST /api/metricas → grava investimento/cliques do mês (entrada manual)
      if (pathname === '/api/metricas' && req.method === 'POST') {
        const dados = await readBody(req);
        if (!dados || !dados.canal) return json(res, 400, { erro: 'informe o canal' });
        return json(res, 200, await store.salvarMetrica(dados));
      }

      return json(res, 404, { erro: 'rota não encontrada' });
    }

    // ---------- Arquivos estáticos ----------
    serveStatic(res, pathname);

  } catch (err) {
    json(res, 500, { erro: err.message || 'erro interno' });
  }
});

/* Escuta só em localhost por padrão. Agora que a aba Integrações guarda tokens
   do Meta e do Google, deixar em 0.0.0.0 exporia o CRM (sem senha) para
   qualquer aparelho no Wi-Fi da oficina. Para acessar de outra máquina da rede,
   rode com:  CRM_HOST=0.0.0.0 node server.js  — e só numa rede confiável. */
const HOST = process.env.CRM_HOST || '127.0.0.1';

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
  if (HOST === '127.0.0.1') console.log('   (acessível só neste computador)\n');
  else console.log(`   ⚠️  exposto na rede em ${HOST} — sem autenticação\n`);
});
