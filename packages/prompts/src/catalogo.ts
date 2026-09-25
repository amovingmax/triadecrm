import { classificarIntencaoV1 } from './prompts/classificar-intencao/v1';
import { fichaDaConversaV1 } from './prompts/ficha-da-conversa/v1';
import { followupLigacaoV1 } from './prompts/followup-ligacao/v1';
import { pulsoDoDiaV1 } from './prompts/pulso-do-dia/v1';
import { triagemDoRadarV1 } from './prompts/triagem-do-radar/v1';
import { triagemDoRadarV2 } from './prompts/triagem-do-radar/v2';
import { resumoLigacaoV1 } from './prompts/resumo-ligacao/v1';
import { transcricaoAudioV1 } from './prompts/transcricao-audio/v1';
import {
  type CatalogoDePrompts,
  type MetadadosDePrompt,
  type PromptVersionado,
  metadadosDoPrompt,
  selecionar,
} from './nucleo/versionamento';

/** Um prompt qualquer do catálogo, sem o tipo da entrada e da saída dele. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PromptDeQualquerVersao = PromptVersionado<any, any>;

/**
 * O catálogo: id → versão → prompt.
 *
 * A ordem dos ids é a ordem de prioridade do R13, e não é alfabética por acaso:
 * transcrever o áudio que chega, resumir a ligação, redigir o follow-up e, por baixo de
 * tudo, classificar o que o parceiro escreveu.
 *
 * Publicar uma v2 é acrescentar `2: <prompt>` na linha do id. Quem chamava
 * `obterPrompt('resumo-ligacao', 1)` continua recebendo o v1, com os schemas do v1;
 * quem chama `promptVigente` passa a receber o v2 quando `VIGENTES` mudar. As duas
 * coisas mudam separadamente, e é isso que faz uma migração de prompt ser reversível.
 */
export const CATALOGO = {
  'transcricao-audio': { 1: transcricaoAudioV1 },
  'ficha-da-conversa': { 1: fichaDaConversaV1 },
  'pulso-do-dia': { 1: pulsoDoDiaV1 },
  'triagem-do-radar': { 1: triagemDoRadarV1, 2: triagemDoRadarV2 },
  'resumo-ligacao': { 1: resumoLigacaoV1 },
  'followup-ligacao': { 1: followupLigacaoV1 },
  'classificar-intencao': { 1: classificarIntencaoV1 },
} as const;

export type IdDePrompt = keyof typeof CATALOGO;

/** A versão em produção de cada prompt. Mudar aqui é o deploy de um prompt. */
export const VIGENTES = {
  'transcricao-audio': 1,
  'ficha-da-conversa': 1,
  'pulso-do-dia': 1,
  // v2 desde 25/09/2026: a v1 ensinava o modelo a devolver nome de GRUPO em
  // `categoriaSugerida` ("Locais"), e a gravação casa EXATO com o catálogo —
  // o exemplo treinava uma string que nunca casa. A v1 continua no catálogo,
  // e voltar é trocar este número.
  'triagem-do-radar': 2,
  'resumo-ligacao': 1,
  'followup-ligacao': 1,
  'classificar-intencao': 1,
} as const satisfies Record<IdDePrompt, number>;

/** Uma versão específica, com o tipo daquela versão. */
export function obterPrompt<Id extends IdDePrompt, Versao extends keyof (typeof CATALOGO)[Id]>(
  id: Id,
  versao: Versao,
): (typeof CATALOGO)[Id][Versao] {
  return selecionar(CATALOGO, id, versao);
}

/**
 * Todas as vigentes, como metadados.
 *
 * Existe porque `promptVigente(id)` com `id` de tipo união não resolve o índice
 * `CATALOGO[Id][VIGENTES[Id]]` — o TypeScript devolve `unknown`, e isso só
 * apareceu quando a primeira v2 foi publicada. Quem precisa percorrer o
 * catálogo inteiro usa esta lista; quem sabe o id usa `promptVigente`.
 */
export function vigentes(): readonly PromptDeQualquerVersao[] {
  return (Object.keys(CATALOGO) as IdDePrompt[]).map(
    (id) => promptVigente(id) as PromptDeQualquerVersao,
  );
}

/**
 * O prompt vigente de um id, com o tipo daquela versão.
 *
 * O `extends` não é cerimônia: para um `Id` GENÉRICO, `VIGENTES[Id]` é a união
 * `1 | 2` desde que existe a primeira v2, e `2` não é chave de um prompt que só
 * tem a v1. Para cada `Id` concreto o par sempre existe, e o condicional é o
 * que diz isso ao TypeScript.
 */
export type VersaoVigente<Id extends IdDePrompt> =
  (typeof VIGENTES)[Id] extends keyof (typeof CATALOGO)[Id]
    ? (typeof CATALOGO)[Id][(typeof VIGENTES)[Id]]
    : never;

/** A versão vigente, com o tipo dela. */
export function promptVigente<Id extends IdDePrompt>(id: Id): VersaoVigente<Id> {
  // A travessia é apagada e o tipo volta numa asserção só, como em `selecionar`
  // e pela mesma razão. Desde que existe uma v2, `VIGENTES[Id]` para um `Id`
  // GENÉRICO é `1 | 2`, e o TypeScript não aceita `2` como chave de um prompt
  // que só tem a v1 — embora, para cada `Id` concreto, o par sempre exista. A
  // assinatura, que é o que o chamador vê, continua exata.
  return selecionar(CATALOGO as CatalogoDePrompts, id, VIGENTES[id]) as VersaoVigente<Id>;
}

/**
 * A versão VIGENTE de cada prompt, em metadados — é o que o documento de custos
 * lê, e é por prompt, não por versão publicada: o custo do mês é o do que roda.
 * A v1 da triagem continua no CATALOGO, para voltar trocando um número.
 */
export const INVENTARIO: readonly MetadadosDePrompt[] = [
  metadadosDoPrompt(transcricaoAudioV1),
  metadadosDoPrompt(fichaDaConversaV1),
  metadadosDoPrompt(pulsoDoDiaV1),
  metadadosDoPrompt(triagemDoRadarV2),
  metadadosDoPrompt(resumoLigacaoV1),
  metadadosDoPrompt(followupLigacaoV1),
  metadadosDoPrompt(classificarIntencaoV1),
];
