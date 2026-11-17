'use client';

import { useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

import type { PainelProgressoIA, SemanaDaIA } from '../dados-vende';
import { contagem, contar, diaCivil, diaMes, inteiro, lista, numero, pct } from '../formatos-vende';
import { ALVO, COR, Cartao, Dica, SemDado, type Cor } from '../graficos-vende';

/**
 * O resultado das conversas: o interesse antes e depois, o que a IA resolve sozinha e as
 * visitas que ela marca. Dono: o agente "resultados".
 *
 * Desenho (16/11/2026):
 *   - três cartões IGUAIS lado a lado (no tablet, o interesse em cima e os outros dois
 *     embaixo), e cada cartão com as mesmas três faixas: cabeçalho, a figura e a legenda.
 *     As faixas são linhas de uma grade compartilhada (`subgrid`), então o gráfico e a
 *     legenda ficam na mesma altura nos três, sem buraco;
 *   - sem número grande aqui: os números grandes são os do topo da aba (`numeros.tsx`,
 *     as últimas 4 semanas). Cada cartão conclui no título e mostra a forma; a contagem
 *     que ajuda a ler ("8 conversas", "4 de 8") vai no subtítulo, na legenda ou na dica;
 *   - a última semana da lista é a corrente, pela metade (o banco gera as semanas até a
 *     segunda-feira de hoje): aparece tracejada, com "esta semana" no eixo, e não entra
 *     em título nem em conclusão;
 *   - com uma semana só de dado não há gráfico de semanas: o interesse e as resolvidas
 *     viram uma barra de proporção (o todo dividido em partes) e a frase diz quando a
 *     evolução aparece; visita zero é um vazio honesto, sem eixo vazio;
 *   - com duas semanas ou mais, os três gráficos dividem o mesmo eixo de semanas (as
 *     mesmas fatias, a mesma calha do eixo y), para uma semana cair no mesmo lugar nos
 *     três cartões. Coluna com largura máxima de 24px: poucas semanas não viram parede;
 *   - cor com função: subiu azul, igual cinza, caiu vermelho (a paleta validada de
 *     `graficos-vende.tsx`); a IA (resolvidas, visitas recentes) em azul, o resto em
 *     cinza. Nada só por cor: legenda sempre, leitura por extenso no `sr-only` e a dica
 *     de cada semana no mouse e no foco do teclado.
 */
export function ResultadosDaIA({ dados }: { dados: PainelProgressoIA }) {
  const semanas = lista(dados.semanas);
  const desde = dados.desde ?? null;
  // Sem semana nenhuma (a IA ligada sem nada medido) os cartões só têm o recado:
  // a grade compartilhada só sobraria em vãos vazios.
  const alinhado = semanas.length > 0 ? ALINHADO : undefined;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <Interesse semanas={semanas} desde={desde} className={cn(alinhado, 'md:col-span-2 lg:col-span-1')} />
      <Resolvidas semanas={semanas} desde={desde} className={alinhado} />
      <VisitasDaIA semanas={semanas} desde={desde} className={alinhado} />
    </div>
  );
}

/**
 * Cada cartão ocupa 3 linhas da grade do pai e as herda (`subgrid`): cabeçalho, figura e
 * legenda alinham entre os cartões vizinhos. O cabeçalho do `Cartao` encosta o título
 * embaixo (`items-end`); aqui ele sobe, para os títulos começarem na mesma linha.
 */
const ALINHADO = 'md:row-span-3 md:grid md:grid-rows-subgrid md:[&>header]:items-start';

// ---------------------------------------------------------------------------
// Leitura das semanas
// ---------------------------------------------------------------------------

type Ponto = { indice: number; valor: number; parcial: boolean };

/** As semanas com valor, da mais antiga para a atual. A última da lista é a corrente. */
function pontosDe(valores: readonly (number | null)[]): Ponto[] {
  const corrente = valores.length - 1;
  return valores.flatMap((v, i) => (v === null ? [] : [{ indice: i, valor: v, parcial: i === corrente }]));
}

/** A última semana completa com valor; a corrente (parcial) só quando não há outra. */
function ultimoQueVale(pontos: readonly Ponto[]): Ponto | null {
  const completas = pontos.filter((p) => !p.parcial);
  return completas[completas.length - 1] ?? pontos[pontos.length - 1] ?? null;
}

/** A primeira semana completa com valor (o "no começo" do título). */
function primeiroQueVale(pontos: readonly Ponto[]): Ponto | null {
  return pontos.find((p) => !p.parcial) ?? pontos[0] ?? null;
}

/**
 * A lista começa na semana em que a IA começou? Com mais de 12 semanas o banco corta o
 * começo, e aí "na 1ª semana" seria mentira: vira "em 24/08".
 */
function listaDesdeOComeco(semanas: readonly SemanaDaIA[], desde: string | null): boolean {
  const dia = diaCivil(desde);
  const primeira = semanas[0]?.inicio;
  return !!dia && !!primeira && dia >= primeira;
}

/** "na 1ª semana", "na semana de 09/11", "nesta semana (parcial)". */
function naSemana(semanas: readonly SemanaDaIA[], p: Ponto, desde: string | null): string {
  if (p.parcial) return 'nesta semana (parcial)';
  if (p.indice === 0 && listaDesdeOComeco(semanas, desde)) return 'na 1ª semana';
  return `na semana de ${diaMes(semanas[p.indice]?.inicio)}`;
}

/**
 * "na última semana" (a semana fechada logo antes da corrente) ou "na semana de 26/10".
 * O título dos cartões com semanas diz SEMPRE de que semana é o número: os números do
 * topo são as últimas 4 semanas, e "62%" aqui ao lado de "61%" lá em cima, sem dizer
 * a janela, parecia contradição (revisão de 16/11/2026).
 */
function naUltima(semanas: readonly SemanaDaIA[], p: Ponto): string {
  if (p.parcial) return 'nesta semana (parcial)';
  return p.indice === semanas.length - 2 ? 'na última semana' : `na semana de ${diaMes(semanas[p.indice]?.inicio)}`;
}

/** "semana de 02/11" ou "esta semana (parcial)". */
function rotuloDaSemana(semanas: readonly SemanaDaIA[], p: Ponto): string {
  return p.parcial ? 'esta semana (parcial)' : `semana de ${diaMes(semanas[p.indice]?.inicio)}`;
}

/** "Semana de 02/11" ou "Esta semana (09/11, parcial)": o começo da dica de cada semana. */
function quandoNaDica(s: SemanaDaIA, parcial: boolean): string {
  return parcial ? `Esta semana (${diaMes(s.inicio)}, parcial)` : `Semana de ${diaMes(s.inicio)}`;
}

const maiuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

// ---------------------------------------------------------------------------
// Títulos-conclusão (versões locais; ver o relatório do agente)
// ---------------------------------------------------------------------------

/**
 * "Mais clientes saem interessados: 16% no começo, 32% na última semana". Com uma
 * semana só: "Na 1ª semana, ninguém saiu mais interessado; 25% saíram menos".
 */
function tituloDoInteresse(semanas: readonly SemanaDaIA[], desde: string | null): string {
  const pontos = pontosDe(semanas.map((s) => numero(s.subiu_pct)));
  const ultimo = ultimoQueVale(pontos);
  const primeiro = primeiroQueVale(pontos);
  if (!ultimo || !primeiro) return 'Ainda sem avaliação do interesse';
  const subiu = Math.round(ultimo.valor);
  if (primeiro.indice === ultimo.indice) {
    const quando = maiuscula(naSemana(semanas, ultimo, desde));
    const caiu = Math.round(numero(semanas[ultimo.indice]?.caiu_pct) ?? 0);
    if (subiu === 0) {
      return caiu > 0
        ? `${quando}, ninguém saiu mais interessado; ${caiu}% saíram menos`
        : `${quando}, ninguém saiu mais interessado`;
    }
    return `${quando}, ${subiu}% saíram mais interessados`;
  }
  const antes = Math.round(primeiro.valor);
  const comeco = listaDesdeOComeco(semanas, desde) && primeiro.indice === 0 ? 'no começo' : `em ${diaMes(semanas[primeiro.indice]?.inicio)}`;
  const agora = naUltima(semanas, ultimo);
  if (subiu > antes) return `Mais clientes saem interessados: ${antes}% ${comeco}, ${subiu}% ${agora}`;
  if (subiu < antes) return `Menos clientes saem interessados: ${antes}% ${comeco}, ${subiu}% ${agora}`;
  return `${subiu}% saem mais interessados ${agora}, como ${comeco}`;
}

/**
 * "Na última semana, resolveu sozinha 62% das conversas" (o mesmo jeito da 1ª semana:
 * "Na 1ª semana, resolveu sozinha metade das conversas"). A versão antiga de
 * `formatos-vende.ts` chamava 50% de "mais da metade"; aqui 50% é "metade" (pelo
 * número arredondado, o mesmo que aparece na tela).
 */
function tituloDasResolvidas(semanas: readonly SemanaDaIA[], desde: string | null): string {
  const pontos = pontosDe(semanas.map((s) => numero(s.resolvidas_pct)));
  const ultimo = ultimoQueVale(pontos);
  if (!ultimo) return 'Ainda sem conversas atendidas pela IA';
  const v = Math.round(ultimo.valor);
  if (pontos.filter((p) => !p.parcial).length <= 1) {
    const quando = maiuscula(naSemana(semanas, ultimo, desde));
    if (v === 50) return `${quando}, resolveu sozinha metade das conversas`;
    if (v > 50) return `${quando}, resolveu sozinha mais da metade das conversas`;
    return `${quando}, resolveu sozinha ${v}% das conversas`;
  }
  const quando = maiuscula(naUltima(semanas, ultimo));
  if (v === 50) return `${quando}, resolveu sozinha metade das conversas`;
  return `${quando}, resolveu sozinha ${v}% das conversas`;
}

/** "Marcou 5 visitas na última semana completa; começou com 2". Zero é zero. */
function tituloDasVisitas(semanas: readonly SemanaDaIA[], desde: string | null): string {
  const total = semanas.reduce((s, w) => s + contagem(w.visitas), 0);
  if (total === 0) return 'A IA ainda não marcou visita';
  const completas = semanas.slice(0, -1);
  const ultima = completas[completas.length - 1];
  if (!ultima) return `Marcou ${contar(total, 'visita', 'visitas')} nesta semana (parcial)`;
  const v = contagem(ultima.visitas);
  if (completas.length === 1) {
    return listaDesdeOComeco(semanas, desde)
      ? `Marcou ${contar(v, 'visita', 'visitas')} na 1ª semana`
      : `Marcou ${contar(v, 'visita', 'visitas')} na semana de ${diaMes(ultima.inicio)}`;
  }
  const frase = `Marcou ${contar(v, 'visita', 'visitas')} na última semana completa`;
  const primeiro = contagem(completas[0]?.visitas);
  if (primeiro === v) return frase;
  return listaDesdeOComeco(semanas, desde)
    ? `${frase}; começou com ${inteiro(primeiro)}`
    : `${frase}; eram ${inteiro(primeiro)} em ${diaMes(completas[0]?.inicio)}`;
}

// ---------------------------------------------------------------------------
// Interesse
// ---------------------------------------------------------------------------

function Interesse({
  semanas,
  desde,
  className,
}: {
  semanas: readonly SemanaDaIA[];
  desde: string | null;
  className?: string;
}) {
  const pontos = pontosDe(semanas.map((s) => numero(s.subiu_pct)));
  const ultimo = ultimoQueVale(pontos);
  const primeiro = primeiroQueVale(pontos);
  const ajuda =
    'A avaliação diária lê cada conversa da IA e compara o interesse do cliente no começo e no fim: subiu, ficou igual ou caiu. A porcentagem é sobre as conversas avaliadas na semana. A semana corrente ainda está pela metade e não entra na conclusão.';

  if (!ultimo || !primeiro) {
    return (
      <Cartao secao="interesse" titulo="Ainda sem avaliação do interesse" ajuda={ajuda} className={className}>
        <SemDado>Aparece depois que a avaliação diária ler as primeiras conversas da IA.</SemDado>
      </Cartao>
    );
  }

  const semana = semanas[ultimo.indice];
  const subiu = numero(semana?.subiu_pct) ?? 0;
  const igual = numero(semana?.igual_pct) ?? 0;
  const caiu = numero(semana?.caiu_pct) ?? 0;
  const conversas = contar(contagem(semana?.conversas), 'conversa', 'conversas');
  const comTendencia = pontos.length >= 2;

  return (
    <Cartao
      secao="interesse"
      titulo={tituloDoInteresse(semanas, desde)}
      sub={
        comTendencia
          ? 'Antes e depois da conversa, por semana'
          : `${maiuscula(rotuloDaSemana(semanas, ultimo))} · ${conversas} com a IA`
      }
      ajuda={ajuda}
      className={className}
    >
      {comTendencia ? (
        <>
          <div>
            <ColunasDoInteresse semanas={semanas} />
            <p className="sr-only">
              Interesse por semana, da mais antiga para a atual:{' '}
              {semanas
                .map((s, i) => {
                  const sub = numero(s.subiu_pct);
                  const quando = i === semanas.length - 1 ? `esta semana, parcial` : `semana de ${diaMes(s.inicio)}`;
                  return sub === null
                    ? `${quando}, sem avaliação`
                    : `${quando}, subiu ${pct(sub)}, igual ${pct(s.igual_pct)}, caiu ${pct(s.caiu_pct)}`;
                })
                .join('; ')}
              .
            </p>
          </div>
          <Chaves
            itens={[
              { rotulo: 'Subiu', cor: 'subiu' },
              { rotulo: 'Igual', cor: 'igual' },
              { rotulo: 'Caiu', cor: 'caiu' },
              { rotulo: 'Parcial', forma: 'parcial' },
            ]}
          />
        </>
      ) : (
        <>
          <BarraDoTodo
            rotulo={`Interesse ${rotuloDaSemana(semanas, ultimo)}`}
            partes={[
              { rotulo: 'Subiu', valor: subiu, cor: 'subiu' },
              { rotulo: 'Igual', valor: igual, cor: 'igual' },
              { rotulo: 'Caiu', valor: caiu, cor: 'caiu' },
            ]}
          />
          <div className="flex flex-col gap-2">
            <Chaves
              itens={[
                { rotulo: 'Subiu', valor: pct(subiu), cor: 'subiu' },
                { rotulo: 'Igual', valor: pct(igual), cor: 'igual' },
                { rotulo: 'Caiu', valor: pct(caiu), cor: 'caiu' },
              ]}
            />
            <Nota>A evolução por semana aparece a partir da 2ª semana avaliada.</Nota>
          </div>
        </>
      )}
    </Cartao>
  );
}

/** As colunas 100% empilhadas: caiu em cima, igual no meio, subiu na base (cresce do chão). */
function ColunasDoInteresse({ semanas }: { semanas: readonly SemanaDaIA[] }) {
  const [ativa, setAtiva] = useState<string | null>(null);
  const corrente = semanas.length - 1;

  return (
    <Quadro semanas={semanas} eixoY={['100%', '50%', '0']}>
      {semanas.map((s, i) => {
        const subiu = numero(s.subiu_pct);
        const parcial = i === corrente;
        const quando = quandoNaDica(s, parcial);
        const conversas = contar(contagem(s.conversas), 'conversa', 'conversas');
        const leitura =
          subiu === null ? 'sem avaliação ainda' : `subiu ${pct(subiu)} · igual ${pct(s.igual_pct)} · caiu ${pct(s.caiu_pct)}`;
        const segmentos = (
          [
            { valor: numero(s.caiu_pct) ?? 0, cor: 'caiu' },
            { valor: numero(s.igual_pct) ?? 0, cor: 'igual' },
            { valor: subiu ?? 0, cor: 'subiu' },
          ] as const
        ).filter((g) => g.valor > 0);
        return (
          <Dica
            key={s.inicio}
            texto={
              <>
                <strong>{quando}</strong> · {conversas}
                <br />
                {leitura}
              </>
            }
          >
            <button
              type="button"
              aria-label={`${quando}, ${conversas}: ${leitura.replaceAll(' · ', ', ')}`}
              onMouseEnter={() => setAtiva(s.inicio)}
              onMouseLeave={() => setAtiva(null)}
              onFocus={() => setAtiva(s.inicio)}
              onBlur={() => setAtiva(null)}
              className={cn(
                ALVO,
                'flex h-full min-w-0 flex-1 items-end justify-center transition-opacity',
                ativa !== null && ativa !== s.inicio && 'opacity-55',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  LARGURA_DA_COLUNA,
                  'flex h-full flex-col justify-end gap-0.5',
                  parcial && 'rounded-t-[4px] border border-dashed border-(--vende-traco) p-px',
                )}
              >
                {segmentos.length === 0 && !parcial ? <span className="h-px w-full bg-border" /> : null}
                {segmentos.map((g, k) => (
                  <span
                    key={g.cor}
                    className={cn('w-full', COR[g.cor], k === 0 && 'rounded-t-[3px]', parcial && 'opacity-45')}
                    style={{ height: `calc(${g.valor.toFixed(2)}% - 2px)` }}
                  />
                ))}
              </span>
            </button>
          </Dica>
        );
      })}
    </Quadro>
  );
}

// ---------------------------------------------------------------------------
// Resolvidas sem a equipe
// ---------------------------------------------------------------------------

function Resolvidas({
  semanas,
  desde,
  className,
}: {
  semanas: readonly SemanaDaIA[];
  desde: string | null;
  className?: string;
}) {
  const valores = semanas.map((s) => numero(s.resolvidas_pct));
  const pontos = pontosDe(valores);
  const ultimo = ultimoQueVale(pontos);
  const primeiro = primeiroQueVale(pontos);
  const ajuda =
    'Das conversas em que a IA respondeu na semana, quantas ela terminou sem passar para alguém da equipe. A linha do meio do gráfico é a metade (50%). A semana corrente ainda está pela metade.';

  if (!ultimo || !primeiro) {
    return (
      <Cartao secao="resolvidas" titulo="Ainda sem conversas atendidas pela IA" ajuda={ajuda} className={className}>
        <SemDado>Aparece quando a IA responder as primeiras conversas.</SemDado>
      </Cartao>
    );
  }

  const quantas = quantasResolvidas(semanas[ultimo.indice]);
  const comTendencia = pontos.length >= 2;
  const parcialComValor = valores[valores.length - 1] !== null && comTendencia;

  return (
    <Cartao
      secao="resolvidas"
      titulo={tituloDasResolvidas(semanas, desde)}
      sub={
        comTendencia
          ? 'Terminadas sem a equipe, por semana'
          : quantas
            ? `${maiuscula(rotuloDaSemana(semanas, ultimo))} · ${quantas} sem a equipe`
            : `${maiuscula(rotuloDaSemana(semanas, ultimo))} · terminadas sem a equipe`
      }
      ajuda={ajuda}
      className={className}
    >
      {comTendencia ? (
        <>
          <div>
            <LinhaDasResolvidas semanas={semanas} valores={valores} />
            <p className="sr-only">
              Resolvidas sem a equipe, por semana, da mais antiga para a atual:{' '}
              {semanas
                .map((s, i) => {
                  const quando = i === semanas.length - 1 ? 'esta semana, parcial' : `semana de ${diaMes(s.inicio)}`;
                  return `${quando}, ${valores[i] === null ? 'sem dado' : pct(valores[i])}`;
                })
                .join('; ')}
              .
            </p>
          </div>
          <Chaves
            itens={[
              { rotulo: 'Resolvidas sem a equipe', cor: 'azul', forma: 'linha' },
              ...(parcialComValor ? [{ rotulo: 'Parcial', forma: 'parcial-linha' as const }] : []),
            ]}
          />
        </>
      ) : (
        <>
          <BarraDoTodo
            rotulo={`Conversas ${rotuloDaSemana(semanas, ultimo)}`}
            partes={[
              { rotulo: 'Sem a equipe', valor: ultimo.valor, cor: 'azul' },
              { rotulo: 'Passou para a equipe', valor: 100 - ultimo.valor, cor: 'resto' },
            ]}
          />
          <div className="flex flex-col gap-2">
            <Chaves
              itens={[
                { rotulo: 'Sem a equipe', valor: pct(ultimo.valor), cor: 'azul' },
                { rotulo: 'Passou para a equipe', valor: pct(100 - ultimo.valor), cor: 'resto' },
              ]}
            />
            <Nota>A linha por semana aparece a partir da 2ª semana com conversas.</Nota>
          </div>
        </>
      )}
    </Cartao>
  );
}

/**
 * "25 de 40 conversas": a conta do banco é resolvidas ÷ conversas em que a IA falou na
 * semana, então a contagem sai da porcentagem e do total. Nulo sem conversa ou sem valor.
 */
function quantasResolvidas(s: SemanaDaIA | undefined): string | null {
  const v = numero(s?.resolvidas_pct);
  const total = contagem(s?.conversas);
  if (v === null || total === 0) return null;
  return `${inteiro(Math.round((v / 100) * total))} de ${contar(total, 'conversa', 'conversas')}`;
}

/**
 * A linha das resolvidas, de 0 a 100% (o mesmo eixo do interesse ao lado: a escala
 * inteira não exagera a subida, e a linha do meio é a metade). Os pontos ficam no meio
 * da fatia de cada semana, como as colunas dos vizinhos. A semana corrente, quando tem
 * valor, liga tracejada e com o ponto vazio.
 */
function LinhaDasResolvidas({
  semanas,
  valores,
}: {
  semanas: readonly SemanaDaIA[];
  valores: readonly (number | null)[];
}) {
  const n = valores.length;
  const corrente = n - 1;
  const xDe = (i: number) => ((i + 0.5) / n) * 100;
  const yDe = (v: number) => 100 - Math.max(0, Math.min(100, v));
  const pontos = valores.map((v, i) => (v === null ? null : { x: xDe(i), y: yDe(v) }));

  // Os trechos firmes (semanas completas seguidas); buraco quebra a linha.
  const trechos: { x: number; y: number }[][] = [];
  let atual: { x: number; y: number }[] = [];
  pontos.forEach((p, i) => {
    if (p && i !== corrente) {
      atual.push(p);
    } else if (atual.length > 0) {
      trechos.push(atual);
      atual = [];
    }
  });
  if (atual.length > 0) trechos.push(atual);

  const firmes = pontos.flatMap((p, i) => (p && i !== corrente ? [i] : []));
  const ultimoFirme = firmes[firmes.length - 1];
  const pontoParcial = pontos[corrente];
  const pontoAntes = ultimoFirme !== undefined && ultimoFirme === corrente - 1 ? pontos[ultimoFirme] : null;
  const isolados = new Set(trechos.filter((t) => t.length === 1).map((t) => t[0]?.x));
  const texto = (t: readonly { x: number; y: number }[]) => t.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');

  return (
    <Quadro semanas={semanas} eixoY={['100%', '50%', '0']}>
      <svg
        aria-hidden="true"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      >
        {trechos.map((t, k) =>
          t.length > 1 ? (
            <polygon
              key={`a${k}`}
              points={`${t[0]?.x.toFixed(2)},100 ${texto(t)} ${t[t.length - 1]?.x.toFixed(2)},100`}
              className="fill-(--vende-azul)/10"
            />
          ) : null,
        )}
        {trechos.map((t, k) =>
          t.length > 1 ? (
            <polyline
              key={`l${k}`}
              points={texto(t)}
              fill="none"
              className="stroke-(--vende-azul)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ) : null,
        )}
        {pontoAntes && pontoParcial ? (
          <line
            x1={pontoAntes.x}
            y1={pontoAntes.y}
            x2={pontoParcial.x}
            y2={pontoParcial.y}
            className="stroke-(--vende-azul)"
            strokeWidth={2}
            strokeDasharray="3 3"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>
      {semanas.map((s, i) => {
        const p = pontos[i];
        const parcial = i === corrente;
        const quando = quandoNaDica(s, parcial);
        const quantas = quantasResolvidas(s);
        const leitura =
          valores[i] === null
            ? 'sem dado'
            : `${pct(valores[i])} resolvidas sem a equipe${quantas ? ` (${quantas})` : ''}`;
        const sempreVisivel = i === ultimoFirme || parcial || (!!p && isolados.has(p.x));
        return (
          <Dica key={s.inicio} texto={`${quando}: ${leitura}`}>
            <button
              type="button"
              aria-label={`${quando}: ${leitura}`}
              className={cn(ALVO, 'group/ponto relative h-full min-w-0 flex-1')}
            >
              {p ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full',
                    parcial
                      ? 'size-2.5 border-2 border-(--vende-azul) bg-card'
                      : cn(COR.azul, 'ring-2 ring-card', i === ultimoFirme ? 'size-2.5' : 'size-2'),
                    !sempreVisivel && 'opacity-0 group-hover/ponto:opacity-100 group-focus-visible/ponto:opacity-100',
                  )}
                  style={{ top: `${p.y.toFixed(2)}%` }}
                />
              ) : null}
            </button>
          </Dica>
        );
      })}
    </Quadro>
  );
}

// ---------------------------------------------------------------------------
// Visitas marcadas pela IA
// ---------------------------------------------------------------------------

function VisitasDaIA({
  semanas,
  desde,
  className,
}: {
  semanas: readonly SemanaDaIA[];
  desde: string | null;
  className?: string;
}) {
  const valores = semanas.map((s) => contagem(s.visitas));
  const total = valores.reduce((s, v) => s + v, 0);
  const ajuda =
    'Conta as visitas que a própria IA marcou na agenda (não as marcadas pela equipe), na semana em que foram marcadas. As 4 últimas semanas completas ficam em destaque; a semana corrente ainda está pela metade.';

  if (semanas.length === 0) {
    return (
      <Cartao secao="visitas-ia" titulo="A IA ainda não marcou visita" ajuda={ajuda} className={className}>
        <SemDado>As visitas que ela marcar aparecem aqui, semana a semana.</SemDado>
      </Cartao>
    );
  }

  if (total === 0) {
    // Zero honesto: desde quando, e quando o gráfico aparece. Sem eixo vazio e sem o "0"
    // gigante (o número do topo da aba já mostra o zero).
    return (
      <Cartao
        secao="visitas-ia"
        titulo={tituloDasVisitas(semanas, desde)}
        sub="Marcadas pela própria IA na agenda"
        ajuda={ajuda}
        className={className}
      >
        {/* Duas frases em duas faixas, como os vizinhos: o fato na altura da figura, o
            "quando aparece" na altura da linha final. */}
        <p className="text-[13px] leading-snug text-muted-foreground">
          {desde ? `Nenhuma desde ${diaMes(desde)}, quando a IA começou.` : 'Nenhuma visita marcada ainda.'}
        </p>
        <Nota>O gráfico por semana aparece com a primeira visita marcada.</Nota>
      </Cartao>
    );
  }

  const corrente = semanas.length - 1;

  return (
    <Cartao
      secao="visitas-ia"
      titulo={tituloDasVisitas(semanas, desde)}
      sub="Por semana · as 4 últimas em destaque"
      ajuda={ajuda}
      className={className}
    >
      <div>
        <ColunasDasVisitas semanas={semanas} valores={valores} />
        <p className="sr-only">
          Visitas marcadas pela IA, por semana, da mais antiga para a atual:{' '}
          {semanas
            .map((s, i) => `${i === corrente ? 'esta semana, parcial' : `semana de ${diaMes(s.inicio)}`}, ${inteiro(valores[i])}`)
            .join('; ')}
          .
        </p>
      </div>
      <Chaves
        itens={[
          { rotulo: '4 últimas semanas', cor: 'azul' },
          { rotulo: 'Antes', cor: 'resto' },
          { rotulo: 'Parcial', forma: 'parcial' },
        ]}
      />
    </Cartao>
  );
}

/**
 * As colunas das visitas: as 4 últimas semanas completas em azul (a janela que os números
 * do topo comparam), as de antes em cinza, a corrente tracejada. O número fica em cima só
 * das que estão em destaque; as outras dizem o valor na dica e no eixo.
 */
function ColunasDasVisitas({ semanas, valores }: { semanas: readonly SemanaDaIA[]; valores: readonly number[] }) {
  const corrente = semanas.length - 1;
  const teto = tetoBonito(Math.max(0, ...valores));
  const destaqueDe = Math.max(0, corrente - 4);

  return (
    <Quadro semanas={semanas} eixoY={[inteiro(teto), inteiro(teto / 2), '0']}>
      {semanas.map((s, i) => {
        const v = valores[i] ?? 0;
        const parcial = i === corrente;
        const destaque = !parcial && i >= destaqueDe;
        const quando = quandoNaDica(s, parcial);
        const leitura = contar(v, 'visita marcada', 'visitas marcadas');
        return (
          <Dica key={s.inicio} texto={`${quando}: ${leitura}`}>
            <button
              type="button"
              aria-label={`${quando}: ${leitura}`}
              className={cn(ALVO, 'flex h-full min-w-0 flex-1 flex-col items-center justify-end')}
            >
              {destaque || parcial ? (
                <span aria-hidden="true" className="numerico mb-1 text-[11px] leading-none">
                  {inteiro(v)}
                </span>
              ) : null}
              <span
                aria-hidden="true"
                className={cn(
                  LARGURA_DA_COLUNA,
                  'block shrink-0 rounded-t-[4px]',
                  parcial
                    ? 'border border-b-0 border-dashed border-(--vende-traco) bg-(--vende-azul)/30'
                    : destaque
                      ? COR.azul
                      : COR.resto,
                )}
                style={{ height: v > 0 ? `${((v / teto) * 100).toFixed(2)}%` : '1px' }}
              />
            </button>
          </Dica>
        );
      })}
    </Quadro>
  );
}

/**
 * O topo do eixo das visitas: um número par (a marca do meio fica inteira) com folga de
 * ~15% acima da maior coluna, para o número em cima dela caber dentro do gráfico.
 */
function tetoBonito(maximo: number): number {
  const alvo = Math.max(2, maximo / 0.85);
  for (const d of [2, 4, 6, 8, 10]) if (d >= alvo) return d;
  const base = 10 ** Math.floor(Math.log10(alvo));
  for (const m of [1.2, 1.6, 2, 3, 4, 5, 6, 8, 10]) {
    const t = Math.round(m * base);
    if (t >= alvo && t % 2 === 0) return t;
  }
  return Math.ceil(alvo / base) * base;
}

// ---------------------------------------------------------------------------
// Peças locais
// ---------------------------------------------------------------------------

/** Coluna fina: até 24px, e o resto da fatia é ar (poucas semanas não viram parede). */
const LARGURA_DA_COLUNA = 'w-[72%] max-w-6';

/** A frase curta do "quando aparece" e do zero: cinza, sem quebrar o desenho. */
function Nota({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>;
}

/**
 * O todo dividido em partes (uma semana só): cada parte é um bloco de 24px com cantos de
 * 4px e 2px de vão, largura proporcional; a parte zero não desenha nada. Cada bloco é um
 * botão com a dica (mouse e foco); os valores ficam na legenda logo abaixo, em tinta.
 */
function BarraDoTodo({
  partes,
  rotulo,
}: {
  partes: readonly { rotulo: string; valor: number; cor: Cor }[];
  rotulo: string;
}) {
  const visiveis = partes.filter((p) => p.valor > 0);
  return (
    <div role="group" aria-label={rotulo} className="flex h-6 w-full gap-0.5 md:self-center">
      {visiveis.length === 0 ? <span aria-hidden="true" className="h-full w-0.5 rounded-[2px] bg-(--vende-resto)" /> : null}
      {visiveis.map((p) => (
        <Dica key={p.rotulo} texto={`${p.rotulo}: ${pct(p.valor)}`}>
          <button
            type="button"
            aria-label={`${p.rotulo}: ${pct(p.valor)}`}
            className={cn(ALVO, 'h-full min-w-1 rounded-[4px]', COR[p.cor])}
            style={{ flex: `${p.valor} 1 0` }}
          />
        </Dica>
      ))}
    </div>
  );
}

type Chave = {
  rotulo: string;
  /** O valor escrito em tinta depois do rótulo (a legenda que também rotula). */
  valor?: string;
  cor?: Cor;
  forma?: 'quadrado' | 'linha' | 'parcial' | 'parcial-linha';
};

/** A legenda dos gráficos daqui, com a amostra da semana parcial (tracejada). */
function Chaves({ itens }: { itens: readonly Chave[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {itens.map((c) => (
        <li key={c.rotulo} className="inline-flex items-center gap-1.5">
          <AmostraDaChave cor={c.cor ?? 'resto'} forma={c.forma ?? 'quadrado'} />
          <span>{c.rotulo}</span>
          {c.valor ? <span className="numerico font-semibold text-foreground">{c.valor}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function AmostraDaChave({ cor, forma }: { cor: Cor; forma: NonNullable<Chave['forma']> }) {
  switch (forma) {
    case 'linha':
      return <span aria-hidden="true" className={cn('h-0.5 w-3.5 rounded-full', COR[cor])} />;
    case 'parcial':
      return <span aria-hidden="true" className="size-2.5 rounded-[3px] border border-dashed border-(--vende-traco)" />;
    case 'parcial-linha':
      return <span aria-hidden="true" className="w-3.5 border-t-2 border-dashed border-(--vende-azul)" />;
    default:
      return <span aria-hidden="true" className={cn('size-2.5 rounded-[3px]', COR[cor])} />;
  }
}

/** A altura dos três gráficos de semanas: a mesma nos três cartões. */
const ALTURA_DO_QUADRO = 'h-32';

/**
 * O quadro comum dos três gráficos: a calha do eixo y (a mesma largura nos três), a grade
 * em hairline com a base mais forte, uma fatia por semana (`children`, um alvo por fatia)
 * e embaixo a primeira data e "esta semana". Com poucas semanas, cada fatia leva a data.
 */
function Quadro({
  semanas,
  eixoY,
  children,
}: {
  semanas: readonly SemanaDaIA[];
  eixoY: readonly string[];
  children: ReactNode;
}) {
  const n = semanas.length;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <div
          aria-hidden="true"
          className={cn(
            'numerico flex w-8 shrink-0 flex-col justify-between text-right text-[11px] text-muted-foreground',
            ALTURA_DO_QUADRO,
          )}
        >
          {eixoY.map((r, i) => (
            <span
              key={i}
              className={cn('leading-none', i === 0 ? '-translate-y-1/2' : i === eixoY.length - 1 ? 'translate-y-1/2' : '')}
            >
              {r}
            </span>
          ))}
        </div>
        <div className={cn('relative min-w-0 flex-1', ALTURA_DO_QUADRO)}>
          <div aria-hidden="true" className="absolute inset-0 flex flex-col justify-between">
            {eixoY.map((_, i) => (
              <span key={i} className={cn('h-px', i === eixoY.length - 1 ? 'bg-border' : 'bg-hairline')} />
            ))}
          </div>
          <div className="absolute inset-0 flex">{children}</div>
        </div>
      </div>
      <div aria-hidden="true" className="numerico ml-10 flex text-[11px] leading-tight text-muted-foreground">
        {n > 4 ? (
          <>
            <span>{diaMes(semanas[0]?.inicio)}</span>
            <span className="ml-auto">esta semana</span>
          </>
        ) : (
          semanas.map((s, i) => (
            <span key={s.inicio} className="flex min-w-0 flex-1 justify-center whitespace-nowrap">
              {i === n - 1 ? 'esta semana' : diaMes(s.inicio)}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
