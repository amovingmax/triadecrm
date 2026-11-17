'use client';

import { useQuery } from '@tanstack/react-query';

import { carregarPainelIA, type PainelProgressoIA } from '../dados-vende';
import { diaMes, diaMesAno } from '../formatos-vende';
import { MolduraDaAba } from '../graficos-vende';
import type { DefinicaoPainel } from '../tipos';

import { Lacunas } from './lacunas';
import { Notas } from './notas';
import { NumerosDaIA } from './numeros';
import { Passagem } from './passagem';
import { ResultadosDaIA } from './resultados';
import { ResumoDaIA, tempoDaIA } from './resumo';
import { Versoes } from './versoes';

/**
 * Progresso da IA (09/11/2026; topo e ordem refeitos em 16/11/2026): desde que a IA
 * começou, semana a semana. Sem barra de período: a régua é "desde o começo", e os
 * números do topo são as últimas 4 semanas (contra as 4 anteriores, quando a IA já
 * existia nelas).
 *
 * Lê `relatorio_imova_painel_ia()` (`dados-vende.ts`).
 */
export function PainelVendeIA({ painel }: { painel: DefinicaoPainel }) {
  const consulta = useQuery({ queryKey: ['relatorios', 'vende-ia'], queryFn: carregarPainelIA });
  const dados = consulta.data ?? null;

  return (
    <MolduraDaAba
      // A descrição longa de `tipos.ts` repetia a lista de seções que o resumo e os
      // títulos já dizem; aqui ela fica numa linha. (`tipos.ts` não muda: a definição
      // continua a mesma para quem mais a lê.)
      painel={{ ...painel, descricao: 'Semana a semana: o que a IA entrega e o que ainda falta.' }}
      consulta={consulta}
      tiras={5}
      apoio={dados ? apoioDaAba(dados) : null}
    >
      {(d) => <Conteudo dados={d} />}
    </MolduraDaAba>
  );
}

/**
 * A linha de apoio, à direita do título: desde quando e o recorte dos números. Nas
 * primeiras 8 semanas diz quando a comparação com as 4 anteriores começa, em vez de
 * comparar com um tempo em que a IA não estava ligada.
 *
 * É uma função que devolve o `<p>`, e não um componente: a moldura só parte em chips o
 * parágrafo que chega direto (`ApoioEmChips`, em `graficos-vende.tsx`).
 */
function apoioDaAba(dados: PainelProgressoIA) {
  const tempo = tempoDaIA(dados);
  if (!tempo || !dados.desde) return null;
  return (
    <p className="numerico text-xs leading-relaxed text-muted-foreground md:text-right">
      Desde {diaMesAno(dados.desde)} · números das últimas 4 semanas
      <br />
      {tempo.compara
        ? 'comparados com as 4 semanas anteriores'
        : `comparação com as 4 anteriores a partir de ${diaMes(tempo.comparaEm)}`}
    </p>
  );
}

/**
 * A ordem e a grade das seções. Cada seção mora no seu arquivo (`ia/*.tsx`) e recebe o
 * painel inteiro. Dono: o agente "topo da aba IA".
 *
 * O topo (resumo + números) é um bloco só, mais junto; as seções vêm depois, na ordem
 * de leitura de quem decide:
 *   1. Resultados — o que a IA entrega (cliente mais interessado, resolve sozinha,
 *      visitas): a resposta a "está valendo a pena?";
 *   2. Notas — a qualidade, que explica o resultado;
 *   3. Lacunas | Versões — o que ainda falta (à esquerda: é a ação) ao lado do que
 *      cada versão já mudou (o histórico, contexto da ação);
 *   4. Passagem — onde a IA depende da equipe: fecha a aba com a parte que é das
 *      pessoas, não da IA.
 * As larguras são as combinadas com as seções: Resultados, Notas e Passagem em
 * largura inteira; Lacunas e Versões meia largura cada no computador. A grade estica
 * os dois da mesma linha à mesma altura (nada de buraco embaixo do mais baixo).
 */
function Conteudo({ dados }: { dados: PainelProgressoIA }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <ResumoDaIA dados={dados} />
        <NumerosDaIA dados={dados} />
      </div>
      <div className="flex flex-col gap-4">
        <ResultadosDaIA dados={dados} />
        <Notas dados={dados} />
        <div className="grid gap-4 lg:grid-cols-2">
          <Lacunas dados={dados} />
          <Versoes dados={dados} />
        </div>
        <Passagem dados={dados} />
      </div>
    </div>
  );
}
