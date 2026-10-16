/* Rodada 5: funções puras (lib/rodada5, lib/apps, public/apps.js, crm-utils novo). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R5 = require('../lib/rodada5');
const APPS = require('../lib/apps');
const U = require('../public/crm-utils');

const dias = n => new Date(Date.now() - n * 864e5).toISOString();
const L = (n, extra = {}) => ({ id: `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`, nome: 'Fictício ' + n, telefone: '1299' + String(1000000 + n), status: 'novo', origem: 'whatsapp', valor_orcado: 0, valor_pago: 0, created_at: dias(10), updated_at: dias(5), closed_at: null, responsavel_id: null, ...extra });

test('telefone normalizado: com/sem 55, máscara, nono dígito', () => {
  assert.equal(R5.normalizarTelefone('+55 (12) 99620-4288'), '12996204288');
  assert.equal(R5.normalizarTelefone('5512996204288'), '12996204288');
  assert.equal(R5.normalizarTelefone('1236320000'), '1236320000');
  assert.equal(R5.normalizarTelefone('123'), null);
  assert.deepEqual(R5.variantesTelefone('12996204288').sort(), ['1296204288', '12996204288']);
  assert.deepEqual(R5.variantesTelefone('1236320000').sort(), ['1236320000', '12936320000']);
});

test('motivo de perda padronizado a partir do texto livre', () => {
  assert.equal(R5.motivoPadrao('achou muito caro o orçamento'), 'Achou caro');
  assert.equal(R5.motivoPadrao('fez na concorrência'), 'Foi em outra oficina');
  assert.equal(R5.motivoPadrao('não respondeu mais'), 'Sem retorno do cliente');
  assert.equal(R5.motivoPadrao('vendeu o carro'), 'Desistiu do serviço');
  assert.equal(R5.motivoPadrao('não fazemos esse serviço'), 'Não fazemos o serviço');
  assert.equal(R5.motivoPadrao('precisava para amanhã'), 'Prazo não atendeu');
  assert.equal(R5.motivoPadrao('Outro'), 'Outro');
  assert.equal(R5.motivoPadrao('xyz'), 'Outro');
  assert.equal(R5.motivoPadrao(''), null);
  assert.equal(R5.motivoDe('obs\nMotivo da perda: Achou caro'), 'Achou caro');
  assert.equal(R5.MOTIVOS_PERDA.length, 7);
});

test('parâmetros por modelo: Sonnet pensa entre ferramentas; Opus/Haiku usam effort', () => {
  assert.deepEqual(R5.parametrosModelo('claude-sonnet-5-5'), { thinking: { type: 'between_tools' } });
  assert.deepEqual(R5.parametrosModelo('claude-opus-5-5'), { output_config: { effort: 'low' } });
  assert.deepEqual(R5.parametrosModelo('claude-haiku-5-5'), { output_config: { effort: 'low' } });
  assert.deepEqual(R5.parametrosModelo(''), { output_config: { effort: 'low' } });
});

test('previsão pelo funil: valor × chance por etapa, ajuste pela conversão e leads sem valor fora', () => {
  const leads = [L(1, { status: 'orcamento', valor_orcado: 1000 }), L(2, { status: 'agendado', valor_orcado: 500 }), L(3, { status: 'novo' }), L(4, { status: 'concluido', closed_at: dias(3) })];
  const p = R5.previsaoPipeline(leads);
  assert.equal(p.leadsAbertos, 3); assert.equal(p.semValor, 1); assert.equal(p.emAberto, 1500);
  assert.equal(p.conversaoHistorica, null, 'menos de 10 fechamentos: sem conversão histórica');
  assert.equal(p.fator, 1);
  assert.equal(p.previsto, Math.round((1000 * 0.45 + 500 * 0.7) * 100) / 100);
  // 12 fechamentos com 100% de ganho puxam as chances para cima (teto 1,5× e 95%)
  const bons = Array.from({ length: 12 }, (_, i) => L(100 + i, { status: 'concluido', closed_at: dias(i + 1), valor_pago: 100 }));
  const q = R5.previsaoPipeline([...leads, ...bons]);
  assert.equal(q.conversaoHistorica, 100); assert.equal(q.fator, 1.5);
  assert.equal(q.porEtapa.find(e => e.etapa === 'em_servico').chance, 0.95);
  assert.ok(q.previsto > p.previsto);
  // perdas antigas (mais de 90 dias) não entram na conversão
  const velhos = Array.from({ length: 12 }, (_, i) => L(200 + i, { status: 'perdido', closed_at: dias(100 + i) }));
  assert.equal(R5.previsaoPipeline([...leads, ...velhos]).conversaoHistorica, null);
});

test('leads sem dono: resumo por etapa/idade e rodízio sugerido iguala a carga sem gravar nada', () => {
  const leads = [L(1, { status: 'orcamento', created_at: dias(40) }), L(2, { status: 'novo', created_at: dias(2) }), L(3, { status: 'contato', created_at: dias(10) }), L(4, { status: 'novo', created_at: dias(100) }),
    L(5, { status: 'concluido' }), L(6, { responsavel_id: 'alguem' }), L(7, { status: 'agendado', created_at: dias(20) })];
  const r = R5.resumoSemDono(leads);
  assert.equal(r.total, 5); assert.deepEqual(r.porEtapa, { orcamento: 1, novo: 2, contato: 1, agendado: 1 });
  assert.equal(r.porIdade.find(x => x.chave === 'mais90').qtd, 1); assert.equal(r.porIdade.find(x => x.chave === 'ate7').qtd, 1);
  assert.equal(r.maisAntigo, 100);
  const gente = [{ id: 'a', nome: 'Ana', abertos: 3 }, { id: 'b', nome: 'Bruno', abertos: 0 }];
  const s = R5.sugerirRodizio(leads, gente, { cargas: new Map([['a', 3], ['b', 0]]) });
  assert.equal(s.total, 5);
  const bruno = s.resumo.find(x => x.id === 'b'), ana = s.resumo.find(x => x.id === 'a');
  assert.equal(bruno.recebe, 4, 'quem tem menos abertos recebe mais, até igualar'); assert.equal(ana.recebe, 1);
  assert.equal(bruno.depois, 4); assert.equal(ana.depois, 4);
  // orçamento e agendado saem primeiro (vão para quem tem menos carga)
  assert.equal(s.plano[0].status, 'orcamento'); assert.equal(s.plano[0].para, 'b');
  assert.deepEqual(Object.keys(s.grupos).sort(), ['a', 'b']);
  assert.equal(s.grupos.b.length + s.grupos.a.length, 5);
  assert.ok(leads.every(l => l.responsavel_id === null || l.responsavel_id === 'alguem'), 'nada foi gravado nos leads');
  assert.equal(R5.sugerirRodizio(leads, []).semGente, true);
  assert.equal(R5.sugerirRodizio(leads, gente, { limite: 2 }).total, 2);
});

test('busca global: nome sem acento, final do telefone, placa; abertos primeiro; limite', () => {
  const leads = [L(1, { nome: 'José Antônio', telefone: '12991110000', placa: 'ABC1D23', status: 'perdido' }), L(2, { nome: 'Jose Outro', telefone: '12992220000', placa: 'XYZ9A88' }), L(3, { nome: 'Maria', telefone: '12993330000', carro_modelo: 'Corolla' })];
  const clientes = [{ id: 'c1', nome: 'Jose Cliente', telefone: '12994440000', placa: 'QWE1234' }, { id: 'c2', nome: 'Zélia', telefone: '12995550000' }];
  const r1 = R5.buscaGlobal({ leads, clientes }, 'jose');
  assert.equal(r1.leads.length, 2); assert.equal(r1.leads[0].nome, 'Jose Outro', 'aberto vem antes do perdido'); assert.equal(r1.leads[0].por, 'nome');
  assert.equal(r1.clientes.length, 1);
  const r2 = R5.buscaGlobal({ leads, clientes }, '5550000');
  assert.equal(r2.leads.length, 0); assert.equal(r2.clientes[0].id, 'c2'); assert.equal(r2.clientes[0].por, 'telefone');
  const r3 = R5.buscaGlobal({ leads, clientes }, 'abc-1d23');
  assert.equal(r3.leads.length, 1); assert.equal(r3.leads[0].por, 'placa');
  assert.equal(R5.buscaGlobal({ leads, clientes }, 'corol').leads[0].por, 'carro');
  assert.deepEqual(R5.buscaGlobal({ leads, clientes }, 'j'), { leads: [], clientes: [], termo: 'j' });
  assert.equal(R5.buscaGlobal({ leads: Array.from({ length: 20 }, (_, i) => L(i, { nome: 'Repetido' })), clientes }, 'repetido', { limite: 5 }).leads.length, 5);
});

test('filtros salvos: nome obrigatório, sem repetir, no máximo 12, só campos conhecidos', () => {
  const ok = R5.validarFiltrosSalvos([{ nome: ' Parados do Google ', filtro: { status: 'orcamento', origem: 'google', parados: true, lixo: 'x' } }]);
  assert.equal(ok[0].nome, 'Parados do Google'); assert.deepEqual(ok[0].filtro, { status: 'orcamento', origem: 'google', parados: true }); assert.ok(ok[0].em);
  assert.throws(() => R5.validarFiltrosSalvos([{ nome: '', filtro: {} }]), /nome/);
  assert.throws(() => R5.validarFiltrosSalvos([{ nome: 'A', filtro: {} }, { nome: 'a', filtro: {} }]), /repetido/);
  assert.throws(() => R5.validarFiltrosSalvos(Array.from({ length: 13 }, (_, i) => ({ nome: 'F' + i, filtro: {} }))), /12/);
  assert.throws(() => R5.validarFiltrosSalvos('x'), /lista/);
});

test('destinos da campanha: um por telefone, no formato do Comunicar', () => {
  const d = R5.destinosDeLeads([L(1, { telefone: '5512991110000', cliente_id: 'c1' }), L(2, { telefone: '(12) 99111-0000' }), L(3, { telefone: '123' }), L(4, { telefone: '12992220000', carro_modelo: 'Gol', placa: 'AAA1B11' })]);
  assert.equal(d.length, 2);
  assert.deepEqual(Object.keys(d[0]).sort(), ['carro', 'cliente_id', 'lead_id', 'nome', 'placa', 'telefone']);
  assert.equal(d[0].telefone, '12991110000'); assert.equal(d[1].carro, 'Gol');
});

test('links da ficha 360: host de cada app solto; irmãos na Central', () => {
  const ficha = { telefone_55: '5512996204288', conversa: { link: '/?conversa=abc' }, agendamentos: [{ id: 'a1', link: '/?agendamento=a1' }], patio: [{ id: 'o1', link: '/?os=o1' }], leads: [{ id: 'l1', link: '/?lead=l1' }], orcamentos: [] };
  const solto = R5.linksFicha(ficha);
  assert.equal(solto.conversa, 'https://indycar-atendimento.onrender.com/?conversa=abc');
  assert.equal(solto.agenda, 'https://indycar-agendamentos.onrender.com/?tel=5512996204288');
  assert.equal(solto.agendamentos.a1, 'https://indycar-agendamentos.onrender.com/?agendamento=a1');
  assert.equal(solto.patio.o1, 'https://indycar-patio.netlify.app/?os=o1');
  assert.equal(solto.leads.l1, '/?lead=l1'); assert.equal(solto.whatsapp, 'https://wa.me/5512996204288'); assert.equal(solto.ligar, 'tel:+5512996204288');
  const central = R5.linksFicha(ficha, { prefixo: '/crm' });
  assert.equal(central.conversa, '/atendimento/?conversa=abc'); assert.equal(central.agenda, '/agenda/?tel=5512996204288');
  assert.equal(central.leads.l1, '/crm/?lead=l1'); assert.equal(central.patio.o1, 'https://indycar-patio.netlify.app/?os=o1', 'o Pátio continua no Netlify');
});

test('lib/apps: prefixo, raiz da Central e links', () => {
  assert.equal(APPS.normalizarPrefixo('/crm/'), '/crm'); assert.equal(APPS.normalizarPrefixo('crm'), '/crm'); assert.equal(APPS.normalizarPrefixo('/'), ''); assert.equal(APPS.normalizarPrefixo('../x'), '');
  assert.equal(APPS.raizDe('/crm'), ''); assert.equal(APPS.raizDe('/apps/crm'), '/apps');
  assert.equal(APPS.linkApp('agenda', '/?tel=1'), 'https://indycar-agendamentos.onrender.com/?tel=1');
  assert.equal(APPS.linkApp('agenda', '/?tel=1', { prefixo: '/crm' }), '/agenda/?tel=1');
  assert.equal(APPS.linkApp('agenda', '/?tel=1', { prefixo: '/apps/crm' }), '/apps/agenda/?tel=1');
  assert.equal(APPS.linkApp('orcador', '/', { prefixo: '/crm' }), 'https://indycar-orcador.netlify.app/');
  assert.equal(APPS.linkApp('ads', '/'), null);
  assert.equal(APPS.linkCrm('/?meus=1'), '/?meus=1'); assert.equal(APPS.linkCrm('/?meus=1', { prefixo: '/crm' }), '/crm/?meus=1');
  assert.ok(APPS.origens().includes('https://indycar-patio.netlify.app'));
});

test('public/apps.js: base da página e rotas relativas (solto e Central)', () => {
  const carregar = pathname => {
    const ctx = { location: { pathname, origin: 'https://indycar-agendamentos.onrender.com' }, window: null, document: {} };
    ctx.window = ctx; ctx.window.INDYCAR_APPS = undefined;
    const vm = require('node:vm'); const fs = require('node:fs'); const path = require('node:path');
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'apps.js'), 'utf8'), ctx);
    return ctx.IndyCarApps;
  };
  const solto = carregar('/');
  assert.equal(solto.BASE, '/'); assert.equal(solto.CENTRAL, false); assert.equal(solto.rota('/api/leads'), '/api/leads'); assert.equal(solto.rota('api/leads'), '/api/leads');
  assert.equal(solto.urlApp('agenda', '/?tel=1'), 'https://indycar-agendamentos.onrender.com/?tel=1'); assert.equal(solto.urlApp('crm', '/?lead=x'), '/?lead=x');
  assert.equal(solto.rota('https://x.y/z'), 'https://x.y/z'); assert.equal(solto.rota('tel:+5512'), 'tel:+5512');
  const central = carregar('/crm/');
  assert.equal(central.BASE, '/crm/'); assert.equal(central.CENTRAL, true); assert.equal(central.RAIZ_CENTRAL, '/');
  assert.equal(central.rota('/api/leads'), '/crm/api/leads'); assert.equal(central.rota('/?lead=1'), '/crm/?lead=1');
  assert.equal(central.rota('/crm/api/leads'), '/crm/api/leads', 'não dobra o prefixo'); assert.equal(solto.rota('/crm/x'), '/crm/x');
  assert.equal(central.urlApp('agenda', '/?tel=1'), '/agenda/?tel=1'); assert.equal(central.urlApp('comunicar', '/'), '/comunicar/');
  assert.equal(central.urlApp('orcador', '/'), 'https://indycar-orcador.netlify.app/');
  assert.equal(central.absoluto('/'), 'https://indycar-agendamentos.onrender.com/crm/');
  assert.equal(carregar('/crm/index.html').BASE, '/crm/');
  assert.equal(carregar('/apps/crm/').RAIZ_CENTRAL, '/apps/');
  assert.ok(central.lista().some(a => a.app === 'agenda' && a.url === '/agenda/'));
});

test('crm-utils: origem detalhada e validação dos campos utm', () => {
  const rot = o => ({ meta: 'Meta / Instagram', google: 'Google' })[o] || o;
  assert.equal(U.origemDetalhada({ origem: 'meta', utm_source: 'instagram', utm_medium: 'story', utm_campaign: 'cambio' }, rot), 'Meta / Instagram · Instagram · story · campanha cambio');
  assert.equal(U.origemDetalhada({ origem: 'google', utm_source: 'google' }, rot), 'Google', 'fonte igual à origem não repete');
  assert.equal(U.origemDetalhada({ origem: 'whatsapp', utm_source: 'area_cliente' }, rot), 'whatsapp · Área do Cliente');
  assert.equal(U.validarLead({ nome: 'A', telefone: '12991110000', utm_source: 'x'.repeat(201) }), 'Texto maior que o permitido.');
  assert.equal(U.validarLead({ nome: 'A', telefone: '12991110000', utm_source: 'instagram', utm_medium: null }), null);
});
