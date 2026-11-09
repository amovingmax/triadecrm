import {
  CANAIS_DE_CHEGADA,
  ROTULO_DO_CANAL,
  ROTULO_DO_SUBCANAL,
  SUBCANAIS_POR_CANAL,
  type CanalDeChegada,
} from '@komune/schema';

import type { LinhaCanal } from './tipos';

/**
 * O painel "Canais" (06/11/2026, só Imova), a parte pura: as linhas de
 * `public.relatorio_por_canal` (uma por canal e subcanal) viram a tabela da
 * tela — o total de cada canal e, embaixo, os detalhes dele — e o resumo.
 *
 * Nenhum número é calculado aqui além de SOMA: quem conta é o banco. A soma
 * existe porque a função entrega o par (canal, subcanal) e a pergunta da
 * gestão começa pelo canal ("quantos vieram da placa?").
 */

/** Os números que a função devolve, na ordem das colunas. */
export const NUMEROS_DO_CANAL = [
  'chegadas',
  'leads_novos',
  'ja_na_base',
  'sem_ficha',
  'atendidos',
  'visitas_marcadas',
  'visitas_realizadas',
  'ganhos',
  'com_foto_da_placa',
  'com_foto_do_banner',
  'por_regra',
  'por_ia',
  'por_gente',
  'corrigidos',
] as const;

export type NumeroDoCanal = (typeof NUMEROS_DO_CANAL)[number];
export type NumerosDoCanal = Record<NumeroDoCanal, number>;

export type LinhaDoPainelDeCanais = NumerosDoCanal & {
  chave: string;
  /** `canal`: o total do canal; `detalhe`: um subcanal dele. */
  nivel: 'canal' | 'detalhe';
  /** O canal conhecido, para o ícone e a cor; `null` para valor que a tela não conhece. */
  canal: CanalDeChegada | null;
  /** O que a célula mostra: "Placa" no total, "Foto da placa" no detalhe. */
  rotulo: string;
  /** O que o arquivo leva: "Placa" no total, "Placa · Foto da placa" no detalhe. */
  rotuloCompleto: string;
  /** Parte das chegadas do período (0 a 100); `null` sem chegada nenhuma. */
  parte: number | null;
};

function zerados(): NumerosDoCanal {
  return Object.fromEntries(NUMEROS_DO_CANAL.map((n) => [n, 0])) as NumerosDoCanal;
}

function somar(alvo: NumerosDoCanal, linha: Partial<Record<NumeroDoCanal, unknown>>): void {
  for (const n of NUMEROS_DO_CANAL) {
    const v = Number(linha[n] ?? 0);
    alvo[n] += Number.isFinite(v) ? v : 0;
  }
}

function ehCanalConhecido(v: string): v is CanalDeChegada {
  return (CANAIS_DE_CHEGADA as readonly string[]).includes(v);
}

/** O rótulo de um canal que pode vir vazio (ainda lendo) ou desconhecido. */
export function rotuloDoCanalNoRelatorio(canal: string | null | undefined): string {
  if (!canal) return 'Ainda identificando';
  return ehCanalConhecido(canal) ? ROTULO_DO_CANAL[canal] : canal;
}

function rotuloDoDetalhe(subcanal: string | null | undefined): string {
  if (!subcanal) return 'Sem detalhe';
  return (ROTULO_DO_SUBCANAL as Record<string, string>)[subcanal] ?? subcanal;
}

function posicaoDoSubcanal(canal: CanalDeChegada | null, subcanal: string): number {
  if (!canal) return 99;
  const i = (SUBCANAIS_POR_CANAL[canal] as readonly string[]).indexOf(subcanal);
  return i === -1 ? 99 : i;
}

/**
 * A tabela: os cinco canais na ordem de sempre (com zero quando não vieram, porque
 * esconder a linha vazia é esconder o problema) e, debaixo de cada um que tem
 * detalhe a mostrar, uma linha por subcanal. Não identificado não tem
 * detalhe: a linha só repetiria o canal. Sem linha nenhuma no período, a tabela
 * fica vazia e o painel diz isso.
 */
export function montarLinhasDeCanais(linhas: readonly LinhaCanal[]): LinhaDoPainelDeCanais[] {
  if (linhas.length === 0) return [];

  const total = linhas.reduce((s, l) => s + (Number(l.chegadas) || 0), 0);
  const parte = (n: number) => (total > 0 ? (n * 100) / total : null);

  const porCanal = new Map<string, LinhaCanal[]>();
  for (const l of linhas) {
    const chave = l.canal ?? '';
    porCanal.set(chave, [...(porCanal.get(chave) ?? []), l]);
  }
  const desconhecidos = [...porCanal.keys()]
    .filter((c) => !ehCanalConhecido(c))
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const saida: LinhaDoPainelDeCanais[] = [];
  for (const chave of [...CANAIS_DE_CHEGADA, ...desconhecidos]) {
    const doCanal = porCanal.get(chave) ?? [];
    const canal = ehCanalConhecido(chave) ? chave : null;
    const soma = zerados();
    for (const l of doCanal) somar(soma, l);
    const rotulo = rotuloDoCanalNoRelatorio(chave);
    saida.push({
      ...soma,
      chave: `canal:${chave}`,
      nivel: 'canal',
      canal,
      rotulo,
      rotuloCompleto: rotulo,
      parte: parte(soma.chegadas),
    });

    const temDetalhe = canal === null || SUBCANAIS_POR_CANAL[canal].length > 1;
    if (!temDetalhe) continue;

    const porSub = new Map<string, NumerosDoCanal>();
    for (const l of doCanal) {
      const sub = l.subcanal ?? '';
      const acumulado = porSub.get(sub) ?? zerados();
      somar(acumulado, l);
      porSub.set(sub, acumulado);
    }
    const subs = [...porSub.keys()].sort(
      (a, b) =>
        posicaoDoSubcanal(canal, a) - posicaoDoSubcanal(canal, b) || a.localeCompare(b, 'pt-BR'),
    );
    for (const sub of subs) {
      const numeros = porSub.get(sub)!;
      const detalhe = rotuloDoDetalhe(sub);
      saida.push({
        ...numeros,
        chave: `detalhe:${chave}:${sub}`,
        nivel: 'detalhe',
        canal,
        rotulo: detalhe,
        rotuloCompleto: `${rotulo} · ${detalhe}`,
        parte: parte(numeros.chegadas),
      });
    }
  }
  return saida;
}

export type ResumoDosCanais = NumerosDoCanal & {
  /** Chegadas que terminaram sem canal (Não identificado). */
  naoIdentificado: number;
};

/** O total do período, para as tiras do alto e a linha de rodapé. */
export function resumirCanais(linhas: readonly LinhaCanal[]): ResumoDosCanais {
  const soma = zerados();
  let naoIdentificado = 0;
  for (const l of linhas) {
    somar(soma, l);
    if (l.canal === 'nao_identificado') naoIdentificado += Number(l.chegadas) || 0;
  }
  return { ...soma, naoIdentificado };
}
