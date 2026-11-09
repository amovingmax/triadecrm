'use client';

import { ChevronRight, TrendingDown } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { cn } from '@/lib/utils';

import { chaveDoRelatorio } from './dados';
import { carregarPainelVisao, type KpiSemanal, type PainelVisao, type Sugestao } from './dados-vende';
import {
  contagem,
  contaDaMeta,
  contar,
  decimalEnxuto,
  decimalFixo,
  deltaDe,
  diaMes,
  dinheiroCurto,
  fimDoMes,
  gargaloDoFunil,
  impactoDaSugestao,
  indiceDaSemana,
  inteiro,
  lista,
  minutos,
  nomeDoMes,
  numero,
  ordenarImoveis,
  pct,
  plural,
  precoCurto,
  rotuloDaSituacao,
  tituloDaMesa,
  tituloDaNotaDaIA,
  tituloDaPrevisao,
  tituloDoFunilCurto,
  textoDoInteresse,
  tituloDoMaisProcurado,
  versaoCurta,
} from './formatos-vende';
import {
  ALVO,
  Barra,
  BarraEmpilhada,
  Cartao,
  Dica,
  FilaDeKpis,
  IrPara,
  Legenda,
  LegendaDoInteresse,
  Linha,
  MolduraDaAba,
  PlacarDaMeta,
  Quadrinho,
  Rodape,
  SeloIA,
  SemDado,
  TiraKpi,
} from './graficos-vende';
import { diasNoPeriodo, type Periodo } from './periodo';
import { PremissasDaConta } from './premissas-vende';
import type { AbrirPainel, ChavePainel, DefinicaoPainel } from './tipos';

/** Para onde cada sugestão leva. */
const DESTINO: Record<Sugestao['destino'], ChavePainel> = {
  oportunidades: 'oportunidades',
  imoveis: 'imoveis',
  funil: 'funil_equipe',
  ia: 'progresso_ia',
};

/**
 * A Visão geral do "relatório que vende" (09/11/2026): os seis números do período
 * contra o período anterior, as sugestões da IA, o placar do mês, os imóveis mais
 * procurados, o funil, a IA e a comissão parada. Cada cartão leva à aba que detalha
 * (`aoAbrirPainel`).
 *
 * Lê `relatorio_imova_painel_visao(p_de, p_ate)` (`dados-vende.ts`).
 */
export function PainelVendeVisao({
  painel,
  periodo,
  aoAbrirPainel,
}: {
  painel: DefinicaoPainel;
  periodo: Periodo;
  aoAbrirPainel: AbrirPainel;
}) {
  const consulta = useQuery({
    queryKey: chaveDoRelatorio('vende-visao', periodo),
    queryFn: () => carregarPainelVisao(periodo),
  });
  const n = diasNoPeriodo(periodo);

  return (
    <MolduraDaAba
      painel={painel}
      consulta={consulta}
      apoio={
        <>
          <p className="text-xs text-muted-foreground">
            Contra os {n} {plural(n, 'dia anterior', 'dias anteriores')}.
          </p>
          <PremissasDaConta premissas={consulta.data?.premissas} />
        </>
      }
    >
      {(dados) => <Conteudo dados={dados} aoAbrirPainel={aoAbrirPainel} />}
    </MolduraDaAba>
  );
}

function eram(n: number | null | undefined, sufixo = ''): string {
  const v = numero(n);
  if (v === null) return '';
  return `${plural(v, 'era', 'eram')} ${inteiro(v)}${sufixo}`;
}

function juntar(...partes: (string | null | undefined | false)[]): string {
  return partes.filter(Boolean).join(' · ');
}

function Conteudo({ dados, aoAbrirPainel }: { dados: PainelVisao; aoAbrirPainel: AbrirPainel }) {
  const k = dados.kpis;
  const serie = (kpi: KpiSemanal | null | undefined) => lista(kpi?.semanas);

  return (
    <div className="flex flex-col gap-4">
      <FilaDeKpis>
        <TiraKpi
          rotulo="Leads novos"
          valor={inteiro(k?.leads_novos?.agora)}
          delta={deltaDe(k?.leads_novos?.agora, k?.leads_novos?.antes, 'contagem')}
          serie={serie(k?.leads_novos)}
          apoio={eram(k?.leads_novos?.antes)}
        />
        <TiraKpi
          rotulo="Primeira resposta"
          valor={minutos(k?.primeira_resposta_min?.agora)}
          delta={deltaDe(k?.primeira_resposta_min?.agora, k?.primeira_resposta_min?.antes, 'minutos', {
            menorEMelhor: true,
          })}
          serie={serie(k?.primeira_resposta_min)}
          apoio={juntar(
            numero(k?.primeira_resposta_min?.antes) !== null && `era ${minutos(k?.primeira_resposta_min?.antes)}`,
            'mediana · menos é melhor',
          )}
        />
        <TiraKpi
          rotulo="Visitas marcadas"
          valor={inteiro(k?.visitas_marcadas?.agora)}
          delta={deltaDe(k?.visitas_marcadas?.agora, k?.visitas_marcadas?.antes, 'contagem')}
          serie={serie(k?.visitas_marcadas)}
          apoio={juntar(`${inteiro(contagem(k?.visitas_marcadas?.pela_ia))} pela IA`, eram(k?.visitas_marcadas?.antes))}
        />
        <TiraKpi
          rotulo="Propostas"
          valor={inteiro(k?.propostas?.agora)}
          delta={deltaDe(k?.propostas?.agora, k?.propostas?.antes, 'contagem')}
          serie={serie(k?.propostas)}
          apoio={eram(k?.propostas?.antes)}
        />
        <TiraKpi
          rotulo="Negócios fechados"
          valor={inteiro(k?.fechados?.agora)}
          delta={deltaDe(k?.fechados?.agora, k?.fechados?.antes, 'contagem')}
          serie={serie(k?.fechados)}
          apoio={juntar(eram(k?.fechados?.antes), contar(contagem(k?.fechados?.perdidos), 'perdido', 'perdidos'))}
        />
        <TiraKpi
          rotulo="Comissão provável parada"
          valor={dinheiroCurto(k?.comissao_parada?.agora)}
          delta={deltaDe(k?.comissao_parada?.agora, k?.comissao_parada?.ontem, 'dinheiro', { menorEMelhor: true })}
          serie={lista(k?.comissao_parada?.semanas)}
          apoio={numero(k?.comissao_parada?.ontem) === null ? 'agora · subir é ruim' : 'desde ontem · subir é ruim'}
        />
      </FilaDeKpis>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Sugestoes sugestoes={lista(dados.sugestoes)} aoAbrirPainel={aoAbrirPainel} />
        <PrevisaoDoMes dados={dados} aoAbrirPainel={aoAbrirPainel} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <ImoveisMaisProcurados dados={dados} aoAbrirPainel={aoAbrirPainel} />
        <FunilDoPeriodo dados={dados} aoAbrirPainel={aoAbrirPainel} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <NotaDaIA dados={dados} aoAbrirPainel={aoAbrirPainel} />
        <ComissaoParada dados={dados} aoAbrirPainel={aoAbrirPainel} />
      </div>
    </div>
  );
}

function Sugestoes({ sugestoes, aoAbrirPainel }: { sugestoes: readonly Sugestao[]; aoAbrirPainel: AbrirPainel }) {
  return (
    <Cartao
      grande
      titulo="Sugestões da IA para vender mais esta semana"
      sub="Lidas das conversas, dos imóveis e do funil. Em ordem do que mais rende."
      extra={<SeloIA />}
    >
      {sugestoes.length === 0 ? (
        <SemDado>
          A IA ainda não tem sugestão para esta semana. Elas aparecem quando o conselheiro ler as conversas, os imóveis e o
          funil.
        </SemDado>
      ) : (
        <ol className="-mx-2 flex flex-col gap-0.5">
          {sugestoes.map((s, i) => {
            const impacto = impactoDaSugestao(s);
            const destino = DESTINO[s.destino] ?? 'oportunidades';
            return (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => aoAbrirPainel(destino, s.destino === 'imoveis' ? s.alvo : null)}
                  className="toque grid w-full grid-cols-[5.75rem_minmax(0,1fr)_1rem] items-center gap-3 rounded-lg p-2.5 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:grid-cols-[6.5rem_minmax(0,1fr)_1rem] sm:gap-3.5"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="numerico text-lg leading-tight font-medium sm:text-xl">{impacto.numero}</span>
                    <span className="text-[11px] leading-snug text-muted-foreground">{impacto.unidade}</span>
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm leading-snug font-semibold">{s.acao}</span>
                    <span className="text-xs leading-snug text-muted-foreground">{s.porque}</span>
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </Cartao>
  );
}

function PrevisaoDoMes({ dados, aoAbrirPainel }: { dados: PainelVisao; aoAbrirPainel: AbrirPainel }) {
  const p = dados.previsao;
  if (!p) {
    return (
      <Cartao grande titulo="A previsão do mês ainda não tem dado">
        <SemDado>A previsão sai do funil aberto. Ela aparece quando houver negócio em andamento.</SemDado>
      </Cartao>
    );
  }
  const meta = numero(p.meta) ?? numero(dados.premissas?.meta_mes);
  const esperado = Math.max(0, numero(p.esperado) ?? 0);
  const fechados = contagem(p.fechados);
  const escala = Math.ceil(Math.max(meta ?? 0, numero(p.faixa_alta) ?? 0, esperado, fechados, 1) + 1);
  const conta = contaDaMeta(p, meta);
  const fim = fimDoMes(p.mes);
  const etapas = [...lista(p.por_etapa)].sort((a, b) => (numero(b.esperado) ?? 0) - (numero(a.esperado) ?? 0));

  const quadrinhos: { numero: string; texto: string }[] = conta
    ? [
        { numero: inteiro(conta.faltam), texto: conta.faltam === 1 ? 'negócio falta para a meta' : 'negócios faltam para a meta' },
        ...(conta.visitasFeitas !== null ? [{ numero: inteiro(conta.visitasFeitas), texto: 'visitas feitas a mais' }] : []),
        ...(conta.visitasMarcadas !== null
          ? [{ numero: inteiro(conta.visitasMarcadas), texto: `visitas marcadas a mais até ${fim}` }]
          : []),
      ]
    : [
        ...etapas.slice(0, 2).map((e) => ({
          numero: inteiro(contagem(e.abertos)),
          texto: `em “${e.etapa}” para acompanhar`,
        })),
        ...(numero(p.ritmo?.visitas_marcadas_por_semana) !== null
          ? [{ numero: decimalEnxuto(p.ritmo?.visitas_marcadas_por_semana), texto: 'visitas marcadas por semana' }]
          : []),
      ];

  return (
    <Cartao
      grande
      titulo={tituloDaPrevisao(p, meta)}
      sub={`${nomeDoMes(p.mes)}: fechados até hoje e a previsão pelo funil aberto.`}
    >
      <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="numerico text-[44px] leading-none font-medium tracking-[-0.03em] md:text-[52px]">
          {decimalEnxuto(esperado)}
        </span>
        <span className="text-sm">
          {plural(Math.ceil(esperado), 'negócio previsto', 'negócios previstos')} ·{' '}
          {meta === null ? 'sem meta' : `meta ${inteiro(meta)}`}
        </span>
      </p>
      <PlacarDaMeta fechados={fechados} esperado={esperado} meta={meta} escala={escala} />
      <Legenda
        itens={[
          { rotulo: `Fechados · ${inteiro(fechados)}`, cor: 'tinta' },
          { rotulo: `Previstos até ${fim} · ${decimalEnxuto(Math.max(0, esperado - fechados))}`, cor: 'resto' },
          ...(meta !== null ? [{ rotulo: 'Meta', cor: 'tinta' as const, forma: 'traco' as const }] : []),
        ]}
      />
      {quadrinhos.length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          {quadrinhos.map((q) => (
            <Quadrinho key={q.texto} numero={q.numero} texto={q.texto} />
          ))}
        </div>
      ) : null}
      <IrPara aoClicar={() => aoAbrirPainel('funil_equipe')}>Ver o funil e a conta</IrPara>
    </Cartao>
  );
}

function ImoveisMaisProcurados({ dados, aoAbrirPainel }: { dados: PainelVisao; aoAbrirPainel: AbrirPainel }) {
  const imoveis = ordenarImoveis(lista(dados.imoveis), 'total').slice(0, 6);
  const maximo = Math.max(1, ...imoveis.map((m) => contagem(m.total)));

  return (
    <Cartao
      titulo={tituloDoMaisProcurado(imoveis)}
      sub="Leads interessados em cada imóvel, pelo nível de interesse lido pela IA."
      extra={<LegendaDoInteresse />}
    >
      {imoveis.length === 0 ? (
        <SemDado>Nenhum imóvel no ar recebeu lead interessado no período.</SemDado>
      ) : (
        <ul className="flex flex-col gap-3 sm:gap-2">
          {imoveis.map((m) => (
            <li
              key={m.codigo}
              className="grid grid-cols-[minmax(0,1fr)_2.5rem] items-center gap-x-3 gap-y-1.5 sm:grid-cols-[minmax(8rem,0.9fr)_minmax(0,1.4fr)_2.25rem_minmax(7.5rem,0.8fr)]"
            >
              <span className="col-start-1 row-start-1 flex min-w-0 flex-col">
                <span className="truncate text-[13px] font-semibold">{m.titulo}</span>
                <span className="numerico truncate text-[11px] text-muted-foreground">
                  {m.codigo} · {precoCurto(m.preco_venda, m.preco_aluguel)}
                </span>
              </span>
              <span className="numerico col-start-2 row-start-1 text-right text-sm font-medium sm:col-start-3">
                {inteiro(contagem(m.total))}
              </span>
              <Dica texto={textoDoInteresse(m)}>
                <button
                  type="button"
                  aria-label={`${m.codigo}: ${textoDoInteresse(m)}`}
                  className={cn(ALVO, 'col-span-2 row-start-2 py-1 sm:col-span-1 sm:col-start-2 sm:row-start-1')}
                >
                  <BarraEmpilhada
                    maximo={maximo}
                    segmentos={[
                      { valor: contagem(m.muito), cor: 'muito' },
                      { valor: contagem(m.interessado), cor: 'interessado' },
                      { valor: contagem(m.morno), cor: 'morno' },
                    ]}
                  />
                </button>
              </Dica>
              <span className="col-span-2 row-start-3 min-w-0 truncate text-xs sm:col-span-1 sm:col-start-4 sm:row-start-1">
                {m.lider ? (
                  <>
                    mais quente: <strong className="font-semibold">{m.lider.nome}</strong>{' '}
                    <span className="numerico text-muted-foreground">{inteiro(m.lider.calor)}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">sem lead quente</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <IrPara aoClicar={() => aoAbrirPainel('imoveis')}>Ver cada imóvel, seus leads e o que falar</IrPara>
    </Cartao>
  );
}

function FunilDoPeriodo({ dados, aoAbrirPainel }: { dados: PainelVisao; aoAbrirPainel: AbrirPainel }) {
  const etapas = lista(dados.funil).map((e) => ({ etapa: e.etapa, leads: contagem(e.leads) }));
  const maximo = Math.max(1, ...etapas.map((e) => e.leads));
  const gargalo = gargaloDoFunil(etapas);

  return (
    <Cartao titulo={tituloDoFunilCurto(etapas)} sub="Leads do período em cada etapa e quanto passou da anterior.">
      {etapas.length === 0 ? (
        <SemDado>Nenhum lead entrou no funil no período.</SemDado>
      ) : (
        <ol className="flex flex-col gap-2">
          {etapas.map((e, i) => {
            const anterior = etapas[i - 1];
            const taxa = i > 0 && anterior && anterior.leads > 0 ? Math.round((e.leads / anterior.leads) * 100) : null;
            const ehGargalo = gargalo?.indice === i;
            return (
              <li
                key={`${e.etapa}-${i}`}
                className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)_2.25rem_3.75rem] items-center gap-2.5 text-[13px] sm:grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_2.25rem_3.75rem]"
              >
                <span className={cn('truncate', ehGargalo && 'font-semibold')}>{e.etapa}</span>
                <Barra valor={e.leads} maximo={maximo} />
                <span className="numerico text-right font-medium">{inteiro(e.leads)}</span>
                <span
                  className={cn(
                    'numerico inline-flex items-center justify-end gap-0.5 text-xs',
                    ehGargalo ? 'font-semibold text-quente-texto' : 'text-muted-foreground',
                  )}
                >
                  {ehGargalo ? <TrendingDown className="size-3.5" aria-hidden="true" /> : null}
                  {taxa === null ? '' : `${taxa}%`}
                  {ehGargalo ? <span className="sr-only">, a maior perda</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <Rodape>À direita, quanto passou da etapa anterior. A seta para baixo marca a maior perda.</Rodape>
      <IrPara aoClicar={() => aoAbrirPainel('funil_equipe')}>Ver o que trava cada etapa</IrPara>
    </Cartao>
  );
}

function NotaDaIA({ dados, aoAbrirPainel }: { dados: PainelVisao; aoAbrirPainel: AbrirPainel }) {
  const notas = lista(dados.ia?.notas);
  const valores = notas.map((n) => numero(n.nota));
  const validas = valores.filter((v): v is number => v !== null);
  const piso = Math.max(1, Math.min(3, Math.floor(Math.min(5, ...validas))));
  const eixoY = Array.from({ length: 5 - piso + 1 }, (_, i) => String(5 - i));
  const inicios = notas.map((n) => n.semana);
  const marcas = lista(dados.ia?.versoes)
    .map((v) => ({ indice: indiceDaSemana(inicios, v.desde), rotulo: versaoCurta(v.versao) }))
    .filter((m) => m.indice >= 0);
  const ia = dados.ia;

  return (
    <Cartao
      titulo={tituloDaNotaDaIA(notas)}
      sub={`Nota média da avaliação diária (de 1 a 5), por semana desde que a IA começou. Os tracejados são as versões. O eixo começa em ${piso}.`}
    >
      {validas.length === 0 ? (
        <SemDado>A avaliação diária ainda não deu nota às conversas da IA.</SemDado>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Linha
            valores={valores}
            dominio={[piso, 5]}
            eixoY={eixoY}
            marcas={marcas}
            pontos={notas.map((n) => ({
              dica: `Semana de ${diaMes(n.semana)} · ${numero(n.nota) === null ? 'sem nota' : `nota ${decimalFixo(n.nota)}`}`,
              aria: `Semana de ${diaMes(n.semana)}: ${numero(n.nota) === null ? 'sem nota' : `nota ${decimalFixo(n.nota)}`}`,
            }))}
          />
          <div aria-hidden="true" className="numerico ml-10 flex justify-between text-[11px] text-muted-foreground">
            <span>{diaMes(notas[0]?.semana)}</span>
            <span>{diaMes(notas[notas.length - 1]?.semana)}</span>
          </div>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        <Quadrinho
          numero={pct(ia?.mais_interesse?.agora)}
          texto={juntar('saem mais interessados', numero(ia?.mais_interesse?.antes) !== null && `era ${pct(ia?.mais_interesse?.antes)}`)}
        />
        <Quadrinho
          numero={inteiro(ia?.visitas?.agora)}
          texto={juntar('visitas marcadas pela IA', eram(ia?.visitas?.antes))}
        />
        <Quadrinho
          numero={pct(ia?.resolvidas?.agora)}
          texto={juntar('resolvidas sem a equipe', numero(ia?.resolvidas?.antes) !== null && `era ${pct(ia?.resolvidas?.antes)}`)}
        />
      </div>
      <Rodape>Últimas 4 semanas contra as 4 anteriores.</Rodape>
      <IrPara aoClicar={() => aoAbrirPainel('progresso_ia')}>Ver o progresso da IA</IrPara>
    </Cartao>
  );
}

function ComissaoParada({ dados, aoAbrirPainel }: { dados: PainelVisao; aoAbrirPainel: AbrirPainel }) {
  const mesa = dados.mesa;
  const situacoes = [...lista(mesa?.situacoes)]
    .filter((s) => contagem(s.leads) > 0)
    .sort((a, b) => (numero(b.valor) ?? 0) - (numero(a.valor) ?? 0));
  const maximo = Math.max(1, ...situacoes.map((s) => numero(s.valor) ?? 0));

  return (
    <Cartao
      titulo={tituloDaMesa(mesa?.valor, mesa?.leads)}
      sub="Leads com chance de negócio e nenhuma ação em dia, por situação."
    >
      {situacoes.length === 0 ? (
        <SemDado>Todo lead com chance de negócio tem uma ação em dia.</SemDado>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {situacoes.map((s) => (
            <li
              key={s.situacao}
              className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_4.75rem] items-center gap-3 text-[13px]"
            >
              <span className="flex min-w-0 flex-col">
                <span className="leading-snug font-semibold">{rotuloDaSituacao(s.situacao)}</span>
                <span className="text-[11px] text-muted-foreground">{contar(contagem(s.leads), 'lead', 'leads')}</span>
              </span>
              <Barra valor={numero(s.valor)} maximo={maximo} />
              <span className="numerico text-right font-medium">{dinheiroCurto(s.valor)}</span>
            </li>
          ))}
        </ul>
      )}
      <IrPara aoClicar={() => aoAbrirPainel('oportunidades')}>Ver a fila de hoje</IrPara>
    </Cartao>
  );
}
