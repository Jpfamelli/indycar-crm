(function(root) {
  'use strict';
  const normalizar = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const digitos = v => String(v ?? '').replace(/\D/g, '');
  function buscar(l, q) {
    const termo = normalizar(q);
    if (!termo) return true;
    const tel = digitos(q);
    return [l.nome,l.telefone,l.placa,l.carro_modelo,l.servico].some(v => normalizar(v).includes(termo)) ||
      (tel.length >= 8 && digitos(l.telefone).slice(-8) === tel.slice(-8));
  }
  function validarLead(d, parcial = false) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return 'Informe um objeto JSON.';
    if ((!parcial || 'nome' in d) && (typeof d.nome !== 'string' || !d.nome.trim() || d.nome.length > 120)) return 'Informe um nome com até 120 caracteres.';
    if ((!parcial || 'telefone' in d) && !/^(?:55)?\d{10,11}$/.test(digitos(d.telefone))) return 'Informe telefone com DDD (10 ou 11 dígitos).';
    for (const k of ['valor_orcado','valor_pago']) if (k in d && (!Number.isFinite(Number(d[k])) || Number(d[k]) < 0 || Number(d[k]) > 10000000)) return 'Informe valores entre zero e R$ 10 milhões.';
    if ('status' in d && !['novo','contato','orcamento','agendado','em_servico','concluido','perdido'].includes(d.status)) return 'Etapa inválida.';
    if ('origem' in d && !['meta','google','indicacao','organico','whatsapp','passagem','telefone'].includes(d.origem)) return 'Origem inválida.';
    if (d.placa && !/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/i.test(normalizar(d.placa))) return 'Confira a placa: ABC1234 ou ABC1D23.';
    for (const k of ['observacoes','servico','carro_modelo','utm_campaign']) if (k in d && (typeof d[k] !== 'string' || d[k].length > (k === 'observacoes' ? 4000 : 200))) return 'Texto maior que o permitido.';
    return null;
  }
  function nascimento(v) {
    if (v === '' || v === null) return null;
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('Aniversário inválido.');
    const d = new Date(v + 'T12:00:00Z');
    if (!Number.isFinite(+d) || d.toISOString().slice(0,10) !== v || v > new Date().toISOString().slice(0,10) || Number(v.slice(0,4)) < 1900) throw new Error('Aniversário inválido.');
    return v;
  }
  const moeda = v => (Number.isFinite(Number(v)) ? Number(v) : 0).toLocaleString('pt-BR', {style:'currency',currency:'BRL'});
  const csvCelula = v => '"' + String(v ?? '').replace(/^[=+@\-\t\r]/, "'$&").replace(/"/g,'""') + '"';
  const csv = rows => '\uFEFF' + rows.map(r => r.map(csvCelula).join(';')).join('\r\n');
  /* ---------- Rodada 2 (tela) — funções puras usadas pela interface ---------- */
  const DIA = 86400000;
  const ETAPAS = ['novo','contato','orcamento','agendado','em_servico','concluido','perdido'];
  const ABERTAS = ['novo','contato','orcamento','agendado','em_servico'];
  // dias sem mexer a partir dos quais o lead conta como "parado" (concluído/perdido nunca param)
  const LIMITE_PARADO = {novo:1, contato:3, orcamento:4, agendado:7, em_servico:5};
  const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const valorLead = l => num(l && l.status === 'concluido' ? l.valor_pago : l && l.valor_orcado);
  const ms = v => { const t = Date.parse(v); return Number.isFinite(t) ? t : NaN; };
  function diasNaEtapa(l, agora = Date.now()) {
    const t = ms(l && (l.updated_at || l.created_at));
    return Number.isFinite(t) ? Math.max(0, Math.floor((agora - t) / DIA)) : 0;
  }
  function parado(l, agora = Date.now()) {
    const lim = LIMITE_PARADO[l && l.status];
    return lim !== undefined && diasNaEtapa(l, agora) >= lim;
  }
  const textoDias = d => d <= 0 ? 'hoje' : d === 1 ? '1 dia' : d + ' dias';
  function resumoColuna(leads, agora = Date.now()) {
    return {qtd: leads.length, valor: Math.round(leads.reduce((s, l) => s + valorLead(l), 0) * 100) / 100,
      parados: leads.filter(l => parado(l, agora)).length};
  }
  /* Período do painel. Datas no fuso do navegador; fim é exclusivo. */
  function periodo(chave, agora = new Date(), ini, fim) {
    const d0 = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const hoje = d0(agora), amanha = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 1);
    const menos = n => new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - n);
    let a, b;
    if (chave === 'hoje') { a = hoje; b = amanha; }
    else if (chave === '30') { a = menos(29); b = amanha; }
    else if (chave === 'mes') { a = new Date(hoje.getFullYear(), hoje.getMonth(), 1); b = amanha; }
    else if (chave === 'personalizado') {
      const p = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], m[2] - 1, +m[3]) : null; };
      a = p(ini); b = p(fim);
      if (!a || !b || b < a) throw new Error('Escolha um período válido (início antes do fim).');
      b = new Date(b.getFullYear(), b.getMonth(), b.getDate() + 1);
    } else { a = menos(6); b = amanha; }
    const dias = Math.round((b - a) / DIA);
    // mês: compara com o mesmo pedaço do mês anterior (dia 1 a N), não com 30 dias corridos
    let pa, pb;
    if (chave === 'mes') { pa = new Date(a.getFullYear(), a.getMonth() - 1, 1); pb = new Date(Math.min(new Date(pa.getFullYear(), pa.getMonth(), dias + 1).getTime(), a.getTime())); }
    else { pa = new Date(a.getFullYear(), a.getMonth(), a.getDate() - dias); pb = a; }
    return {ini: a, fim: b, antIni: pa, antFim: pb, dias};
  }
  const dentro = (v, a, b) => { const t = ms(v); return Number.isFinite(t) && t >= +a && t < +b; };
  /* Métricas de um intervalo: entradas pelo created_at; fechamentos pelo closed_at (ou updated_at). */
  function metricas(leads, a, b) {
    const entraram = leads.filter(l => dentro(l.created_at, a, b));
    const fechou = l => l.closed_at || l.updated_at || l.created_at;
    const ganhos = leads.filter(l => l.status === 'concluido' && dentro(fechou(l), a, b));
    const perdidos = leads.filter(l => l.status === 'perdido' && dentro(fechou(l), a, b));
    const faturamento = Math.round(ganhos.reduce((s, l) => s + num(l.valor_pago), 0) * 100) / 100;
    const ciclos = ganhos.map(l => (ms(fechou(l)) - ms(l.created_at)) / DIA).filter(x => Number.isFinite(x) && x >= 0);
    const decididos = ganhos.length + perdidos.length;
    const porOrigem = {};
    const linha = o => porOrigem[o] || (porOrigem[o] = {origem: o, leads: 0, ganhos: 0, faturamento: 0});
    for (const l of entraram) linha(l.origem || 'organico').leads++;
    for (const l of ganhos) { const o = linha(l.origem || 'organico'); o.ganhos++; o.faturamento += num(l.valor_pago); }
    const motivos = {};
    for (const l of perdidos) { const m = motivoPerda(l.observacoes) || 'Sem motivo registrado'; motivos[m] = (motivos[m] || 0) + 1; }
    return {
      entradas: entraram.length, ganhos: ganhos.length, perdidos: perdidos.length, faturamento,
      ticket: ganhos.length ? Math.round(faturamento / ganhos.length * 100) / 100 : 0,
      conversao: decididos ? Math.round(ganhos.length / decididos * 1000) / 10 : 0,
      cicloMedio: ciclos.length ? Math.round(ciclos.reduce((s, x) => s + x, 0) / ciclos.length * 10) / 10 : null,
      porOrigem: Object.values(porOrigem).map(o => ({...o, faturamento: Math.round(o.faturamento * 100) / 100,
        conversao: o.leads ? Math.round(Math.min(o.ganhos, o.leads) / o.leads * 100) : 0}))
        .sort((x, y) => y.leads - x.leads || y.faturamento - x.faturamento),
      motivos: Object.entries(motivos).map(([motivo, qtd]) => ({motivo, qtd})).sort((x, y) => y.qtd - x.qtd),
    };
  }
  /* Conversão por etapa: quantos chegaram ATÉ cada etapa (perdido conta só na entrada). */
  function funilPassagem(leads) {
    const ordem = ETAPAS.slice(0, 6), idx = s => ordem.indexOf(s);
    const chegou = ordem.map((_, i) => leads.filter(l => l.status !== 'perdido' ? idx(l.status) >= i : i === 0).length);
    return ordem.map((etapa, i) => ({etapa, chegaram: chegou[i], taxa: i === 0 ? 100 : chegou[i - 1] ? Math.round(chegou[i] / chegou[i - 1] * 100) : 0}));
  }
  const comparar = (atual, anterior) => !anterior ? (atual ? null : 0) : Math.round((atual - anterior) / anterior * 100);
  /* Motivo de perda vive numa linha das observações (a tabela leads não tem coluna própria). */
  const RE_MOTIVO = /^Motivo da perda: (.+)$/m;
  function motivoPerda(obs) { const m = RE_MOTIVO.exec(String(obs ?? '')); return m ? m[1].trim() : null; }
  function comMotivoPerda(obs, motivo) {
    const limpo = String(obs ?? '').replace(/\n?^Motivo da perda: .+$/m, '').trim();
    const m = String(motivo ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
    if (!m) throw new Error('Diga o motivo da perda.');
    const linha = 'Motivo da perda: ' + m;
    return ((limpo ? limpo.slice(0, 4000 - linha.length - 1) + '\n' : '') + linha);
  }
  /* Telefone em links: wa.me exige DDI; tel: aceita com +55. */
  function telE164(v) { let d = digitos(v); if (d.length === 12 || d.length === 13) d = d.replace(/^55/, ''); return d.length === 10 || d.length === 11 ? d : ''; }
  const linkWhatsApp = v => telE164(v) ? 'https://wa.me/55' + telE164(v) : '';
  const linkLigar = v => telE164(v) ? 'tel:+55' + telE164(v) : '';
  const linkConversa = v => telE164(v) ? 'https://indycar-atendimento.onrender.com/?tel=' + telE164(v) : '';
  const linkComunicar = v => 'https://indycar-posvenda.onrender.com/' + (telE164(v) ? '?tel=' + telE164(v) : '');
  const linkAgenda = v => 'https://indycar-agendamentos.onrender.com/' + (telE164(v) ? '?tel=' + telE164(v) : '');
  function formatarTelefone(v) {
    const d = telE164(v); if (!d) return String(v ?? '').trim();
    return d.length === 11 ? `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}` : `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  }
  function paginar(lista, pagina, tamanho = 50) {
    const total = lista.length, paginas = Math.max(1, Math.ceil(total / tamanho));
    const p = Math.min(Math.max(1, Math.floor(Number(pagina) || 1)), paginas);
    return {itens: lista.slice((p - 1) * tamanho, p * tamanho), pagina: p, paginas, total, de: total ? (p - 1) * tamanho + 1 : 0, ate: Math.min(p * tamanho, total)};
  }
  /* Linha do tempo única: aceita o contexto do servidor (vários formatos) e a reserva local. */
  const quando = x => x && (x.quando || x.em || x.data_hora || x.created_at || x.criado_em || x.enviado_em || (x.data ? x.data + (x.hora ? 'T' + String(x.hora).slice(0, 5) : 'T12:00') : null));
  function linhaDoTempo(ctx, reserva = []) {
    const itens = [];
    const add = (tipo, x, titulo, detalhe) => { const q = quando(x); if (q) itens.push({tipo, quando: q, titulo: String(titulo ?? '').slice(0, 160), detalhe: String(detalhe ?? '').slice(0, 400)}); };
    const c = ctx && typeof ctx === 'object' ? ctx : {};
    const prontos = c.linha_do_tempo || c.linhaDoTempo || c.timeline || c.eventos;
    if (Array.isArray(prontos)) for (const e of prontos) add(e.tipo || 'evento', e, e.titulo || e.resumo || e.tipo, e.detalhe || e.texto || e.descricao || '');
    const msgs = c.mensagens || (c.conversa && c.conversa.mensagens) || [];
    if (Array.isArray(msgs)) for (const m of msgs) add('mensagem', m, m.direcao === 'saida' ? (m.gerada_por_ia ? 'IA respondeu' : 'Equipe respondeu') : 'Cliente escreveu', m.corpo || m.texto || (m.anexo || m.anexo_mime ? '[anexo]' : ''));
    for (const a of (Array.isArray(c.agendamentos) ? c.agendamentos : [])) add('agendamento', a, 'Agendamento · ' + (a.status || ''), [a.servico, a.veiculo || a.placa].filter(Boolean).join(' · '));
    for (const o of (Array.isArray(c.orcamentos) ? c.orcamentos : [])) add('orcamento', o, 'Orçamento' + (o.numero ? ' nº ' + o.numero : '') + ' · ' + (o.status || ''), [o.titulo || o.servico || o.veiculo, o.motivo_recusa && 'recusa: ' + o.motivo_recusa, o.total != null ? moeda(o.total) : o.valor != null ? moeda(o.valor) : ''].filter(Boolean).join(' · '));
    const com = c.comunicar || c.envios || c.posvenda || [];
    for (const e of (Array.isArray(com) ? com : [])) {
      add('comunicar', {quando: e.enviado_em || e.quando || e.created_at || e.enviar_em}, 'Comunicar · ' + String(e.tipo || e.status || 'mensagem').replace(/_/g, ' '), e.corpo || e.mensagem || '');
      if (e.respondido_em) add('mensagem', {quando: e.respondido_em}, 'Cliente respondeu ao Comunicar', e.resposta || '');
    }
    for (const v of (Array.isArray(c.satisfacao) ? c.satisfacao : [])) add('satisfacao', v, 'Pesquisa de satisfação' + (v.nota != null ? ' · nota ' + v.nota : v.satisfeito != null ? (v.satisfeito ? ' · satisfeito' : ' · insatisfeito') : ''), v.comentario || '');
    const hist = c.historico || c.etapas || c.mudancas || [];
    for (const h of (Array.isArray(hist) ? hist : [])) add('status', h, 'Etapa: ' + (h.para || h.status || h.etapa || ''), h.de ? 'antes: ' + h.de : (h.por || ''));
    for (const r of reserva) add(r.tipo || 'evento', r, r.titulo, r.detalhe);
    const vistos = new Set();
    return itens.filter(i => Number.isFinite(ms(i.quando)))
      .sort((x, y) => ms(y.quando) - ms(x.quando))
      .filter(i => { const k = i.tipo + '|' + ms(i.quando) + '|' + i.titulo; if (vistos.has(k)) return false; vistos.add(k); return true; });
  }
  /* Lembretes do vendedor (guardados no aparelho). */
  function situacaoTarefa(t, agora = new Date()) {
    if (t.feita) return 'feita';
    const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).getTime();
    const p = /^(\d{4})-(\d{2})-(\d{2})/.exec(t.para || '');
    if (!p) return 'sem_data';
    const d = new Date(+p[1], p[2] - 1, +p[3]).getTime();
    return d < hoje ? 'atrasada' : d === hoje ? 'hoje' : 'futura';
  }
  function ordenarTarefas(lista, agora = new Date()) {
    const peso = {atrasada: 0, hoje: 1, futura: 2, sem_data: 3, feita: 4};
    return [...lista].sort((a, b) => peso[situacaoTarefa(a, agora)] - peso[situacaoTarefa(b, agora)] || String(a.para || '9').localeCompare(String(b.para || '9')) || String(a.criada || '').localeCompare(String(b.criada || '')));
  }
  function novaTarefa(d, agora = new Date()) {
    const texto = String(d && d.texto || '').replace(/\s+/g, ' ').trim();
    if (!texto) throw new Error('Escreva o lembrete.');
    if (texto.length > 200) throw new Error('Lembrete com até 200 caracteres.');
    if (d.para && !/^\d{4}-\d{2}-\d{2}$/.test(d.para)) throw new Error('Data do lembrete inválida.');
    return {id: 't' + agora.getTime().toString(36) + Math.random().toString(36).slice(2, 6), texto, para: d.para || '', leadId: d.leadId ? String(d.leadId) : '', leadNome: String(d.leadNome || '').slice(0, 120), feita: false, criada: agora.toISOString()};
  }
  /* Colunas da lista de leads que a pessoa pode ligar e desligar. */
  const COLUNAS_LEADS = ['cliente','carro','servico','origem','valor','status','etapa','entrada','campanha'];
  const COLUNAS_PADRAO = ['cliente','carro','servico','origem','valor','status','etapa','entrada'];
  function colunasValidas(lista) {
    const ok = Array.isArray(lista) ? COLUNAS_LEADS.filter(c => lista.includes(c)) : [];
    return ok.includes('cliente') ? ok : COLUNAS_PADRAO.slice();
  }
  /* Atalhos de teclado: sequência "g" + letra leva a uma aba. */
  const ATALHOS_ABA = {d:'dashboard', l:'leads', f:'pipeline', c:'clientes', i:'ia', o:'origem', s:'servicos'};
  const api = {normalizar,digitos,buscar,validarLead,nascimento,moeda,csv,ETAPAS,ABERTAS,LIMITE_PARADO,valorLead,diasNaEtapa,parado,textoDias,resumoColuna,periodo,metricas,funilPassagem,comparar,motivoPerda,comMotivoPerda,telE164,linkWhatsApp,linkLigar,linkConversa,linkComunicar,linkAgenda,formatarTelefone,paginar,linhaDoTempo,situacaoTarefa,ordenarTarefas,novaTarefa,COLUNAS_LEADS,COLUNAS_PADRAO,colunasValidas,ATALHOS_ABA};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CrmUtils = api;
})(typeof window !== 'undefined' ? window : globalThis);
