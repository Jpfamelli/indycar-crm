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
  const COLUNAS_LEADS = ['cliente','carro','servico','origem','valor','status','responsavel','etapa','entrada','campanha'];
  const COLUNAS_PADRAO = ['cliente','carro','servico','origem','valor','status','responsavel','etapa','entrada'];
  function colunasValidas(lista) {
    const ok = Array.isArray(lista) ? COLUNAS_LEADS.filter(c => lista.includes(c)) : [];
    return ok.includes('cliente') ? ok : COLUNAS_PADRAO.slice();
  }
  /* Atalhos de teclado: sequência "g" + letra leva a uma aba. */
  const ATALHOS_ABA = {d:'dashboard', l:'leads', f:'pipeline', c:'clientes', i:'ia', o:'origem', s:'servicos', e:'equipe', t:'dashboard'};
  /* ---------- Rodada 3 (tela) — login, acesso, equipe, tarefas, notificações ---------- */
  const EH_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ehUuid = v => EH_UUID.test(String(v ?? ''));
  const PAPEIS = ['admin','gestor','atendente','agenda'];
  const ROTULO_PAPEL = {admin:'Administrador', gestor:'Gestor', atendente:'Atendente', agenda:'Agenda (só presença)'};
  const ehGestor = p => p === 'admin' || p === 'gestor';
  /* Endereço de cada app do ecossistema (links das notificações são relativos ao app de origem). */
  const URL_APPS = {atendimento:'https://indycar-atendimento.onrender.com', crm:'https://indycar-crm.onrender.com',
    agenda:'https://indycar-agendamentos.onrender.com', comunicar:'https://indycar-posvenda.onrender.com',
    orcador:'https://indycar-orcador.netlify.app'};
  const NOME_APPS = {atendimento:'Atendimento', crm:'CRM', agenda:'Agenda', comunicar:'Comunicar', orcador:'Orçador'};
  /* Quem pode usar o app: admin sempre; papel agenda nunca (exceto a própria Agenda);
     sem lista de apps (perfil antigo) conta como liberado — o servidor confere de novo. */
  function acessoApp(perfil, app = 'crm') {
    if (!perfil) return {ok: false, motivo: 'sem_perfil'};
    if (perfil.ativo === false) return {ok: false, motivo: 'desativado'};
    if (perfil.papel === 'admin') return {ok: true, motivo: null};
    if (perfil.papel === 'agenda' && app !== 'agenda') return {ok: false, motivo: 'papel_agenda'};
    if (!PAPEIS.includes(perfil.papel)) return {ok: false, motivo: 'papel_invalido'};
    if (Array.isArray(perfil.apps) && !perfil.apps.includes(app)) return {ok: false, motivo: 'sem_app'};
    return {ok: true, motivo: null};
  }
  function appsPermitidos(perfil, atual = 'crm') {
    if (!perfil || perfil.ativo === false) return [];
    const lista = perfil.papel === 'admin' ? Object.keys(URL_APPS)
      : perfil.papel === 'agenda' ? ['agenda'] : (Array.isArray(perfil.apps) ? perfil.apps : []);
    return lista.filter(a => a !== atual && URL_APPS[a]).map(a => ({app: a, nome: NOME_APPS[a], url: URL_APPS[a]}));
  }
  /* 401/403 do servidor viram uma ação da tela, pelo `codigo` (aceita hífen ou sublinhado). */
  function acaoErroAcesso(status, corpo) {
    if (status !== 401 && status !== 403) return null;
    const c = String((corpo && (corpo.codigo || corpo.code)) || '').toLowerCase().replace(/-/g, '_');
    if (/desativad|inativ|bloquead/.test(c)) return 'desativado';
    if (/trocar_senha|troca_senha|precisa_trocar/.test(c)) return 'trocar_senha';
    if (/mfa|aal2|duas_etapas/.test(c)) return 'mfa';
    if (/sem_acesso|sem_app|app_negado|acesso_app|papel_agenda|sem_perfil/.test(c)) return 'sem_acesso';
    if (/expirad|token|sessao|sem_login|nao_logado|login/.test(c)) return 'login';
    return status === 401 ? 'login' : 'proibido';
  }
  /* Erro do Supabase Auth em português simples. */
  function mensagemLogin(err) {
    const m = String((err && (err.message || err.msg)) || err || '');
    const cod = String((err && err.code) || '');
    if (/failed to fetch|networkerror|network request|load failed|sem conex/i.test(m) || cod === 'network') return 'Sem internet ou servidor fora do ar. Confira a conexão e tente de novo.';
    if (/invalid login|invalid_credentials|invalid email or password/i.test(m + cod)) return 'E-mail ou senha incorretos.';
    if (/banned|desativad|user_banned/i.test(m + cod)) return 'Seu acesso foi desativado. Fale com o gestor da loja.';
    if (/not confirmed|email_not_confirmed/i.test(m + cod)) return 'Este e-mail ainda não foi confirmado. Peça ao administrador para liberar o acesso.';
    if (/rate limit|too many|over_request|over_email/i.test(m + cod)) return 'Muitas tentativas em pouco tempo. Espere alguns minutos e tente de novo.';
    if (/same.*password|different from the old/i.test(m + cod)) return 'A senha nova precisa ser diferente da atual.';
    if (/weak|password should|at least/i.test(m)) return 'Senha fraca: use pelo menos 8 caracteres, misturando letras e números.';
    if (/invalid totp|invalid code|expired|mfa/i.test(m + cod)) return 'Código inválido ou vencido. Confira o app autenticador e digite o código atual.';
    return m ? 'Não deu certo: ' + m.slice(0, 160) : 'Não deu certo. Tente de novo.';
  }
  /* Espera progressiva depois de 5 erros seguidos: 30 s, 1 min, 2 min… até 15 min. */
  const esperaLogin = falhas => falhas < 5 ? 0 : Math.min(900, 30 * 2 ** (falhas - 5));
  function validarNovaSenha(s1, s2, email) {
    const a = String(s1 ?? ''), e = String(email ?? '').trim().toLowerCase();
    if (a.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
    if (a.length > 72) return 'Use no máximo 72 caracteres.';
    if (a !== String(s2 ?? '')) return 'As duas senhas não são iguais.';
    if (e && (a.toLowerCase() === e || a.toLowerCase() === e.split('@')[0])) return 'A senha não pode ser igual ao seu e-mail.';
    if (/^(.)\1+$/.test(a) || /^(12345678|87654321|senha123|password|indycar1?)$/i.test(a)) return 'Essa senha é fácil demais de adivinhar.';
    return null;
  }
  const codigoMfaValido = c => /^\d{6}$/.test(String(c ?? '').replace(/\s/g, ''));
  /* Link de uma notificação: /?lead= do próprio CRM abre aqui; o resto abre no app de origem.
     Endereço absoluto só se for de um app do ecossistema (nada de link solto vindo do banco). */
  function linkNotificacao(n, atual = 'crm') {
    const link = String((n && n.link) || '').trim(), app = (n && n.app) || atual;
    if (!link) return {interno: null, url: null};
    let u;
    try { u = new URL(link, (URL_APPS[app] || URL_APPS[atual]) + '/'); } catch { return {interno: null, url: null}; }
    const permitido = Object.values(URL_APPS).some(b => new URL(b).origin === u.origin);
    if (!permitido || !/^https:$/.test(u.protocol)) return {interno: null, url: null};
    const lead = u.searchParams.get('lead');
    const mesmo = u.origin === new URL(URL_APPS[atual]).origin;
    if (mesmo && lead && ehUuid(lead)) return {interno: {lead}, url: u.href};
    if (mesmo && u.search) return {interno: {busca: u.search}, url: u.href};
    return {interno: null, url: u.href};
  }
  const CORES_AVATAR = ['#e50914','#3b82f6','#22c55e','#a855f7','#f59e0b','#06b6d4','#ec4899','#64748b'];
  function corAvatar(p) {
    const c = p && p.avatar_cor;
    if (/^#[0-9a-f]{6}$/i.test(String(c ?? ''))) return c;
    const s = String((p && (p.id || p.nome)) || '?'); let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return CORES_AVATAR[h % CORES_AVATAR.length];
  }
  /* Responsável do lead: '' todos · 'meus' · 'sem' · uuid de uma pessoa. */
  function filtroResponsavel(l, filtro, meuId) {
    if (!filtro) return true;
    const r = l && l.responsavel_id ? String(l.responsavel_id) : '';
    if (filtro === 'meus') return !!meuId && r === String(meuId);
    if (filtro === 'sem') return !r;
    return r === String(filtro);
  }
  function funilPorResponsavel(leads, equipe = []) {
    const nomes = new Map(equipe.map(p => [String(p.id), p]));
    const linhas = new Map();
    for (const l of leads) {
      const id = l.responsavel_id ? String(l.responsavel_id) : '';
      if (!linhas.has(id)) linhas.set(id, {perfil_id: id || null, nome: id ? (nomes.get(id)?.nome || 'Pessoa fora da equipe') : 'Sem responsável', porEtapa: Object.fromEntries(ETAPAS.map(e => [e, 0])), total: 0, abertos: 0, valorAberto: 0, ganhos: 0, faturamento: 0});
      const x = linhas.get(id); x.total++;
      if (x.porEtapa[l.status] !== undefined) x.porEtapa[l.status]++;
      if (ABERTAS.includes(l.status)) { x.abertos++; x.valorAberto += valorLead(l); }
      if (l.status === 'concluido') { x.ganhos++; x.faturamento += num(l.valor_pago); }
    }
    return [...linhas.values()].map(x => ({...x, valorAberto: Math.round(x.valorAberto * 100) / 100, faturamento: Math.round(x.faturamento * 100) / 100}))
      .sort((a, b) => (a.perfil_id === null) - (b.perfil_id === null) || b.abertos - a.abertos || b.total - a.total);
  }
  /* Tarefas (tabela `tarefas`): vence_em é data e hora. */
  function vencimentoDe(data, hora) {
    if (!data) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data); if (!m) throw new Error('Data inválida.');
    const h = /^(\d{2}):(\d{2})$/.exec(hora || '17:30'); if (!h) throw new Error('Hora inválida.');
    const d = new Date(+m[1], m[2] - 1, +m[3], +h[1], +h[2]);
    if (!Number.isFinite(+d) || d.getDate() !== +m[3]) throw new Error('Data inválida.');
    return d.toISOString();
  }
  function situacaoTarefaDb(t, agora = new Date()) {
    if (!t) return 'sem_data';
    if (t.status === 'feita') return 'feita';
    if (t.status === 'cancelada') return 'cancelada';
    const v = ms(t.vence_em); if (!Number.isFinite(v)) return 'sem_data';
    const ini = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).getTime(), fim = ini + DIA;
    if (v < +agora) return 'atrasada';
    return v < fim ? 'hoje' : 'futura';
  }
  function ordenarTarefasDb(lista, agora = new Date()) {
    const peso = {atrasada: 0, hoje: 1, futura: 2, sem_data: 3, feita: 4, cancelada: 5};
    return [...lista].sort((a, b) => peso[situacaoTarefaDb(a, agora)] - peso[situacaoTarefaDb(b, agora)]
      || String(a.vence_em || '9').localeCompare(String(b.vence_em || '9'))
      || (num(b.prioridade) || 2) - (num(a.prioridade) || 2)
      || String(a.created_at || '').localeCompare(String(b.created_at || '')));
  }
  function agruparTarefas(lista, agora = new Date()) {
    const g = {atrasadas: [], hoje: [], proximas: [], semData: []};
    for (const t of ordenarTarefasDb(lista, agora)) {
      const s = situacaoTarefaDb(t, agora);
      if (s === 'atrasada') g.atrasadas.push(t); else if (s === 'hoje') g.hoje.push(t);
      else if (s === 'futura') g.proximas.push(t); else if (s === 'sem_data') g.semData.push(t);
    }
    return g;
  }
  function validarTarefa(d) {
    const titulo = String(d && d.titulo || '').replace(/\s+/g, ' ').trim();
    if (!titulo) throw new Error('Escreva a tarefa.');
    if (titulo.length > 200) throw new Error('Tarefa com até 200 caracteres.');
    const descricao = String(d.descricao || '').trim();
    if (descricao.length > 2000) throw new Error('Descrição com até 2.000 caracteres.');
    const prioridade = Math.round(num(d.prioridade) || 2);
    if (prioridade < 1 || prioridade > 3) throw new Error('Prioridade de 1 a 3.');
    const row = {titulo, prioridade, origem: 'crm', status: 'aberta'};
    if (descricao) row.descricao = descricao;
    if (d.vence_em) { if (!Number.isFinite(ms(d.vence_em))) throw new Error('Data inválida.'); row.vence_em = new Date(d.vence_em).toISOString(); }
    for (const k of ['responsavel_id', 'lead_id', 'cliente_id', 'conversa_id', 'agendamento_id']) {
      if (d[k] == null || d[k] === '') continue;
      if (!ehUuid(d[k])) throw new Error('Identificador inválido.');
      row[k] = String(d[k]);
    }
    return row;
  }
  /* Lembrete antigo (localStorage) vira linha da tabela tarefas. */
  function lembreteParaTarefa(l, meuId) {
    const row = validarTarefa({titulo: l && l.texto, responsavel_id: ehUuid(meuId) ? meuId : null, lead_id: ehUuid(l && l.leadId) ? l.leadId : null,
      vence_em: l && l.para && /^\d{4}-\d{2}-\d{2}$/.test(l.para) ? vencimentoDe(l.para, '17:30') : null});
    if (l && l.feita) row.status = 'feita';
    row.descricao = 'Importado dos lembretes deste aparelho.';
    return row;
  }
  const ROTULO_PRIORIDADE = {1: 'Baixa', 2: 'Normal', 3: 'Urgente'};
  /* Metas: AAAA-MM, intervalo do mês e projeção pelo ritmo. */
  function mesAtual(agora = new Date()) { return agora.getFullYear() + '-' + String(agora.getMonth() + 1).padStart(2, '0'); }
  function intervaloMes(mes) {
    const m = /^(\d{4})-(\d{2})$/.exec(mes || ''); if (!m || +m[2] < 1 || +m[2] > 12) throw new Error('Mês inválido.');
    const fim = new Date(+m[1], +m[2], 0).getDate();
    return {de: `${m[1]}-${m[2]}-01`, ate: `${m[1]}-${m[2]}-${String(fim).padStart(2, '0')}`, dias: fim};
  }
  function progressoMeta(realizado, alvo, mes, agora = new Date()) {
    const r = num(realizado), a = num(alvo);
    const {dias} = intervaloMes(mes), atual = mes === mesAtual(agora);
    const passados = atual ? agora.getDate() : (mes < mesAtual(agora) ? dias : 0);
    const projecao = passados ? Math.round(r / passados * dias * 100) / 100 : 0;
    return {pct: a > 0 ? Math.min(100, Math.round(r / a * 100)) : 0, falta: Math.max(0, Math.round((a - r) * 100) / 100), projecao, noRitmo: a > 0 && projecao >= a};
  }
  const CAMPOS_META = ['leads', 'agendamentos', 'vendas', 'faturamento'];
  function validarMetas(lista) {
    if (!Array.isArray(lista)) throw new Error('Metas inválidas.');
    const vistos = new Set();
    return lista.map(m => {
      const id = m.perfil_id ? String(m.perfil_id) : null;
      if (id && !ehUuid(id)) throw new Error('Pessoa inválida.');
      if (vistos.has(id)) throw new Error('Pessoa repetida nas metas.'); vistos.add(id);
      const r = {perfil_id: id};
      for (const k of CAMPOS_META) { const v = num(m[k]); if (v < 0 || v > (k === 'faturamento' ? 10000000 : 100000)) throw new Error('Meta fora do limite.'); r[k] = k === 'faturamento' ? Math.round(v * 100) / 100 : Math.round(v); }
      return r;
    });
  }
  /* GET /api/metas aceita dois formatos: lista plana [{perfil_id, leads…, realizado, projecao}]
     ou o do servidor {loja:{meta, itens:{campo:{meta,realizado,projecao}}}, pessoas:[…]}. Sai sempre a lista plana. */
  function normalizarMetas(r) {
    if (Array.isArray(r)) return r.map(m => ({...m, perfil_id: m.perfil_id || null}));
    if (!r || typeof r !== 'object') return [];
    const linha = (perfil_id, x) => {
      const out = {perfil_id, nome: x.nome, avatar_cor: x.avatar_cor || null, status: x.status || null, realizado: {}, projecao: {}};
      for (const k of CAMPOS_META) {
        const it = x.itens && x.itens[k];
        out[k] = num(x.meta && x.meta[k]);
        if (it) { if (it.realizado != null) out.realizado[k] = num(it.realizado); if (it.projecao != null) out.projecao[k] = num(it.projecao); }
      }
      return out;
    };
    return [...(r.loja ? [linha(null, r.loja)] : []), ...(Array.isArray(r.pessoas) ? r.pessoas.filter(p => p.perfil_id).map(p => linha(String(p.perfil_id), p)) : [])];
  }
  /* GET /api/desempenho: lista plana ou {pessoas:[…]} do servidor (sem a linha "Sem responsável"). */
  function normalizarDesempenho(r) {
    const l = Array.isArray(r) ? r : (r && (r.pessoas || r.equipe || r.desempenho)) || [];
    return l.filter(x => x && x.perfil_id && !x.inativo);
  }
  /* GET /api/vendedores {vendedores:[…]} · /api/equipe/nomes […] · {equipe:[…]} */
  function normalizarEquipe(r) {
    const l = Array.isArray(r) ? r : (r && (r.vendedores || r.equipe || r.nomes)) || null;
    return l ? l.filter(p => p && ehUuid(p.id) && p.papel !== 'agenda' && p.ativo !== false).map(p => ({id: String(p.id), nome: String(p.nome || 'Sem nome').slice(0, 80), papel: p.papel || 'atendente', avatar_cor: p.avatar_cor || null, cargo: p.cargo || null, abertos: p.abertos ?? null})) : null;
  }
  /* Quem pode mudar o responsável (mesma regra do servidor): gestor muda qualquer um;
     atendente só passa lead dele ou pega lead sem dono; tirar o dono é só do gestor. */
  function podeReatribuir(lead, perfil, novo) {
    if (!perfil) return false;
    if (ehGestor(perfil.papel)) return true;
    if (novo === null || novo === '') return false;
    const dono = lead && lead.responsavel_id ? String(lead.responsavel_id) : null;
    return !dono || dono === String(perfil.id);
  }
  function ordenarDesempenho(lista, criterio = 'faturamento') {
    const v = x => criterio === 'tempo_resposta_min' ? -(x[criterio] ?? Infinity) : num(x[criterio]);
    return [...(lista || [])].sort((a, b) => v(b) - v(a) || num(b.faturamento) - num(a.faturamento) || String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
  }
  const deveGravarAcesso = (ultimo, agora = Date.now()) => !Number.isFinite(Number(ultimo)) || agora - Number(ultimo) >= 5 * 60000;
  /* preferências do perfil: mistura sem apagar chaves dos outros apps. */
  function mesclarPreferencias(atual, novas) {
    const a = atual && typeof atual === 'object' && !Array.isArray(atual) ? atual : {};
    const out = {...a};
    for (const [k, v] of Object.entries(novas || {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? {...(a[k] && typeof a[k] === 'object' ? a[k] : {}), ...v} : v;
    return out;
  }
  function tempoRelativo(iso, agora = Date.now()) {
    const t = ms(iso); if (!Number.isFinite(t)) return '';
    const s = Math.max(0, Math.round((agora - t) / 1000));
    if (s < 60) return 'agora'; if (s < 3600) return Math.floor(s / 60) + ' min';
    if (s < 86400) return Math.floor(s / 3600) + ' h';
    const d = Math.floor(s / 86400); return d === 1 ? 'ontem' : d + ' dias';
  }
  const api = {normalizar,digitos,buscar,validarLead,nascimento,moeda,csv,ETAPAS,ABERTAS,LIMITE_PARADO,valorLead,diasNaEtapa,parado,textoDias,resumoColuna,periodo,metricas,funilPassagem,comparar,motivoPerda,comMotivoPerda,telE164,linkWhatsApp,linkLigar,linkConversa,linkComunicar,linkAgenda,formatarTelefone,paginar,linhaDoTempo,situacaoTarefa,ordenarTarefas,novaTarefa,COLUNAS_LEADS,COLUNAS_PADRAO,colunasValidas,ATALHOS_ABA,
    ehUuid,PAPEIS,ROTULO_PAPEL,ehGestor,URL_APPS,NOME_APPS,acessoApp,appsPermitidos,acaoErroAcesso,mensagemLogin,esperaLogin,validarNovaSenha,codigoMfaValido,linkNotificacao,CORES_AVATAR,corAvatar,filtroResponsavel,funilPorResponsavel,vencimentoDe,situacaoTarefaDb,ordenarTarefasDb,agruparTarefas,validarTarefa,lembreteParaTarefa,ROTULO_PRIORIDADE,mesAtual,intervaloMes,progressoMeta,CAMPOS_META,validarMetas,normalizarMetas,normalizarDesempenho,normalizarEquipe,podeReatribuir,ordenarDesempenho,deveGravarAcesso,mesclarPreferencias,tempoRelativo};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CrmUtils = api;
})(typeof window !== 'undefined' ? window : globalThis);
