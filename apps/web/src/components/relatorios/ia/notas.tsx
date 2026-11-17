'use client';

import { ChartLine } from 'lucide-react';

import { cn } from '@/lib/utils';

import type { PainelProgressoIA, SemanaDaIA } from '../dados-vende';
import {
  contagem,
  contar,
  decimalFixo,
  deltaDe,
  diaMes,
  indiceDaSemana,
  lista,
  numero,
  SERIES_DA_NOTA,
  versaoCurta,
} from '../formatos-vende';
import { Cartao, Legenda, Linha, SemDado, TextoDoDelta } from '../graficos-vende';

/**
 * As três notas da avaliação diária (tirou a dúvida, informação útil, cliente
 * satisfeito), de 1 a 5, média por semana. Dono: o agente "notas".
 *
 * O desenho muda com a quantidade de semanas, porque linha com um ponto só não é
 * gráfico (era o print de 16/11/2026: um ponto encostado na esquerda e 12 semanas
 * de eixo vazio, parecendo quebrado):
 *   - nenhuma semana com nota: vazio honesto, curto;
 *   - uma semana fechada com nota (o começo da IA): cada nota como número grande numa
 *     régua de 1 a 5, com as faixas de leitura escritas (fraca, boa, ótima), a mais
 *     baixa marcada (é onde mexer) e a data em que a tendência aparece;
 *   - duas ou mais: múltiplos pequenos, um por nota, na mesma escala de 1 a 5.
 *
 * A última semana da lista é a corrente, pela metade: nunca entra na linha nem no
 * título (uma semana de 2 dias sem nota pareceria queda ou buraco). Ela aparece só
 * como texto ("em andamento"), com a nota de até agora quando já tiver.
 */

type ChaveDaNota = (typeof SERIES_DA_NOTA)[number]['chave'];
type NomeDaFaixa = 'fraca' | 'boa' | 'ótima';

/** As faixas de leitura da nota. Sempre escritas: a cor da régua é uma só. */
const FAIXAS: readonly { nome: NomeDaFaixa; de: number; ate: number }[] = [
  { nome: 'fraca', de: 1, ate: 3 },
  { nome: 'boa', de: 3, ate: 4 },
  { nome: 'ótima', de: 4, ate: 5 },
];

/** A nota como aparece na tela (uma casa): a faixa segue o número escrito, não o bruto. */
const casa = (v: number) => Math.round(v * 10) / 10;

function faixaDa(v: number): NomeDaFaixa {
  const r = casa(v);
  return r < 3 ? 'fraca' : r < 4 ? 'boa' : 'ótima';
}

/** De 1 a 5 para 0 a 100 (a posição na régua). */
const posicao = (v: number) => ((Math.max(1, Math.min(5, v)) - 1) / 4) * 100;

/** "Informação útil" vira "informação útil" no meio da frase. */
const minuscula = (texto: string) => texto.charAt(0).toLowerCase() + texto.slice(1);

/** "Tirou a dúvida" no começo da frase. */
const maiuscula = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1);

/** A segunda-feira seguinte (`AAAA-MM-DD`): o dia em que a semana corrente fecha. */
function semanaSeguinte(inicio: string): string {
  const t = Date.parse(`${inicio.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(t) ? new Date(t + 7 * 86_400_000).toISOString().slice(0, 10) : '';
}

function temNota(s: SemanaDaIA | undefined): boolean {
  return !!s && SERIES_DA_NOTA.some((serie) => numero(s[serie.chave]) !== null);
}

/** A semana corrente (a última da lista, parcial) e as fechadas com nota. */
function lerSemanas(semanas: readonly SemanaDaIA[]) {
  const iAtual = semanas.length - 1;
  const atual = iAtual >= 0 ? semanas[iAtual] : undefined;
  const fechadasComNota = semanas.flatMap((s, i) => (i < iAtual && temNota(s) ? [i] : []));
  return { iAtual, atual, fechadasComNota };
}

/** As notas, da mais baixa para a mais alta; a "mais baixa" só existe quando é única. */
function maisBaixa(notas: readonly { chave: ChaveDaNota; rotulo: string; valor: number | null }[]) {
  const com = notas.filter((n): n is { chave: ChaveDaNota; rotulo: string; valor: number } => n.valor !== null);
  if (com.length < 2) return null;
  const ordem = [...com].sort((a, b) => a.valor - b.valor);
  const [primeira, segunda] = ordem;
  if (!primeira || !segunda || casa(primeira.valor) === casa(segunda.valor)) return null;
  return primeira;
}

const AJUDA_BASE =
  'A avaliação diária lê as conversas da IA e dá três notas de 1 a 5: se ela tirou a dúvida do cliente, se a informação foi útil e se o cliente saiu satisfeito. Aqui está a média de cada semana (segunda a domingo). Leitura: abaixo de 3 é fraca, de 3 a 4 é boa, 4 ou mais é ótima. A semana em andamento fica de fora até fechar. A nota média do topo junta as três notas de cada conversa nas últimas 4 semanas, por isso pode ficar um pouco diferente da média destas três.';

// ---------------------------------------------------------------------------
// A seção
// ---------------------------------------------------------------------------

export function Notas({ dados }: { dados: PainelProgressoIA }) {
  const semanas = lista(dados.semanas);
  const { iAtual, atual, fechadasComNota } = lerSemanas(semanas);

  if (fechadasComNota.length >= 2) {
    return <NotasNaLinha dados={dados} semanas={semanas} indices={fechadasComNota} iAtual={iAtual} />;
  }

  const iDaRegua = fechadasComNota[0] ?? (temNota(atual) ? iAtual : -1);
  if (iDaRegua >= 0) {
    return <NotasNaRegua semanas={semanas} indice={iDaRegua} iAtual={iAtual} />;
  }

  return (
    <Cartao
      grande
      secao="notas"
      titulo="A avaliação diária ainda não deu nota à IA"
      sub="Três notas de 1 a 5: tirou a dúvida, informação útil e cliente satisfeito."
      ajuda={AJUDA_BASE}
    >
      <SemDado>As notas aparecem aqui depois da primeira avaliação das conversas da IA.</SemDado>
    </Cartao>
  );
}

// ---------------------------------------------------------------------------
// Uma semana com nota: a régua de 1 a 5
// ---------------------------------------------------------------------------

function NotasNaRegua({
  semanas,
  indice,
  iAtual,
}: {
  semanas: readonly SemanaDaIA[];
  indice: number;
  iAtual: number;
}) {
  const semana = semanas[indice];
  if (!semana) return null;
  const parcial = indice === iAtual;
  const atual = semanas[iAtual];
  // A nota de até agora da semana em andamento, quando a régua mostra a fechada.
  const atualComNota = !parcial && temNota(atual) ? atual : undefined;

  const notas = SERIES_DA_NOTA.map((serie) => ({ ...serie, valor: numero(semana[serie.chave]) }));
  const baixa = maisBaixa(notas);
  const conversas = contagem(semana.conversas);

  const titulo = tituloDaRegua(notas, baixa, parcial);
  const fecha = atual ? diaMes(semanaSeguinte(atual.inicio)) : '';
  const quando = parcial
    ? 'A linha semana a semana aparece quando houver duas semanas fechadas com nota.'
    : indice + 1 === iAtual && atual
      ? `A linha semana a semana aparece${fecha ? ` a partir de ${fecha}` : ''}, quando a semana de ${diaMes(atual.inicio)} fechar.`
      : 'A linha semana a semana aparece com a segunda semana fechada com nota.';

  return (
    <Cartao
      grande
      secao="notas"
      titulo={titulo}
      sub={
        parcial
          ? `Esta semana, até agora (em andamento) · ${contar(conversas, 'conversa', 'conversas')} · média de 1 a 5`
          : `Semana de ${diaMes(semana.inicio)} · ${contar(conversas, 'conversa', 'conversas')} · média de 1 a 5`
      }
      ajuda={`${AJUDA_BASE} Com uma semana só ainda não há tendência: cada nota aparece na régua de 1 a 5, e a linha semana a semana entra quando houver duas semanas fechadas.`}
    >
      <div className="grid gap-x-8 gap-y-6 md:grid-cols-3">
        {notas.map((n) => {
          const destaque = baixa?.chave === n.chave;
          const agora = atualComNota ? numero(atualComNota[n.chave]) : null;
          return (
            <figure key={n.chave} className="flex min-w-0 flex-col gap-2.5">
              <figcaption className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-semibold">{n.rotulo}</span>
                {destaque ? (
                  <span className="inline-flex h-6 items-center rounded-full bg-muted px-2 text-[11px] font-semibold">
                    a mais baixa
                  </span>
                ) : null}
              </figcaption>
              {n.valor === null ? (
                <p className="text-sm text-muted-foreground">Sem nota nesta semana.</p>
              ) : (
                <>
                  <p className="flex items-baseline gap-1.5" aria-hidden="true">
                    <span className="numerico text-[28px] leading-none font-medium tracking-[-0.02em]">
                      {decimalFixo(n.valor)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      de 5 · <span className="font-semibold text-foreground">{faixaDa(n.valor)}</span>
                    </span>
                  </p>
                  <Regua valor={n.valor} />
                  <span className="sr-only">
                    {`${n.rotulo}: ${decimalFixo(n.valor)} de 5, ${faixaDa(n.valor)}.${destaque ? ' É a mais baixa das três.' : ''}`}
                  </span>
                </>
              )}
              {atualComNota && atual ? (
                <p className="text-[11px] text-muted-foreground">
                  Semana de {diaMes(atual.inicio)} (em andamento):{' '}
                  {agora === null ? 'sem nota ainda' : <span className="numerico">{decimalFixo(agora)} até agora</span>}
                </p>
              ) : null}
            </figure>
          );
        })}
      </div>
      <p className="flex items-start gap-2 border-t border-hairline pt-3 text-xs leading-relaxed text-muted-foreground">
        <ChartLine className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        {quando}
      </p>
    </Cartao>
  );
}

/** "Informação útil é a nota mais baixa: 2,4 de 5". */
function tituloDaRegua(
  notas: readonly { rotulo: string; valor: number | null }[],
  baixa: { rotulo: string; valor: number } | null,
  parcial: boolean,
): string {
  const ate = parcial ? ' até agora' : '';
  if (baixa) return `${baixa.rotulo} é a nota mais baixa${ate}: ${decimalFixo(baixa.valor)} de 5`;
  const valores = notas.map((n) => n.valor).filter((v): v is number => v !== null);
  if (valores.length === 0) return 'A avaliação diária ainda não deu nota à IA';
  const menor = Math.min(...valores);
  const maior = Math.max(...valores);
  if (casa(menor) === casa(maior)) {
    return valores.length === 3
      ? `As três notas estão em ${decimalFixo(menor)} de 5${ate}`
      : `Nota de ${decimalFixo(menor)} de 5${ate}`;
  }
  return `Notas de ${decimalFixo(menor)} a ${decimalFixo(maior)} de 5${ate}`;
}

/**
 * A régua de 1 a 5 (um "bullet"): o trilho em três trechos, um por faixa de leitura,
 * separados por 2px de vão; o azul enche até a nota e um traço em tinta marca o ponto
 * exato. Embaixo, os números das divisas e os nomes das faixas, em texto: a leitura não
 * depende da cor. O trilho é o azul claro da mesma rampa (régua de medidor), nada de
 * branco no escuro.
 */
function Regua({ valor }: { valor: number }) {
  const v = casa(valor);
  const marcas: { texto: string; em: number; jeito: 'numero' | 'faixa' }[] = [
    { texto: '1', em: 0, jeito: 'numero' },
    { texto: 'fraca', em: 25, jeito: 'faixa' },
    { texto: '3', em: 50, jeito: 'numero' },
    { texto: 'boa', em: 62.5, jeito: 'faixa' },
    { texto: '4', em: 75, jeito: 'numero' },
    { texto: 'ótima', em: 87.5, jeito: 'faixa' },
    { texto: '5', em: 100, jeito: 'numero' },
  ];
  return (
    <div aria-hidden="true" className="flex flex-col gap-1.5">
      <div className="relative h-4">
        <div className="absolute inset-x-0 top-1/2 flex h-2.5 -translate-y-1/2 gap-0.5">
          {FAIXAS.map((f) => {
            const cheio = Math.max(0, Math.min(1, (v - f.de) / (f.ate - f.de)));
            return (
              <span
                key={f.nome}
                className={cn(
                  'relative h-full overflow-hidden bg-(--vende-azul)/15 dark:bg-(--vende-azul)/25',
                  f.de === 1 && 'rounded-l-full',
                  f.ate === 5 && 'rounded-r-full',
                )}
                style={{ flex: `${f.ate - f.de} 1 0` }}
              >
                {cheio > 0 ? (
                  <span
                    className={cn('absolute inset-y-0 left-0 bg-(--vende-azul)', cheio < 1 && 'rounded-r-[3px]')}
                    style={{ width: `${(cheio * 100).toFixed(2)}%` }}
                  />
                ) : null}
              </span>
            );
          })}
        </div>
        <span
          className="absolute top-0 h-4 w-[3px] -translate-x-1/2 rounded-full bg-foreground ring-2 ring-card"
          style={{ left: `${posicao(v).toFixed(2)}%` }}
        />
      </div>
      <div className="numerico relative h-3.5 text-[11px] leading-none text-muted-foreground">
        {marcas.map((m) => (
          <span
            key={m.texto}
            className={cn(
              'absolute top-0 whitespace-nowrap',
              m.em === 0 ? 'left-0' : m.em === 100 ? 'right-0' : '-translate-x-1/2',
              m.jeito === 'faixa' && 'tracking-tight',
            )}
            style={m.em === 0 || m.em === 100 ? undefined : { left: `${m.em}%` }}
          >
            {m.texto}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Duas ou mais semanas com nota: múltiplos pequenos
// ---------------------------------------------------------------------------

type SerieNaLinha = {
  chave: ChaveDaNota;
  rotulo: string;
  valores: (number | null)[];
  primeiro: number | null;
  ultimo: number | null;
};

function NotasNaLinha({
  dados,
  semanas,
  indices,
  iAtual,
}: {
  dados: PainelProgressoIA;
  semanas: readonly SemanaDaIA[];
  indices: readonly number[];
  iAtual: number;
}) {
  // A janela vai da primeira semana com nota até a última FECHADA: a corrente fica fora.
  const comeco = indices[0] ?? 0;
  const janela = semanas.slice(comeco, iAtual);
  const atual = semanas[iAtual];

  // As versões que entraram na mesma semana viram UMA marca ("v2 · v4"): duas marcas
  // no mesmo lugar se sobrepunham e repetiam a chave do React.
  const inicios = semanas.map((s) => s.inicio);
  const porSemana = new Map<number, string[]>();
  const naSemanaAtual: string[] = [];
  for (const v of lista(dados.versoes)) {
    const i = indiceDaSemana(inicios, v.desde);
    const nome = versaoCurta(v.versao);
    if (i < comeco || !nome) continue;
    if (i === iAtual) {
      naSemanaAtual.push(nome);
      continue;
    }
    const lugar = i - comeco;
    porSemana.set(lugar, [...(porSemana.get(lugar) ?? []), nome]);
  }
  const marcas = [...porSemana.entries()].map(([indice, nomes]) => ({ indice, rotulo: nomes.join(' · ') }));

  const series: SerieNaLinha[] = SERIES_DA_NOTA.map((serie) => {
    const valores = janela.map((s) => numero(s[serie.chave]));
    const bons = valores.filter((v): v is number => v !== null);
    return { ...serie, valores, primeiro: bons[0] ?? null, ultimo: bons[bons.length - 1] ?? null };
  });
  const atualComNota = temNota(atual) ? atual : undefined;

  const ultimaFechada = janela[janela.length - 1];
  return (
    <Cartao
      grande
      secao="notas"
      titulo={tituloDaLinha(series)}
      sub={`Média de 1 a 5 por semana, de ${diaMes(janela[0]?.inicio)} a ${diaMes(ultimaFechada?.inicio)}`}
      ajuda={`${AJUDA_BASE} Os traços verticais marcam a semana em que entrou cada versão da IA. Em cima de cada gráfico, a nota da primeira semana → a da última semana fechada.`}
    >
      <div className="grid gap-x-8 gap-y-7 md:grid-cols-3">
        {series.map((serie) => (
          <MultiploDaNota
            key={serie.chave}
            serie={serie}
            janela={janela}
            versoes={porSemana}
            agora={atualComNota ? numero(atualComNota[serie.chave]) : null}
            atual={atualComNota}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-hairline pt-3 text-xs text-muted-foreground">
        {marcas.length > 0 ? <Legenda itens={[{ rotulo: 'versão nova da IA', forma: 'tracejado' }]} /> : null}
        {atual ? (
          <p>
            Semana de {diaMes(atual.inicio)} em andamento: entra na linha quando fechar.
            {naSemanaAtual.length > 0
              ? ` ${naSemanaAtual.length > 1 ? 'As versões' : 'A'} ${naSemanaAtual.join(' e ')} ${naSemanaAtual.length > 1 ? 'entraram' : 'entrou'} nela.`
              : ''}
          </p>
        ) : null}
      </div>
    </Cartao>
  );
}

function MultiploDaNota({
  serie,
  janela,
  versoes,
  agora,
  atual,
}: {
  serie: SerieNaLinha;
  janela: readonly SemanaDaIA[];
  versoes: ReadonlyMap<number, string[]>;
  agora: number | null;
  atual: SemanaDaIA | undefined;
}) {
  const { primeiro, ultimo, valores } = serie;
  const pontosValidos = valores.filter((v) => v !== null).length;
  const delta = pontosValidos > 1 ? deltaDe(ultimo, primeiro, 'nota') : null;

  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="text-sm font-semibold">{serie.rotulo}</span>
        {ultimo !== null ? (
          <span className="inline-flex items-baseline gap-2 text-xs text-muted-foreground">
            <span>
              {pontosValidos > 1 ? (
                <>
                  <span className="numerico">{decimalFixo(primeiro)}</span>
                  <span aria-hidden="true"> → </span>
                  <span className="sr-only"> para </span>
                </>
              ) : null}
              <strong className="numerico text-[15px] font-semibold text-foreground">{decimalFixo(ultimo)}</strong>
              <span className="ml-1">{faixaDa(ultimo)}</span>
            </span>
            <TextoDoDelta delta={delta} />
          </span>
        ) : null}
      </figcaption>
      <Linha
        valores={valores}
        dominio={[1, 5]}
        altura="h-28"
        eixoY={['5', '3', '1']}
        area
        pontas
        rotuloDoFim={ultimo !== null ? decimalFixo(ultimo) : undefined}
        marcas={[...versoes.entries()].map(([indice, nomes]) => ({ indice, rotulo: nomes.join(' · ') }))}
        pontos={janela.map((s, i) => {
          const v = valores[i] ?? null;
          const entrou = versoes.get(i);
          const nota = v === null ? 'sem nota' : `${decimalFixo(v)} de 5 (${faixaDa(v)})`;
          const versao = entrou ? ` · entrou a ${entrou.join(' e a ')}` : '';
          return {
            dica: `${serie.rotulo} · semana de ${diaMes(s.inicio)}: ${nota}${versao}`,
            aria: `${serie.rotulo}, semana de ${diaMes(s.inicio)}: ${v === null ? 'sem nota' : `nota ${decimalFixo(v)} de 5, ${faixaDa(v)}`}${versao}`,
          };
        })}
      />
      <div aria-hidden="true" className="numerico ml-10 mr-10 flex justify-between text-[11px] text-muted-foreground">
        <span>{diaMes(janela[0]?.inicio)}</span>
        <span>{diaMes(janela[janela.length - 1]?.inicio)}</span>
      </div>
      {atual ? (
        <p className="text-[11px] text-muted-foreground">
          Semana de {diaMes(atual.inicio)} (em andamento):{' '}
          {agora === null ? 'sem nota ainda' : <span className="numerico">{decimalFixo(agora)} até agora</span>}
        </p>
      ) : null}
    </figure>
  );
}

/**
 * O título da linha: só as semanas fechadas, da primeira à última com nota.
 * "As três notas subiram; informação útil foi a que mais cresceu".
 */
function tituloDaLinha(series: readonly SerieNaLinha[]): string {
  const comPontas = series
    .filter((s) => s.primeiro !== null && s.ultimo !== null && s.valores.filter((v) => v !== null).length > 1)
    .map((s) => {
      const primeiro = s.primeiro as number;
      const ultimo = s.ultimo as number;
      return { rotulo: s.rotulo, primeiro, ultimo, d: casa(ultimo) - casa(primeiro) };
    });
  if (comPontas.length === 0) return 'As notas da avaliação diária, semana a semana';

  const subiram = comPontas.filter((s) => s.d >= 0.1).sort((a, b) => b.d - a.d);
  const cairam = comPontas.filter((s) => s.d <= -0.1).sort((a, b) => a.d - b.d);
  const todas = comPontas.length;
  const tres = todas === 3 ? 'As três notas' : 'As notas';

  const maior = subiram[0];
  const pior = cairam[0];
  if (maior && subiram.length === todas) {
    return subiram.length > 1 && casa(maior.d) !== casa(subiram[1]?.d ?? 0)
      ? `${tres} subiram; ${minuscula(maior.rotulo)} foi a que mais cresceu`
      : `${tres} subiram`;
  }
  if (pior && cairam.length === todas) {
    return cairam.length > 1 && casa(pior.d) !== casa(cairam[1]?.d ?? 0)
      ? `${tres} caíram; ${minuscula(pior.rotulo)} foi a que mais caiu`
      : `${tres} caíram`;
  }
  if (maior && pior) {
    return `${maiuscula(maior.rotulo)} subiu para ${decimalFixo(maior.ultimo)}; ${minuscula(pior.rotulo)} caiu para ${decimalFixo(pior.ultimo)}`;
  }
  if (maior) {
    return `${maiuscula(maior.rotulo)} subiu de ${decimalFixo(maior.primeiro)} para ${decimalFixo(maior.ultimo)}; as outras ficaram estáveis`;
  }
  if (pior) {
    return `${maiuscula(pior.rotulo)} caiu de ${decimalFixo(pior.primeiro)} para ${decimalFixo(pior.ultimo)}; as outras ficaram estáveis`;
  }
  const baixa = maisBaixa(series.map((s) => ({ chave: s.chave, rotulo: s.rotulo, valor: s.ultimo })));
  return baixa
    ? `Notas estáveis; ${minuscula(baixa.rotulo)} é a mais baixa (${decimalFixo(baixa.valor)})`
    : 'As três notas ficaram estáveis';
}
