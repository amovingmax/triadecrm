/**
 * `workers ai --ensaio=atendente-imova`: os cenários da IA que atende contra o modelo de
 * verdade (11/11/2026, `atendente-imova@v3`, a visita pelo link).
 *
 * Os cenários e o conferidor moram em `packages/prompts` (`cenarios-v3.ts`) e rodam sem
 * rede no `pnpm test`, com uma resposta boa escrita à mão. Este comando manda as mesmas
 * conversas ao modelo que a configuração escolheu (`ia.atendente.modelo`, o Haiku 5.5 por
 * padrão) e passa cada resposta pelo mesmo `conferirCenario`: visita com código, visita
 * sem imóvel, imóvel fora da lista, link já mandado, pediu de novo, reunião do
 * proprietário, "amanhã às 10h", só o preço, já agendou, mudou de imóvel e rascunho.
 *
 * Cada chamada passa pelo caminho de sempre (`executar`: pseudonimização, auditoria,
 * freio do orçamento, schema e a linha em `ai_runs`, sem ficha e sem conversa). Nada é
 * mandado a cliente nenhum: as conversas e a base são as do ensaio, de mentira.
 */
import {
  BASE_DO_ENSAIO,
  CENARIOS_DO_ATENDENTE_V3,
  type CenarioDoAtendente,
  type EntradaDoAtendenteV3,
  type PromptVersionado,
  type SaidaDoAtendenteV3,
  atendenteImovaV3,
  conferirCenario,
  sistemaComBaseV3,
} from '@komune/prompts';

import { modeloEscolhido } from './atendente';
import { type ContextoDaIa, executar } from './execucao';

export const ENSAIOS = ['atendente-imova'] as const;
export type Ensaio = (typeof ENSAIOS)[number];

export function eEnsaio(valor: unknown): valor is Ensaio {
  return typeof valor === 'string' && (ENSAIOS as readonly string[]).includes(valor);
}

export interface ResultadoDoCenario {
  readonly nome: string;
  /** Vazio é acerto. */
  readonly falhas: readonly string[];
  readonly saida: SaidaDoAtendenteV3 | null;
  readonly custoUsd: number;
}

export interface ResultadoDoEnsaio {
  readonly promptVersion: string;
  readonly modelo: string;
  readonly cenarios: readonly ResultadoDoCenario[];
  readonly acertos: number;
  readonly custoUsd: number;
}

export interface OpcoesDoEnsaio {
  /** Os cenários; sem nada, todos os da v3. */
  readonly cenarios?: readonly CenarioDoAtendente[];
  /** O modelo; sem nada, o da configuração. */
  readonly modelo?: string;
}

export async function ensaiarAtendente(
  contexto: ContextoDaIa,
  opcoes: OpcoesDoEnsaio = {},
): Promise<ResultadoDoEnsaio> {
  const modelo = opcoes.modelo ?? (await modeloEscolhido(contexto));
  const prompt: PromptVersionado<EntradaDoAtendenteV3, SaidaDoAtendenteV3> = {
    ...atendenteImovaV3,
    modelo: modelo as typeof atendenteImovaV3.modelo,
    sistema: sistemaComBaseV3(BASE_DO_ENSAIO),
  };
  const cenarios: ResultadoDoCenario[] = [];
  // Um de cada vez: a primeira chamada escreve o cache do bloco de sistema e as outras o
  // leem, que é como a IA roda de verdade.
  for (const cenario of opcoes.cenarios ?? CENARIOS_DO_ATENDENTE_V3) {
    try {
      const executada = await executar(
        contexto,
        prompt,
        cenario.entrada,
        { leadId: cenario.entrada.leadId, nome: null, empresa: null },
        {},
      );
      cenarios.push({
        nome: cenario.nome,
        falhas: conferirCenario(cenario, executada.saida),
        saida: executada.saida,
        custoUsd: executada.custoUsd,
      });
    } catch (erro) {
      const motivo = erro instanceof Error ? `${erro.name}: ${erro.message}` : String(erro);
      cenarios.push({
        nome: cenario.nome,
        falhas: [`a chamada falhou (${motivo.slice(0, 300)})`],
        saida: null,
        custoUsd: 0,
      });
    }
  }
  return {
    promptVersion: `${prompt.id}@v${prompt.versao}`,
    modelo,
    cenarios,
    acertos: cenarios.filter((c) => c.falhas.length === 0).length,
    custoUsd: cenarios.reduce((soma, c) => soma + c.custoUsd, 0),
  };
}

/** O relatório que o comando imprime: um cenário por linha, e o que errou embaixo. */
export function relatorioDoEnsaio(r: ResultadoDoEnsaio): string {
  const linhas = [
    `Ensaio de ${r.promptVersion} no ${r.modelo}: ${r.acertos} de ${r.cenarios.length} cenários certos`,
    '',
  ];
  for (const c of r.cenarios) {
    linhas.push(`${c.falhas.length === 0 ? '✓' : '✗'} ${c.nome}`);
    if (c.saida !== null) {
      const agenda =
        c.saida.agenda === null
          ? ''
          : ` (${c.saida.agenda.tipo}${c.saida.agenda.imovelCodigo ? ` ${c.saida.agenda.imovelCodigo}` : ''})`;
      linhas.push(`    ${c.saida.acao}${agenda}: ${c.saida.mensagem.replace(/\s+/g, ' ')}`);
    }
    for (const falha of c.falhas) linhas.push(`    → ${falha}`);
  }
  linhas.push(
    '',
    `custo do ensaio: US$ ${r.custoUsd.toFixed(6)} (as chamadas estão em ai_runs, como draft_reply)`,
    '',
  );
  return linhas.join('\n');
}
