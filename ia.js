/* ============================================================
   IndyCar CRM — IA administradora (Claude)
   Recebe os dados do período (semana ou mês) e devolve um resumo
   executivo: de ONDE vieram os leads, COMO foi o período, COMO
   terminaram — e agora também Atendimento, Comunicar e Orçador,
   com recomendações práticas.
   ============================================================ */
'use strict';

/* Modelo vem de ia_config.modelo_forte (lido pelo servidor); este é o reserva. */
const MODEL = 'claude-opus-5-5';

const brl = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Monta um briefing textual compacto a partir dos dados do CRM. */
function montarBriefing({ stats, semanaLeads = [], extras = null, periodo = 'semana' }) {
  const s = stats.semana;
  const c = stats.comparativo;
  const nomeP = periodo === 'mes' ? 'DOS ÚLTIMOS 30 DIAS' : 'DA SEMANA';
  const ant = periodo === 'mes' ? '30 dias anteriores' : 'semana anterior';

  const linhasOrigem = s.porOrigem.length
    ? s.porOrigem.map(o =>
        `- ${o.origem}: ${o.leads} leads, ${o.ganhos} fechados, ${brl(o.faturamento)}`).join('\n')
    : '- (sem leads no período)';

  const statusTxt = Object.entries(s.porStatus)
    .filter(([, n]) => n > 0).map(([k, n]) => `${k}=${n}`).join(', ') || '(nenhum)';

  const perdidos = semanaLeads.filter(l => l.status === 'perdido')
    .map(l => `- ${l.servico || 'serviço n/d'} (${l.origem}) — orçado ${brl(l.valor_orcado)}`)
    .slice(0, 10).join('\n') || '- (nenhum lead perdido)';

  const ganhos = semanaLeads.filter(l => l.status === 'concluido')
    .map(l => `- ${l.servico || 'serviço n/d'} (${l.origem}) — pago ${brl(l.valor_pago)}`)
    .slice(0, 10).join('\n') || '- (nenhum serviço concluído)';

  const min = v => (v == null ? 'sem dado' : `${v} min`);
  const blocoExtras = extras ? `

ATENDIMENTO (WhatsApp)
- Conversas novas: ${extras.atendimento.conversasNovas}
- Tempo médio até a primeira resposta: ${min(extras.atendimento.tempoMedioPrimeiraRespostaMin)}
- Conversas ainda sem resposta: ${extras.atendimento.semResposta}
- Desfecho: fechou ${extras.atendimento.fechou}, não fechou ${extras.atendimento.naoFechou}

COMUNICAR (mensagens programadas e de pós-venda)
- Mensagens enviadas: ${extras.comunicar.enviadas}
- Clientes que responderam: ${extras.comunicar.respostas}
- Agendaram depois da mensagem: ${extras.comunicar.agendaramPelaMensagem}
- Falharam no envio: ${extras.comunicar.falharam}

ORÇADOR
- Orçamentos enviados: ${extras.orcador.enviados}
- Aprovados: ${extras.orcador.aprovados} (${brl(extras.orcador.valorAprovado)})
- Recusados: ${extras.orcador.recusados}` : '';

  return `DADOS ${nomeP} — IndyCar Centro Automotivo (Taubaté)

RESUMO
- Leads recebidos: ${s.total} (${ant}: ${c.leads.anterior})
- Serviços concluídos: ${s.ganhos}
- Leads perdidos: ${s.perdidos}
- Faturamento: ${brl(s.faturamento)} (${ant}: ${brl(c.faturamento.anterior)})
- Em aberto (orçamentos não fechados): ${brl(s.emAberto)}
- Ticket médio: ${brl(s.ticket)}
- Taxa de conversão: ${Number(s.conversao || 0).toFixed(1)}%

DE ONDE VIERAM OS LEADS
${linhasOrigem}

SITUAÇÃO ATUAL DOS LEADS
${statusTxt}

SERVIÇOS FECHADOS
${ganhos}

LEADS PERDIDOS
${perdidos}${blocoExtras}`;
}

const SYSTEM = `Você é o analista comercial da IndyCar Centro Automotivo, uma oficina mecânica em Taubaté-SP especializada em câmbio automático, freios, suspensão, direção, pneus, troca de óleo e revisões.

Escreva um resumo para o DONO da oficina — alguém prático, que quer saber o que aconteceu e o que fazer, não jargão de marketing.

Estruture assim, em português do Brasil:

## 📊 O período em uma frase
(uma frase direta: foi bom, foi fraco, e o porquê)

## 🎯 De onde vieram os clientes
(analise os canais: Meta/Instagram, Google, indicação, WhatsApp, orgânico. Qual trouxe mais gente, qual trouxe gente que FECHOU — são coisas diferentes. Aponte o canal mais eficiente em faturamento, não só em volume.)

## 💰 Números que importam
(faturamento, ticket médio, conversão, dinheiro parado em orçamento aberto — comente o que cada número significa na prática)

## ⚠️ Onde perdemos dinheiro
(analise os leads perdidos e o valor em aberto; levante hipóteses do porquê)

## 📲 Atendimento, Comunicar e Orçador
(quando esses blocos vierem no briefing: tempo de resposta no WhatsApp, quem respondeu e agendou pelas mensagens do Comunicar, orçamentos aprovados × recusados — o que isso diz sobre a operação. Se não vierem, pule esta seção.)

## ✅ 3 ações para o próximo período
(três recomendações concretas e acionáveis, em ordem de prioridade. Nada genérico — cite canal, serviço, número ou tarefa no CRM, como "cobrar os orçamentos parados" ou "responder mais rápido de manhã".)

Regras: seja direto e honesto (se o período foi ruim, diga). Use os números reais fornecidos. Não invente dados que não estão no briefing. Se o briefing for de 30 dias, fale em "mês" em vez de "semana". Máximo ~500 palavras.`;

/**
 * Gera o resumo (semanal ou mensal) chamando a Claude.
 * opcoes: { modelo, clienteIA (objeto com criar(params)), periodo: 'semana'|'mes' }
 * Sem credencial devolve ok:false com o briefing (a tela mostra um aviso amigável).
 */
async function gerarResumoSemanal(dados, opcoes = {}) {
  const periodo = opcoes.periodo === 'mes' ? 'mes' : 'semana';
  const briefing = montarBriefing({ ...dados, periodo });
  const modelo = opcoes.modelo || MODEL;

  let cliente = opcoes.clienteIA;
  if (cliente === undefined) {
    if (!process.env.ANTHROPIC_API_KEY) {
      return {
        ok: false, erro: 'ANTHROPIC_API_KEY não configurada', periodo, briefing,
        instrucao: 'Defina a variável de ambiente ANTHROPIC_API_KEY e reinicie o servidor para ativar o resumo com IA.',
      };
    }
    cliente = require('./lib/ia-crm').clienteAnthropic(process.env.ANTHROPIC_API_KEY);
  }
  if (!cliente) {
    return { ok: false, erro: 'IA não configurada', periodo, briefing,
      instrucao: 'Confira a chave ANTHROPIC_API_KEY e o pacote @anthropic-ai/sdk.' };
  }

  const t0 = Date.now();
  try {
    const message = await cliente.criar({
      model: modelo,
      // teto de raciocínio + texto: com pouco o modelo podia gastar tudo pensando
      max_tokens: 16000,
      output_config: { effort: 'low' },   // resumo curto: corta custo e latência
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: briefing }],
    });

    if (message.stop_reason === 'refusal') {
      return { ok: false, erro: 'A IA recusou a solicitação.', briefing, periodo };
    }

    const texto = (message.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();

    if (!texto) {
      return { ok: false, erro: 'A IA devolveu uma resposta vazia. Tente gerar de novo.', briefing, periodo };
    }

    return {
      ok: true,
      resumo: texto,
      truncado: message.stop_reason === 'max_tokens',
      modelo: message.model || modelo,
      geradoEm: new Date().toISOString(),
      periodo,
      tokens: { entrada: message.usage?.input_tokens || 0, saida: message.usage?.output_tokens || 0 },
      duracaoMs: Date.now() - t0,
    };
  } catch (err) {
    // a mensagem crua do SDK pode trazer detalhe interno; a tela recebe texto simples
    return { ok: false, erro: 'A IA não respondeu agora. Tente de novo em instantes.', detalhe: String(err?.status || ''), briefing, periodo };
  }
}

module.exports = { gerarResumoSemanal, montarBriefing, SYSTEM, MODEL };
