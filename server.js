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

/* Freio simples por usuário: um token válido (ou um script distraído) não
   pode criar mil contas nem martelar o banco em segundos. */
const USO = new Map();   // chave -> { qtd, zeraEm }

function dentroDoLimite(chave, teto, janelaMs) {
  const agora = Date.now();
  const atual = USO.get(chave);
  if (!atual || atual.zeraEm <= agora) {
    if (USO.size > 500) USO.clear();
    USO.set(chave, { qtd: 1, zeraEm: agora + janelaMs });
    return true;
  }
  if (atual.qtd >= teto) return false;
  atual.qtd++;
  return true;
}

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
async function carregarBaseClientes() {
  const sb = adminSupabase();
  if (!sb) throw new Error('Servidor sem a chave do banco configurada.');

  const [rc, rl, ra] = await Promise.all([
    sb.from('clientes')
      .select('id,nome,telefone,email,carro_modelo,carro_ano,placa,origem,observacoes,created_at')
      .order('nome'),
    sb.from('leads')
      .select('id,cliente_id,nome,telefone,servico,valor_orcado,valor_pago,status,origem,utm_campaign,observacoes,created_at,closed_at')
      .order('created_at', { ascending: false }),
    sb.from('agendamentos')
      .select('id,cliente_id,lead_id,cliente_nome,telefone,servico,veiculo,placa,data,hora,status,valor,origem,compareceu,created_at')
      .order('data', { ascending: false }),
  ]);
  for (const r of [rc, rl, ra]) if (r.error) throw new Error(r.error.message);

  const clientes = rc.data || [], leads = rl.data || [], agendamentos = ra.data || [];

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
        const ip = req.socket?.remoteAddress || 'desconhecido';
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
                           : error.message });
        }

        /* O gatilho do banco já marca o primeiro cadastro como admin. Reforçado
           aqui porque uma corrida entre dois cadastros simultâneos poderia
           deixar o dono como atendente no próprio sistema. */
        await sb.from('perfis').update({ nome, papel: 'admin', ativo: true }).eq('id', data.user.id);
        return json(res, 201, { ok: true, email });
      }

      // Daqui para baixo, só com login válido.
      const quem = await usuarioLogado(req);
      if (!quem) {
        return json(res, 401, { erro: 'Faça login para usar o CRM.' });
      }
      const ehAdmin = quem.papel === 'admin';

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
        // mexe no investimento e, com ele, no ROI de todo mundo
        if (!ehAdmin) {
          return json(res, 403, { erro: 'Só o administrador registra investimento.' });
        }
        const dados = await readBody(req);
        if (!dados || !dados.canal) return json(res, 400, { erro: 'informe o canal' });
        return json(res, 200, await store.salvarMetrica(dados));
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
          .select('id,nome,email,papel,ativo').eq('id', quem.id).maybeSingle();
        if (error) return json(res, 500, { erro: error.message });
        return json(res, 200, data || {
          id: quem.id, nome: '', email: quem.email || '',
          papel: quem.papel || 'atendente', ativo: true,
        });
      }

      // PATCH /api/perfil → troca só o PRÓPRIO nome (o id vem do token, não do corpo)
      if (pathname === '/api/perfil' && req.method === 'PATCH') {
        const nome = texto1((await readBody(req)).nome, 80).trim();
        if (!nome) return json(res, 400, { erro: 'Informe o seu nome.' });
        const sb = adminSupabase();
        if (!sb) return json(res, 503, { erro: 'Servidor sem a chave do banco configurada.' });
        const { error } = await sb.from('perfis').update({ nome }).eq('id', quem.id);
        if (error) return json(res, 500, { erro: error.message });
        return json(res, 200, { ok: true, nome });
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
        let consulta = sb.from('perfis')
          .select('id,nome,email,papel,ativo,created_at').order('created_at');
        if (!ehAdmin) consulta = consulta.eq('id', quem.id);
        const { data, error } = await consulta;
        if (error) return json(res, 500, { erro: error.message });
        return json(res, 200, { equipe: data || [], souAdmin: ehAdmin, meuId: quem.id });
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
        const papel = bruto.papel === 'admin' ? 'admin' : 'atendente';

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
            erro: jaExiste ? 'Já existe alguém cadastrado com esse e-mail.' : error.message });
        }

        // o gatilho do banco cria o perfil; aqui só acertamos nome e papel
        const { error: erroPerfil } = await sb.from('perfis')
          .update({ nome, papel, ativo: true }).eq('id', data.user.id);
        if (erroPerfil) {
          return json(res, 200, { ok: true, id: data.user.id, nome, email, papel,
            aviso: 'Usuário criado, mas não consegui ajustar o perfil: ' + erroPerfil.message });
        }
        return json(res, 201, { ok: true, id: data.user.id, nome, email, papel });
      }

      /* ---- Equipe: quem é atendente e quem é administrador ---- */
      if (pathname === '/api/equipe/papel' && req.method === 'POST') {
        if (!ehAdmin) return json(res, 403, { erro: 'Só o administrador muda a função da equipe.' });

        const bruto = await readBody(req);
        const id    = texto1(bruto.id, 60);
        const papel = bruto.papel === 'admin' ? 'admin' : 'atendente';
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

        const { error } = await sb.from('perfis').update({ papel }).eq('id', id);
        if (error) return json(res, 500, { erro: error.message });
        return json(res, 200, { ok: true, papel });
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

        const { error } = await sb.from('perfis')
          .update({ ativo: bruto.ativo === true }).eq('id', id);
        if (error) return json(res, 500, { erro: error.message });
        return json(res, 200, { ok: true, ativo: bruto.ativo === true });
      }

      /* ============================================================
         CLIENTES — a base compartilhada com a Agenda e o Atendimento
         ============================================================ */
      // GET /api/clientes?q= → lista resumida (gasto, serviços, último contato)
      if (pathname === '/api/clientes' && req.method === 'GET') {
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
        } catch (e) { return json(res, 503, { erro: e.message }); }
      }

      // GET /api/clientes/:id → ficha 360 de um cliente
      const mc = pathname.match(/^\/api\/clientes\/([0-9a-fA-F-]{36})$/);
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
              ticket: concluidos ? Math.round((f.gasto / concluidos) * 100) / 100 : 0,
            },
            servicos: [...f.servicos.entries()]
              .map(([nome, vezes]) => ({ nome, vezes }))
              .sort((a, b) => b.vezes - a.vezes || a.nome.localeCompare(b.nome)),
            leads: f.leads.slice(0, 10),
            agendamentos: f.agendamentos.slice(0, 10),
          });
        } catch (e) { return json(res, 503, { erro: e.message }); }
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
        if (error) return json(res, 500, { erro: error.message });
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
        if (error) return json(res, 500, { erro: error.message });
        if (!data) return json(res, 404, { erro: 'serviço não encontrado' });
        return json(res, 200, { ok: true, servico: data });
      }

      return json(res, 404, { erro: 'rota não encontrada' });
    }

    // ---------- Arquivos estáticos ----------
    serveStatic(res, pathname);

  } catch (err) {
    json(res, 500, { erro: err.message || 'erro interno' });
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
const HOST = process.env.CRM_HOST || (NA_NUVEM ? '0.0.0.0' : '127.0.0.1');

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
