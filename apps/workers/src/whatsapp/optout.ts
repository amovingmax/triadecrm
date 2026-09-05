/**
 * A REGRA DE OPT-OUT (guardrail do CLAUDE.md, RF-CON-19, R08 §5.7).
 *
 * "Opt-out por regra (palavras como 'sair', 'parar', 'não quero', 'remover') →
 * `do_not_contact` imediato e entrada na `suppression_list`; nenhum envio a
 * contato suprimido, em nenhum modo."
 *
 * Determinística de propósito. Nenhum modelo é consultado para decidir se
 * alguém pediu para sair: um classificador que erra 2% das vezes erra 2% dos
 * opt-outs, e o custo de errar aqui não é uma resposta ruim — é continuar
 * mandando mensagem para quem disse não. A IA classifica o resto; isto aqui é
 * `if`.
 *
 * E roda ANTES de tudo. Antes de classificar, antes de transcrever, antes de
 * pensar em responder. A ordem é a regra.
 *
 * DUAS REGRAS, E A SEGUNDA EXISTE POR CAUSA DE UMA PALAVRA
 * ---------------------------------------------------------------------------
 * "para" é, em português, a preposição mais comum que existe: "para mim",
 * "para quinta", "para o evento". Uma lista de palavras soltas que a contenha
 * transforma "consigo para quinta às 9h30" — que é um SIM — em opt-out, e o
 * fornecedor mais interessado da semana vira um número suprimido para sempre.
 * Supressão não tem desfazer barato: ela grava `consent_events`, que é prova
 * de LGPD e é append-only.
 *
 * Por isso são duas regras com exigências diferentes:
 *
 *   1. A PALAVRA SOZINHA. A mensagem inteira, tirada a pontuação e o emoji, é
 *      uma das palavras de encerrar. É o "opt-out em 1 palavra" que o R08 §5.7
 *      pede que seja sempre possível — e uma mensagem cujo conteúdo inteiro é
 *      "para" não é preposição nenhuma, é imperativo.
 *
 *   2. A FRASE INEQUÍVOCA. Em mensagem longa, só conta o que não tem outra
 *      leitura: "não quero receber", "me tira da lista", "para de mandar".
 *      "sair" solto no meio de uma frase NÃO conta — "vocês vão sair com o app
 *      quando?" é uma pergunta de interesse.
 *
 * O QUE ENTRA ALÉM DAS QUATRO PALAVRAS DO CLAUDE.md, E POR QUÊ
 * ---------------------------------------------------------------------------
 * "vou bloquear" e "vou denunciar" entram. O R08 §1 os classifica como
 * `HOSTIL`, não como `OPT_OUT`, e para a conversa isso está certo. Para o
 * ENVIO, não: bloqueio e denúncia são exatamente as duas métricas pelas quais
 * a Meta rebaixa o quality rating do número (R04 §4), e continuar mandando
 * mensagem para quem acabou de anunciar as duas é a maneira mais rápida de
 * perder o número. Tratar como opt-out é o que protege o ativo.
 *
 * O QUE NÃO ENTRA
 * ---------------------------------------------------------------------------
 * "não" sozinho, "não tenho interesse", "obrigado mas não". São
 * `SEM_INTERESSE_SUAVE` e `SEM_INTERESSE_FIRME` do R08 §1: viram perda com
 * motivo e saem da cadência, mas não são supressão. Quem diz "não é pra mim
 * agora" está dizendo "agora" — e a reativação de 60 dias do R08 §3.4 existe
 * para isso. Suprimir os dois seria apagar o "agora".
 */

/**
 * Normaliza para comparar: minúsculas, sem acento, sem pontuação nas bordas,
 * espaços colapsados. `unaccent` do Postgres faz o mesmo do lado de lá.
 */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Regra 1: a mensagem INTEIRA é uma destas. Uma palavra só, e nada mais.
 * É a única lista em que "para" e "sai" podem aparecer.
 */
const PALAVRA_SOZINHA: ReadonlySet<string> = new Set([
  'sair',
  'sai',
  'saia',
  'parar',
  'pare',
  'para',
  'para com isso',
  'remover',
  'remove',
  'remova',
  'cancelar',
  'cancela',
  'descadastrar',
  'descadastre',
  'bloquear',
  'stop',
  'unsubscribe',
  'chega',
  'ja chega',
  'para de mandar',
  'nao quero',
  'nao quero mais',
  'nao me mande mais',
  'nao manda mais',
]);

/**
 * Regra 2: frases que não têm outra leitura, procuradas em qualquer lugar do
 * texto. Cada uma é uma decisão: se der para imaginar um contexto em que a
 * pessoa quis dizer outra coisa, a frase não entra nesta lista.
 */
const FRASE_INEQUIVOCA: readonly string[] = [
  'nao quero receber',
  'nao quero mais receber',
  'nao quero mais mensagem',
  'nao quero mais mensagens',
  'nao quero mais nada',
  'nao me mande mais',
  'nao me manda mais',
  'nao me mandem mais',
  'nao mande mais',
  'nao manda mais',
  'nao envie mais',
  'nao envia mais',
  'nao me envie',
  'nao me envia mais',
  'nao me procure',
  'nao me procura mais',
  'nao me procurem',
  'nao me perturbe',
  'nao me perturba',
  'nao insista',
  'nao insiste',
  'nao me chame mais',
  'nao me chama mais',
  'nao me liguem mais',
  'nao me ligue mais',
  'nao me liga mais',
  'para de mandar',
  'para de me mandar',
  'pare de mandar',
  'pare de me mandar',
  'parem de mandar',
  'parar de receber',
  'pode parar',
  'para com essas mensagens',
  'me tira da lista',
  'me tire da lista',
  'me tirem da lista',
  'me remove',
  'me remova',
  'me removam',
  'remove meu numero',
  'remova meu numero',
  'remover meu numero',
  'tira meu numero',
  'tire meu numero',
  'apague meu numero',
  'apaga meu numero',
  'excluir meus dados',
  'exclua meus dados',
  'apagar meus dados',
  'me descadastre',
  'me descadastra',
  'cancelar inscricao',
  'quero sair',
  'quero sair da lista',
  'me tira daqui',
  'vou bloquear',
  'vou te bloquear',
  'vou bloquear esse numero',
  'vou denunciar',
  'vou te denunciar',
  'vou reportar como spam',
  'isso e spam',
  'para de me incomodar',
  'pare de me incomodar',
];

export interface VereditoDeOptOut {
  /** Verdadeiro quando a pessoa pediu para não receber mais. */
  pediu: boolean;
  /** Qual regra decidiu: `palavra` (regra 1) ou `frase` (regra 2). */
  regra: 'palavra' | 'frase' | null;
  /** O trecho exato que disparou. Vai para `consent_events.evidence_text`. */
  evidencia: string | null;
}

const SEM_PEDIDO: VereditoDeOptOut = { pediu: false, regra: null, evidencia: null };

/**
 * A pessoa pediu para sair?
 *
 * Recebe o texto como ele chegou (a normalização é aqui dentro, para não haver
 * duas). Texto vazio — áudio sem legenda, foto sem legenda — devolve `false`:
 * o que está dentro do áudio é assunto da transcrição, e esta função não
 * adivinha.
 */
export function pediuParaSair(texto: string | null | undefined): VereditoDeOptOut {
  if (typeof texto !== 'string') return SEM_PEDIDO;
  const limpo = normalizar(texto);
  if (limpo === '') return SEM_PEDIDO;

  if (PALAVRA_SOZINHA.has(limpo)) {
    return { pediu: true, regra: 'palavra', evidencia: limpo };
  }

  for (const frase of FRASE_INEQUIVOCA) {
    if (limpo.includes(frase)) {
      return { pediu: true, regra: 'frase', evidencia: frase };
    }
  }

  return SEM_PEDIDO;
}

/** Só para os testes e para o relatório: quantas formas a regra conhece. */
export const TAMANHO_DA_REGRA = {
  palavras: PALAVRA_SOZINHA.size,
  frases: FRASE_INEQUIVOCA.length,
} as const;
