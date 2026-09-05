import {
  FRASE_DE_ESCAPE_FINANCEIRO,
  TEMAS_FINANCEIROS_SEM_RESPOSTA,
  URLS_PERMITIDAS,
  VALORES_AUTORIZADOS,
  fatoPorId,
} from './base-conhecimento';

/**
 * Validador determinístico de promessas (RF-CON-24; R08 §5.4 e §5.7).
 *
 * Roda DEPOIS do modelo e ANTES de qualquer pessoa ver o rascunho. Não julga estilo:
 * julga se o texto afirma preço, prazo ou condição que não está na base de conhecimento.
 * Bloqueou, o rascunho cai para texto fixo ou para humano — nunca sai "quase certo".
 *
 * Determinístico de propósito. Um segundo modelo julgando o primeiro custaria o dobro,
 * seria não reproduzível e não daria para testar sem rede. O preço dessa escolha é
 * conhecido e está nos evals: paráfrase sem número ("a gente dá um jeito no valor")
 * passa. Por isso a aprovação humana continua sendo a regra (ADR-05) — o validador é a
 * segunda rede, não a primeira.
 */

export type CodigoDeBloqueio =
  | 'valor_nao_autorizado'
  | 'palavra_proibida'
  | 'url_fora_da_lista'
  | 'claim_sem_base'
  | 'financeiro_sem_resposta'
  | 'tamanho'
  | 'emoji_demais'
  | 'caixa_alta';

export interface MotivoDeBloqueio {
  readonly codigo: CodigoDeBloqueio;
  readonly trecho: string;
  readonly explicacao: string;
}

export type ResultadoDaValidacao =
  | { readonly situacao: 'aprovado'; readonly texto: string }
  | {
      /** Dúvida financeira sem resposta na FAQ: o texto vira a frase de escape. */
      readonly situacao: 'substituido';
      readonly texto: string;
      readonly motivos: readonly MotivoDeBloqueio[];
    }
  | {
      readonly situacao: 'bloqueado';
      readonly motivos: readonly MotivoDeBloqueio[];
      readonly queda: 'texto_fixo' | 'humano';
    };

export interface LimitesDoTexto {
  readonly maxCaracteres: number;
  readonly maxLinhas: number;
  readonly maxEmojis: number;
}

/** RF-CON-24: 300 caracteres por turno. R08 §5.7: follow-up ≤ 3 linhas, 1 emoji. */
export const LIMITES_PADRAO: LimitesDoTexto = {
  maxCaracteres: 300,
  maxLinhas: 4,
  maxEmojis: 1,
};

export interface EntradaDaValidacao {
  readonly texto: string;
  /** Ids de fatos da base que o texto diz estar usando (o modelo devolve isto). */
  readonly claims?: readonly string[];
  /** A mensagem do parceiro que originou o rascunho, quando existe. */
  readonly perguntaDoParceiro?: string | null;
  readonly limites?: LimitesDoTexto;
}

/** R08 §5.1 e RF-CON-24. Cada entrada é um radical, não uma palavra inteira. */
const PALAVRAS_PROIBIDAS: readonly { readonly radical: RegExp; readonly explicacao: string }[] = [
  { radical: /garant/i, explicacao: 'garantia não está no pitch padrão (R08 §5.4)' },
  { radical: /\bgr[áa]tis\b/i, explicacao: 'usar "sem mensalidade", nunca "grátis"' },
  { radical: /exclusiv/i, explicacao: 'exclusividade de categoria ou região não existe' },
  { radical: /desconto/i, explicacao: 'desconto na taxa só a direção libera, por escrito' },
  { radical: /promo[çc]/i, explicacao: 'não há promoção' },
  { radical: /imperd[íi]vel/i, explicacao: 'palavra proibida (R08 §5.1)' },
  { radical: /[úu]ltima chance/i, explicacao: 'palavra proibida (R08 §5.1)' },
  { radical: /\burgente\b/i, explicacao: 'palavra proibida (R08 §5.1)' },
  { radical: /\bseguro\b/i, explicacao: 'seguro/garantia de valores está em avaliação; não citar' },
  { radical: /\bquerid[oa]s?\b/i, explicacao: 'vocativo proibido (R08 §5.1)' },
  { radical: /\bparceir[oa]s?,/i, explicacao: '"parceiro" como vocativo é proibido (R08 §5.1)' },
];

/** Percentual, dinheiro e prazo — as três formas em que uma promessa vira número. */
const PADROES_DE_VALOR: readonly RegExp[] = [
  /\d+(?:[.,]\d+)?\s*%/g,
  /R\$\s*\d+(?:[.\d]*)(?:,\d{2})?/gi,
  /\bem\s+(?:at[ée]\s+)?\d+\s*(?:dias?|semanas?|m[êe]s(?:es)?|horas?|minutos?|min)\b/gi,
  /\b\d+\s*(?:dias?|semanas?|m[êe]s(?:es)?|horas?|minutos?|min)\b/gi,
  /\b\d+\s*mil\b/gi,
];

const URL = /(?:https?:\/\/)?(?:www\.)?([\p{L}0-9-]+(?:\.[\p{L}0-9-]+)+)(?:\/[^\s]*)?/giu;
const EMOJI = /\p{Extended_Pictographic}/gu;
const CAIXA_ALTA = /\b\p{Lu}{4,}\b/gu;

/** Promessa comercial é assunto de gente; forma é forma, e o texto fixo resolve. */
const CODIGOS_QUE_EXIGEM_HUMANO: ReadonlySet<CodigoDeBloqueio> = new Set([
  'valor_nao_autorizado',
  'palavra_proibida',
  'claim_sem_base',
]);

/** Normaliza o valor para comparar com a base ("8 %" e "8%" são o mesmo). */
function normalizarValor(valor: string): string {
  return valor.replace(/\s+/g, ' ').replace(/\s*%/, '%').trim().toLowerCase();
}

function valorAutorizado(valor: string): boolean {
  const normalizado = normalizarValor(valor);
  if (VALORES_AUTORIZADOS.has(normalizado)) return true;
  // "em até 30 dias" e "30 dias" são o mesmo fato.
  const semPrefixo = normalizado.replace(/^em\s+(at[ée]\s+)?/, '');
  return VALORES_AUTORIZADOS.has(semPrefixo);
}

/** As palavras que só existem em pergunta de dinheiro que a FAQ ainda não responde. */
export function eDuvidaFinanceiraSemResposta(pergunta: string | null | undefined): boolean {
  if (!pergunta) return false;
  return TEMAS_FINANCEIROS_SEM_RESPOSTA.some((padrao) => padrao.test(pergunta));
}

/**
 * Valida um rascunho gerado por IA.
 *
 * Ordem: primeiro a dúvida financeira sem resposta (que substitui o texto inteiro e não
 * adianta continuar analisando), depois as recusas duras, depois os limites de forma.
 */
export function validarPromessas(entrada: EntradaDaValidacao): ResultadoDaValidacao {
  const limites = entrada.limites ?? LIMITES_PADRAO;
  const texto = entrada.texto;
  const motivos: MotivoDeBloqueio[] = [];

  if (eDuvidaFinanceiraSemResposta(entrada.perguntaDoParceiro)) {
    return {
      situacao: 'substituido',
      texto: FRASE_DE_ESCAPE_FINANCEIRO,
      motivos: [
        {
          codigo: 'financeiro_sem_resposta',
          trecho: entrada.perguntaDoParceiro ?? '',
          explicacao:
            'pergunta de dinheiro fora da FAQ aprovada por Dennis: só a frase de escape, e tarefa humana',
        },
      ],
    };
  }

  for (const { radical, explicacao } of PALAVRAS_PROIBIDAS) {
    const achado = radical.exec(texto);
    if (achado) {
      motivos.push({ codigo: 'palavra_proibida', trecho: achado[0], explicacao });
    }
  }

  for (const padrao of PADROES_DE_VALOR) {
    for (const achado of texto.matchAll(padrao)) {
      if (!valorAutorizado(achado[0])) {
        motivos.push({
          codigo: 'valor_nao_autorizado',
          trecho: achado[0],
          explicacao: 'número, preço ou prazo que não está na base de conhecimento',
        });
      }
    }
  }

  for (const achado of texto.matchAll(URL)) {
    const dominio = (achado[1] ?? '').toLowerCase();
    const caminho = achado[0]
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '');
    const permitido = URLS_PERMITIDAS.some((alvo) => dominio === alvo || caminho.startsWith(alvo));
    if (!permitido) {
      motivos.push({
        codigo: 'url_fora_da_lista',
        trecho: achado[0],
        explicacao: `domínio fora da lista permitida (${URLS_PERMITIDAS.join(', ')})`,
      });
    }
  }

  for (const claim of entrada.claims ?? []) {
    if (fatoPorId(claim) === undefined) {
      motivos.push({
        codigo: 'claim_sem_base',
        trecho: claim,
        explicacao: 'o rascunho afirma algo que não mapeia para nenhum fato da base',
      });
    }
  }

  if (texto.length > limites.maxCaracteres) {
    motivos.push({
      codigo: 'tamanho',
      trecho: `${texto.length} caracteres`,
      explicacao: `acima do teto de ${limites.maxCaracteres} por turno (RF-CON-24)`,
    });
  }

  const linhas = texto.split('\n').filter((linha) => linha.trim().length > 0).length;
  if (linhas > limites.maxLinhas) {
    motivos.push({
      codigo: 'tamanho',
      trecho: `${linhas} linhas`,
      explicacao: `acima do teto de ${limites.maxLinhas} linhas (R08 §5.7)`,
    });
  }

  const emojis = (texto.match(EMOJI) ?? []).length;
  if (emojis > limites.maxEmojis) {
    motivos.push({
      codigo: 'emoji_demais',
      trecho: `${emojis} emojis`,
      explicacao: `no máximo ${limites.maxEmojis} por mensagem (R08 §5.7)`,
    });
  }

  const caixaAlta = texto.match(CAIXA_ALTA) ?? [];
  // "HUMANO" é a palavra de transferência do RF-CON-26 e pode aparecer em caixa alta.
  const gritos = caixaAlta.filter((palavra) => palavra !== 'HUMANO' && palavra !== 'SAIR');
  if (gritos.length > 0) {
    motivos.push({
      codigo: 'caixa_alta',
      trecho: gritos.join(', '),
      explicacao: 'caixa alta é proibida (R08 §5.1)',
    });
  }

  if (motivos.length === 0) return { situacao: 'aprovado', texto };

  // Promessa comercial e claim sem base são assunto de gente; forma é só forma, e o
  // texto fixo do segmento resolve sem ocupar a Heloísa.
  const exigeHumano = motivos.some((motivo) => CODIGOS_QUE_EXIGEM_HUMANO.has(motivo.codigo));
  return { situacao: 'bloqueado', motivos, queda: exigeHumano ? 'humano' : 'texto_fixo' };
}
