/* ============================================================
   IndyCar CRM — rotas da rodada 3 (equipe, metas, tarefas,
   automações, auditoria). Todas exigem login (o porteiro do
   server.js já conferiu papel e app). Erros saem por ErroHttp.
   Devolve true quando tratou a rota.
   ============================================================ */
'use strict';

const crypto = require('node:crypto');
const U = require('./util-servidor');
const { ehUuid, falha, ehGestor, texto } = U;

const sim = v => v === '1' || v === 'true' || v === 'sim';

async function rotasR3(c) {
  const { req, res, url, pathname: p, quem, json, lerCorpo, freio } = c;
  const m = req.method;
  const exigirGestor = (msg = 'Só um gestor pode fazer isso.') => { if (!ehGestor(quem.papel)) throw falha(403, msg); };
  const exigirAdmin = (msg = 'Só o administrador pode fazer isso.') => { if (quem.papel !== 'admin') throw falha(403, msg); };
  const frear = (nome, teto, janelaMs) => { if (!freio.dentro(`${nome}:${quem.id}`, teto, janelaMs)) throw falha(429, 'Muitos pedidos seguidos. Espere um pouco.'); };
  const precisa = (x, nome) => { if (!x) throw falha(503, `${nome} disponível só com o banco compartilhado (Supabase).`); return x; };

  /* ---------- quem sou eu ---------- */
  if (p === '/api/eu' && m === 'GET') { json(res, 200, await c.acesso.eu(quem)); return true; }

  /* ---------- vendedores (para filtros e atribuição) ---------- */
  if (p === '/api/vendedores' && m === 'GET') {
    const eq = precisa(c.equipe, 'Equipe');
    const [gente, carga] = await Promise.all([eq.vendedores(), eq.cargas()]);
    json(res, 200, { vendedores: gente.map(v => ({ ...eq.publico(v), abertos: carga.get(v.id) || 0, eu: v.id === quem.id })) });
    return true;
  }

  /* ---------- responsável do lead ---------- */
  const mr = p.match(/^\/api\/leads\/([^/]+)\/responsavel$/);
  if (mr && (m === 'PATCH' || m === 'PUT' || m === 'POST')) {
    const eq = precisa(c.equipe, 'Responsável');
    if (!ehUuid(mr[1])) throw falha(400, 'Lead inválido.');
    frear('atribuir', 120, 60_000);
    const b = await lerCorpo();
    if (!('responsavel_id' in b)) throw falha(400, 'Informe responsavel_id (ou null para tirar o dono).');
    const novo = b.responsavel_id === 'eu' ? quem.id : b.responsavel_id;
    json(res, 200, await eq.atribuir(mr[1], novo === '' ? null : novo, quem, { motivo: texto(b.motivo, 200) || null }));
    c.limparStats?.();
    return true;
  }
  if (p === '/api/leads/responsavel-lote' && m === 'POST') {
    const eq = precisa(c.equipe, 'Distribuição');
    exigirGestor('Só um gestor distribui leads em lote.');
    frear('lote', 20, 60_000);
    const b = await lerCorpo();
    if (!('responsavel_id' in b)) throw falha(400, 'Informe responsavel_id (ou null).');
    json(res, 200, await eq.atribuirLote(b.ids, b.responsavel_id === '' ? null : b.responsavel_id, quem));
    c.limparStats?.();
    return true;
  }
  if (p === '/api/rodizio' && m === 'POST') {
    const eq = precisa(c.equipe, 'Rodízio');
    exigirGestor('Só um gestor roda o rodízio.');
    frear('rodizio', 10, 60_000);
    const b = await lerCorpo();
    const r = await eq.rodizio({ executar: b.simular !== true, quem, horas: b.horas, todos: b.todos === true, limite: b.limite });
    json(res, 200, r);
    c.limparStats?.();
    return true;
  }

  /* ---------- desempenho e ranking ---------- */
  if ((p === '/api/desempenho' || p === '/api/ranking') && m === 'GET') {
    const eq = precisa(c.equipe, 'Desempenho');
    frear('desempenho', 30, 60_000);
    const r = await eq.desempenho({ mes: url.searchParams.get('mes') || undefined, dias: url.searchParams.get('dias') ?? undefined });
    if (p === '/api/ranking') { json(res, 200, { periodo: r.periodo, ranking: r.ranking }); return true; }
    // atendente vê o ranking e os próprios números; gestor vê todo mundo
    if (!ehGestor(quem.papel)) r.pessoas = r.pessoas.filter(x => x.perfil_id === quem.id);
    json(res, 200, r);
    return true;
  }

  /* ---------- metas ---------- */
  if (p === '/api/metas' && m === 'GET') {
    const eq = precisa(c.equipe, 'Metas');
    frear('metas', 30, 60_000);
    json(res, 200, await eq.lerMetas({ mes: url.searchParams.get('mes') || undefined }));
    return true;
  }
  if (p === '/api/metas' && (m === 'PUT' || m === 'POST')) {
    const eq = precisa(c.equipe, 'Metas');
    exigirGestor('Só um gestor define metas.');
    frear('metas-gravar', 30, 60_000);
    const b = await lerCorpo();
    if (Array.isArray(b.metas)) {
      if (!b.metas.length || b.metas.length > 30) throw falha(400, 'Envie de 1 a 30 metas.');
      for (const x of b.metas) eq.validarMeta({ mes: b.mes, ...x });          // valida tudo antes de gravar
      const gravadas = [];
      for (const x of b.metas) gravadas.push(await eq.gravarMeta({ mes: b.mes, ...x }, quem));
      json(res, 200, { ok: true, metas: gravadas });
    } else json(res, 200, { ok: true, meta: await eq.gravarMeta(b, quem) });
    return true;
  }

  /* ---------- tarefas ---------- */
  if (p === '/api/tarefas' && m === 'GET') {
    const t = precisa(c.tarefas, 'Tarefas');
    const q = url.searchParams;
    json(res, 200, await t.listar({ quem, minhas: sim(q.get('minhas')), leadId: q.get('lead') || undefined, clienteId: q.get('cliente') || undefined,
      status: q.get('status') || 'aberta', responsavel: q.get('responsavel') === 'eu' ? quem.id : (q.get('responsavel') || undefined), limite: q.get('limite') }));
    return true;
  }
  if (p === '/api/tarefas' && m === 'POST') {
    const t = precisa(c.tarefas, 'Tarefas');
    frear('tarefa', 60, 60_000);
    const b = await lerCorpo();
    if (b.responsavel_id === 'eu') b.responsavel_id = quem.id;
    json(res, 201, await t.criar(b, quem, { origem: 'crm' }));
    return true;
  }
  const mt = p.match(/^\/api\/tarefas\/([^/]+)$/);
  if (mt) {
    const t = precisa(c.tarefas, 'Tarefas');
    if (!ehUuid(mt[1])) throw falha(400, 'Tarefa inválida.');
    if (m === 'GET') { json(res, 200, await t.ler(mt[1])); return true; }
    if (m === 'PATCH') { const b = await lerCorpo(); if (b.responsavel_id === 'eu') b.responsavel_id = quem.id; json(res, 200, await t.atualizar(mt[1], b, quem)); return true; }
    if (m === 'DELETE') { json(res, 200, await t.apagar(mt[1], quem)); return true; }
    throw falha(405, 'método não permitido');
  }

  /* ---------- automações ---------- */
  if (p === '/api/automacoes' && m === 'GET') {
    exigirGestor('Só um gestor vê as automações.');
    const a = c.automacoes;
    json(res, 200, { disponivel: !!a, ligadas: !!c.automacoesLigadas, intervaloMin: c.intervaloMin || null, regras: a ? a.REGRAS : [],
      rodando: a ? a.rodando() : false, ultimo: a ? a.ultimo() : null, agendador: !!c.tokenAgendador });
    return true;
  }
  if (p === '/api/automacoes/rodar' && m === 'POST') {
    const a = precisa(c.automacoes, 'Automações');
    exigirGestor('Só um gestor roda as automações.');
    frear('automacoes', 6, 60_000);
    const b = await lerCorpo();
    const r = await a.ciclo({ origem: 'manual', quem, regras: b.regras });
    json(res, r.ocupado ? 409 : 200, r);
    c.limparStats?.();
    return true;
  }

  /* ---------- auditoria ---------- */
  if (p === '/api/auditoria/exportacao' && m === 'POST') {
    frear('exportar', 30, 600_000);
    const b = await lerCorpo();
    const tipo = ['leads', 'clientes', 'tarefas', 'desempenho'].includes(b.tipo) ? b.tipo : 'leads';
    const qtd = Math.max(0, Math.min(1_000_000, Math.round(Number(b.quantidade) || 0)));
    const filtros = b.filtros && typeof b.filtros === 'object' && !Array.isArray(b.filtros)
      ? Object.fromEntries(Object.entries(b.filtros).slice(0, 12).map(([k, v]) => [String(k).slice(0, 30), typeof v === 'object' ? null : String(v ?? '').slice(0, 60)])) : null;
    await c.auditar(quem, 'exportar_csv', { tabela: tipo, detalhes: { quantidade: qtd, filtros } });
    json(res, 200, { ok: true });
    return true;
  }
  if (p === '/api/auditoria' && m === 'GET') {
    exigirAdmin('Só o administrador lê a auditoria.');
    const sb = precisa(c.sb, 'Auditoria');
    const lim = Math.max(1, Math.min(200, Math.round(Number(url.searchParams.get('limite')) || 50)));
    let q = sb.from('auditoria').select('id,perfil_id,app,acao,tabela,registro_id,campos,detalhes,created_at');
    if (url.searchParams.get('app') !== 'todos') q = q.eq('app', 'crm');
    const { data, error } = await q.order('created_at', { ascending: false }).limit(lim);
    if (error) throw falha(503, 'Não consegui ler a auditoria.');
    const ids = [...new Set((data || []).map(x => x.perfil_id).filter(Boolean))];
    const { data: ps } = ids.length ? await sb.from('perfis').select('id,nome').in('id', ids) : { data: [] };
    const nomes = new Map((ps || []).map(x => [x.id, x.nome]));
    json(res, 200, { registros: (data || []).map(x => ({ ...x, quem: x.perfil_id ? (nomes.get(x.perfil_id) || 'Sem nome') : 'Sistema' })) });
    return true;
  }

  /* ---------- equipe (rodada 3) ---------- */
  if (p === '/api/equipe/apps' && m === 'POST') {
    exigirAdmin('Só o administrador muda os apps de alguém.');
    const sb = precisa(c.sb, 'Equipe');
    const b = await lerCorpo();
    if (!ehUuid(b.id)) throw falha(400, 'Informe quem você quer alterar.');
    if (!Array.isArray(b.apps) || b.apps.some(a => !U.APPS.includes(a))) throw falha(400, `Apps válidos: ${U.APPS.join(', ')}.`);
    const { data: alvo } = await sb.from('perfis').select('id,papel,apps').eq('id', b.id).maybeSingle();
    if (!alvo) throw falha(404, 'Pessoa não encontrada.');
    const apps = alvo.papel === 'agenda' ? ['agenda'] : [...new Set(b.apps)];
    const { error } = await sb.from('perfis').update({ apps }).eq('id', b.id);
    if (error) throw falha(503, 'Não consegui salvar os apps.');
    c.acesso.esquecer(b.id);
    await c.auditar(quem, 'equipe_apps', { tabela: 'perfis', registro: b.id, detalhes: { antes: alvo.apps, depois: apps } });
    json(res, 200, { ok: true, apps });
    return true;
  }
  if (p === '/api/equipe/recebe-leads' && m === 'POST') {
    exigirGestor('Só um gestor muda quem recebe leads.');
    const sb = precisa(c.sb, 'Equipe');
    const b = await lerCorpo();
    if (!ehUuid(b.id) || typeof b.recebe_leads !== 'boolean') throw falha(400, 'Informe id e recebe_leads (true/false).');
    const { data, error } = await sb.from('perfis').update({ recebe_leads: b.recebe_leads }).eq('id', b.id).select('id,recebe_leads').maybeSingle();
    if (error) throw falha(503, 'Não consegui salvar.');
    if (!data) throw falha(404, 'Pessoa não encontrada.');
    await c.auditar(quem, 'equipe_recebe_leads', { tabela: 'perfis', registro: b.id, detalhes: { recebe_leads: b.recebe_leads } });
    json(res, 200, { ok: true, recebe_leads: data.recebe_leads });
    return true;
  }
  if (p === '/api/equipe/senha-temporaria' && m === 'POST') {
    exigirAdmin('Só o administrador gera senha temporária.');
    const sb = precisa(c.sb, 'Equipe');
    frear('senha-temp', 5, 600_000);
    const b = await lerCorpo();
    if (!ehUuid(b.id)) throw falha(400, 'Informe quem vai receber a senha.');
    if (b.id === quem.id) throw falha(400, 'Para a sua própria senha, use "Trocar senha" no seu perfil.');
    const { data: alvo } = await sb.from('perfis').select('id,ativo').eq('id', b.id).maybeSingle();
    if (!alvo) throw falha(404, 'Pessoa não encontrada.');
    // 12 caracteres sem os que confundem (0/O, 1/l/I)
    const alfabeto = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const senha = Array.from(crypto.randomBytes(12), x => alfabeto[x % alfabeto.length]).join('');
    const { error } = await sb.auth.admin.updateUserById(b.id, { password: senha });
    if (error) throw falha(503, 'Não consegui trocar a senha agora.');
    await sb.from('perfis').update({ precisa_trocar_senha: true }).eq('id', b.id);
    c.acesso.esquecer(b.id);
    await c.auditar(quem, 'equipe_senha_temporaria', { tabela: 'perfis', registro: b.id, detalhes: { gerada: true } });
    json(res, 200, { ok: true, senha, aviso: 'Mostre esta senha só para a pessoa. No primeiro login ela vai precisar trocar.' });
    return true;
  }

  return false;
}

module.exports = { rotasR3 };
