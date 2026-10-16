/* ============================================================
   IndyCar CRM — rodada 5 (16/10/2026), servidor
   - ficha 360 pela rpc `cliente_360` (uma chamada, tudo do cliente)
   - busca global (nome, telefone, placa) em leads e clientes
   - leads sem dono: resumo + rodízio SUGERIDO (o gestor aplica)
   - mandar leads para uma campanha do Comunicar (proposta que o gestor aprova lá)
   - filtros salvos por pessoa (perfis.preferencias.crm_filtros)
   - previsão de faturamento pelo funil (para o resumo da IA e o painel)
   - motivos de perda padronizados
   - parâmetros certos por modelo da Claude (Sonnet pensa entre ferramentas;
     Opus/Haiku usam effort)
   Funções puras no topo (testáveis sem banco); rotas embaixo.
   ============================================================ */
'use strict';

const U = require('./util-servidor');
const APPS = require('./apps');
const { ehUuid, falha, ehGestor, texto, r2 } = U;

const DIA = 864e5;
const ABERTAS = ['novo', 'contato', 'orcamento', 'agendado', 'em_servico'];

/* ---------------- telefone ---------------- */
/** Só dígitos, sem o 55: 'DDDNÚMERO' (10 ou 11 dígitos) ou null. Mesma regra de `telefone_e164`. */
function normalizarTelefone(v) {
  let d = String(v ?? '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  return d.length === 10 || d.length === 11 ? d : null;
}
/** Variações com e sem o nono dígito (cadastros antigos). */
function variantesTelefone(v) {
  const d = normalizarTelefone(v);
  if (!d) return [];
  const out = new Set([d]);
  if (d.length === 11 && d[2] === '9') out.add(d.slice(0, 2) + d.slice(3));
  if (d.length === 10) out.add(d.slice(0, 2) + '9' + d.slice(2));
  return [...out];
}

/* ---------------- motivos de perda (meio-termo: lista curta + "Outro") ---------------- */
const MOTIVOS_PERDA = ['Achou caro', 'Foi em outra oficina', 'Sem retorno do cliente', 'Desistiu do serviço', 'Não fazemos o serviço', 'Prazo não atendeu', 'Outro'];
const RE_MOTIVO = /^Motivo da perda: (.+)$/m;
const motivoDe = obs => { const m = RE_MOTIVO.exec(String(obs ?? '')); return m ? m[1].trim() : null; };
/** Texto livre → motivo padrão (para relatórios e IA). Mantém o texto original como detalhe. */
function motivoPadrao(t) {
  const s = String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (!s.trim()) return null;
  if (/caro|preco|valor|dinheiro|orcamento alto|barato/.test(s)) return 'Achou caro';
  if (/outra oficina|concorr|fez em outro|outro lugar|outra loja/.test(s)) return 'Foi em outra oficina';
  if (/sem retorno|nao respond|sumiu|nao atend|silencio|parou de responder/.test(s)) return 'Sem retorno do cliente';
  if (/desist|nao quer|mudou de ideia|vendeu o carro|nao vai fazer/.test(s)) return 'Desistiu do serviço';
  if (/nao fazemos|nao trabalhamos|fora do escopo|nao atendemos/.test(s)) return 'Não fazemos o serviço';
  if (/prazo|demor|tempo|urgen|amanh|pra hoje|para hoje|rapid|data/.test(s)) return 'Prazo não atendeu';
  const exato = MOTIVOS_PERDA.find(m => m.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() === s.trim());
  return exato || 'Outro';
}

/* ---------------- modelos da Claude ---------------- */
/** Sonnet 5.5 pensa por padrão: desliga com thinking between_tools. Opus/Haiku recusam isso: usam effort. */
function parametrosModelo(modelo) {
  return /sonnet/i.test(String(modelo || '')) ? { thinking: { type: 'between_tools' } } : { output_config: { effort: 'low' } };
}

/* ---------------- previsão de faturamento pelo funil ---------------- */
/* Chance de um lead de cada etapa virar venda. Ajustada pela conversão real dos últimos 90 dias. */
const CHANCE_BASE = { novo: 0.10, contato: 0.25, orcamento: 0.45, agendado: 0.70, em_servico: 0.90 };
const ms = v => { const t = Date.parse(v || ''); return Number.isFinite(t) ? t : NaN; };
/**
 * previsaoPipeline(leads, agora) → { previsto, emAberto, leadsAbertos, semValor, conversaoHistorica, fator, porEtapa[] }
 * - previsto: soma de valor_orcado × chance da etapa (só leads com valor);
 * - semValor: leads abertos sem valor orçado (ficam fora da conta — a tela avisa);
 * - conversaoHistorica: concluídos ÷ (concluídos + perdidos) fechados nos últimos 90 dias.
 */
function previsaoPipeline(leads, agora = Date.now()) {
  const lista = Array.isArray(leads) ? leads : [];
  const desde = agora - 90 * DIA;
  const fechados = lista.filter(l => ['concluido', 'perdido'].includes(l.status) && ms(l.closed_at || l.updated_at || l.created_at) >= desde);
  const ganhos = fechados.filter(l => l.status === 'concluido').length;
  const conv = fechados.length >= 10 ? ganhos / fechados.length : null;        // com menos de 10 fechamentos a amostra não diz nada
  const fator = conv == null ? 1 : Math.max(0.5, Math.min(1.5, conv / 0.4));
  const porEtapa = ABERTAS.map(etapa => {
    const its = lista.filter(l => l.status === etapa);
    const comValor = its.filter(l => Number(l.valor_orcado) > 0);
    const valor = r2(comValor.reduce((s, l) => s + Number(l.valor_orcado), 0));
    const chance = Math.min(0.95, r2(CHANCE_BASE[etapa] * fator));
    return { etapa, leads: its.length, comValor: comValor.length, valor, chance, previsto: r2(valor * chance) };
  });
  const abertos = lista.filter(l => ABERTAS.includes(l.status));
  return {
    previsto: r2(porEtapa.reduce((s, e) => s + e.previsto, 0)),
    emAberto: r2(porEtapa.reduce((s, e) => s + e.valor, 0)),
    leadsAbertos: abertos.length,
    semValor: abertos.filter(l => !(Number(l.valor_orcado) > 0)).length,
    conversaoHistorica: conv == null ? null : Math.round(conv * 1000) / 10,
    fechados90: fechados.length, fator: r2(fator), porEtapa,
  };
}

/* ---------------- leads sem dono: resumo e rodízio sugerido ---------------- */
const idade = (l, agora) => { const t = ms(l.created_at); return Number.isFinite(t) ? Math.floor((agora - t) / DIA) : 0; };
const FAIXAS = [['ate7', 0, 7, 'até 7 dias'], ['7a30', 7, 30, '7 a 30 dias'], ['30a90', 30, 90, '30 a 90 dias'], ['mais90', 90, Infinity, 'mais de 90 dias']];
function resumoSemDono(leads, agora = Date.now()) {
  const sem = (leads || []).filter(l => l && !l.responsavel_id && ABERTAS.includes(l.status));
  const conta = (lista, chave) => { const o = {}; for (const l of lista) { const k = chave(l); o[k] = (o[k] || 0) + 1; } return o; };
  return {
    total: sem.length,
    porEtapa: conta(sem, l => l.status),
    porOrigem: conta(sem, l => l.origem || 'organico'),
    porIdade: FAIXAS.map(([chave, a, b, rotulo]) => ({ chave, rotulo, qtd: sem.filter(l => idade(l, agora) >= a && idade(l, agora) < b).length })),
    valorOrcado: r2(sem.reduce((s, l) => s + (Number(l.valor_orcado) || 0), 0)),
    maisAntigo: sem.length ? Math.max(...sem.map(l => idade(l, agora))) : 0,
  };
}
const ORDEM_ETAPA = ['orcamento', 'agendado', 'em_servico', 'contato', 'novo'];
/**
 * Rodízio sugerido: quem tem menos leads abertos recebe primeiro, até igualar; os mais
 * quentes (orçamento, agendado) e mais antigos saem primeiro. NADA é gravado aqui.
 */
function sugerirRodizio(leads, vendedores, { cargas = new Map(), limite = 1000, agora = Date.now() } = {}) {
  const gente = (vendedores || []).filter(v => v && v.id);
  const sem = (leads || []).filter(l => l && !l.responsavel_id && ABERTAS.includes(l.status))
    .sort((a, b) => ORDEM_ETAPA.indexOf(a.status) - ORDEM_ETAPA.indexOf(b.status) || String(a.created_at).localeCompare(String(b.created_at)))
    .slice(0, Math.max(1, Math.min(1000, limite)));
  if (!gente.length) return { total: sem.length, plano: [], resumo: [], grupos: {}, semGente: true };
  const estado = gente.map((v, i) => ({ id: String(v.id), nome: v.nome || 'Sem nome', carga: Number(cargas.get?.(v.id) ?? v.abertos ?? 0) || 0, recebe: 0, i }));
  const plano = [];
  for (const l of sem) {
    const alvo = estado.reduce((m, e) => (e.carga + e.recebe < m.carga + m.recebe || (e.carga + e.recebe === m.carga + m.recebe && e.i < m.i)) ? e : m);
    alvo.recebe++;
    plano.push({ id: String(l.id), nome: l.nome || '', status: l.status, dias: idade(l, agora), para: alvo.id });
  }
  const grupos = {};
  for (const p of plano) (grupos[p.para] = grupos[p.para] || []).push(p.id);
  const resumo = estado.map(e => ({ id: e.id, nome: e.nome, antes: e.carga, recebe: e.recebe, depois: e.carga + e.recebe,
    porEtapa: plano.filter(p => p.para === e.id).reduce((o, p) => { o[p.status] = (o[p.status] || 0) + 1; return o; }, {}) }));
  return { total: plano.length, plano, resumo, grupos, semGente: false };
}

/* ---------------- busca global ---------------- */
const semAcento = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const normaliza = s => semAcento(s).replace(/[^a-z0-9]+/g, ' ').trim();
const alnum = s => semAcento(s).replace(/[^a-z0-9]/g, '');
/**
 * Busca em leads e clientes por nome, telefone (final) ou placa. Devolve o que
 * casou, com o "porque" (nome | telefone | placa) e até `limite` de cada tipo.
 */
function buscaGlobal({ leads = [], clientes = [] }, q, { limite = 8 } = {}) {
  const termo = normaliza(q), dig = String(q ?? '').replace(/\D/g, ''), pl = alnum(q);
  if (termo.length < 2 && dig.length < 4) return { leads: [], clientes: [], termo };
  const casa = x => {
    if (dig.length >= 4 && String(x.telefone ?? '').replace(/\D/g, '').endsWith(dig)) return 'telefone';
    if (pl.length >= 3 && alnum(x.placa).includes(pl) && /\d/.test(pl)) return 'placa';
    if (termo.length >= 2 && normaliza(x.nome).includes(termo)) return 'nome';
    if (termo.length >= 3 && normaliza([x.carro_modelo, x.servico].join(' ')).includes(termo)) return 'carro';
    return null;
  };
  const pega = (lista, mapa) => { const out = []; for (const x of lista) { const por = casa(x); if (por) { out.push({ ...mapa(x), por }); if (out.length >= limite) break; } } return out; };
  const abertoPrimeiro = (a, b) => (ABERTAS.includes(b.status) - ABERTAS.includes(a.status)) || String(b.created_at || '').localeCompare(String(a.created_at || ''));
  return {
    termo,
    leads: pega([...leads].sort(abertoPrimeiro), l => ({ id: l.id, nome: l.nome, telefone: l.telefone, placa: l.placa || null, carro_modelo: l.carro_modelo || null, status: l.status, servico: l.servico || null, responsavel_id: l.responsavel_id || null })),
    clientes: pega(clientes, c => ({ id: c.id, nome: c.nome, telefone: c.telefone, placa: c.placa || null, carro_modelo: c.carro_modelo || null })),
  };
}

/* ---------------- filtros salvos ---------------- */
const CAMPOS_FILTRO = ['status', 'origem', 'resp', 'ordem', 'parados', 'semValor', 'q'];
function validarFiltrosSalvos(lista) {
  if (!Array.isArray(lista)) throw falha(400, 'Envie a lista de filtros.');
  if (lista.length > 12) throw falha(400, 'No máximo 12 filtros salvos.');
  const nomes = new Set();
  return lista.map(f => {
    const nome = texto(f && f.nome, 40).replace(/\s+/g, ' ').trim();
    if (!nome) throw falha(400, 'Cada filtro precisa de um nome.');
    if (nomes.has(nome.toLowerCase())) throw falha(400, `Filtro repetido: ${nome}.`);
    nomes.add(nome.toLowerCase());
    const filtro = {};
    for (const k of CAMPOS_FILTRO) {
      if (!f.filtro || !(k in f.filtro)) continue;
      const v = f.filtro[k];
      filtro[k] = typeof v === 'boolean' ? v : texto(v, 60);
    }
    return { nome, filtro, em: f.em && Number.isFinite(ms(f.em)) ? new Date(f.em).toISOString() : new Date().toISOString() };
  });
}

/* ---------------- campanha do Comunicar a partir de leads ---------------- */
/** Destinos únicos por telefone, no formato que o Comunicar grava em comunicar_campanhas.destinos. */
function destinosDeLeads(leads) {
  const porTel = new Map();
  for (const l of leads || []) {
    const t = normalizarTelefone(l.telefone);
    if (!t) continue;
    const ja = porTel.get(t);
    // o mesmo telefone em dois leads: fica um destino, completando o que faltar (cliente_id, carro, placa)
    if (ja) { if (!ja.cliente_id && l.cliente_id) ja.cliente_id = l.cliente_id; if (!ja.carro && l.carro_modelo) ja.carro = l.carro_modelo; if (!ja.placa && l.placa) ja.placa = l.placa; continue; }
    porTel.set(t, { cliente_id: l.cliente_id || null, telefone: t, nome: l.nome || null, carro: l.carro_modelo || null, placa: l.placa || null, lead_id: l.id });
  }
  return [...porTel.values()];
}
/** Links cruzados da ficha 360 (host de cada app ou irmão na Central). */
function linksFicha(ficha, { prefixo = '' } = {}) {
  const f = ficha || {};
  const ap = (app, c) => APPS.linkApp(app, c, { prefixo });
  const tel = f.telefone_55 ? `/?tel=${encodeURIComponent(f.telefone_55)}` : '/';
  return {
    atendimento: f.conversa?.link ? ap('atendimento', f.conversa.link) : ap('atendimento', tel),
    agenda: ap('agenda', tel), comunicar: ap('comunicar', tel), orcador: ap('orcador', '/'),
    whatsapp: f.telefone_55 ? `https://wa.me/${f.telefone_55}` : null, ligar: f.telefone_55 ? `tel:+${f.telefone_55}` : null,
    conversa: f.conversa?.link ? ap('atendimento', f.conversa.link) : null,
    agendamentos: Object.fromEntries((f.agendamentos || []).map(a => [a.id, ap('agenda', a.link || `/?agendamento=${a.id}`)])),
    patio: Object.fromEntries((f.patio || []).map(o => [o.id, ap('patio', o.link || `/?os=${o.id}`)])),
    orcamentos: Object.fromEntries((f.orcamentos || []).map(o => [o.id, ap('orcador', o.link || `/?orcamento=${o.id}`)])),
    leads: Object.fromEntries((f.leads || []).map(l => [l.id, APPS.linkCrm(l.link || `/?lead=${l.id}`, { prefixo })])),
  };
}

/* ============================================================ rotas */
async function rotasR5(c) {
  const { req, res, url, pathname: p, quem, json, lerCorpo, freio, sb, prefixo = '' } = c;
  const m = req.method;
  const gestor = ehGestor(quem.papel);
  const exigirGestor = msg => { if (!gestor) throw falha(403, msg, { codigo: 'so_gestor' }); };
  const frear = (nome, teto, janela) => { if (!freio.dentro(`${nome}:${quem.id}`, teto, janela)) throw falha(429, 'Muitos pedidos seguidos. Espere um pouco.'); };
  const precisa = () => { if (!sb) throw falha(503, 'Disponível só com o banco compartilhado (Supabase).'); return sb; };

  /* ---------- quem sou eu, com os outros apps no endereço certo (Central: irmãos) ---------- */
  if (p === '/api/eu' && m === 'GET' && c.acesso && prefixo) {
    const eu = await c.acesso.eu(quem);
    eu.outrosApps = (eu.outrosApps || []).map(a => ({ ...a, url: APPS.linkApp(a.app, '/', { prefixo }) || a.url }));
    eu.prefixo = prefixo;
    json(res, 200, eu);
    return true;
  }

  /* ---------- ficha 360 em UMA chamada (rpc cliente_360) ---------- */
  if (p === '/api/clientes/360' && m === 'GET') {
    precisa();
    frear('ficha360', 60, 60_000);
    let tel = url.searchParams.get('tel') || url.searchParams.get('t') || '';
    const cid = url.searchParams.get('cliente');
    if (!normalizarTelefone(tel) && ehUuid(cid)) {
      const { data } = await sb.from('clientes').select('telefone').eq('id', cid).maybeSingle();
      tel = data?.telefone || '';
    }
    if (!normalizarTelefone(tel)) throw falha(400, 'Informe o telefone com DDD (ou um cliente válido).');
    const { data, error } = await sb.rpc('cliente_360', { p_telefone: tel });
    if (error) {
      if (String(error.code) === '42501') throw falha(403, 'Seu papel não pode abrir a ficha completa.');
      if (String(error.code) === '22023') throw falha(400, 'Telefone inválido.');
      if (/não existe|does not exist|function/i.test(String(error.message))) throw falha(503, 'A ficha completa ainda não está disponível no banco (rpc cliente_360).');
      throw falha(503, 'Não consegui montar a ficha agora.');
    }
    const ficha = data && typeof data === 'object' ? data : {};
    json(res, 200, { ...ficha, links: linksFicha(ficha, { prefixo }), motivosPerda: MOTIVOS_PERDA });
    return true;
  }

  /* ---------- busca global (Ctrl+K) ---------- */
  if (p === '/api/busca' && m === 'GET') {
    frear('busca', 120, 60_000);
    const q = String(url.searchParams.get('q') || '').slice(0, 80);
    const [leads, fichas] = await Promise.all([c.store.todosOsLeads ? c.store.todosOsLeads() : c.store.listLeads({}), c.baseClientes ? c.baseClientes().catch(() => null) : null]);
    const clientes = fichas ? [...fichas.values()].map(f => f.cliente) : [];
    json(res, 200, buscaGlobal({ leads, clientes }, q, { limite: Number(url.searchParams.get('limite')) || 8 }));
    return true;
  }

  /* ---------- leads sem dono: resumo + rodízio sugerido (gestor; nada é gravado aqui) ---------- */
  if (p === '/api/leads/sem-dono' && m === 'GET') {
    precisa();
    exigirGestor('Só um gestor vê a distribuição dos leads sem responsável.');
    frear('sem-dono', 30, 60_000);
    const eq = c.equipe; if (!eq) throw falha(503, 'Equipe indisponível.');
    const [leads, gente, cargas] = await Promise.all([c.store.todosOsLeads(), eq.vendedores({ soRecebe: true }), eq.cargas()]);
    const vendedores = gente.map(v => ({ ...eq.publico(v), abertos: cargas.get(v.id) || 0 }));
    const limite = Math.max(1, Math.min(1000, Number(url.searchParams.get('limite')) || 1000));
    const sugestao = sugerirRodizio(leads, vendedores, { cargas, limite });
    json(res, 200, { resumo: resumoSemDono(leads), vendedores, sugestao,
      leads: leads.filter(l => !l.responsavel_id && ABERTAS.includes(l.status)).slice(0, limite).map(l => ({ id: l.id, nome: l.nome, status: l.status, origem: l.origem, servico: l.servico, valor_orcado: l.valor_orcado, created_at: l.created_at })) });
    return true;
  }

  /* ---------- mandar leads para uma campanha do Comunicar (proposta; o gestor aprova lá) ---------- */
  if (p === '/api/leads/campanha' && m === 'POST') {
    precisa();
    frear('campanha', 10, 600_000);
    const b = await lerCorpo();
    const ids = Array.isArray(b.ids) ? [...new Set(b.ids.filter(ehUuid))] : [];
    if (!ids.length || ids.length > 300) throw falha(400, 'Escolha de 1 a 300 leads.');
    const corpo = texto(b.corpo, 2000).trim();
    if (corpo.length < 10) throw falha(400, 'Escreva a mensagem da campanha (pelo menos 10 caracteres).');
    if (/\bprezad|\befetuar\b|\bcomparecer\b|\bve[ií]culo/i.test(corpo)) throw falha(400, 'Troque "prezado", "efetuar", "comparecer" e "veículo" por palavras da casa (ex.: "carro").');
    let enviarEm = null;
    if (b.enviar_em) { const t = ms(b.enviar_em); if (!Number.isFinite(t)) throw falha(400, 'Data de envio inválida.'); if (t < Date.now() - 60_000) throw falha(400, 'A data de envio já passou.'); enviarEm = new Date(t).toISOString(); }
    const todos = await c.store.todosOsLeads();
    const escolhidos = todos.filter(l => ids.includes(String(l.id)));
    const destinos = destinosDeLeads(escolhidos);
    if (!destinos.length) throw falha(400, 'Nenhum lead com telefone válido na seleção.');
    const detalhe = texto(b.detalhe, 200).trim() || null;
    const { data: camp, error } = await sb.from('comunicar_campanhas').insert({
      status: 'aguardando', corpo, detalhe, segmento: null, destinos, total_previsto: destinos.length, enviar_em: enviarEm,
      criado_por: quem.id, criado_por_nome: quem.nome || quem.email || 'CRM',
    }).select('id,status,total_previsto,created_at').single();
    if (error || !camp) throw falha(503, 'Não consegui registrar a campanha no Comunicar agora.');
    // avisa os gestores (um aviso por pessoa; o link abre a campanha no Comunicar)
    let avisados = 0;
    try {
      const { data: gestores } = await sb.from('perfis').select('id,papel,ativo').in('papel', ['admin', 'gestor']).eq('ativo', true);
      for (const g of gestores || []) {
        const { error: e2 } = await sb.rpc('notificar', { p_perfil: g.id, p_tipo: 'campanha', p_titulo: `Campanha do CRM para ${destinos.length} cliente${destinos.length === 1 ? '' : 's'} espera aprovação`,
          p_corpo: `${quem.nome || 'Alguém da equipe'} montou pelo CRM. Aprove ou recuse no Comunicar.`, p_link: `/?campanha=${camp.id}`, p_app: 'comunicar', p_chave: `campanha:${camp.id}:${g.id}` });
        if (!e2) avisados++;
      }
    } catch { /* sem aviso não atrapalha */ }
    await c.auditar(quem, 'campanha_comunicar', { tabela: 'comunicar_campanhas', registro: camp.id, detalhes: { leads: ids.length, destinos: destinos.length, enviar_em: enviarEm, avisados } });
    json(res, 201, { ok: true, campanha: { id: camp.id, status: camp.status, total: destinos.length }, destinos: destinos.length, pulados: ids.length - destinos.length, avisados,
      abrir: APPS.linkApp('comunicar', `/?campanha=${camp.id}`, { prefixo }) });
    return true;
  }

  /* ---------- filtros salvos (por pessoa, em perfis.preferencias.crm_filtros) ---------- */
  if (p === '/api/filtros' && (m === 'GET' || m === 'PUT')) {
    precisa();
    const ler = async () => { const { data } = await sb.from('perfis').select('preferencias').eq('id', quem.id).maybeSingle(); return data?.preferencias || {}; };
    if (m === 'GET') { const pref = await ler(); json(res, 200, { filtros: Array.isArray(pref.crm_filtros) ? pref.crm_filtros : [] }); return true; }
    frear('filtros', 30, 60_000);
    const b = await lerCorpo();
    const filtros = validarFiltrosSalvos(b.filtros);
    const atual = await ler();
    const preferencias = require('../public/crm-utils').mesclarPreferencias(atual, {});
    preferencias.crm_filtros = filtros;                // lista inteira troca (mesclar juntaria índices)
    const { error } = await sb.from('perfis').update({ preferencias }).eq('id', quem.id);
    if (error) throw falha(503, 'Não consegui salvar os filtros.');
    json(res, 200, { ok: true, filtros });
    return true;
  }

  /* ---------- previsão de faturamento pelo funil ---------- */
  if (p === '/api/previsao' && m === 'GET') {
    frear('previsao', 30, 60_000);
    let leads = await c.store.todosOsLeads();
    if (!gestor && url.searchParams.get('meus') === '1') leads = leads.filter(l => String(l.responsavel_id || '') === String(quem.id));
    json(res, 200, previsaoPipeline(leads));
    return true;
  }

  /* ---------- motivos de perda (lista única para todas as telas) ---------- */
  if (p === '/api/motivos-perda' && m === 'GET') { json(res, 200, { motivos: MOTIVOS_PERDA }); return true; }

  return false;
}

module.exports = { normalizarTelefone, variantesTelefone, MOTIVOS_PERDA, motivoDe, motivoPadrao, parametrosModelo, previsaoPipeline, CHANCE_BASE,
  resumoSemDono, sugerirRodizio, buscaGlobal, validarFiltrosSalvos, destinosDeLeads, linksFicha, rotasR5, ABERTAS };
