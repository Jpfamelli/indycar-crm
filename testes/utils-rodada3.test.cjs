// Rodada 3 (tela): login, acesso, responsável, tarefas, notificações e metas — funções puras.
const {test} = require('node:test'); const assert = require('node:assert/strict'); const u = require('../public/crm-utils');
const AGORA = new Date(2026, 9, 13, 15, 0); // 13/10/2026 15h local
const ID = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');

test('acesso ao app pelo papel, apps e ativo', () => {
  assert.equal(u.acessoApp({papel: 'admin', apps: []}).ok, true);
  assert.equal(u.acessoApp({papel: 'gestor', apps: ['crm']}).ok, true);
  assert.equal(u.acessoApp({papel: 'atendente', apps: ['atendimento']}).motivo, 'sem_app');
  assert.equal(u.acessoApp({papel: 'atendente'}).ok, true, 'perfil antigo sem lista de apps fica liberado');
  assert.equal(u.acessoApp({papel: 'agenda', apps: ['agenda', 'crm']}).motivo, 'papel_agenda');
  assert.equal(u.acessoApp({papel: 'agenda', apps: ['agenda']}, 'agenda').ok, true);
  assert.equal(u.acessoApp({papel: 'gestor', ativo: false}).motivo, 'desativado');
  assert.equal(u.acessoApp({papel: 'dono'}).motivo, 'papel_invalido');
  assert.equal(u.acessoApp(null).ok, false);
  assert.deepEqual(u.appsPermitidos({papel: 'atendente', apps: ['atendimento', 'crm', 'ads']}).map(a => a.app), ['atendimento']);
  assert.deepEqual(u.appsPermitidos({papel: 'agenda', apps: ['crm']}).map(a => a.nome), ['Agenda']);
  assert.equal(u.appsPermitidos({papel: 'admin'}).length, 4);
  assert.deepEqual(u.appsPermitidos({papel: 'admin', ativo: false}), []);
  assert.ok(u.ehGestor('admin') && u.ehGestor('gestor') && !u.ehGestor('atendente') && !u.ehGestor('agenda'));
});

test('401/403 viram ação da tela pelo código', () => {
  assert.equal(u.acaoErroAcesso(200, {}), null);
  assert.equal(u.acaoErroAcesso(401, {}), 'login');
  assert.equal(u.acaoErroAcesso(401, {codigo: 'token-expirado'}), 'login');
  assert.equal(u.acaoErroAcesso(401, {codigo: 'usuario_desativado'}), 'desativado');
  assert.equal(u.acaoErroAcesso(403, {codigo: 'desativado'}), 'desativado');
  assert.equal(u.acaoErroAcesso(403, {codigo: 'sem-acesso-app'}), 'sem_acesso');
  assert.equal(u.acaoErroAcesso(403, {codigo: 'precisa_trocar_senha'}), 'trocar_senha');
  assert.equal(u.acaoErroAcesso(403, {codigo: 'mfa_obrigatorio'}), 'mfa');
  assert.equal(u.acaoErroAcesso(403, {codigo: 'papel_insuficiente'}), 'proibido');
  assert.equal(u.acaoErroAcesso(403, {erro: 'Só o administrador.'}), 'proibido');
});

test('mensagens de login, espera progressiva e senha nova', () => {
  assert.equal(u.mensagemLogin({message: 'Invalid login credentials'}), 'E-mail ou senha incorretos.');
  assert.match(u.mensagemLogin(new TypeError('Failed to fetch')), /Sem internet/);
  assert.match(u.mensagemLogin({message: 'User is banned'}), /desativado/);
  assert.match(u.mensagemLogin({code: 'over_email_send_rate_limit', message: 'x'}), /Muitas tentativas/);
  assert.match(u.mensagemLogin({message: 'Invalid TOTP code entered'}), /Código inválido/);
  assert.deepEqual([0, 4, 5, 6, 7, 20].map(u.esperaLogin), [0, 0, 30, 60, 120, 900]);
  assert.match(u.validarNovaSenha('curta', 'curta'), /8 caracteres/);
  assert.match(u.validarNovaSenha('abcdefgh1', 'abcdefgh2'), /iguais/);
  assert.match(u.validarNovaSenha('joao@indy.com', 'joao@indy.com', 'Joao@Indy.com'), /e-mail/);
  assert.match(u.validarNovaSenha('joaozinho', 'joaozinho', 'joaozinho@indy.com'), /e-mail/);
  assert.match(u.validarNovaSenha('12345678', '12345678'), /fácil/);
  assert.match(u.validarNovaSenha('aaaaaaaa', 'aaaaaaaa'), /fácil/);
  assert.equal(u.validarNovaSenha('Oficina#2026', 'Oficina#2026', 'joao@indy.com'), null);
  assert.ok(u.codigoMfaValido('123 456') && !u.codigoMfaValido('12345') && !u.codigoMfaValido('abcdef'));
});

test('link da notificação: abre no CRM ou no app de origem, nunca fora do ecossistema', () => {
  assert.deepEqual(u.linkNotificacao({link: '/?lead=' + ID(1), app: 'crm'}).interno, {lead: ID(1)});
  assert.equal(u.linkNotificacao({link: '/?conversa=abc', app: 'atendimento'}).url, 'https://indycar-atendimento.onrender.com/?conversa=abc');
  assert.equal(u.linkNotificacao({link: '/?conversa=abc', app: 'atendimento'}).interno, null);
  assert.deepEqual(u.linkNotificacao({link: '/?cliente=' + ID(2) + '&tel=12999990000', app: 'crm'}).interno, {busca: '?cliente=' + ID(2) + '&tel=12999990000'});
  assert.equal(u.linkNotificacao({link: 'https://golpe.example/?lead=' + ID(1)}).url, null);
  assert.equal(u.linkNotificacao({link: 'javascript:alert(1)'}).url, null);
  assert.equal(u.linkNotificacao({link: ''}).url, null);
  assert.equal(u.linkNotificacao({link: '/?lead=nao-e-uuid', app: 'crm'}).interno.busca, '?lead=nao-e-uuid');
});

test('cor do avatar estável e responsável do lead', () => {
  assert.equal(u.corAvatar({avatar_cor: '#123abc'}), '#123abc');
  assert.equal(u.corAvatar({id: ID(3), avatar_cor: 'red;background:url(x)'}), u.corAvatar({id: ID(3)}));
  assert.ok(u.CORES_AVATAR.includes(u.corAvatar({nome: 'Ana'})));
  const l = {responsavel_id: ID(1)}, sem = {responsavel_id: null};
  assert.ok(u.filtroResponsavel(l, '', ID(9)) && u.filtroResponsavel(l, 'meus', ID(1)) && !u.filtroResponsavel(l, 'meus', ID(2)));
  assert.ok(u.filtroResponsavel(sem, 'sem') && !u.filtroResponsavel(l, 'sem') && u.filtroResponsavel(l, ID(1)) && !u.filtroResponsavel(sem, ID(1)));
  assert.ok(!u.filtroResponsavel(sem, 'meus', null));
  const f = u.funilPorResponsavel([{responsavel_id: ID(1), status: 'novo', valor_orcado: 100}, {responsavel_id: ID(1), status: 'concluido', valor_pago: 300}, {status: 'contato', valor_orcado: 50}, {responsavel_id: ID(7), status: 'perdido'}],
    [{id: ID(1), nome: 'Ana'}]);
  assert.deepEqual(f.map(x => [x.nome, x.total, x.abertos]), [['Ana', 2, 1], ['Pessoa fora da equipe', 1, 0], ['Sem responsável', 1, 1]]);
  assert.equal(f[0].valorAberto, 100); assert.equal(f[0].faturamento, 300); assert.equal(f[0].porEtapa.concluido, 1);
});

test('tarefas: vencimento, situação, agenda do dia e atrasadas primeiro', () => {
  const v = u.vencimentoDe('2026-10-13', '09:00'); assert.equal(new Date(v).getHours(), 9);
  assert.equal(new Date(u.vencimentoDe('2026-10-13')).getMinutes(), 30, 'sem hora vence às 17h30');
  assert.equal(u.vencimentoDe('', '10:00'), null);
  assert.throws(() => u.vencimentoDe('2026-02-30', '10:00')); assert.throws(() => u.vencimentoDe('13/10/2026'));
  const em = (d, h) => new Date(2026, 9, d, h).toISOString();
  const lista = [
    {id: 'a', titulo: 'futura', vence_em: em(20, 10), status: 'aberta'},
    {id: 'b', titulo: 'atrasada ontem', vence_em: em(12, 10), status: 'aberta'},
    {id: 'c', titulo: 'hoje 16h', vence_em: em(13, 16), status: 'aberta'},
    {id: 'd', titulo: 'hoje 9h (passou)', vence_em: em(13, 9), status: 'aberta'},
    {id: 'e', titulo: 'sem data', status: 'aberta'},
    {id: 'f', titulo: 'feita', vence_em: em(1, 1), status: 'feita'},
    {id: 'g', titulo: 'hoje 17h urgente', vence_em: em(13, 17), status: 'aberta', prioridade: 3},
  ];
  assert.equal(u.situacaoTarefaDb(lista[3], AGORA), 'atrasada'); assert.equal(u.situacaoTarefaDb(lista[2], AGORA), 'hoje');
  assert.equal(u.situacaoTarefaDb({status: 'cancelada'}, AGORA), 'cancelada');
  assert.deepEqual(u.ordenarTarefasDb(lista, AGORA).map(t => t.id), ['b', 'd', 'c', 'g', 'a', 'e', 'f']);
  const g = u.agruparTarefas(lista, AGORA);
  assert.deepEqual([g.atrasadas, g.hoje, g.proximas, g.semData].map(x => x.map(t => t.id)), [['b', 'd'], ['c', 'g'], ['a'], ['e']]);
});

test('tarefa validada antes de gravar e lembrete antigo importado', () => {
  assert.throws(() => u.validarTarefa({titulo: '  '})); assert.throws(() => u.validarTarefa({titulo: 'x'.repeat(201)}));
  assert.throws(() => u.validarTarefa({titulo: 'ok', prioridade: 9})); assert.throws(() => u.validarTarefa({titulo: 'ok', lead_id: '7'}));
  assert.throws(() => u.validarTarefa({titulo: 'ok', vence_em: 'amanhã'}));
  const t = u.validarTarefa({titulo: ' Ligar  pro cliente ', lead_id: ID(4), responsavel_id: ID(1), vence_em: '2026-10-13T12:00:00Z', prioridade: 3, cliente_id: ''});
  assert.deepEqual(t, {titulo: 'Ligar pro cliente', prioridade: 3, origem: 'crm', status: 'aberta', vence_em: '2026-10-13T12:00:00.000Z', responsavel_id: ID(1), lead_id: ID(4)});
  const i = u.lembreteParaTarefa({texto: 'Retornar orçamento', para: '2026-10-14', leadId: ID(5), feita: false}, ID(1));
  assert.equal(i.lead_id, ID(5)); assert.equal(i.responsavel_id, ID(1)); assert.equal(new Date(i.vence_em).getHours(), 17); assert.equal(i.status, 'aberta');
  const velho = u.lembreteParaTarefa({texto: 'feito', leadId: '7', feita: true}, 'ficticio');
  assert.equal(velho.lead_id, undefined); assert.equal(velho.responsavel_id, undefined); assert.equal(velho.status, 'feita');
  assert.equal(u.ROTULO_PRIORIDADE[3], 'Urgente');
});

test('metas: mês, projeção pelo ritmo e validação', () => {
  assert.equal(u.mesAtual(AGORA), '2026-10');
  assert.deepEqual(u.intervaloMes('2026-02'), {de: '2026-02-01', ate: '2026-02-28', dias: 28});
  assert.throws(() => u.intervaloMes('2026-13'));
  const p = u.progressoMeta(13000, 30000, '2026-10', AGORA);
  assert.equal(p.pct, 43); assert.equal(p.falta, 17000); assert.equal(p.projecao, 31000); assert.equal(p.noRitmo, true);
  assert.equal(u.progressoMeta(10, 0, '2026-10', AGORA).pct, 0);
  assert.equal(u.progressoMeta(10, 20, '2026-11', AGORA).projecao, 0, 'mês futuro não projeta');
  assert.equal(u.progressoMeta(10, 20, '2026-09', AGORA).projecao, 10, 'mês fechado projeta o realizado');
  assert.deepEqual(u.validarMetas([{perfil_id: null, leads: '40', agendamentos: 20.4, vendas: 10, faturamento: 30000.555}]), [{perfil_id: null, leads: 40, agendamentos: 20, vendas: 10, faturamento: 30000.56}]);
  assert.throws(() => u.validarMetas([{perfil_id: null}, {perfil_id: null}]));
  assert.throws(() => u.validarMetas([{perfil_id: 'x'}])); assert.throws(() => u.validarMetas([{faturamento: -1}]));
  const r = u.ordenarDesempenho([{nome: 'B', faturamento: 100, tempo_resposta_min: 5}, {nome: 'A', faturamento: 300, tempo_resposta_min: 30}, {nome: 'C', faturamento: 100, tempo_resposta_min: null}]);
  assert.deepEqual(r.map(x => x.nome), ['A', 'B', 'C']);
  assert.deepEqual(u.ordenarDesempenho(r, 'tempo_resposta_min').map(x => x.nome), ['B', 'A', 'C']);
});

test('último acesso a cada 5 min, preferências mescladas e tempo relativo', () => {
  assert.ok(u.deveGravarAcesso(null)); assert.ok(!u.deveGravarAcesso(Date.now() - 60000)); assert.ok(u.deveGravarAcesso(Date.now() - 300001));
  assert.deepEqual(u.mesclarPreferencias({tema: 'claro', notificacoes: {som: true, atendimento: 1}}, {notificacoes: {som: false}}), {tema: 'claro', notificacoes: {som: false, atendimento: 1}});
  assert.deepEqual(u.mesclarPreferencias(null, {a: 1}), {a: 1});
  const t = AGORA.getTime();
  assert.equal(u.tempoRelativo(new Date(t - 20000).toISOString(), t), 'agora');
  assert.equal(u.tempoRelativo(new Date(t - 5 * 60000).toISOString(), t), '5 min');
  assert.equal(u.tempoRelativo(new Date(t - 3 * 3600000).toISOString(), t), '3 h');
  assert.equal(u.tempoRelativo(new Date(t - 30 * 3600000).toISOString(), t), 'ontem');
  assert.equal(u.tempoRelativo('lixo', t), '');
  assert.ok(u.COLUNAS_PADRAO.includes('responsavel'));
});

test('formatos do servidor: metas aninhadas, desempenho, vendedores e regra de reatribuir', () => {
  const m = u.normalizarMetas({mes: '2026-10', loja: {meta: {leads: 60, faturamento: 30000}, itens: {leads: {meta: 60, realizado: 24, projecao: 57}, faturamento: {meta: 30000, realizado: 4520, projecao: 10778}}, status: 'risco'},
    pessoas: [{perfil_id: ID(1), nome: 'Ana', meta: null, itens: {vendas: {meta: null, realizado: 2}}}, {perfil_id: null, nome: 'Sem responsável'}]});
  assert.equal(m.length, 2); assert.equal(m[0].perfil_id, null); assert.equal(m[0].faturamento, 30000); assert.equal(m[0].vendas, 0);
  assert.deepEqual(m[0].realizado, {leads: 24, faturamento: 4520}); assert.equal(m[0].projecao.faturamento, 10778); assert.equal(m[0].status, 'risco');
  assert.equal(m[1].perfil_id, ID(1)); assert.equal(m[1].realizado.vendas, 2); assert.equal(m[1].leads, 0);
  assert.deepEqual(u.normalizarMetas([{perfil_id: '', leads: 3}]), [{perfil_id: null, leads: 3}]);
  assert.deepEqual(u.normalizarMetas(null), []);
  assert.deepEqual(u.normalizarDesempenho({pessoas: [{perfil_id: ID(1)}, {perfil_id: null}, {perfil_id: ID(2), inativo: true}]}).map(x => x.perfil_id), [ID(1)]);
  assert.equal(u.normalizarDesempenho([{perfil_id: ID(3)}]).length, 1);
  const eq = u.normalizarEquipe({vendedores: [{id: ID(1), nome: 'Ana', papel: 'gestor', abertos: 4}, {id: ID(2), papel: 'agenda'}, {id: 'x'}, {id: ID(3), nome: 'Bia', ativo: false}]});
  assert.deepEqual(eq.map(p => [p.nome, p.abertos]), [['Ana', 4]]);
  assert.equal(u.normalizarEquipe({}), null); assert.equal(u.normalizarEquipe([]).length, 0);
  const eu = {id: ID(1), papel: 'atendente'};
  assert.ok(u.podeReatribuir({responsavel_id: ID(1)}, eu, ID(2)), 'passa o próprio');
  assert.ok(u.podeReatribuir({responsavel_id: null}, eu, ID(1)), 'pega sem dono');
  assert.ok(!u.podeReatribuir({responsavel_id: ID(2)}, eu, ID(1)), 'não pega de outro');
  assert.ok(!u.podeReatribuir({responsavel_id: ID(1)}, eu, null), 'não tira o dono');
  assert.ok(u.podeReatribuir({responsavel_id: ID(2)}, {id: ID(9), papel: 'gestor'}, null));
  assert.equal(u.acaoErroAcesso(403, {codigo: 'sem_perfil'}), 'sem_acesso');
  assert.equal(u.acaoErroAcesso(401, {codigo: 'sessao_invalida'}), 'login');
});
