/**
 * O aviso que chega ao time quando alguém escreve para a Komune no WhatsApp.
 *
 * POR QUE ISTO EXISTE
 * ---------------------------------------------------------------------------
 * O número da KOMUNE vive só na Cloud API (decisão de 14/09/2026): ele não toca
 * em celular nenhum, e por isso ninguém ouve "plim". Sem aviso, a mensagem que
 * chegou às 9h fica esperando alguém abrir a tela Conversas — e a janela de 24 h
 * da Meta corre do mesmo jeito.
 *
 * O aviso é E-MAIL, pelo Resend (pedido do Rafael em 16/09/2026). Um e-mail por
 * lote da fila, não um por mensagem: cinco mensagens de uma pessoa em dez
 * segundos são uma conversa, e cinco e-mails seriam ruído — que é como um aviso
 * deixa de ser lido.
 *
 * O QUE VAI NO E-MAIL, E O QUE NÃO VAI
 * ---------------------------------------------------------------------------
 * Vai o suficiente para decidir se é agora: quem escreveu (nome da ficha, ou o
 * fim do número quando não é ficha), o que a pessoa escolheu no menu do bot e a
 * primeira linha da mensagem. NÃO vai o número inteiro nem o histórico: e-mail é
 * caixa de entrada de gente, fora da RLS do CRM, e telefone completo lá é PII
 * exportada sem `pii_access_log` (RF-BAS-14). Quem quer o resto abre o CRM — e o
 * e-mail leva o link direto da conversa.
 */

import type { Logger } from '../lib/log';

/** Uma mensagem que chegou, do jeito que o aviso precisa dela. */
export interface EntradaParaAviso {
  /** Nome da ficha, quando o número é conhecido. */
  ficha: string | null;
  organizationId: string | null;
  /** E.164 — usado só para tirar os quatro últimos dígitos. */
  telefone: string | null;
  texto: string | null;
  /** O que a pessoa escolheu no menu do bot de entrada, quando escolheu. */
  opcao: string | null;
}

export interface ConfiguracaoDoAviso {
  ativo: boolean;
  para: string[];
  de: string;
  /**
   * Para onde vai o "responder" do e-mail. Existe por dois motivos: responder um
   * aviso não pode ir para o vazio, e uma caixa que responde é sinal de correio de
   * gente — o que ajuda o Gmail a não mandar o aviso para o spam.
   */
  responderPara?: string | null;
  urlDoCrm: string;
}

const RESEND = 'https://api.resend.com/emails';

/** "terminado em 4698": o mesmo recorte que a tela usa (RF-BAS-14). */
export function finalDoNumero(e164: string | null): string {
  const digitos = (e164 ?? '').replace(/\D/g, '');
  return digitos.length >= 4 ? `terminado em ${digitos.slice(-4)}` : 'sem número';
}

export function quemEscreveu(entrada: EntradaParaAviso): string {
  return entrada.ficha ?? `Número ${finalDoNumero(entrada.telefone)}`;
}

/** Primeira linha do que a pessoa escreveu, curta o bastante para caber no assunto. */
export function primeiraLinha(texto: string | null, limite = 120): string {
  const limpo = (texto ?? '').replace(/\s+/g, ' ').trim();
  if (limpo === '') return '(sem texto: áudio, imagem ou documento)';
  return limpo.length > limite ? `${limpo.slice(0, limite - 1)}…` : limpo;
}

export function assuntoDoAviso(entradas: readonly EntradaParaAviso[]): string {
  if (entradas.length === 1) {
    const e = entradas[0]!;
    return `WhatsApp: ${quemEscreveu(e)} — ${primeiraLinha(e.texto, 60)}`;
  }
  return `WhatsApp: ${entradas.length} mensagens novas`;
}

/** O corpo em texto puro. Sem HTML: e-mail de aviso se lê no relógio e no celular. */
export function corpoDoAviso(entradas: readonly EntradaParaAviso[], urlDoCrm: string): string {
  const linhas = entradas.map((e) => {
    const onde = e.organizationId
      ? `${urlDoCrm}/conversas?org=${e.organizationId}`
      : `${urlDoCrm}/conversas?aba=fora`;
    const escolha = e.opcao ? `\n  Escolheu no menu: ${e.opcao}` : '';
    return `• ${quemEscreveu(e)}${escolha}\n  "${primeiraLinha(e.texto, 280)}"\n  ${onde}`;
  });
  return [
    entradas.length === 1
      ? 'Chegou uma mensagem no WhatsApp da Komune.'
      : `Chegaram ${entradas.length} mensagens no WhatsApp da Komune.`,
    '',
    ...linhas,
    '',
    'Responder é pelo CRM: o número não abre no celular (ele vive na Cloud API).',
    'A janela de resposta livre da Meta dura 24 h depois da última mensagem da pessoa.',
  ].join('\n');
}

/**
 * Manda o aviso. Nunca lança: aviso que derruba a fila de entrada é pior que
 * aviso que não chega — a mensagem do parceiro já está gravada quando isto roda.
 */
export async function avisarPorEmail(
  entradas: readonly EntradaParaAviso[],
  config: ConfiguracaoDoAviso,
  chave: string | undefined,
  logger: Logger,
  buscar: typeof fetch = fetch,
): Promise<boolean> {
  if (entradas.length === 0) return false;
  if (!config.ativo || config.para.length === 0) return false;
  if (!chave) {
    logger.warn('aviso por e-mail ligado, mas sem RESEND_API_KEY: ninguém foi avisado', {
      mensagens: entradas.length,
    });
    return false;
  }
  try {
    const resposta = await buscar(RESEND, {
      method: 'POST',
      headers: { authorization: `Bearer ${chave}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: config.de,
        to: config.para,
        ...(config.responderPara ? { reply_to: config.responderPara } : {}),
        subject: assuntoDoAviso(entradas),
        text: corpoDoAviso(entradas, config.urlDoCrm),
      }),
    });
    if (!resposta.ok) {
      logger.error('Resend recusou o aviso', {
        status: resposta.status,
        corpo: (await resposta.text()).slice(0, 300),
      });
      return false;
    }
    logger.info('time avisado por e-mail', {
      mensagens: entradas.length,
      para: config.para.length,
    });
    return true;
  } catch (erro) {
    logger.error('não deu para avisar por e-mail', { erro: (erro as Error).message });
    return false;
  }
}
