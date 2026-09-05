import { classificarIntencaoV1 } from './prompts/classificar-intencao/v1';
import { followupLigacaoV1 } from './prompts/followup-ligacao/v1';
import { resumoLigacaoV1 } from './prompts/resumo-ligacao/v1';
import { transcricaoAudioV1 } from './prompts/transcricao-audio/v1';
import { type MetadadosDePrompt, metadadosDoPrompt, selecionar } from './nucleo/versionamento';

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
  'resumo-ligacao': { 1: resumoLigacaoV1 },
  'followup-ligacao': { 1: followupLigacaoV1 },
  'classificar-intencao': { 1: classificarIntencaoV1 },
} as const;

export type IdDePrompt = keyof typeof CATALOGO;

/** A versão em produção de cada prompt. Mudar aqui é o deploy de um prompt. */
export const VIGENTES = {
  'transcricao-audio': 1,
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

/** A versão vigente, com o tipo dela. */
export function promptVigente<Id extends IdDePrompt>(
  id: Id,
): (typeof CATALOGO)[Id][(typeof VIGENTES)[Id]] {
  return selecionar(CATALOGO, id, VIGENTES[id]);
}

/** Todas as versões publicadas, em metadados — é o que o documento de custos lê. */
export const INVENTARIO: readonly MetadadosDePrompt[] = [
  metadadosDoPrompt(transcricaoAudioV1),
  metadadosDoPrompt(resumoLigacaoV1),
  metadadosDoPrompt(followupLigacaoV1),
  metadadosDoPrompt(classificarIntencaoV1),
];
