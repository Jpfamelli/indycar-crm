#!/usr/bin/env node
// Rodada 5 — roteiro de navegador (só no PC: Chrome instalado + puppeteer-core).
// Sobe o servidor FALSO (dados inventados) solto e montado em /crm/ (como a Central),
// abre no Chrome em 1440 e 375 px como gestor e atendente e confere:
// busca global Ctrl+K, filtros salvos, ficha 360, leads sem dono + rodízio, campanha em lote,
// previsão pelo funil, origem detalhada, teclado (M, ↑↓, X), caminhos relativos no prefixo,
// zero erro de console e zero rolagem lateral.
//   node testes/r5-navegador.mjs            → saída em <scratch>/r5-navegador/ (ou RELATORIO_DIR)
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import net from 'node:net';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SAIDA = process.env.RELATORIO_DIR || join(process.env.TEMP || RAIZ, 'r5-navegador');
mkdirSync(SAIDA, { recursive: true });
const requerer = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = requerer('puppeteer-core'); } catch { puppeteer = createRequire(join(RAIZ, '..', 'indycar-ferramentas', 'package.json'))('puppeteer-core'); }

const portaLivre = p => new Promise(ok => { const s = net.createServer().once('error', () => ok(false)).once('listening', () => s.close(() => ok(true))).listen(p, '127.0.0.1'); });
async function subirMock(env = {}) {
  let porta = 3141; while (!(await portaLivre(porta))) porta++;
  const filho = spawn(process.execPath, ['scripts/mock-server.mjs'], { cwd: RAIZ, env: { ...process.env, PORT: String(porta), MOCK_LEADS: '160', MOCK_PAPEL: 'gestor', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; filho.stdout.on('data', d => { log += d; }); filho.stderr.on('data', d => { log += d; });
  const base = `http://127.0.0.1:${porta}${env.MOCK_PREFIXO || ''}`;
  for (let i = 0; i < 60; i++) {
    if (filho.exitCode !== null) throw new Error('mock saiu: ' + log.slice(-300));
    try { const r = await fetch(base + '/', { signal: AbortSignal.timeout(2000) }); if (r.ok) return { filho, base }; } catch { /* subindo */ }
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error('mock não subiu: ' + log.slice(-300));
}

const resultados = [];
let falhas = 0;
function ok(nome, cond, detalhe = '') { resultados.push({ nome, ok: !!cond, detalhe }); if (!cond) falhas++; console.log(`${cond ? '✔' : '✖'} ${nome}${detalhe ? ' — ' + detalhe : ''}`); }
const dorme = ms => new Promise(r => setTimeout(r, ms));

async function roteiro(browser, base, { largura, altura, movel, papel, prefixo }) {
  const tag = `${prefixo ? 'crm-' : ''}${papel}-${largura}`;
  const page = await browser.newPage();
  await page.setViewport({ width: largura, height: altura, isMobile: !!movel, hasTouch: !!movel, deviceScaleFactor: 1 });
  const erros = [], pedidos = [];
  page.on('console', m => { if (m.type() === 'error') erros.push(m.text()); });
  page.on('pageerror', e => erros.push('pageerror: ' + e.message));
  page.on('request', r => { const u = r.url(); if (u.includes('/api/')) pedidos.push(new URL(u).pathname); });
  page.on('dialog', d => d.accept());
  await page.goto(`${base}/?papel=${papel}`, { waitUntil: 'domcontentloaded', timeout: 60000 });   // o mock mantém um SSE aberto: networkidle nunca chega
  await page.waitForSelector('#kpis .kpi', { timeout: 30000 });
  await dorme(600);
  const semRolagem = async rotulo => ok(`${tag}: sem rolagem lateral (${rotulo})`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await semRolagem('painel');

  if (prefixo) {
    ok(`${tag}: todas as chamadas da API levam o prefixo`, pedidos.length > 5 && pedidos.every(p => p.startsWith(prefixo + '/api/')), pedidos.filter(p => !p.startsWith(prefixo + '/api/')).slice(0, 3).join(', '));
    const apps = await page.evaluate(() => ({ base: IndyCarApps.BASE, central: IndyCarApps.CENTRAL, agenda: IndyCarApps.urlApp('agenda', '/'), opcoes: [...document.querySelectorAll('#ecossistema option')].map(o => o.value) }));
    ok(`${tag}: apps.js detecta a Central (base ${apps.base})`, apps.base === prefixo + '/' && apps.central && apps.agenda === '/agenda/' && apps.opcoes.includes('/agenda/'));
    const links = await page.evaluate(() => [...document.querySelectorAll('link[rel=manifest],link[rel=icon][sizes]')].map(l => l.getAttribute('href')));
    ok(`${tag}: manifest e ícones relativos`, links.every(h => !h.startsWith('/')), links.join(' '));
  }

  /* previsão pelo funil */
  await page.waitForSelector('#cardPrevisao:not([hidden]) .pv-num b', { timeout: 15000 }).catch(() => {});
  const pv = await page.evaluate(() => ({ visivel: !document.getElementById('cardPrevisao').hidden, valor: document.querySelector('#cardPrevisao .pv-num b')?.textContent || '', linhas: document.querySelectorAll('#previsaoFunil .fm-row').length }));
  ok(`${tag}: card "Previsão pelo funil" com valor e etapas`, pv.visivel && /R\$/.test(pv.valor) && pv.linhas >= 2, `${pv.valor} · ${pv.linhas} etapas`);

  /* busca global (Ctrl+K) */
  await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control');
  await page.waitForSelector('#dlgBusca[open]', { timeout: 5000 });
  const nome = await page.evaluate(() => TODOS.find(l => !['concluido', 'perdido'].includes(l.status)).nome.split(' ')[0]);
  await page.type('#buscaGlobal', nome);
  await page.waitForFunction(() => document.querySelectorAll('#buscaResultados .bg-item').length > 0, { timeout: 8000 });
  const busca = await page.evaluate(() => ({ itens: document.querySelectorAll('#buscaResultados .bg-item').length, grupos: [...document.querySelectorAll('.bg-grupo')].map(x => x.textContent), foco: !!document.querySelector('.bg-item.foco') }));
  ok(`${tag}: Ctrl+K lista leads e clientes com um item em foco`, busca.itens >= 2 && busca.grupos.includes('Leads') && busca.foco, `${busca.itens} itens · ${busca.grupos.join('/')}`);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await page.waitForSelector('#modalBg.open', { timeout: 5000 });
  ok(`${tag}: Enter no resultado abre a ficha do lead`, await page.evaluate(() => document.querySelector('#modalBg').classList.contains('open') && !document.getElementById('dlgBusca').open));
  await semRolagem('ficha do lead');
  // origem detalhada (utm) no topo do lead, quando o lead tem utm
  const comUtm = await page.evaluate(() => { const l = TODOS.find(x => x.utm_source); return l ? l.id : null; });
  if (comUtm) {
    await page.evaluate(id => { fecharModal(true); return abrirModal(id); }, comUtm);
    await dorme(400);
    const tagTxt = await page.evaluate(() => document.querySelector('#lfTopo .lf-tags .tag')?.textContent || '');
    ok(`${tag}: origem detalhada (utm) na ficha do lead`, /·/.test(tagTxt), tagTxt);
  }
  // Ctrl+K com telefone sem cadastro oferece criar lead
  await page.evaluate(() => fecharModal(true));
  await page.evaluate(() => abrirBusca('12900009999'));
  await page.waitForFunction(() => document.querySelector('#buscaResultados [data-bg-novo]'), { timeout: 8000 }).catch(() => {});
  ok(`${tag}: telefone sem cadastro oferece "Cadastrar lead com este telefone"`, await page.evaluate(() => !!document.querySelector('#buscaResultados [data-bg-novo]')));
  await page.keyboard.press('Escape'); await dorme(200);
  ok(`${tag}: Esc fecha a busca`, await page.evaluate(() => !document.getElementById('dlgBusca').open));

  /* lista de leads: filtros salvos, teclado, campanha em lote, CSV auditado */
  await page.evaluate(() => irPara('leads'));
  await dorme(300);
  await page.select('#fStatus', 'orcamento');
  await page.evaluate(() => { document.getElementById('fStatus').dispatchEvent(new Event('change')); });
  await page.evaluate(() => { window.prompt = () => null; });
  await page.click('#btnSalvarFiltro');
  await page.waitForSelector('#dlgFiltro[open]', { timeout: 5000 });
  const resumoFiltro = await page.$eval('#dlgFiltroResumo', e => e.textContent);
  ok(`${tag}: diálogo "Salvar filtro" descreve o que vai guardar`, /Orçamento/.test(resumoFiltro), resumoFiltro);
  await page.type('#filtroNome', 'Orçamentos ' + largura);
  await page.keyboard.press('Enter');
  await page.waitForFunction(l => [...document.querySelectorAll('#filtrosSalvos option')].some(o => o.textContent === 'Orçamentos ' + l), { timeout: 8000 }, largura);
  ok(`${tag}: filtro salvo aparece no seletor`, true);
  await page.click('#limparFiltros'); await dorme(200);
  const idx = await page.evaluate(l => [...document.querySelectorAll('#filtrosSalvos option')].find(o => o.textContent === 'Orçamentos ' + l)?.value, largura);
  await page.select('#filtrosSalvos', idx); await dorme(300);
  ok(`${tag}: aplicar o filtro salvo devolve os filtros da lista`, await page.evaluate(() => document.getElementById('fStatus').value === 'orcamento' && LEADS.every(l => l.status === 'orcamento')));
  await page.click('#limparFiltros'); await dorme(300);
  // teclado na lista: ↓ anda, X marca
  await page.focus('#tblLeads tbody tr[data-id]');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('x'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('x');
  await dorme(200);
  const sel = await page.evaluate(() => ({ n: SEL.size, barra: !document.getElementById('barraLote').hidden, foco: document.activeElement?.matches('tr[data-id]') }));
  ok(`${tag}: ↓ anda pelas linhas e X marca (2 selecionados, barra de lote aberta)`, sel.n === 2 && sel.barra && sel.foco, JSON.stringify(sel));
  // campanha em lote
  await page.click('#loteCampanha');
  await page.waitForSelector('#dlgCampanha[open]', { timeout: 5000 });
  ok(`${tag}: diálogo da campanha conta os selecionados`, /2 leads/.test(await page.$eval('#campTxt', e => e.textContent)));
  await page.evaluate(() => { document.getElementById('campCorpo').value = 'Prezado, favor comparecer com o veículo.'; });
  await page.click('#campEnviar'); await dorme(200);
  ok(`${tag}: vocabulário proibido é barrado antes de mandar`, /prezado/i.test(await page.$eval('#campErro', e => e.textContent)));
  await page.evaluate(() => { document.getElementById('campCorpo').value = 'Oi {nome}! Aqui é da IndyCar. Posso ajudar com o seu {carro}?'; });
  await page.click('#campEnviar');
  await page.waitForFunction(() => /Campanha proposta/.test(document.getElementById('toastTxt').textContent), { timeout: 8000 });
  ok(`${tag}: campanha mandada ao Comunicar como proposta (toast com "Abrir no Comunicar")`, await page.evaluate(() => !document.getElementById('toastAcao').hidden && document.getElementById('toastAcao').textContent === 'Abrir no Comunicar'));
  await semRolagem('lista');
  // CSV auditado: a exportação registra em /api/auditoria/exportacao com os filtros
  pedidos.length = 0;
  await page.evaluate(() => { const a = document.createElement('a'); window.__clicou = 0; HTMLAnchorElement.prototype.click = function () { window.__clicou++; }; void a; });
  await page.click('#exportarLeads'); await dorme(500);
  ok(`${tag}: exportar CSV registra a exportação na auditoria`, pedidos.some(p => p.endsWith('/api/auditoria/exportacao')));

  /* ficha 360 do cliente */
  await page.evaluate(() => irPara('clientes'));
  await page.waitForSelector('#tblClientes tbody tr[data-id]', { timeout: 15000 });
  const cid = await page.evaluate(() => TODOS.find(l => l.cliente_id)?.cliente_id);
  await page.evaluate(id => abrirFichaCliente(id), cid);
  await page.waitForFunction(() => /uma consulta só/.test(document.getElementById('fichaCliente').textContent), { timeout: 15000 });
  const ficha = await page.evaluate(() => ({ kpis: document.querySelectorAll('#fichaCliente .ficha-kpi').length, blocos: [...document.querySelectorAll('#fichaCliente .ficha-bloco h4')].map(h => h.textContent), acoes: document.querySelectorAll('#fichaCliente .lf-acoes .acao').length, prefs: !!document.getElementById('formPreferencias') }));
  ok(`${tag}: ficha 360 em uma chamada (8 indicadores, blocos de leads/agenda, ações e preferências)`, ficha.kpis === 8 && ficha.blocos.includes('Leads') && ficha.blocos.includes('Agendamentos') && ficha.acoes >= 5 && ficha.prefs, ficha.blocos.join(' | '));
  await semRolagem('ficha 360');
  await page.screenshot({ path: join(SAIDA, `${tag}-ficha360.png`) });
  const leadNaFicha = await page.$('#fichaCliente tr[data-lead]');
  if (leadNaFicha) { await leadNaFicha.click(); await dorme(400); ok(`${tag}: clicar num lead da ficha 360 abre o lead`, await page.evaluate(() => document.querySelector('#modalBg').classList.contains('open'))); await page.evaluate(() => fecharModal(true)); }
  else await page.evaluate(() => fecharFichaCliente());

  /* funil: M abre a lista de etapas */
  await page.evaluate(() => irPara('pipeline')); await dorme(300);
  await page.focus('.kb-card'); await page.keyboard.press('m'); await dorme(150);
  ok(`${tag}: M no cartão do funil leva o foco ao seletor de etapa`, await page.evaluate(() => document.activeElement?.classList.contains('kb-etapa')));
  await page.keyboard.press('Escape');

  /* leads sem dono (gestor) */
  if (papel === 'gestor') {
    await page.evaluate(() => irPara('distribuir'));
    await page.waitForFunction(() => document.querySelector('#sdRodizio table') || /Todos os leads abertos têm dono/.test(document.getElementById('sdRodizio').textContent), { timeout: 15000 });
    const sd = await page.evaluate(() => ({ txt: document.getElementById('sdTxt').textContent, chips: document.querySelectorAll('#sdResumo .sd-chip').length, linhas: document.querySelectorAll('#sdRodizio tbody tr').length, botao: document.getElementById('sdAplicar').textContent, badge: document.querySelector('.nav-item[data-view="distribuir"]').dataset.badge, titulo: document.querySelector('.nav-item[data-view="distribuir"] span').textContent }));
    ok(`${tag}: "Leads sem dono" mostra resumo, chips por etapa/idade e rodízio sugerido`, /sem responsável/.test(sd.txt) && sd.chips >= 3 && sd.linhas >= 2 && /Aplicar o rodízio sugerido \(\d+\)/.test(sd.botao) && sd.titulo === 'Leads sem dono' && Number(sd.badge) > 0, `${sd.txt} · ${sd.linhas} pessoas · selo ${sd.badge}`);
    await page.screenshot({ path: join(SAIDA, `${tag}-sem-dono.png`), fullPage: largura > 500 });
    await semRolagem('leads sem dono');
    const antes = await page.evaluate(() => TODOS.filter(l => !l.responsavel_id && U.ABERTAS.includes(l.status)).length);
    await page.click('#sdAplicar');
    await page.waitForFunction(() => /Rodízio aplicado/.test(document.getElementById('toastTxt').textContent), { timeout: 15000 });
    await page.waitForFunction(() => /Todos os leads abertos têm dono/.test(document.getElementById('sdRodizio').textContent), { timeout: 15000 });
    const depois = await page.evaluate(() => ({ sem: TODOS.filter(l => !l.responsavel_id && U.ABERTAS.includes(l.status)).length, desfazer: document.getElementById('toastAcao').textContent, badge: document.querySelector('.nav-item[data-view="distribuir"]').dataset.badge }));
    ok(`${tag}: aplicar o rodízio distribui todos (${antes} → ${depois.sem}) com "Desfazer" e o selo zera`, antes > 0 && depois.sem === 0 && depois.desfazer === 'Desfazer' && !depois.badge);
    await page.click('#toastAcao');
    await page.waitForFunction(() => /Distribuição desfeita/.test(document.getElementById('toastTxt').textContent), { timeout: 15000 });
    ok(`${tag}: desfazer devolve os leads sem dono`, await page.evaluate(n => TODOS.filter(l => !l.responsavel_id && U.ABERTAS.includes(l.status)).length === n, antes));
  } else {
    ok(`${tag}: atendente não vê "Leads sem dono"`, await page.evaluate(() => document.querySelector('.nav-item[data-view="distribuir"]').hidden));
  }

  /* IA: resumo com "o que fazer esta semana" e previsão */
  await page.evaluate(() => irPara('ia')); await page.click('#btnIA');
  await page.waitForFunction(() => /O que fazer esta semana/.test(document.getElementById('iaOut').textContent), { timeout: 15000 });
  ok(`${tag}: resumo da IA traz "O que fazer esta semana" e a previsão pelo funil`, await page.evaluate(() => /Previsão pelo funil agora/.test(document.getElementById('iaOut').textContent)));

  /* ajuda com as perguntas novas e tema claro */
  await page.evaluate(() => window.abrirAjuda()); await dorme(200);
  ok(`${tag}: ajuda explica Ctrl+K e a campanha`, await page.evaluate(() => /Ctrl\+K/.test(document.getElementById('ajudaLista').textContent) && /Campanha no Comunicar/.test(document.getElementById('ajudaLista').textContent)));
  await page.keyboard.press('Escape');
  await page.evaluate(() => aplicarTema('claro')); await page.evaluate(() => irPara('dashboard')); await dorme(300);
  await page.screenshot({ path: join(SAIDA, `${tag}-painel-claro.png`) });
  await semRolagem('painel claro');

  const errosReais = erros.filter(e => !/favicon|net::ERR_ABORTED|Failed to load resource.*(404|401|403)/.test(e));
  ok(`${tag}: zero erro de console/página`, errosReais.length === 0, errosReais.slice(0, 3).join(' | '));
  await page.close();
}

const { filho: m1, base: b1 } = await subirMock();
const { filho: m2, base: b2 } = await subirMock({ MOCK_PREFIXO: '/crm' });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
try {
  await roteiro(browser, b1, { largura: 1440, altura: 900, papel: 'gestor', prefixo: '' });
  await roteiro(browser, b1, { largura: 375, altura: 812, movel: true, papel: 'atendente', prefixo: '' });
  await roteiro(browser, b2, { largura: 1440, altura: 900, papel: 'gestor', prefixo: '/crm' });
  await roteiro(browser, b2, { largura: 375, altura: 812, movel: true, papel: 'gestor', prefixo: '/crm' });
} catch (e) { ok('roteiro terminou', false, e.message); console.error(e); }
finally { await browser.close(); m1.kill(); m2.kill(); }
writeFileSync(join(SAIDA, 'r5-navegador.json'), JSON.stringify({ em: new Date().toISOString(), total: resultados.length, falhas, resultados }, null, 2));
console.log(`\n${resultados.length - falhas}/${resultados.length} verificações ok · capturas em ${SAIDA}`);
process.exit(falhas ? 1 : 0);
