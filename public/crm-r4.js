/* ============================================================
   IndyCar CRM — rodada 4 (14/10/2026): funções puras da tela.
   Confiabilidade (servidor acordando), rascunho, fila offline,
   valor pago, distribuição em lote, relatórios, tour e ajuda.
   Sem DOM aqui: tudo testável no Node (testes/r4-utils.test.cjs).
   ============================================================ */
(function (root) {
  'use strict';
  const DIA = 86400000;
  const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const ms = v => { const t = Date.parse(v); return Number.isFinite(t) ? t : NaN; };
  const r2 = v => Math.round(num(v) * 100) / 100;

  /* ---------------- servidor acordando (Render gratuito) ---------------- */
  /** Espera entre tentativas, em segundos: crescente, ~3 min no total. */
  const ESPERAS = [2, 3, 5, 8, 12, 18, 25, 30, 30, 30];
  const esperasAcordar = () => ESPERAS.slice();
  const totalEspera = () => ESPERAS.reduce((s, x) => s + x, 0);
  /** Resposta que NÃO veio do nosso servidor (o proxy do Render manda HTML ou JSON sem "erro"). */
  const naoEhNossa = corpo => !corpo || typeof corpo !== 'object' || typeof corpo.erro !== 'string';
  /** 502/503/504 do proxy, ou falha de rede: o sistema está dormindo/acordando. */
  function ehAcordando(status, corpo) {
    if (status === 0) return true;
    return [502, 503, 504].includes(status) && naoEhNossa(corpo);
  }
  /**
   * Vale tentar de novo? GET: rede ou 502/503/504 (até do nosso servidor).
   * Escrita: só com chave de idempotência (o servidor não repete a ação) e
   * quando o pedido nem chegou (rede/proxy).
   */
  function deveRepetir({ metodo = 'GET', status = 0, corpo = null, chave = false } = {}) {
    const m = String(metodo).toUpperCase();
    if (m === 'GET' || m === 'HEAD') return status === 0 || [502, 503, 504].includes(status);
    if (!chave) return false;
    return ehAcordando(status, corpo);
  }
  function textoAcordando(tentativa, total, seg) {
    const s = Math.max(0, Math.round(num(seg)));
    return `O sistema está acordando… tentando de novo em ${s} s (tentativa ${tentativa} de ${total}).`;
  }
  /** Chave de idempotência: única por pedido de escrita, repetida nas novas tentativas. */
  function novaChave(aleatorio = Math.random, agora = Date.now()) {
    return 'k' + agora.toString(36) + Math.floor(aleatorio() * 1e12).toString(36);
  }

  /* ---------------- rascunho do formulário do lead ---------------- */
  const chaveRascunho = id => 'indycar_crm_rascunho_' + (id ? String(id).replace(/[^0-9a-z-]/gi, '').slice(0, 40) : 'novo');
  /** Rascunho vale se tem menos de 24 h, é diferente do salvo e é mais novo que a última mudança do lead. */
  function rascunhoValido(r, lead, agora = Date.now()) {
    if (!r || typeof r !== 'object' || !r.valores || typeof r.valores !== 'object') return false;
    const t = num(r.em);
    if (!t || agora - t > DIA || t > agora + 60000) return false;
    if (lead && Number.isFinite(ms(lead.updated_at)) && ms(lead.updated_at) > t) return false;
    if (r.base && r.base === r.assinatura) return false;
    return true;
  }

  /* ---------------- fila de alterações (PATCH de lead) ---------------- */
  /** Junta na fila: dois PATCH do mesmo lead viram um só (o mais novo vence campo a campo). */
  function filaAdicionar(fila, item) {
    const lista = Array.isArray(fila) ? fila.slice() : [];
    if (!item || !item.url || !item.corpo) return lista;
    const i = lista.findIndex(x => x.url === item.url && x.metodo === (item.metodo || 'PATCH'));
    const novo = { metodo: item.metodo || 'PATCH', url: item.url, corpo: { ...(i >= 0 ? lista[i].corpo : {}), ...item.corpo }, nome: item.nome || (i >= 0 ? lista[i].nome : ''), em: item.em || Date.now(), chave: item.chave || (i >= 0 ? lista[i].chave : novaChave()) };
    if (i >= 0) lista[i] = novo; else lista.push(novo);
    return lista.slice(-50);
  }
  const textoFila = n => n ? `${n} alteraç${n === 1 ? 'ão' : 'ões'} esperando o servidor` : '';

  /* ---------------- valor pago ---------------- */
  const RE_CORTESIA = /^Cortesia: sem cobrança$/m;
  const ehCortesia = obs => RE_CORTESIA.test(String(obs ?? ''));
  function comCortesia(obs) {
    const s = String(obs ?? '').trim();
    if (ehCortesia(s)) return s;
    return (s ? s.slice(0, 3970) + '\n' : '') + 'Cortesia: sem cobrança';
  }
  /** Concluído sem valor pago (e que não foi marcado como cortesia). */
  const semValor = l => !!l && l.status === 'concluido' && !(num(l.valor_pago) > 0) && !ehCortesia(l.observacoes);
  const semValorPago = leads => (leads || []).filter(semValor);
  /** Sugestões de valor, sem repetir: orçado, Agenda e Orçador. */
  function sugestoesValor(lead, extras = {}) {
    const out = [], vistos = new Set();
    const add = (rotulo, v) => { const n = r2(v); if (n > 0 && n <= 10000000 && !vistos.has(n)) { vistos.add(n); out.push({ rotulo, valor: n }); } };
    add('Orçado no CRM', lead && lead.valor_orcado);
    add('Valor na Agenda', extras.agendamento);
    add('Orçamento do Orçador', extras.orcamento);
    return out;
  }
  /** Valida a lista do preenchimento em lote. */
  function validarValores(itens) {
    if (!Array.isArray(itens) || !itens.length) throw new Error('Preencha ao menos um valor.');
    if (itens.length > 300) throw new Error('No máximo 300 por vez.');
    return itens.map(x => {
      const id = String(x && x.id || '');
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Lead inválido na lista.');
      if (x.cortesia === true) return { id, valor_pago: 0, cortesia: true };
      const v = Number(x.valor_pago);
      if (!Number.isFinite(v) || v <= 0 || v > 10000000) throw new Error('Valor entre R$ 0,01 e R$ 10 milhões (ou marque cortesia).');
      return { id, valor_pago: r2(v), cortesia: false };
    });
  }

  /* ---------------- distribuição em lote ---------------- */
  const IDADES = { '': [0, Infinity], '7': [7, Infinity], '30': [30, Infinity], '90': [90, Infinity], '0-7': [0, 7], '7-30': [7, 30], '30-90': [30, 90] };
  const idadeDias = (l, agora = Date.now()) => { const t = ms(l && l.created_at); return Number.isFinite(t) ? Math.floor((agora - t) / DIA) : 0; };
  /** Leads que entram na distribuição: sem dono (padrão), etapas/origens marcadas, faixa de idade. */
  function filtrarDistribuir(leads, { status = [], origem = [], idade = '', soSemDono = true, agora = Date.now() } = {}) {
    const faixa = IDADES[idade] || IDADES[''];
    return (leads || []).filter(l => l && (!soSemDono || !l.responsavel_id)
      && (!status.length || status.includes(l.status)) && (!origem.length || origem.includes(l.origem || 'organico'))
      && idadeDias(l, agora) >= faixa[0] && idadeDias(l, agora) < faixa[1]);
  }
  /**
   * Plano: modo 'igual' = partes iguais em rodízio; 'carga' = quem tem menos
   * leads abertos recebe mais, até igualar. As etapas se espalham (cada pessoa
   * recebe um pouco de cada), começando pelos mais antigos.
   */
  const ORDEM_ETAPA = ['orcamento', 'agendado', 'em_servico', 'contato', 'novo', 'concluido', 'perdido'];
  function planoDistribuicao(leads, vendedores, { modo = 'igual' } = {}) {
    const gente = (vendedores || []).filter(v => v && v.id);
    if (!gente.length) throw new Error('Escolha ao menos uma pessoa.');
    const lista = [...(leads || [])].sort((a, b) => ORDEM_ETAPA.indexOf(a.status) - ORDEM_ETAPA.indexOf(b.status) || String(a.created_at).localeCompare(String(b.created_at)));
    const estado = gente.map((v, i) => ({ id: String(v.id), nome: v.nome || 'Sem nome', carga: modo === 'carga' ? num(v.abertos ?? v.carga) : 0, recebe: 0, i }));
    const plano = [];
    let k = 0;
    for (const l of lista) {
      let alvo;
      if (modo === 'carga') alvo = estado.reduce((m, e) => (e.carga + e.recebe < m.carga + m.recebe || (e.carga + e.recebe === m.carga + m.recebe && e.i < m.i)) ? e : m);
      else alvo = estado[k++ % estado.length];
      alvo.recebe++;
      plano.push({ id: String(l.id), nome: l.nome || '', status: l.status, para: alvo.id });
    }
    const resumo = estado.map(e => ({ id: e.id, nome: e.nome, recebe: e.recebe, depois: e.carga + e.recebe,
      porEtapa: plano.filter(p => p.para === e.id).reduce((o, p) => { o[p.status] = (o[p.status] || 0) + 1; return o; }, {}) }));
    return { plano, resumo, total: plano.length };
  }
  /** Agrupa o plano por pessoa (formato do servidor: {perfilId: [leadIds]}). */
  const gruposDoPlano = plano => (plano || []).reduce((g, p) => { (g[p.para] = g[p.para] || []).push(p.id); return g; }, {});

  /* ---------------- relatórios gerenciais ---------------- */
  const ETAPAS = ['novo', 'contato', 'orcamento', 'agendado', 'em_servico', 'concluido', 'perdido'];
  const FUNIL = ['novo', 'contato', 'orcamento', 'agendado', 'em_servico', 'concluido'];
  const RE_MOTIVO = /^Motivo da perda: (.+)$/m;
  const motivoDe = obs => { const m = RE_MOTIVO.exec(String(obs ?? '')); return m ? m[1].trim() : null; };
  const fechouEm = l => l.closed_at || l.updated_at || l.created_at;
  const dentro = (v, a, b) => { const t = ms(v); return Number.isFinite(t) && t >= +a && t < +b; };
  /** Linha de números para um grupo de leads (entradas no período e fechamentos no período). */
  function linhaNumeros(entraram, ganhos, perdidos) {
    const fat = r2(ganhos.reduce((s, l) => s + num(l.valor_pago), 0));
    const decididos = ganhos.length + perdidos.length;
    const avancaram = entraram.filter(l => ['agendado', 'em_servico', 'concluido'].includes(l.status)).length;
    return { leads: entraram.length, agendados: avancaram, ganhos: ganhos.length, perdidos: perdidos.length, faturamento: fat,
      ticket: ganhos.length ? r2(fat / ganhos.length) : 0, conversao: decididos ? Math.round(ganhos.length / decididos * 1000) / 10 : null,
      semValor: ganhos.filter(semValor).length };
  }
  function relatorio(leads, ini, fim, { equipe = [], rotuloOrigem = o => o } = {}) {
    const todos = leads || [];
    const entraram = todos.filter(l => dentro(l.created_at, ini, fim));
    const ganhos = todos.filter(l => l.status === 'concluido' && dentro(fechouEm(l), ini, fim));
    const perdidos = todos.filter(l => l.status === 'perdido' && dentro(fechouEm(l), ini, fim));
    // funil das entradas do período: quantos chegaram até cada etapa (perdido conta só na entrada)
    const idx = s => FUNIL.indexOf(s);
    const chegou = FUNIL.map((_, i) => entraram.filter(l => l.status !== 'perdido' ? idx(l.status) >= i : i === 0).length);
    const funil = FUNIL.map((etapa, i) => ({ etapa, chegaram: chegou[i], taxa: i === 0 ? 100 : chegou[i - 1] ? Math.round(chegou[i] / chegou[i - 1] * 100) : 0, agora: entraram.filter(l => l.status === etapa).length }));
    const perdidosDasEntradas = entraram.filter(l => l.status === 'perdido').length;
    const agrupar = chave => {
      const m = new Map();
      const g = k => m.get(k) || (m.set(k, { chave: k, e: [], g: [], p: [] }), m.get(k));
      for (const l of entraram) g(chave(l)).e.push(l);
      for (const l of ganhos) g(chave(l)).g.push(l);
      for (const l of perdidos) g(chave(l)).p.push(l);
      return [...m.values()].map(x => ({ chave: x.chave, ...linhaNumeros(x.e, x.g, x.p) }));
    };
    const porOrigem = agrupar(l => l.origem || 'organico').map(x => ({ ...x, nome: rotuloOrigem(x.chave) }))
      .sort((a, b) => b.leads - a.leads || b.faturamento - a.faturamento);
    const nomes = new Map((equipe || []).map(p => [String(p.id), p.nome]));
    const porVendedor = agrupar(l => l.responsavel_id ? String(l.responsavel_id) : '').map(x => ({ ...x, nome: x.chave ? (nomes.get(x.chave) || 'Fora da equipe') : 'Sem responsável' }))
      .sort((a, b) => (a.chave === '') - (b.chave === '') || b.faturamento - a.faturamento || b.ganhos - a.ganhos || b.leads - a.leads);
    const mot = {};
    for (const l of perdidos) { const k = motivoDe(l.observacoes) || 'Sem motivo registrado'; mot[k] = (mot[k] || 0) + 1; }
    const motivos = Object.entries(mot).map(([motivo, qtd]) => ({ motivo, qtd, pct: perdidos.length ? Math.round(qtd / perdidos.length * 100) : 0 })).sort((a, b) => b.qtd - a.qtd || a.motivo.localeCompare(b.motivo));
    const ciclos = ganhos.map(l => (ms(fechouEm(l)) - ms(l.created_at)) / DIA).filter(x => Number.isFinite(x) && x >= 0);
    return { totais: { ...linhaNumeros(entraram, ganhos, perdidos), perdidosDasEntradas, cicloMedio: ciclos.length ? Math.round(ciclos.reduce((s, x) => s + x, 0) / ciclos.length * 10) / 10 : null },
      funil, porOrigem, porVendedor, motivos };
  }
  /** Tempo de resposta (minutos) em texto curto. */
  const textoMinutos = v => v == null || !Number.isFinite(Number(v)) ? '—' : Number(v) >= 60 ? (Math.round(Number(v) / 6) / 10).toLocaleString('pt-BR') + ' h' : Math.round(Number(v)) + ' min';
  /** Intervalo do relatório a partir de duas datas AAAA-MM-DD (fim incluído). */
  function intervaloDatas(de, ate) {
    const p = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], m[2] - 1, +m[3]) : null; };
    const a = p(de), b = p(ate);
    if (!a || !b || b < a) throw new Error('Escolha um período válido (início antes do fim).');
    if ((b - a) / DIA > 731) throw new Error('Período de no máximo 2 anos.');
    return { ini: a, fim: new Date(b.getFullYear(), b.getMonth(), b.getDate() + 1) };
  }

  /* ---------------- tour de boas-vindas e ajuda ---------------- */
  function passosTour(papel) {
    const gestor = papel === 'admin' || papel === 'gestor';
    const base = [
      { alvo: '#cardTarefas', titulo: 'Seu dia começa aqui', texto: 'Tarefas atrasadas e de hoje ficam no topo. Marque a caixinha quando fizer.' },
      { alvo: '.nav-item[data-view="leads"]', titulo: 'Seus leads', texto: 'A lista já abre em "Meus leads". Busque por nome, telefone ou placa com a tecla /.' },
      { alvo: '.nav-item[data-view="pipeline"]', titulo: 'Funil', texto: 'Arraste o cartão para a próxima etapa. Ao concluir, o CRM pergunta quanto o cliente pagou.' },
      { alvo: '#btnSino', titulo: 'Avisos', texto: 'Lead passado para você, cliente esperando e tarefas novas chegam no sino.' },
    ];
    const extra = gestor ? [
      { alvo: '.nav-item[data-view="distribuir"]', titulo: 'Distribuir leads', texto: 'Divida os leads sem responsável entre a equipe, veja a prévia antes de gravar e desfaça se precisar.' },
      { alvo: '.nav-item[data-view="relatorios"]', titulo: 'Relatórios', texto: 'Funil, conversão por origem e por vendedor, tempo de resposta e motivos de perda — com exportação.' },
      { alvo: '#cardSemValor', titulo: 'Vendas sem valor', texto: 'Concluídos sem o valor pago deixam o faturamento vazio. Preencha vários de uma vez por aqui.' },
    ] : [];
    return [...base, ...extra, { alvo: '#btnAjuda', titulo: 'Precisa de ajuda?', texto: 'Aqui tem atalhos, "como faço…" e este tour de novo quando quiser.' }];
  }
  function perguntasAjuda(papel) {
    const gestor = papel === 'admin' || papel === 'gestor';
    const lista = [
      ['Como cadastro um lead?', 'Botão "+ Novo Lead" (ou tecla N). Nome e telefone com DDD bastam; o resto dá para completar depois.'],
      ['Como passo o lead para a próxima etapa?', 'Arraste o cartão no Funil, use os botões de etapa na ficha ou, no teclado, Shift + setas.'],
      ['O que pôr no "valor pago"?', 'O que o cliente pagou de fato. O CRM sugere o orçado; se foi cortesia, marque "cortesia".'],
      ['Como pego um lead sem dono?', 'Abra o lead e clique em "Pegar para mim".'],
      ['Como crio um lembrete?', 'Na ficha do lead, aba Tarefas, ou no card "Minhas tarefas" do Dashboard.'],
      ['O sistema mostrou "acordando". E agora?', 'O servidor gratuito dorme quando ninguém usa. Espere: ele tenta sozinho por até 3 minutos e o que você digitou não se perde.'],
      ['Não consigo apagar um lead.', 'Apagar é só do gestor. Peça a ele, ou marque como perdido com o motivo.'],
    ];
    if (gestor) lista.push(
      ['Como divido os leads antigos?', 'Menu "Distribuir": filtre, marque quem recebe, confira a prévia e grave. Dá para desfazer.'],
      ['Como preencho os valores que faltam?', 'No Dashboard, card "Vendas sem valor" → "Preencher agora".'],
      ['Como exporto os números?', 'Menu "Relatórios": escolha o período e use "Exportar CSV" ou "Imprimir".'],
    );
    return lista.map(([p, r]) => ({ pergunta: p, resposta: r }));
  }

  const api = { esperasAcordar, totalEspera, ehAcordando, deveRepetir, textoAcordando, novaChave, naoEhNossa,
    chaveRascunho, rascunhoValido, filaAdicionar, textoFila,
    ehCortesia, comCortesia, semValor, semValorPago, sugestoesValor, validarValores,
    IDADES, idadeDias, filtrarDistribuir, planoDistribuicao, gruposDoPlano,
    ETAPAS, FUNIL, relatorio, textoMinutos, intervaloDatas, motivoDe,
    passosTour, perguntasAjuda };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CrmR4 = api;
})(typeof window !== 'undefined' ? window : globalThis);
