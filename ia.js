/* ============================================================
   IndyCar CRM — IA administradora (Claude)
   Recebe os dados da semana e devolve um resumo executivo:
   de ONDE vieram os leads, COMO foi a semana e COMO terminaram.
   ============================================================ */
'use strict';

const MODEL = 'claude-opus-5';

const brl = (n) => (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Monta um briefing textual compacto a partir dos dados do CRM. */
function montarBriefing({ stats, semanaLeads }) {
  const s = stats.semana;
  const c = stats.comparativo;

  const linhasOrigem = s.porOrigem.length
    ? s.porOrigem.map(o =>
        `- ${o.origem}: ${o.leads} leads, ${o.ganhos} fechados, ${brl(o.faturamento)}`).join('\n')
    : '- (sem leads na semana)';

  const statusTxt = Object.entries(s.porStatus)
    .filter(([, n]) => n > 0).map(([k, n]) => `${k}=${n}`).join(', ') || '(nenhum)';

  const perdidos = semanaLeads.filter(l => l.status === 'perdido')
    .map(l => `- ${l.servico || 'serviço n/d'} (${l.origem}) — orçado ${brl(l.valor_orcado)}`)
    .slice(0, 10).join('\n') || '- (nenhum lead perdido)';

  const ganhos = semanaLeads.filter(l => l.status === 'concluido')
    .map(l => `- ${l.servico || 'serviço n/d'} (${l.origem}) — pago ${brl(l.valor_pago)}`)
    .slice(0, 10).join('\n') || '- (nenhum serviço concluído)';

  return `DADOS DA SEMANA — IndyCar Centro Automotivo (Taubaté)

RESUMO
- Leads recebidos: ${s.total} (semana anterior: ${c.leads.anterior})
- Serviços concluídos: ${s.ganhos}
- Leads perdidos: ${s.perdidos}
- Faturamento: ${brl(s.faturamento)} (semana anterior: ${brl(c.faturamento.anterior)})
- Em aberto (orçamentos não fechados): ${brl(s.emAberto)}
- Ticket médio: ${brl(s.ticket)}
- Taxa de conversão: ${s.conversao.toFixed(1)}%

DE ONDE VIERAM OS LEADS
${linhasOrigem}

SITUAÇÃO ATUAL DOS LEADS
${statusTxt}

SERVIÇOS FECHADOS
${ganhos}

LEADS PERDIDOS
${perdidos}`;
}

const SYSTEM = `Você é o analista comercial da IndyCar Centro Automotivo, uma oficina mecânica em Taubaté-SP especializada em câmbio automático, freios, suspensão, direção, pneus, troca de óleo e revisões.

Escreva um resumo semanal para o DONO da oficina — alguém prático, que quer saber o que aconteceu e o que fazer, não jargão de marketing.

Estruture assim, em português do Brasil:

## 📊 A semana em uma frase
(uma frase direta: foi boa, foi fraca, e o porquê)

## 🎯 De onde vieram os clientes
(analise os canais: Meta/Instagram, Google, indicação, WhatsApp, orgânico. Qual trouxe mais gente, qual trouxe gente que FECHOU — são coisas diferentes. Aponte o canal mais eficiente em faturamento, não só em volume.)

## 💰 Números que importam
(faturamento, ticket médio, conversão, dinheiro parado em orçamento aberto — comente o que cada número significa na prática)

## ⚠️ Onde perdemos dinheiro
(analise os leads perdidos e o valor em aberto; levante hipóteses do porquê)

## ✅ 3 ações para a próxima semana
(três recomendações concretas e acionáveis, em ordem de prioridade. Nada genérico — cite canal, serviço ou valor específico.)

Regras: seja direto e honesto (se a semana foi ruim, diga). Use os números reais fornecidos. Não invente dados que não estão no briefing. Máximo ~450 palavras.`;

/**
 * Gera o resumo semanal chamando a API da Claude.
 * Se não houver credencial configurada, devolve ok:false com instruções
 * (o front mostra um aviso amigável em vez de quebrar).
 */
async function gerarResumoSemanal(dados) {
  const briefing = montarBriefing(dados);

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      ok: false,
      erro: 'ANTHROPIC_API_KEY não configurada',
      instrucao: 'Defina a variável de ambiente ANTHROPIC_API_KEY e reinicie o servidor para ativar o resumo com IA.',
      briefing,
    };
  }

  let Anthropic;
  try {
    Anthropic = require('@anthropic-ai/sdk');
  } catch {
    return {
      ok: false,
      erro: 'SDK da Anthropic não instalado',
      instrucao: 'Rode: npm install @anthropic-ai/sdk',
      briefing,
    };
  }

  try {
    const client = new Anthropic();
    const stream = client.messages.stream({
      model: MODEL,
      // max_tokens é o teto de raciocínio + texto. Com 4000 o modelo podia gastar
      // tudo pensando e devolver resposta vazia/cortada, e o front dizia "ok".
      max_tokens: 16000,
      output_config: { effort: 'low' },   // resumo curto: corta custo e latência
      system: SYSTEM,
      messages: [{ role: 'user', content: briefing }],
    });
    const message = await stream.finalMessage();

    if (message.stop_reason === 'refusal') {
      return { ok: false, erro: 'A IA recusou a solicitação.', briefing };
    }

    const texto = message.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();

    if (!texto) {
      return { ok: false, erro: 'A IA devolveu uma resposta vazia. Tente gerar de novo.', briefing };
    }

    return {
      ok: true,
      resumo: texto,
      truncado: message.stop_reason === 'max_tokens',
      modelo: MODEL,
      geradoEm: new Date().toISOString(),
    };
  } catch (err) {
    return { ok: false, erro: err.message || 'falha ao chamar a API da Claude', briefing };
  }
}

module.exports = { gerarResumoSemanal, montarBriefing };
