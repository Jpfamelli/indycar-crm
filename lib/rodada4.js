/* ============================================================
   IndyCar CRM — rodada 4 (14/10/2026), servidor
   - compressão (br/gzip) e ETag para JSON e arquivos estáticos
   - idempotência das escritas (a tela repete o pedido quando o
     Render está acordando; o servidor não faz a ação duas vezes)
   - valor pago: concluídos sem valor (com sugestões) e preenchimento em lote
   - distribuição em lote dos leads sem responsável, com desfazer
   ============================================================ */
'use strict';

const zlib = require('node:zlib');
const crypto = require('node:crypto');
const U = require('./util-servidor');
const { ehUuid, falha, ehGestor, todas, texto } = U;

/* ---------------- compressão ---------------- */
const COMPRIMIVEL = /^(application\/(json|javascript|manifest\+json)|text\/|image\/svg)/;
/** Escolhe a codificação pelo Accept-Encoding (br > gzip). */
function codificacao(req) {
  const ae = String(req?.headers?.['accept-encoding'] || '');
  if (/\bbr\b/.test(ae)) return 'br';
  if (/\bgzip\b/.test(ae)) return 'gzip';
  return null;
}
function comprimir(buf, cod) {
  if (cod === 'br') return zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } });
  if (cod === 'gzip') return zlib.gzipSync(buf, { level: 6 });
  return buf;
}
/** Corpo pronto para enviar: comprime se valer a pena (> 1 KB e tipo de texto). */
function corpoParaEnviar(req, buf, tipo) {
  const cod = buf.length > 1024 && COMPRIMIVEL.test(String(tipo || '')) ? codificacao(req) : null;
  return cod ? { corpo: comprimir(buf, cod), cod } : { corpo: buf, cod: null };
}

/** Cache dos estáticos: lê do disco uma vez por versão do arquivo (mtime) e guarda já comprimido. */
function criarEstaticos({ fs = require('node:fs'), max = 80 } = {}) {
  const memo = new Map();
  function ler(arquivo, transformar = null) {
    const st = fs.statSync(arquivo);
    const m = memo.get(arquivo);
    if (m && m.mtime === st.mtimeMs && m.tamanho === st.size) return m;
    const raw = fs.readFileSync(arquivo);
    const extra = transformar ? transformar(raw) : {};
    const etag = '"' + crypto.createHash('sha1').update(raw).digest('base64url').slice(0, 20) + '"';
    const novo = { mtime: st.mtimeMs, tamanho: st.size, raw, etag, gz: null, br: null, ...extra };
    if (memo.size >= max) memo.delete(memo.keys().next().value);
    memo.set(arquivo, novo);
    return novo;
  }
  /** Versão do arquivo na codificação pedida (comprime na primeira vez e guarda). */
  function versao(item, cod) {
    if (!cod || item.raw.length <= 1024) return { corpo: item.raw, cod: null };
    if (!item[cod === 'br' ? 'br' : 'gz']) item[cod === 'br' ? 'br' : 'gz'] = comprimir(item.raw, cod);
    return { corpo: item[cod === 'br' ? 'br' : 'gz'], cod };
  }
  return { ler, versao, _memo: memo };
}

/* ---------------- idempotência ---------------- */
const RE_CHAVE = /^[a-z0-9_-]{6,48}$/i;
/**
 * A tela manda `x-idempotencia: <chave>` em toda escrita. Se o mesmo pedido
 * chegar de novo (repetido enquanto o servidor acordava), devolve a mesma
 * resposta sem repetir a ação. Respostas 5xx não são guardadas (pode tentar de novo).
 */
function criarIdempotencia({ agora = () => Date.now(), ttlMs = 10 * 60_000, max = 3000 } = {}) {
  const mapa = new Map();
  const limpar = () => { const t = agora(); for (const [k, v] of mapa) if (v.expira <= t) mapa.delete(k); };
  function chaveDe(req, quemId) {
    const c = req.headers['x-idempotencia'];
    if (!c || !['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) return null;
    if (!RE_CHAVE.test(String(c))) return null;
    return `${quemId || 'anon'}:${req.method}:${String(req.url).split('?')[0]}:${c}`;
  }
  /** Devolve {repetida: {status, corpo}} | {aguardar: Promise} | {entrada} (nova). */
  function comecar(chave) {
    if (mapa.size >= max) limpar();
    const e = mapa.get(chave);
    if (e && e.expira > agora()) {
      if (e.feito) return { repetida: e.resposta };
      return { aguardar: e.promessa };
    }
    let resolver;
    const entrada = { feito: false, expira: agora() + ttlMs, resposta: null, promessa: new Promise(r => { resolver = r; }) };
    entrada.terminar = (status, corpo) => {
      if (entrada.feito) return;
      if (status >= 500) { mapa.delete(chave); resolver(null); return; }
      entrada.feito = true; entrada.resposta = { status, corpo }; resolver(entrada.resposta);
    };
    mapa.set(chave, entrada);
    return { entrada };
  }
  return { chaveDe, comecar, _mapa: mapa };
}

/* ---------------- valor pago e distribuição ---------------- */
const COLS_VALOR = 'id,nome,telefone,servico,carro_modelo,valor_orcado,valor_pago,status,origem,observacoes,closed_at,created_at,responsavel_id,cliente_id';
const RE_CORTESIA = /^Cortesia: sem cobrança$/m;
const ehCortesia = obs => RE_CORTESIA.test(String(obs ?? ''));
const comCortesia = obs => { const s = String(obs ?? '').trim(); return ehCortesia(s) ? s : (s ? s.slice(0, 3970) + '\n' : '') + 'Cortesia: sem cobrança'; };
const r2 = v => Math.round((Number(v) || 0) * 100) / 100;
const pedacos = (lista, n) => { const out = []; for (let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n)); return out; };

async function rotasR4(c) {
  const { req, res, url, pathname: p, quem, json, lerCorpo, freio } = c;
  const m = req.method;
  const sb = c.sb;
  const gestor = ehGestor(quem.papel);
  const exigirGestor = msg => { if (!gestor) throw falha(403, msg, { codigo: 'so_gestor' }); };
  const frear = (nome, teto, janela) => { if (!freio.dentro(`${nome}:${quem.id}`, teto, janela)) throw falha(429, 'Muitos pedidos seguidos. Espere um pouco.'); };
  const precisa = () => { if (!sb) throw falha(503, 'Disponível só com o banco compartilhado (Supabase).'); return sb; };

  /* ---------- concluídos sem valor pago (com sugestões) ---------- */
  if (p === '/api/leads/sem-valor' && m === 'GET') {
    precisa();
    frear('sem-valor', 30, 60_000);
    let q = () => { let x = sb.from('leads').select(COLS_VALOR).eq('status', 'concluido'); if (!gestor || url.searchParams.get('meus') === '1') x = x.eq('responsavel_id', quem.id); return x.order('id'); };
    const { data, error } = await todas(q);
    if (error) throw falha(503, 'Não consegui ler os leads concluídos.');
    const lista = (data || []).filter(l => !(Number(l.valor_pago) > 0) && !ehCortesia(l.observacoes))
      .sort((a, b) => String(b.closed_at || b.created_at).localeCompare(String(a.closed_at || a.created_at)));
    const ids = lista.map(l => l.id);
    const agend = new Map(), orc = new Map();
    for (const parte of pedacos(ids, 150)) {
      const [ra, ro] = await Promise.all([
        sb.from('agendamentos').select('lead_id,valor,data').in('lead_id', parte),
        sb.from('orc_orcamentos').select('lead_id,total,status,created_at').in('lead_id', parte),
      ]);
      for (const a of ra.data || []) if (Number(a.valor) > 0 && (!agend.has(a.lead_id) || String(a.data) > String(agend.get(a.lead_id).data))) agend.set(a.lead_id, a);
      for (const o of ro.data || []) if (Number(o.total) > 0 && o.status !== 'recusado' && (!orc.has(o.lead_id) || String(o.created_at) > String(orc.get(o.lead_id).created_at))) orc.set(o.lead_id, o);
    }
    json(res, 200, { total: lista.length, leads: lista.map(l => ({ ...l, valor_orcado: r2(l.valor_orcado), valor_pago: r2(l.valor_pago),
      sugestoes: { agendamento: agend.has(l.id) ? r2(agend.get(l.id).valor) : null, orcamento: orc.has(l.id) ? r2(orc.get(l.id).total) : null } })) });
    return true;
  }

  /* ---------- preencher valor pago em lote (gestor) ---------- */
  if (p === '/api/leads/valores-lote' && m === 'POST') {
    precisa();
    exigirGestor('Só um gestor preenche valores em lote. Peça ao gestor ou preencha na ficha de cada lead.');
    frear('valores-lote', 20, 60_000);
    const b = await lerCorpo();
    const itens = Array.isArray(b.itens) ? b.itens : [];
    if (!itens.length || itens.length > 300) throw falha(400, 'Envie de 1 a 300 valores.');
    const vistos = new Set(), limpos = [];
    for (const x of itens) {
      if (!x || !ehUuid(x.id) || vistos.has(x.id)) throw falha(400, 'Lista com lead inválido ou repetido.');
      vistos.add(x.id);
      if (x.cortesia === true) { limpos.push({ id: x.id, cortesia: true }); continue; }
      const v = Number(x.valor_pago);
      if (!Number.isFinite(v) || v <= 0 || v > 10_000_000) throw falha(400, 'Valor entre R$ 0,01 e R$ 10 milhões (ou marque cortesia).');
      limpos.push({ id: x.id, valor_pago: r2(v) });
    }
    const atuais = new Map();
    for (const parte of pedacos(limpos.map(x => x.id), 150)) {
      const { data, error } = await sb.from('leads').select('id,nome,status,valor_pago,observacoes').in('id', parte);
      if (error) throw falha(503, 'Não consegui ler os leads.');
      for (const l of data || []) atuais.set(l.id, l);
    }
    const feitos = [], pulados = [];
    for (const x of limpos) {
      const a = atuais.get(x.id);
      if (!a) { pulados.push({ id: x.id, motivo: 'não existe mais' }); continue; }
      if (a.status !== 'concluido') { pulados.push({ id: x.id, nome: a.nome, motivo: 'não está mais concluído' }); continue; }
      if (Number(a.valor_pago) > 0) { pulados.push({ id: x.id, nome: a.nome, motivo: 'alguém já preencheu' }); continue; }
      const depois = x.cortesia ? { valor_pago: 0, observacoes: comCortesia(a.observacoes) } : { valor_pago: x.valor_pago };
      let q = sb.from('leads').update(depois).eq('id', x.id).eq('status', 'concluido');
      const { data, error } = await q.select('id,valor_pago,observacoes').maybeSingle();
      if (error || !data) { pulados.push({ id: x.id, nome: a.nome, motivo: 'não consegui gravar' }); continue; }
      feitos.push({ id: x.id, nome: a.nome, antes: { valor_pago: r2(a.valor_pago), observacoes: a.observacoes ?? '' }, depois: { valor_pago: r2(data.valor_pago), observacoes: data.observacoes ?? '' } });
    }
    if (feitos.length) await c.auditar(quem, 'valores_lote', { tabela: 'leads', detalhes: { quantidade: feitos.length, total: r2(feitos.reduce((s, f) => s + f.depois.valor_pago, 0)), cortesias: limpos.filter(x => x.cortesia).length, ids: feitos.map(f => f.id).slice(0, 300) } });
    c.limparStats?.();
    json(res, 200, { ok: true, atualizados: feitos.length, feitos, pulados });
    return true;
  }
  if (p === '/api/leads/valores-lote/desfazer' && m === 'POST') {
    precisa();
    exigirGestor('Só um gestor desfaz valores em lote.');
    frear('valores-lote', 20, 60_000);
    const b = await lerCorpo();
    const itens = Array.isArray(b.itens) ? b.itens.slice(0, 300) : [];
    if (!itens.length) throw falha(400, 'Nada para desfazer.');
    let voltaram = 0; const pulados = [];
    for (const x of itens) {
      if (!x || !ehUuid(x.id) || !x.antes || !x.depois) continue;
      // só volta se ninguém mexeu depois (valor ainda é o que o lote gravou)
      const { data: a } = await sb.from('leads').select('id,valor_pago').eq('id', x.id).maybeSingle();
      if (!a || r2(a.valor_pago) !== r2(x.depois.valor_pago)) { pulados.push(x.id); continue; }
      const { error } = await sb.from('leads').update({ valor_pago: r2(x.antes.valor_pago), observacoes: texto(x.antes.observacoes, 4000) }).eq('id', x.id);
      if (error) pulados.push(x.id); else voltaram++;
    }
    await c.auditar(quem, 'valores_lote_desfeito', { tabela: 'leads', detalhes: { quantidade: voltaram, pulados: pulados.length } });
    c.limparStats?.();
    json(res, 200, { ok: true, voltaram, pulados });
    return true;
  }

  /* ---------- distribuição em lote (gestor) ---------- */
  if (p === '/api/leads/distribuir' && m === 'POST') {
    precisa();
    exigirGestor('Só um gestor distribui leads. Peça ao gestor da loja.');
    frear('distribuir', 10, 60_000);
    const eq = c.equipe; if (!eq) throw falha(503, 'Equipe indisponível.');
    const b = await lerCorpo();
    const grupos = b.grupos && typeof b.grupos === 'object' && !Array.isArray(b.grupos) ? b.grupos : null;
    if (!grupos || !Object.keys(grupos).length) throw falha(400, 'Monte a prévia antes de gravar.');
    const vistos = new Set();
    let total = 0;
    for (const [pid, ids] of Object.entries(grupos)) {
      if (!ehUuid(pid) || !Array.isArray(ids)) throw falha(400, 'Distribuição inválida.');
      for (const id of ids) { if (!ehUuid(id) || vistos.has(id)) throw falha(400, 'Lead inválido ou repetido na distribuição.'); vistos.add(id); }
      total += ids.length;
    }
    if (!total || total > 1000) throw falha(400, 'Distribua de 1 a 1.000 leads por vez.');
    const pessoas = {};
    for (const pid of Object.keys(grupos)) {
      const v = await eq.vendedor(pid);
      if (!v) throw falha(400, 'Uma das pessoas escolhidas não pode receber leads do CRM (desativada ou sem acesso).');
      pessoas[pid] = v.nome || 'Sem nome';
    }
    const itens = [], pulados = [];
    for (const [pid, ids] of Object.entries(grupos)) {
      for (const parte of pedacos(ids, 150)) {
        // só quem continua sem dono: se alguém pegou o lead depois da prévia, ele fica com quem pegou
        const { data, error } = await sb.from('leads').update({ responsavel_id: pid }).in('id', parte).is('responsavel_id', null).select('id');
        if (error) throw falha(503, `Gravei ${itens.length} e parei: não consegui gravar o resto. Confira e tente de novo.`);
        const ok = new Set((data || []).map(x => x.id));
        for (const id of parte) if (ok.has(id)) itens.push({ id, para: pid }); else pulados.push(id);
      }
    }
    // o gatilho do banco manda uma notificação por lead: troca por um aviso só por pessoa
    for (const pid of Object.keys(grupos)) {
      const meus = itens.filter(x => x.para === pid);
      for (const parte of pedacos(meus.map(x => `lead:${x.id}:${pid}`), 150)) {
        try { await sb.from('notificacoes').delete().eq('perfil_id', pid).in('chave', parte); } catch { /* aviso extra não atrapalha */ }
      }
    }
    let lote = null;
    try {
      const { data, error } = await sb.from('crm_distribuicoes').insert({ criado_por: quem.id, modo: b.modo === 'carga' ? 'carga' : 'igual',
        filtros: b.filtros && typeof b.filtros === 'object' && !Array.isArray(b.filtros) ? Object.fromEntries(Object.entries(b.filtros).slice(0, 10).map(([k, v]) => [String(k).slice(0, 20), Array.isArray(v) ? v.slice(0, 10).map(x => String(x).slice(0, 30)) : String(v ?? '').slice(0, 40)])) : null,
        total: itens.length, itens }).select('id').single();
      if (!error && data) lote = data.id;
    } catch { /* sem a tabela: segue sem desfazer pelo servidor */ }
    for (const pid of Object.keys(grupos)) {
      const n = itens.filter(x => x.para === pid).length;
      if (!n) continue;
      try { await sb.rpc('notificar', { p_perfil: pid, p_tipo: 'lead', p_titulo: `Você recebeu ${n} lead${n === 1 ? '' : 's'} para cuidar`, p_corpo: `Distribuição feita por ${quem.nome || 'um gestor'}. Veja em Leads › Meus leads.`, p_link: (c.prefixo || '') + '/?meus=1', p_app: 'crm', p_chave: `distribuicao:${lote || Date.now()}:${pid}` }); } catch { /* sem aviso */ }
    }
    await c.auditar(quem, 'distribuir_leads', { tabela: 'leads', registro: lote, detalhes: { quantidade: itens.length, pulados: pulados.length, porPessoa: Object.fromEntries(Object.keys(grupos).map(pid => [pid, itens.filter(x => x.para === pid).length])) } });
    c.limparStats?.();
    json(res, 200, { ok: true, lote, atualizados: itens.length, pulados: pulados.length, porPessoa: Object.keys(grupos).map(pid => ({ id: pid, nome: pessoas[pid], recebeu: itens.filter(x => x.para === pid).length })), itens });
    return true;
  }
  if (p === '/api/leads/distribuicoes' && m === 'GET') {
    precisa();
    exigirGestor('Só um gestor vê as distribuições.');
    const { data, error } = await sb.from('crm_distribuicoes').select('id,criado_por,created_at,modo,total,itens,desfeita_em,desfeita_por').order('created_at', { ascending: false }).limit(10);
    if (error) { json(res, 200, { distribuicoes: [], indisponivel: true }); return true; }
    const ids = [...new Set((data || []).flatMap(d => [d.criado_por, d.desfeita_por, ...(d.itens || []).map(i => i.para)]).filter(Boolean))];
    const { data: ps } = ids.length ? await sb.from('perfis').select('id,nome').in('id', ids) : { data: [] };
    const nome = new Map((ps || []).map(x => [x.id, x.nome]));
    json(res, 200, { distribuicoes: (data || []).map(d => {
      const por = {}; for (const i of d.itens || []) por[i.para] = (por[i.para] || 0) + 1;
      return { id: d.id, em: d.created_at, por: nome.get(d.criado_por) || 'Sem nome', modo: d.modo, total: d.total, desfeita_em: d.desfeita_em, desfeita_por: d.desfeita_por ? (nome.get(d.desfeita_por) || 'Sem nome') : null,
        pessoas: Object.entries(por).map(([id, n]) => ({ id, nome: nome.get(id) || 'Fora da equipe', recebeu: n })) };
    }) });
    return true;
  }
  const md = p.match(/^\/api\/leads\/distribuicoes\/([^/]+)\/desfazer$/);
  if (md && m === 'POST') {
    precisa();
    exigirGestor('Só um gestor desfaz uma distribuição.');
    frear('distribuir', 10, 60_000);
    if (!ehUuid(md[1])) throw falha(400, 'Distribuição inválida.');
    const { data: d, error } = await sb.from('crm_distribuicoes').select('id,itens,desfeita_em,created_at').eq('id', md[1]).maybeSingle();
    if (error) throw falha(503, 'Não consegui ler a distribuição.');
    if (!d) throw falha(404, 'Distribuição não encontrada.');
    if (d.desfeita_em) throw falha(409, 'Esta distribuição já foi desfeita.');
    const porPessoa = {};
    for (const i of d.itens || []) if (ehUuid(i.id) && ehUuid(i.para)) (porPessoa[i.para] = porPessoa[i.para] || []).push(i.id);
    let voltaram = 0, ficaram = 0;
    for (const [pid, ids] of Object.entries(porPessoa)) {
      for (const parte of pedacos(ids, 150)) {
        // só tira de quem recebeu na distribuição (se já passou para outro, fica)
        const { data, error: e2 } = await sb.from('leads').update({ responsavel_id: null }).in('id', parte).eq('responsavel_id', pid).select('id');
        if (e2) throw falha(503, `Desfiz ${voltaram} e parei. Tente de novo para terminar.`);
        voltaram += (data || []).length; ficaram += parte.length - (data || []).length;
      }
      try { await sb.from('notificacoes').delete().eq('perfil_id', pid).eq('chave', `distribuicao:${d.id}:${pid}`); } catch { /* ignora */ }
    }
    await sb.from('crm_distribuicoes').update({ desfeita_em: new Date().toISOString(), desfeita_por: quem.id }).eq('id', d.id);
    await c.auditar(quem, 'distribuir_desfeita', { tabela: 'leads', registro: d.id, detalhes: { voltaram, ficaram } });
    c.limparStats?.();
    json(res, 200, { ok: true, voltaram, ficaram });
    return true;
  }
  return false;
}

const COMPRIMIVEL_TIPO = tipo => COMPRIMIVEL.test(String(tipo || ''));
module.exports = { COMPRIMIVEL_TIPO, codificacao, comprimir, corpoParaEnviar, criarEstaticos, criarIdempotencia, rotasR4, ehCortesia, comCortesia };
