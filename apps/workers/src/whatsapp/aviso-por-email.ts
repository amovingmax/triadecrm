/**
 * O aviso por e-mail das mensagens que acumulam no WhatsApp.
 *
 * POR QUE ISTO EXISTE
 * ---------------------------------------------------------------------------
 * O número vive só na Cloud API (decisão de 14/09/2026): ele não toca em
 * celular nenhum. De 16/09 a 11/11/2026 o worker mandava um e-mail a cada lote
 * que chegava; com o aviso no navegador e no celular, aquilo virou ruído.
 *
 * Desde 11/11/2026 ("precisamos tirar os avisos de mensagem por email, coloque
 * aviso no email agora, quando tiver mais de 30 novas mensagens") o e-mail só
 * sai quando passam de 30 as mensagens NOVAS sem resposta do time, contadas
 * desde o último aviso. Quem decide é o banco (`public.aviso_de_acumulo_conferir`,
 * migração 20261112120000): a regra do que é "nova", o limite e o marco de onde
 * a conta recomeça moram lá. Este arquivo só escreve e manda o e-mail.
 *
 * O QUE VAI NO E-MAIL, E O QUE NÃO VAI
 * ---------------------------------------------------------------------------
 * Quantas são, em quantas conversas, e as dez conversas com mais mensagens
 * esperando: nome da ficha (ou do perfil), o fim do número quando não há nome,
 * a última mensagem e o link direto. NÃO vai o número inteiro nem o histórico:
 * e-mail é caixa de entrada de gente, fora da RLS do CRM, e telefone completo
 * lá é PII exportada sem `pii_access_log` (RF-BAS-14). O banco já devolve só os
 * quatro últimos dígitos.
 */

import type { Logger } from '../lib/log';

/** Uma conversa da lista do e-mail, como `aviso_de_acumulo_conferir` devolve. */
export interface ConversaDoAcumulo {
  conversationId: string;
  organizationId: string | null;
  /** Nome da ficha ou, sem ficha, o nome do perfil no WhatsApp. */
  nome: string | null;
  /** Os quatro últimos dígitos do número; o resto não sai do banco. */
  finalDoNumero: string | null;
  mensagens: number;
  /** A última mensagem que a pessoa escreveu (nulo em áudio, imagem, documento). */
  ultima: string | null;
}

/** A conta das mensagens novas sem resposta, desde o último aviso. */
export interface Acumulo {
  /** A decisão do banco: passou do limite. */
  mandar: boolean;
  limite: number;
  mensagens: number;
  conversas: number;
  /** A chegada mais recente contada: o próximo aviso conta depois dela. */
  ate: string | null;
  /** As dez conversas com mais mensagens esperando. */
  lista: ConversaDoAcumulo[];
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

/** Como a conversa aparece no e-mail: o nome, ou o fim do número (RF-BAS-14). */
export function quemEscreveu(c: Pick<ConversaDoAcumulo, 'nome' | 'finalDoNumero'>): string {
  if (c.nome) return c.nome;
  return c.finalDoNumero ? `Número terminado em ${c.finalDoNumero}` : 'Número sem identificação';
}

/** Primeira linha do que a pessoa escreveu, curta o bastante para o e-mail. */
export function primeiraLinha(texto: string | null, limite = 120): string {
  const limpo = (texto ?? '').replace(/\s+/g, ' ').trim();
  if (limpo === '') return '(sem texto: áudio, imagem ou documento)';
  return limpo.length > limite ? `${limpo.slice(0, limite - 1)}…` : limpo;
}

/** O link que abre a conversa certa: a ficha, ou a conversa do cliente sem ficha. */
export function linkDaConversa(c: ConversaDoAcumulo, urlDoCrm: string): string {
  return c.organizationId
    ? `${urlDoCrm}/conversas?org=${c.organizationId}`
    : `${urlDoCrm}/conversas?cliente=${c.conversationId}`;
}

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

export function assuntoDoAcumulo(a: Acumulo): string {
  return `WhatsApp: ${a.mensagens} mensagens novas sem resposta`;
}

/** O corpo em texto puro. Sem HTML: e-mail de aviso se lê no relógio e no celular. */
export function corpoDoAcumulo(a: Acumulo, urlDoCrm: string): string {
  const linhas = a.lista.map(
    (c) =>
      `• ${quemEscreveu(c)}: ${plural(c.mensagens, 'mensagem', 'mensagens')}\n` +
      `  "${primeiraLinha(c.ultima, 280)}"\n` +
      `  ${linkDaConversa(c, urlDoCrm)}`,
  );
  const fora = a.conversas - a.lista.length;
  return [
    `Chegaram ${plural(a.mensagens, 'mensagem', 'mensagens')} no WhatsApp que ainda não ` +
      `tiveram resposta do time, em ${plural(a.conversas, 'conversa', 'conversas')}.`,
    `Este e-mail só sai quando passam de ${a.limite}. O próximo só sai se acumularem ` +
      `mais ${a.limite + 1} sem resposta.`,
    '',
    'Onde há mais mensagens esperando:',
    '',
    ...linhas,
    ...(fora > 0 ? ['', `E mais ${plural(fora, 'conversa', 'conversas')} na tela Conversas.`] : []),
    '',
    `Abrir as Conversas: ${urlDoCrm}/conversas`,
    '',
    'Responder é pelo CRM: o número não abre no celular (ele vive na Cloud API).',
    'A janela de resposta livre da Meta dura 24 h depois da última mensagem da pessoa.',
  ].join('\n');
}

/**
 * O cano do Resend, sozinho — assunto, corpo, destinatários.
 *
 * DUAS COISAS MUDAM NA EXTRAÇÃO, E AS DUAS SÃO OBRIGATÓRIAS.
 *
 * 1. `avisarDoAcumulo` engole o erro e devolve `false`, e para ele isso está
 *    certo: aviso que derruba o laço do worker é pior que aviso que não
 *    chega. Para uma fila COM RETENTATIVA está errado — mensagem que
 *    "deu certo" é arquivada, e as cinco tentativas prometidas nunca
 *    acontecem. Então o resultado é discriminado.
 *
 * 2. E ele não é binário. "Aviso desligado" e "lista vazia" NÃO são falha:
 *    são configuração, e devolver falha nesses casos manda TODA reunião para
 *    `reuniao_avisos_dlq` em qualquer ambiente sem Resend — inclusive o
 *    local. Por isso existe `motivo: 'desligado'`, que o consumidor CONCLUI
 *    em vez de falhar, deixando `aviso_enviado_em` nulo (que é justamente o
 *    que o cartão da Agenda já mostra).
 *
 * 5xx, 429 e erro de rede são transitórios. 4xx não é: chave errada, domínio
 * não verificado e destinatário inválido não melhoram com repetição.
 *
 * `para` vem POR FORA da config porque o aviso de reunião soma o dono da
 * reunião à lista do time, e a config é a lista do time.
 */
export type ResultadoDoEnvio =
  | { ok: true }
  | { ok: false; motivo: 'desligado' | 'sem_chave' | 'recusado'; transitorio: boolean };

export async function enviarPeloResend(
  assunto: string,
  texto: string,
  config: ConfiguracaoDoAviso,
  para: readonly string[],
  chave: string | undefined,
  logger: Logger,
  buscar: typeof fetch = fetch,
): Promise<ResultadoDoEnvio> {
  if (!config.ativo || para.length === 0) {
    return { ok: false, motivo: 'desligado', transitorio: false };
  }
  if (!chave) {
    logger.warn('aviso por e-mail ligado, mas sem RESEND_API_KEY: ninguém foi avisado', {
      assunto,
    });
    return { ok: false, motivo: 'sem_chave', transitorio: false };
  }
  try {
    const resposta = await buscar(RESEND, {
      method: 'POST',
      headers: { authorization: `Bearer ${chave}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: config.de,
        to: [...para],
        ...(config.responderPara ? { reply_to: config.responderPara } : {}),
        subject: assunto,
        text: texto,
      }),
    });
    if (!resposta.ok) {
      logger.error('Resend recusou o e-mail', {
        status: resposta.status,
        corpo: (await resposta.text()).slice(0, 300),
      });
      return {
        ok: false,
        motivo: 'recusado',
        transitorio: resposta.status >= 500 || resposta.status === 429,
      };
    }
    logger.info('e-mail enviado', { assunto, para: para.length });
    return { ok: true };
  } catch (erro) {
    logger.error('não deu para falar com o Resend', { erro: (erro as Error).message });
    return { ok: false, motivo: 'recusado', transitorio: true };
  }
}

/**
 * Manda o aviso das mensagens acumuladas. Nunca lança: devolve `true` só quando
 * o Resend aceitou, e é só aí que o worker registra o aviso e a conta recomeça.
 * Se falhou, a próxima conferência tenta de novo.
 */
export async function avisarDoAcumulo(
  acumulo: Acumulo,
  config: ConfiguracaoDoAviso,
  chave: string | undefined,
  logger: Logger,
  buscar: typeof fetch = fetch,
): Promise<boolean> {
  if (!acumulo.mandar || acumulo.mensagens === 0) return false;
  const r = await enviarPeloResend(
    assuntoDoAcumulo(acumulo),
    corpoDoAcumulo(acumulo, config.urlDoCrm),
    config,
    config.para,
    chave,
    logger,
    buscar,
  );
  return r.ok;
}
