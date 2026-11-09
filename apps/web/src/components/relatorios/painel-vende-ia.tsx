'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { cn } from '@/lib/utils';

import {
  carregarPainelIA,
  type FaixaDePassagem,
  type PainelProgressoIA,
  type SemanaDaIA,
} from './dados-vende';
import {
  contagem,
  contar,
  decimalFixo,
  deltaDe,
  diaMes,
  diaMesAno,
  dolares,
  FAIXAS_DE_PASSAGEM,
  indiceDaSemana,
  inteiro,
  lista,
  minutos,
  numero,
  pct,
  plural,
  pontas,
  rotuloDaFaixaDePassagem,
  comoCorrigirLacuna,
  oQueMudouNaVersao,
  rotuloDaLacuna,
  SERIES_DA_NOTA,
  tituloDaPassagem,
  tituloDasLacunas,
  tituloDasNotas,
  tituloDasResolvidas,
  tituloDasVisitasDaIA,
  tituloDoInteresse,
  versaoCurta,
  type Tom,
} from './formatos-vende';
import {
  Barra,
  Cartao,
  Colunas,
  ColunasEmpilhadas,
  FilaDeKpis,
  Legenda,
  Linha,
  MolduraDaAba,
  Rodape,
  SemDado,
  TextoDoDelta,
  TiraKpi,
} from './graficos-vende';
import type { DefinicaoPainel } from './tipos';

/**
 * Progresso da IA (09/11/2026): desde que a IA começou, semana a semana — as três
 * notas da avaliação diária, se o cliente sai mais interessado, o que ela resolve
 * sozinha, as visitas que marca, o efeito de cada versão, o que ainda falta e onde
 * ela depende da equipe. Sem barra de período: a régua é "desde o começo", e os
 * números do topo são as últimas 4 semanas contra as 4 anteriores.
 *
 * Lê `relatorio_imova_painel_ia()` (`dados-vende.ts`).
 */
export function PainelVendeIA({ painel }: { painel: DefinicaoPainel }) {
  const consulta = useQuery({ queryKey: ['relatorios', 'vende-ia'], queryFn: carregarPainelIA });
  const desde = consulta.data?.desde ?? null;

  return (
    <MolduraDaAba
      painel={painel}
      consulta={consulta}
      tiras={5}
      apoio={
        <p className="text-xs text-muted-foreground">
          {desde ? `A IA começou em ${diaMesAno(desde)} · ` : ''}números: últimas 4 semanas × as 4 anteriores
        </p>
      }
    >
      {(dados) => <Conteudo dados={dados} />}
    </MolduraDaAba>
  );
}

function Conteudo({ dados }: { dados: PainelProgressoIA }) {
  const k = dados.kpis;
  const semanas = lista(dados.semanas);
  const teto = numero(k?.teto_mes_usd);

  return (
    <div className="flex flex-col gap-4">
      <FilaDeKpis colunas={5}>
        <TiraKpi
          rotulo="Nota média"
          valor={decimalFixo(k?.nota?.agora)}
          delta={deltaDe(k?.nota?.agora, k?.nota?.antes, 'nota')}
          apoio={[numero(k?.nota?.antes) !== null ? `era ${decimalFixo(k?.nota?.antes)}` : null, 'de 1 a 5']
            .filter(Boolean)
            .join(' · ')}
        />
        <TiraKpi
          rotulo="Saem mais interessados"
          valor={pct(k?.mais_interesse?.agora)}
          delta={deltaDe(k?.mais_interesse?.agora, k?.mais_interesse?.antes, 'pontos')}
          apoio={['das conversas', numero(k?.mais_interesse?.antes) !== null ? `era ${pct(k?.mais_interesse?.antes)}` : null]
            .filter(Boolean)
            .join(' · ')}
        />
        <TiraKpi
          rotulo="Visitas marcadas pela IA"
          valor={inteiro(contagem(k?.visitas?.agora))}
          delta={deltaDe(k?.visitas?.agora, k?.visitas?.antes, 'contagem')}
          apoio={
            numero(k?.visitas?.antes) !== null
              ? `${plural(numero(k?.visitas?.antes) ?? 0, 'era', 'eram')} ${inteiro(k?.visitas?.antes)}`
              : undefined
          }
        />
        <TiraKpi
          rotulo="Resolvidas sem a equipe"
          valor={pct(k?.resolvidas?.agora)}
          delta={deltaDe(k?.resolvidas?.agora, k?.resolvidas?.antes, 'pontos')}
          apoio={numero(k?.resolvidas?.antes) !== null ? `era ${pct(k?.resolvidas?.antes)}` : undefined}
        />
        <TiraKpi
          rotulo="Custo por visita marcada"
          valor={dolares(k?.custo_por_visita_usd?.agora)}
          delta={deltaDe(k?.custo_por_visita_usd?.agora, k?.custo_por_visita_usd?.antes, 'dolar', { menorEMelhor: true })}
          apoio={[`${dolares(k?.custo_mes_usd ?? 0)} no mês`, teto !== null ? `teto ${dolares(teto)}` : null]
            .filter(Boolean)
            .join(' · ')}
        />
      </FilaDeKpis>

      <Notas dados={dados} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Interesse semanas={semanas} />
        <div className="flex min-w-0 flex-col gap-4">
          <Resolvidas semanas={semanas} />
          <VisitasDaIA semanas={semanas} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Versoes dados={dados} />
        <Lacunas dados={dados} />
      </div>

      <Passagem dados={dados} />
    </div>
  );
}

/** As datas da primeira e da última semana, embaixo do gráfico. */
function EixoDasSemanas({ semanas, recuo = 'ml-10' }: { semanas: readonly SemanaDaIA[]; recuo?: string }) {
  if (semanas.length === 0) return null;
  return (
    <div aria-hidden="true" className={cn('numerico flex justify-between text-[10px] text-muted-foreground', recuo)}>
      <span>{diaMes(semanas[0]?.inicio)}</span>
      <span>{diaMes(semanas[semanas.length - 1]?.inicio)}</span>
    </div>
  );
}

function Notas({ dados }: { dados: PainelProgressoIA }) {
  const semanas = lista(dados.semanas);
  const inicios = semanas.map((s) => s.inicio);
  const versoes = lista(dados.versoes)
    .map((v) => ({ ...v, indice: indiceDaSemana(inicios, v.desde) }))
    .filter((v) => v.indice >= 0);
  const todas = semanas.flatMap((s) => SERIES_DA_NOTA.map((serie) => numero(s[serie.chave]))).filter(
    (v): v is number => v !== null,
  );
  const piso = Math.max(1, Math.min(3, Math.floor(Math.min(5, ...todas))));
  const eixoY = Array.from({ length: 5 - piso + 1 }, (_, i) => String(5 - i));

  return (
    <Cartao
      grande
      titulo={tituloDasNotas(semanas)}
      sub={`Avaliação diária das conversas da IA, de 1 a 5, média por semana. Os tracejados marcam as versões. O eixo começa em ${piso}.`}
    >
      {todas.length === 0 ? (
        <SemDado>A avaliação diária ainda não deu nota às conversas da IA.</SemDado>
      ) : (
        <div className="grid gap-7 md:grid-cols-3">
          {SERIES_DA_NOTA.map((serie) => {
            const valores = semanas.map((s) => numero(s[serie.chave]));
            const p = pontas(valores);
            return (
              <figure key={serie.chave} className="flex min-w-0 flex-col gap-2">
                <figcaption className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold">{serie.rotulo}</span>
                  {p ? (
                    <span className="text-xs text-muted-foreground">
                      {valores.filter((v) => v !== null).length > 1 ? (
                        <>
                          <span className="numerico">{decimalFixo(p.primeiro)}</span> →{' '}
                        </>
                      ) : null}
                      <strong className="numerico text-sm font-semibold text-foreground">{decimalFixo(p.ultimo)}</strong>
                    </span>
                  ) : null}
                </figcaption>
                <Linha
                  valores={valores}
                  dominio={[piso, 5]}
                  altura="h-32"
                  eixoY={eixoY}
                  pontas
                  marcas={versoes.map((v) => ({ indice: v.indice }))}
                  pontos={semanas.map((s, i) => ({
                    dica: `${serie.rotulo} · semana de ${diaMes(s.inicio)}: ${valores[i] === null ? 'sem nota' : decimalFixo(valores[i])}`,
                    aria: `${serie.rotulo}, semana de ${diaMes(s.inicio)}: ${valores[i] === null ? 'sem nota' : `nota ${decimalFixo(valores[i])}`}`,
                  }))}
                />
                <EixoDasSemanas semanas={semanas} />
              </figure>
            );
          })}
        </div>
      )}
      {versoes.length > 0 ? (
        <Legenda
          itens={versoes.map((v) => ({
            rotulo: (
              <>
                <strong className="font-semibold text-foreground">{versaoCurta(v.versao)}</strong> desde {diaMes(v.desde)}
              </>
            ),
            forma: 'tracejado' as const,
          }))}
        />
      ) : null}
    </Cartao>
  );
}

function Interesse({ semanas }: { semanas: readonly SemanaDaIA[] }) {
  const [ativa, setAtiva] = useState<string | null>(null);
  const comDado = semanas.some((s) => numero(s.subiu_pct) !== null);
  const caiu = pontas(semanas.map((s) => s.caiu_pct));

  return (
    <Cartao
      titulo={tituloDoInteresse(semanas)}
      sub="Interesse antes e depois de cada conversa com a IA, por semana. Passe o mouse ou o foco numa coluna."
      extra={
        <Legenda
          itens={[
            { rotulo: 'Subiu', cor: 'subiu' },
            { rotulo: 'Igual', cor: 'igual' },
            { rotulo: 'Caiu', cor: 'caiu' },
          ]}
        />
      }
    >
      {!comDado ? (
        <SemDado>A avaliação diária ainda não comparou o interesse antes e depois das conversas.</SemDado>
      ) : (
        <ColunasEmpilhadas
          altura="h-48"
          eixoY={['100%', '50%', '0']}
          ativa={ativa}
          aoAtivar={setAtiva}
          itens={semanas.map((s, i) => {
            const subiu = numero(s.subiu_pct);
            const igual = numero(s.igual_pct);
            const caiuPct = numero(s.caiu_pct);
            const leitura =
              subiu === null
                ? 'sem avaliação'
                : `subiu ${pct(subiu)} · igual ${pct(igual)} · caiu ${pct(caiuPct)}`;
            return {
              chave: s.inicio,
              segmentos: [
                { valor: caiuPct ?? 0, cor: 'caiu' as const },
                { valor: igual ?? 0, cor: 'igual' as const },
                { valor: subiu ?? 0, cor: 'subiu' as const },
              ],
              dica: (
                <>
                  <strong>Semana de {diaMes(s.inicio)}</strong> · {contar(contagem(s.conversas), 'conversa', 'conversas')}
                  <br />
                  {leitura}
                </>
              ),
              aria: `Semana de ${diaMes(s.inicio)}, ${contar(contagem(s.conversas), 'conversa', 'conversas')}: ${leitura}`,
              rotulo: subiu === null ? '' : pct(subiu),
              eixo: i === 0 || i === semanas.length - 1 ? diaMes(s.inicio) : '',
            };
          })}
        />
      )}
      {comDado ? (
        <Rodape>
          Embaixo de cada coluna, quanto subiu.
          {caiu
            ? Math.round(caiu.primeiro) === Math.round(caiu.ultimo)
              ? ` O que caiu ficou em ${pct(caiu.ultimo)}.`
              : ` O que caiu foi de ${pct(caiu.primeiro)} para ${pct(caiu.ultimo)} no mesmo período.`
            : ''}
        </Rodape>
      ) : null}
    </Cartao>
  );
}

function Resolvidas({ semanas }: { semanas: readonly SemanaDaIA[] }) {
  const valores = semanas.map((s) => numero(s.resolvidas_pct));
  const bons = valores.filter((v): v is number => v !== null);
  const lo = bons.length > 0 ? Math.max(0, Math.floor((Math.min(...bons) - 5) / 10) * 10) : 0;
  const hi = bons.length > 0 ? Math.min(100, Math.ceil((Math.max(...bons) + 5) / 10) * 10) : 100;
  const fim = pontas(valores);

  return (
    <Cartao titulo={tituloDasResolvidas(semanas)} sub="Conversas que a IA terminou sem passar para a equipe, por semana.">
      {bons.length === 0 ? (
        <SemDado>Sem conversas terminadas pela IA ainda.</SemDado>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Linha
            valores={valores}
            dominio={[lo, hi]}
            altura="h-24"
            cor="tinta"
            eixoY={[`${hi}%`, `${lo}%`]}
            pontas
            rotuloDoFim={fim ? pct(fim.ultimo) : undefined}
            pontos={semanas.map((s, i) => ({
              dica: `Semana de ${diaMes(s.inicio)}: ${valores[i] === null ? 'sem dado' : `${pct(valores[i])} resolvidas sozinha`}`,
              aria: `Semana de ${diaMes(s.inicio)}: ${valores[i] === null ? 'sem dado' : `${pct(valores[i])} resolvidas sem a equipe`}`,
            }))}
          />
          <EixoDasSemanas semanas={semanas} recuo="ml-10 mr-10" />
        </div>
      )}
    </Cartao>
  );
}

function VisitasDaIA({ semanas }: { semanas: readonly SemanaDaIA[] }) {
  const maximo = Math.max(1, ...semanas.map((s) => contagem(s.visitas)));
  return (
    <Cartao titulo={tituloDasVisitasDaIA(semanas)} sub="Visitas marcadas pela IA, por semana. As 4 últimas em destaque.">
      {semanas.length === 0 ? (
        <SemDado>A IA ainda não marcou visita.</SemDado>
      ) : (
        <Colunas
          maximo={maximo}
          altura="h-24"
          itens={semanas.map((s, i) => ({
            chave: s.inicio,
            valor: contagem(s.visitas),
            rotulo: inteiro(contagem(s.visitas)),
            destaque: i >= semanas.length - 4,
            eixo: i === 0 || i === semanas.length - 1 ? diaMes(s.inicio) : '',
            dica: `Semana de ${diaMes(s.inicio)} · ${contar(contagem(s.visitas), 'visita marcada', 'visitas marcadas')}`,
            aria: `Semana de ${diaMes(s.inicio)}: ${contar(contagem(s.visitas), 'visita marcada', 'visitas marcadas')}`,
          }))}
        />
      )}
    </Cartao>
  );
}

function Versoes({ dados }: { dados: PainelProgressoIA }) {
  const versoes = lista(dados.versoes);
  return (
    <Cartao
      titulo="O efeito de cada versão"
      sub="Nas 2 semanas depois de cada versão, contra as 2 semanas de antes."
    >
      {versoes.length === 0 ? (
        <SemDado>A IA ainda está na primeira versão.</SemDado>
      ) : (
        <ol className="flex flex-col">
          {versoes.map((v) => (
            <li
              key={`${v.versao}-${v.desde}`}
              className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-start gap-3.5 border-t border-hairline py-3 first:border-t-0"
            >
              <span className="flex flex-col gap-0.5">
                <span className="numerico text-[15px] font-semibold">{versaoCurta(v.versao)}</span>
                <span className="text-[11px] text-muted-foreground">desde {diaMes(v.desde)}</span>
              </span>
              <span className="flex flex-col gap-1 text-[13px]">
                {oQueMudouNaVersao(v.versao) ? (
                  <span className="leading-snug">{oQueMudouNaVersao(v.versao)}</span>
                ) : null}
                <EfeitoDaVersao
                  rotulo="Nota"
                  antes={numero(v.nota_antes)}
                  depois={numero(v.nota_depois)}
                  formato={decimalFixo}
                  jeito="nota"
                />
                <EfeitoDaVersao
                  rotulo="Saem mais interessados"
                  antes={numero(v.subiu_antes)}
                  depois={numero(v.subiu_depois)}
                  formato={pct}
                  jeito="pontos"
                />
              </span>
            </li>
          ))}
        </ol>
      )}
    </Cartao>
  );
}

function EfeitoDaVersao({
  rotulo,
  antes,
  depois,
  formato,
  jeito,
}: {
  rotulo: string;
  antes: number | null;
  depois: number | null;
  formato: (v: number) => string;
  jeito: 'nota' | 'pontos';
}) {
  if (antes === null && depois === null) {
    return <span className="text-muted-foreground">{rotulo}: sem avaliação nas semanas em volta</span>;
  }
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span>
        {rotulo}: <span className="numerico">{antes === null ? '—' : formato(antes)}</span> →{' '}
        <strong className="numerico font-semibold">{depois === null ? '—' : formato(depois)}</strong>
      </span>
      <TextoDoDelta delta={deltaDe(depois, antes, jeito)} />
    </span>
  );
}

const TOM: Record<Tom, string> = {
  bom: 'text-cliente-texto',
  ruim: 'text-quente-texto',
  neutro: 'text-muted-foreground',
};

function Lacunas({ dados }: { dados: PainelProgressoIA }) {
  const lacunas = [...lista(dados.lacunas)].sort((a, b) => contagem(b.agora) - contagem(a.agora));
  const maximo = Math.max(1, ...lacunas.flatMap((l) => [contagem(l.agora), contagem(l.antes)]));

  return (
    <Cartao
      titulo={tituloDasLacunas(lacunas)}
      sub="Onde a avaliação diária achou falha, nas últimas 4 semanas. O traço cinza são as 4 semanas anteriores."
      extra={
        lacunas.length > 0 ? (
          <Legenda
            itens={[
              { rotulo: 'Últimas 4 semanas', cor: 'tinta' },
              { rotulo: '4 anteriores', cor: 'traco', forma: 'traco' },
            ]}
          />
        ) : undefined
      }
    >
      {lacunas.length === 0 ? (
        <SemDado>Nenhuma falha anotada pela avaliação diária.</SemDado>
      ) : (
        <ul className="flex flex-col">
          {lacunas.map((l) => {
            const agora = contagem(l.agora);
            const antes = contagem(l.antes);
            const tom: Tom = agora < antes ? 'bom' : agora > antes ? 'ruim' : 'neutro';
            const seta = agora < antes ? '▼' : agora > antes ? '▲' : '=';
            const leitura = agora < antes ? 'melhorou' : agora > antes ? 'piorou' : 'igual';
            return (
              <li
                key={l.lacuna}
                className="grid grid-cols-[minmax(0,1fr)_2rem] items-center gap-x-3 gap-y-1.5 border-t border-hairline py-2.5 text-[13px] first:border-t-0 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)_2rem_5.5rem]"
              >
                <span className="flex flex-col gap-0.5">
                  <span className="leading-snug font-semibold">{rotuloDaLacuna(l.lacuna)}</span>
                  {comoCorrigirLacuna(l.lacuna) ? (
                    <span className="text-[12px] leading-snug text-muted-foreground">{comoCorrigirLacuna(l.lacuna)}</span>
                  ) : null}
                </span>
                <span className="col-span-2 row-start-2 sm:col-span-1 sm:col-start-2 sm:row-start-1">
                  <Barra valor={agora} maximo={maximo} marcador={antes / maximo} altura="h-3.5" />
                </span>
                <span className="numerico col-start-2 row-start-1 text-right sm:col-start-3">{inteiro(agora)}</span>
                <span
                  className={cn(
                    'numerico col-span-2 text-[11px] font-semibold sm:col-span-1 sm:col-start-4 sm:row-start-1 sm:text-right',
                    TOM[tom],
                  )}
                >
                  <span aria-hidden="true">
                    {seta} {plural(antes, 'era', 'eram')} {inteiro(antes)}
                  </span>
                  <span className="sr-only">
                    {leitura}: {plural(antes, 'era', 'eram')} {inteiro(antes)} nas 4 semanas anteriores
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Cartao>
  );
}

function Passagem({ dados }: { dados: PainelProgressoIA }) {
  const porFaixa = new Map<FaixaDePassagem, { leads: number; visitaram: number; esfriaram: number }>(
    lista(dados.passagem).map((p) => [
      p.faixa,
      { leads: contagem(p.leads), visitaram: contagem(p.visitaram), esfriaram: contagem(p.esfriaram) },
    ]),
  );
  const linhas = FAIXAS_DE_PASSAGEM.filter((f) => porFaixa.has(f)).map((f) => ({ faixa: f, ...(porFaixa.get(f) ?? { leads: 0, visitaram: 0, esfriaram: 0 }) }));
  const maximo = Math.max(1, ...linhas.map((l) => l.leads));
  const mediana = numero(dados.passagem_mediana_min);

  return (
    <Cartao
      titulo={tituloDaPassagem(lista(dados.passagem))}
      sub={`Tempo entre a IA passar a conversa e alguém da equipe responder, nas últimas 4 semanas.${mediana !== null ? ` Mediana: ${minutos(mediana)}.` : ''}`}
    >
      {linhas.length === 0 || linhas.every((l) => l.leads === 0) ? (
        <SemDado>A IA não passou conversa para a equipe nas últimas 4 semanas.</SemDado>
      ) : (
        <ul className="flex max-w-3xl flex-col gap-2">
          {linhas.map((l) => {
            const lenta = l.faixa === 'mais_2h' || l.faixa === 'sem_resposta';
            const resultado = [
              l.visitaram > 0 ? `${inteiro(l.visitaram)} ${plural(l.visitaram, 'marcou', 'marcaram')} visita` : null,
              l.esfriaram > 0 ? `${inteiro(l.esfriaram)} ${plural(l.esfriaram, 'esfriou', 'esfriaram')}` : null,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <li
                key={l.faixa}
                className="grid grid-cols-[5.5rem_minmax(0,1fr)_2rem] items-center gap-x-2.5 gap-y-0.5 text-[13px] sm:grid-cols-[6.5rem_minmax(0,1fr)_2rem_11rem]"
              >
                <span className={cn(lenta && 'font-semibold')}>{rotuloDaFaixaDePassagem(l.faixa)}</span>
                <Barra valor={l.leads} maximo={maximo} cor={lenta ? 'tinta' : 'resto'} />
                <span className="numerico text-right font-medium">{inteiro(l.leads)}</span>
                <span className="col-span-3 text-xs text-muted-foreground sm:col-span-1">
                  {resultado || (l.leads > 0 ? 'nenhuma visita' : '')}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Cartao>
  );
}
