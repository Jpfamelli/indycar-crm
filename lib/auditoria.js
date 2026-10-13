/* ============================================================
   IndyCar CRM — auditoria das ações sensíveis
   Grava pela rpc registrar_auditoria (só service role). Nunca
   derruba a ação: se a auditoria falhar, fica no log do servidor.
   Segredos nunca entram em `detalhes` (quem chama manda só nomes de campo).
   ============================================================ */
'use strict';

const { ehUuid } = require('./util-servidor');

const SEGREDO = /(token|senha|password|secret|chave|api_?key)/i;

/** Tira qualquer campo com cara de segredo e corta textos longos. */
function limparDetalhes(d, prof = 0) {
  if (d == null || prof > 3) return d == null ? null : '…';
  if (Array.isArray(d)) return d.slice(0, 200).map(x => limparDetalhes(x, prof + 1));
  if (typeof d === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(d)) o[k] = SEGREDO.test(k) ? '•••' : limparDetalhes(v, prof + 1);
    return o;
  }
  if (typeof d === 'string') return d.length > 500 ? d.slice(0, 499) + '…' : d;
  return d;
}

function criarAuditoria({ sb, app = 'crm', log = () => {} } = {}) {
  const registros = [];   // últimos (para teste e para a rota de status)
  async function auditar(quem, acao, { tabela = null, registro = null, detalhes = null } = {}) {
    const linha = {
      p_perfil: quem && ehUuid(quem.id) ? quem.id : null, p_app: app, p_acao: String(acao).slice(0, 80),
      p_tabela: tabela, p_registro: registro == null ? null : String(registro).slice(0, 80),
      p_detalhes: limparDetalhes(detalhes),
    };
    registros.push(linha); if (registros.length > 50) registros.shift();
    if (!sb?.rpc) return null;
    try {
      const { data, error } = await sb.rpc('registrar_auditoria', linha);
      if (error) { log('auditoria:', acao, error.message); return null; }
      return data;
    } catch (e) { log('auditoria:', acao, e && e.message); return null; }
  }
  auditar.registros = registros;
  return auditar;
}

module.exports = { criarAuditoria, limparDetalhes };
