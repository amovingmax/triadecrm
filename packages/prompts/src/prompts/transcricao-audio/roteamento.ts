import { type SaidaDaTranscricao } from './v1';

/**
 * O que fazer com o áudio depois de transcrito (RF-CON-27).
 *
 * A regra é do PRD e é conservadora de propósito: **no MVP, áudio recebido vai direto
 * para o humano.** A transcrição serve para a pessoa ler em 5 segundos em vez de ouvir
 * 40, não para o robô decidir sozinho. `modoMvp: false` liga o caminho da v1, em que a
 * transcrição confiável segue para o classificador.
 *
 * Fora isso, dois vetos que não dependem do modelo se declarar confiante:
 * mais de um `[inaudível]` (o buraco provavelmente comeu algo que importa) e assunto
 * de contrato, dinheiro ou reclamação, que é gatilho de escalada do R08 §5.3.
 */

export type DestinoDaTranscricao = 'classificador' | 'humano';

export interface DecisaoDaTranscricao {
  readonly destino: DestinoDaTranscricao;
  readonly motivos: readonly string[];
}

/** Acima disso, o buraco no áudio é grande demais para confiar no que sobrou. */
export const MAXIMO_DE_INAUDIVEIS = 1 as const;

export function decidirRoteamento(
  saida: SaidaDaTranscricao,
  opcoes: { readonly modoMvp: boolean },
): DecisaoDaTranscricao {
  const motivos: string[] = [];
  if (opcoes.modoMvp) motivos.push('mvp_audio_sempre_humano');
  if (saida.precisaDeHumano) motivos.push('modelo_pediu_humano');
  if (saida.confianca === 'baixa') motivos.push('confianca_baixa');
  if (saida.trechosInaudiveis > MAXIMO_DE_INAUDIVEIS) motivos.push('inaudiveis_demais');
  return { destino: motivos.length > 0 ? 'humano' : 'classificador', motivos };
}
