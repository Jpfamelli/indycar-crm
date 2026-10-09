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
  const api = {normalizar,digitos,buscar,validarLead,nascimento,moeda,csv};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CrmUtils = api;
})(typeof window !== 'undefined' ? window : globalThis);
