// Servidor FALSO do CRM: serve a interface real de public/ com login fictício e dados
// 100% inventados, em memória. Não lê .env, não chama Supabase, não envia mensagens.
// Uso: npm run mock  →  http://127.0.0.1:3101
//   MOCK_LATENCIA=800        atrasa cada /api (para ver esqueletos)
//   MOCK_IA_TESTE=arquivo.js injeta um script de teste do contrato da IA (nunca commitar)
//   MOCK_PAPEL=atendente     muda o papel do login fictício
//   PORT=3121                outra porta (quando a 3101 estiver ocupada)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const statuses = ['novo','contato','orcamento','agendado','em_servico','concluido','perdido'];
const origens = ['meta','google','organico','whatsapp','indicacao','passagem'];
const DIA = 86400000;

/* gerador previsível: os mesmos dados fictícios a cada execução */
function rng(semente) { let s = semente >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const NOMES = ['Ana','Bruno','Carla','Diego','Elisa','Fábio','Gabi','Hugo','Iara','Jonas','Kátia','Lucas','Marta','Nilo','Olga','Paulo','Rita','Saulo','Tânia','Vítor'];
const SOBRE = ['Teste','Fictício','Exemplo','Simulado','Demo'];
const CARROS = ['Onix 2019','HB20 2021','Corolla 2018','Gol 2015','Civic 2020','Strada 2022','Kwid 2023','Compass 2021'];
const SERVICOS = ['Troca de Óleo de Motor','Freios','Suspensão','Alinhamento 3D','Diagnóstico com Scanner','Embreagem','Correia Dentada'];
const MOTIVOS = ['Achou caro','Foi em outra oficina','Sem retorno do cliente','Desistiu do serviço'];

function gerarDados(agora = Date.now()) {
  const r = rng(42), pick = a => a[Math.floor(r() * a.length)];
  const placa = i => 'TST' + (i % 10) + String.fromCharCode(65 + (i % 26)) + String(i % 100).padStart(2, '0');
  const clientes = [];
  for (let i = 0; i < 2500; i++) {
    clientes.push({id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, nome: `${pick(NOMES)} ${pick(SOBRE)} ${i}`,
      telefone: '129' + String(10000000 + i).slice(-8), carro_modelo: pick(CARROS), placa: placa(i), origem: pick(origens),
      created_at: new Date(agora - Math.floor(r() * 900) * DIA).toISOString(), nascimento: i % 7 ? null : '1904-0' + (1 + i % 9) + '-1' + (i % 9),
      aceita_mensagens: i % 3 ? true : null, email: null, observacoes: null});
  }
  // o primeiro cliente mantém o nome com sinais de < > para provar o escape
  clientes[0] = {...clientes[0], id: '11111111-1111-4111-8111-111111111111', nome: 'CLIENTE FICTÍCIO <teste>', telefone: '12900000001', placa: 'ABC1D23', carro_modelo: 'Carro de teste', nascimento: '1904-02-29', aceita_mensagens: false};
  const leads = [];
  for (let i = 0; i < 90; i++) {
    // 60 clientes para 90 leads: alguns clientes têm mais de um lead (histórico e link por cliente)
    const c = clientes[i * 7 % 60], st = i === 0 ? 'novo' : statuses[Math.floor(r() * statuses.length)];
    const criado = agora - Math.floor(r() * 75 * DIA) - 3600000, mexido = Math.min(agora - 600000, criado + Math.floor(r() * 12) * DIA);
    const orc = [0, 150, 280, 420, 690, 1250, 2300][Math.floor(r() * 7)];
    const l = {id: `22222222-2222-4222-8222-${String(i).padStart(12, '0')}`, cliente_id: c.id, nome: c.nome, telefone: c.telefone,
      carro_modelo: c.carro_modelo, placa: c.placa, servico: pick(SERVICOS), origem: pick(origens), status: st,
      valor_orcado: orc, valor_pago: st === 'concluido' ? orc || 180 : 0, utm_campaign: r() < .3 ? 'campanha-teste' : '',
      observacoes: st === 'perdido' && r() < .75 ? 'Motivo da perda: ' + pick(MOTIVOS) : '',
      created_at: new Date(criado).toISOString(), updated_at: new Date(mexido).toISOString(),
      closed_at: ['concluido','perdido'].includes(st) ? new Date(mexido).toISOString() : null};
    leads.push(l);
  }
  leads.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return {clientes, leads};
}

const auth = `window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'ficticio'}}}),signOut:async()=>({}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}})};`;
const tipos = {'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.mjs':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};

export function criarMock({latencia = Number(process.env.MOCK_LATENCIA) || 0, iaTeste = process.env.MOCK_IA_TESTE || '', papel = process.env.MOCK_PAPEL || 'admin'} = {}) {
  let {clientes, leads} = gerarDados();
  const acoes = [];
  const resumo = (lista, desde) => {
    const rec = desde ? lista.filter(l => Date.parse(l.created_at) >= desde) : lista;
    const ganhos = rec.filter(l => l.status === 'concluido'), perdidos = rec.filter(l => l.status === 'perdido');
    const faturamento = ganhos.reduce((s, l) => s + Number(l.valor_pago || 0), 0);
    const porOrigem = origens.map(o => { const d = rec.filter(l => l.origem === o), g = d.filter(l => l.status === 'concluido');
      return {origem: o, leads: d.length, ganhos: g.length, faturamento: g.reduce((s, l) => s + Number(l.valor_pago || 0), 0)}; }).filter(o => o.leads);
    return {total: rec.length, ganhos: ganhos.length, perdidos: perdidos.length, faturamento,
      emAberto: rec.filter(l => !['concluido','perdido'].includes(l.status)).reduce((s, l) => s + Number(l.valor_orcado || 0), 0),
      ticket: ganhos.length ? faturamento / ganhos.length : 0, conversao: rec.length ? ganhos.length / rec.length * 100 : 0, porOrigem,
      porStatus: Object.fromEntries(statuses.map(s => [s, rec.filter(l => l.status === s).length]))};
  };
  const fichaCliente = id => {
    const c = clientes.find(x => x.id === id); if (!c) return null;
    const ls = leads.filter(l => l.cliente_id === id);
    const ag = ls.filter(l => ['agendado','em_servico','concluido'].includes(l.status)).map((l, i) => ({id: 'ag' + i + l.id.slice(-4), data: l.updated_at.slice(0, 10), hora: '09:30:00', servico: l.servico, veiculo: l.carro_modelo, status: l.status === 'concluido' ? 'concluido' : 'confirmado', valor: l.valor_orcado, lead_id: l.id}));
    const gasto = ls.filter(l => l.status === 'concluido').reduce((s, l) => s + Number(l.valor_pago || 0), 0);
    const servicos = {}; for (const l of ls.filter(l => l.status === 'concluido')) servicos[l.servico] = (servicos[l.servico] || 0) + 1;
    return {cliente: c, resumo: {gasto, emAberto: ls.filter(l => !['concluido','perdido'].includes(l.status)).reduce((s, l) => s + Number(l.valor_orcado || 0), 0),
      servicosFeitos: Object.values(servicos).reduce((s, n) => s + n, 0), ticket: 0, leads: ls.length, agendamentos: ag.length, faltas: 0, ultimoServico: null},
      leads: ls, agendamentos: ag, servicos: Object.entries(servicos).map(([nome, vezes]) => ({nome, vezes}))};
  };
  const contexto = l => {
    const ag = fichaCliente(l.cliente_id)?.agendamentos || [];
    const cliente = clientes.find(c => c.id === l.cliente_id) || null;
    const criado = Date.parse(l.created_at), em = ms => new Date(criado + ms).toISOString();
    return {
      lead: l, leads: leads.filter(x => x.cliente_id && x.cliente_id === l.cliente_id), cliente, c360: null, conversa: {id: 'conversa-ficticia'}, etapa: null,
      mensagens: [
        {id: 'm1', direcao: 'entrada', corpo: `Oi, queria orçamento de ${l.servico} (mensagem fictícia)`, created_at: em(60000)},
        {id: 'm2', direcao: 'saida', gerada_por_ia: true, corpo: 'Olá! Posso agendar um diagnóstico digital gratuito? (fictício)', created_at: em(120000)},
      ],
      agendamentos: ag,
      orcamentos: l.valor_orcado ? [{id: 'o1', numero: 1000 + leads.indexOf(l), status: 'enviado', total: l.valor_orcado, created_at: em(3600000), enviado_em: em(3600000), lead_id: l.id}] : [],
      comunicar: l.status === 'concluido' ? [{id: 'e1', tipo: 'pos_venda', status: 'enviado', corpo: 'Como ficou o carro? (fictício)', created_at: l.updated_at, enviado_em: l.updated_at, respondido_em: null, resposta: null}] : [],
      satisfacao: [],
      sinais: {diasNaEtapa: Math.floor((Date.now() - Date.parse(l.updated_at || l.created_at)) / DIA), clienteEsperandoResposta: false},
      links: linksDe(l.telefone), geradoEm: new Date().toISOString(),
    };
  };
  // Rotas da IA no MESMO formato do servidor real (lib/ia-crm.js), com conteúdo inventado e sem chamar a Claude.
  const registrar = (tipo, lead, resumo, saida, status = 'proposta') => {
    const a = {id: crypto.randomUUID(), origem: 'crm', tipo, status, lead_id: lead?.id || null, cliente_id: lead?.cliente_id || null, resumo, saida, created_at: new Date().toISOString(), executada_em: status === 'executada' ? new Date().toISOString() : null};
    acoes.unshift(a); return a;
  };
  const resumoLead = l => ({id: l.id, nome: l.nome, status: l.status, origem: l.origem, servico: l.servico || null, telefone: l.telefone || null});
  const linksDe = tel => { const t = String(tel || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, ''), q = t ? '?tel=' + t : '';
    return {atendimento: 'https://indycar-atendimento.onrender.com/' + q, agenda: 'https://indycar-agendamentos.onrender.com/' + q, comunicar: 'https://indycar-posvenda.onrender.com/' + q, whatsapp: t ? 'https://wa.me/55' + t : null, ligar: t ? 'tel:+55' + t : null}; };
  const ia = (url, req, d, json) => {
    const p = url.pathname;
    const ml = p.match(/^\/api\/ia\/lead\/([0-9a-f-]{36})\/(contexto|proxima-acao|qualificar|preencher)$/);
    if (ml) {
      const l = leads.find(x => x.id === ml[1]); if (!l) return json({erro: 'Lead não encontrado.'}, 404);
      if (ml[2] === 'contexto') return json(contexto(l));
      if (req.method !== 'POST') return json({erro: 'método não permitido'}, 405);
      if (ml[2] === 'proxima-acao') {
        const proposta = {acao: 'mensagem', prioridade: 'alta', justificativa: 'Cliente pediu orçamento e está sem resposta (fictício).', texto_mensagem: 'Oi! Aqui é da IndyCar. Posso reservar um diagnóstico digital gratuito pra você? (texto fictício)', novo_status: null, motivo_perda: null};
        const plano = {abrir: linksDe(l.telefone).atendimento, texto: proposta.texto_mensagem};
        return json({acao: registrar('crm_proxima_acao', l, 'Mandar mensagem — ' + proposta.justificativa, {...proposta, plano}), proposta, plano, avisos: [], automatico: false, autonomia: 'confirmar'});
      }
      if (ml[2] === 'qualificar') {
        const qualificacao = {temperatura: 'morno', probabilidade: 62, motivo: 'Pediu orçamento, mas não marcou data (fictício).', sinais: ['Pediu orçamento', 'Sem data definida']};
        return json({acao: registrar('crm_qualificar', l, `morno · 62% — ${qualificacao.motivo}`, qualificacao, 'executada'), qualificacao});
      }
      const campos = [{campo: 'carro_modelo', atual: l.carro_modelo || null, sugerido: l.carro_modelo || 'Onix 2019', vazio: !l.carro_modelo}, {campo: 'servico', atual: l.servico || null, sugerido: l.servico || 'Freios', vazio: !l.servico}];
      return json({acao: registrar('crm_preencher', l, 'Atualizar carro_modelo, servico pela conversa', {campos, plano: {muda: {lead: {antes: {}, depois: {}}}}}), campos, avisos: [], automatico: false, autonomia: 'confirmar'});
    }
    if (p === '/api/ia/triagem' && req.method === 'POST') {
      const agora = Date.now(), parados = leads.filter(l => !['concluido','perdido'].includes(l.status) && agora - Date.parse(l.updated_at || l.created_at) > 3 * DIA).slice(0, 6);
      const itens = parados.map(l => { const dias = Math.floor((agora - Date.parse(l.updated_at || l.created_at)) / DIA); const a = registrar('crm_triagem', l, `Ligar — parado há ${dias} dias (fictício)`, {acao: 'ligar', justificativa: 'Parado (fictício)', plano: {abrir: linksDe(l.telefone).ligar}, regra: 'parado', dias, porIA: false, lead: resumoLead(l)});
        return {...a, lead: resumoLead(l), regra: 'parado', dias}; });
      return json({itens, novos: itens.length, porIA: false, erroIA: null, autonomia: 'confirmar', total: leads.length});
    }
    if (p === '/api/ia/perguntar' && req.method === 'POST') {
      const pergunta = String(d.pergunta || '').slice(0, 300), citados = leads.slice(0, 3).map(resumoLead);
      const a = registrar('crm_perguntar', null, pergunta, {resposta: 'resposta fictícia'}, 'executada');
      return json({id: a.id, pergunta, resposta: `Resposta fictícia para: ${pergunta}`, leads: citados, semDados: false, modelo: 'mock', base: {hoje: new Date().toISOString().slice(0, 10), leads: leads.length}});
    }
    const ma = p.match(/^\/api\/ia\/acoes\/([0-9a-f-]{36})\/(executar|recusar|desfazer)$/);
    if (ma && req.method === 'POST') {
      const a = acoes.find(x => x.id === ma[1]); if (!a) return json({erro: 'Ação não encontrada.'}, 404);
      if (ma[2] === 'desfazer') { if (a.status !== 'executada') return json({erro: 'Esta ação não mudou nada no CRM; não há o que desfazer.'}, 422); a.status = 'desfeita'; return json({ok: true, id: a.id}); }
      if (a.status !== 'proposta') return json({erro: 'Essa ação já foi tratada.'}, 409);
      if (ma[2] === 'recusar') { a.status = 'recusada'; return json({ok: true, id: a.id}); }
      const novo = a.saida?.novo_status;
      if (['concluido','perdido'].includes(novo) && !d.confirmarFaturamento) return json({erro: 'Esta ação mexe em faturamento (concluído/perdido). Confirme para executar.', precisaConfirmar: true}, 428);
      a.status = 'executada'; a.executada_em = new Date().toISOString();
      return json({ok: true, id: a.id, abrir: a.saida?.plano?.abrir || null, texto: a.saida?.plano?.texto || null, mudou: false});
    }
    if (p === '/api/ia/acoes') { const lid = url.searchParams.get('leadId'); return json({acoes: acoes.filter(a => !lid || a.lead_id === lid).slice(0, Number(url.searchParams.get('limite')) || 30)}); }
    if (p === '/api/ia/uso') { const hoje = acoes.length; return json({ativo: true, configurada: true, autonomia: 'confirmar', modelos: {rapido: 'mock', forte: 'mock'}, hoje, limite: 300, restante: Math.max(0, 300 - hoje), doCrmHoje: hoje, porTipo: {}, tokensHoje: 0}); }
    return null;
  };

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const json = (v, status = 200) => { res.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}); res.end(JSON.stringify(v)); };
    let body = ''; for await (const c of req) body += c;
    let d = {};
    try { d = body ? JSON.parse(body) : {}; } catch { return json({erro: 'JSON inválido.'}, 400); }
    if (url.pathname.startsWith('/api/')) {
      if (latencia) await new Promise(r => setTimeout(r, latencia));
      const p = url.pathname;
      if (p === '/api/config') return json({configurado: true, supabaseUrl: 'http://localhost', supabaseAnonKey: 'ficticia'});
      if (p === '/api/perfil') return json({id: 'ficticio', nome: 'Equipe de teste', email: 'teste@exemplo.invalid', papel});
      if (p === '/api/stats') return json({semana: resumo(leads, Date.now() - 7 * DIA), geral: resumo(leads), comparativo: {leads: {atual: 5, anterior: 4}, faturamento: {atual: 900, anterior: 1200}}, dominios: {STATUSES: statuses, ORIGENS: origens}});
      if (p === '/api/saude') return json({avisos: [{problema: 'Aviso fictício: integração em manutenção', desde: '2026-10-09'}]});
      if (p === '/api/lead-por-telefone') {
        const t = String(url.searchParams.get('tel') || url.searchParams.get('t') || '').replace(/\D/g, '').slice(-8);
        const doTel = x => t.length === 8 && String(x.telefone).replace(/\D/g, '').slice(-8) === t;
        const cliente = clientes.find(doTel) || null, ls = leads.filter(doTel).sort((a, b) => b.created_at.localeCompare(a.created_at));
        const aberto = ls.find(l => !['concluido','perdido'].includes(l.status)) || null;
        return json({cliente, leads: ls, aberto, lead: aberto || ls[0] || null});
      }
      if (p.startsWith('/api/ia/')) { const r = ia(url, req, d, json); if (r !== null) return r; }
      if (p === '/api/leads' && req.method === 'POST') {
        const c = clientes.find(x => String(x.telefone).replace(/\D/g, '').slice(-8) === String(d.telefone || '').replace(/\D/g, '').slice(-8));
        const agora = new Date().toISOString();
        const l = {valor_orcado: 0, valor_pago: 0, status: 'novo', origem: 'organico', ...d, id: crypto.randomUUID(), cliente_id: c?.id || null, created_at: agora, updated_at: agora, closed_at: null};
        leads.unshift(l); return json(l, 201);
      }
      if (p === '/api/leads') return json(leads);
      if (p.startsWith('/api/leads/')) {
        const id = p.split('/').at(-1), l = leads.find(x => x.id === id);
        if (!l) return json({erro: 'lead não encontrado'}, 404);
        if (req.method === 'PATCH') {
          if (d.status && !statuses.includes(d.status)) return json({erro: 'Etapa inválida.'}, 400);
          const mudouEtapa = d.status && d.status !== l.status;
          Object.assign(l, d, {updated_at: new Date().toISOString()});
          if (mudouEtapa) l.closed_at = ['concluido','perdido'].includes(l.status) ? l.updated_at : null;
        }
        if (req.method === 'DELETE') { leads = leads.filter(x => x.id !== id); return json({ok: true}); }
        return json(l);
      }
      if (p === '/api/clientes') {
        const q = String(url.searchParams.get('q') || '').toLowerCase(), dig = q.replace(/\D/g, '');
        const lista = clientes.filter(c => !q || c.nome.toLowerCase().includes(q) || (dig.length >= 4 && c.telefone.includes(dig)) || c.placa.toLowerCase().includes(q.replace(/[^a-z0-9]/g, '')))
          .map(c => { const ls = leads.filter(l => l.cliente_id === c.id), g = ls.filter(l => l.status === 'concluido');
            return {...c, gasto: g.reduce((s, l) => s + Number(l.valor_pago || 0), 0), emAberto: ls.filter(l => !['concluido','perdido'].includes(l.status)).reduce((s, l) => s + Number(l.valor_orcado || 0), 0), servicos: g.length, leads: ls.length, agendamentos: 0, ultimoContato: ls[0]?.updated_at || c.created_at}; })
          .sort((a, b) => b.gasto - a.gasto || String(b.ultimoContato).localeCompare(String(a.ultimoContato)));
        const fat = lista.reduce((s, c) => s + c.gasto, 0);
        return json({clientes: lista, filtrado: !!q, total: lista.length, faturamento: fat, totalBase: clientes.length, faturamentoBase: leads.filter(l => l.status === 'concluido').reduce((s, l) => s + Number(l.valor_pago || 0), 0)});
      }
      if (p.startsWith('/api/clientes/')) {
        const id = p.split('/').at(-1), c = clientes.find(x => x.id === id);
        if (!c) return json({erro: 'cliente não encontrado'}, 404);
        if (req.method === 'PATCH') { for (const k of ['nascimento','aceita_mensagens']) if (k in d) c[k] = d[k]; return json({cliente: c}); }
        return json(fichaCliente(id));
      }
      if (p === '/api/resumo-ia') return json({ok: true, resumo: '## Semana fictícia\n- Dados inventados pelo servidor falso.', modelo: 'mock', geradoEm: new Date().toISOString()});
      if (p === '/api/catalogo') return json({servicos: [], souAdmin: papel === 'admin'});
      if (p === '/api/equipe') return json({equipe: [], souAdmin: papel === 'admin'});
      if (p === '/api/integracoes') return json({canais: []});
      if (p === '/api/roi') return json({totais: {investimento: 0, faturamento: 0, lucro: 0, roi: null, leads: 0, ganhos: 0}, linhas: []});
      return json({erro: 'Rota fictícia não implementada'}, 404);
    }
    if (iaTeste && url.pathname === '/__ia-teste.js') { res.writeHead(200, {'Content-Type': tipos['.js']}); return res.end(fs.readFileSync(iaTeste)); }
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1)); const f = path.resolve(root, rel);
    if (!f.startsWith(root + path.sep)) return json({erro: 'Proibido'}, 403);
    try {
      let data = fs.readFileSync(f);
      if (rel === 'index.html') {
        let h = data.toString().replace(/<script src="https:\/\/cdn.jsdelivr[^>]+><\/script>/, `<script>${auth}</script>`).replace(/if \('serviceWorker' in navigator\)/, 'if (false)');
        if (iaTeste) h = h.replace('</body>', '<script src="/__ia-teste.js"></script></body>');
        data = Buffer.from(h);
      }
      res.writeHead(200, {'Content-Type': tipos[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache'}); res.end(data);
    } catch { return json({erro: 'Arquivo não encontrado'}, 404); }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { const porta = Number(process.env.PORT) || 3101; criarMock().listen(porta, '127.0.0.1', () => console.log('CRM fictício em http://127.0.0.1:' + porta)); }
