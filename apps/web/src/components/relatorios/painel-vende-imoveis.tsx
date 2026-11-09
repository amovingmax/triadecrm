'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { MessageCircle, TrendingDown } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { chaveDoRelatorio, mensagemDoErro } from './dados';
import { linkDoLead } from './dados-imova';
import {
  carregarDetalheImovel,
  carregarPainelImoveis,
  type DetalheImovel,
  type LinhaImovel,
  type NivelDeInteresse,
  type PainelImoveis,
} from './dados-vende';
import { ErroDoRelatorio } from './estados';
import {
  contagem,
  contar,
  decimalEnxuto,
  diaMes,
  encurtar,
  dias,
  FILTROS_DE_TIPO,
  filtrarImoveis,
  haQuantoCurto,
  indiceDaSemana,
  inteiro,
  lista,
  maisProcurado,
  numero,
  ordenarImoveis,
  parteDe,
  plural,
  precoCurto,
  rotuloDoNivel,
  textoDoInteresse,
  tituloDasSemanasDoImovel,
  tituloDoRanking,
  type FiltroDeTipo,
  type OrdemDosImoveis,
} from './formatos-vende';
import {
  ALVO,
  Barra,
  BarraDeCalor,
  BarraEmpilhada,
  Cartao,
  Colunas,
  Dica,
  FilaDeKpis,
  FUNDO_DA_IA,
  LegendaDoInteresse,
  MolduraDaAba,
  Quadrinho,
  SeloIA,
  SemDado,
  TiraKpi,
  type Cor,
} from './graficos-vende';
import type { Periodo } from './periodo';
import type { DefinicaoPainel } from './tipos';

/** Quantos imóveis a lista mostra antes do "Mostrar todos". */
const NA_LISTA = 12;

const COR_DO_NIVEL: Record<NivelDeInteresse, Cor> = {
  muito: 'muito',
  interessado: 'interessado',
  morno: 'morno',
};

/**
 * Imóveis (09/11/2026): o ranking dos imóveis no ar pelo número de leads
 * interessados e, ao escolher um, o detalhe — do anúncio à proposta, quem são os
 * leads e o que falar com cada um, o que a IA sugere para vender, as 8 semanas, as
 * perguntas e as objeções.
 *
 * Lê `relatorio_imova_painel_imoveis(p_de, p_ate)` e, por imóvel,
 * `relatorio_imova_painel_imovel(p_codigo, p_de, p_ate)` (`dados-vende.ts`).
 */
export function PainelVendeImoveis({
  painel,
  periodo,
  imovelInicial,
}: {
  painel: DefinicaoPainel;
  periodo: Periodo;
  /** O imóvel que a sugestão da Visão geral mandou abrir. */
  imovelInicial: string | null;
}) {
  const consulta = useQuery({
    queryKey: chaveDoRelatorio('vende-imoveis', periodo),
    queryFn: () => carregarPainelImoveis(periodo),
  });
  const conselho = consulta.data?.conselho_em ?? null;

  return (
    <MolduraDaAba
      painel={painel}
      consulta={consulta}
      tiras={5}
      apoio={
        <p className="text-xs text-muted-foreground">
          Leads interessados no período · nível lido pela IA em cada conversa
          {consulta.data ? (
            <>
              <br className="hidden md:block" />
              <span className="md:hidden"> · </span>
              {conselho ? `Sugestões da IA de ${haQuantoCurto(conselho)}` : 'A IA ainda não leu os imóveis'}
            </>
          ) : null}
        </p>
      }
    >
      {(dados) => <Conteudo dados={dados} periodo={periodo} imovelInicial={imovelInicial} />}
    </MolduraDaAba>
  );
}

function Conteudo({
  dados,
  periodo,
  imovelInicial,
}: {
  dados: PainelImoveis;
  periodo: Periodo;
  imovelInicial: string | null;
}) {
  const imoveis = lista(dados.imoveis);
  const topo = maisProcurado(imoveis);
  const [filtro, setFiltro] = useState<FiltroDeTipo>('todos');
  const [ordem, setOrdem] = useState<OrdemDosImoveis>('total');
  const [todos, setTodos] = useState(false);
  const [escolhido, setEscolhido] = useState<string | null>(() =>
    imovelInicial && imoveis.some((m) => m.codigo === imovelInicial)
      ? imovelInicial
      : (ordenarImoveis(imoveis, 'total')[0]?.codigo ?? null),
  );
  const detalhe = useRef<HTMLDivElement>(null);

  const visiveis = filtrarImoveis(ordenarImoveis(imoveis, ordem), filtro);
  const naTela = todos ? visiveis : visiveis.slice(0, NA_LISTA);
  const maximo = Math.max(1, ...imoveis.map((m) => contagem(m.total)));
  const linha = imoveis.find((m) => m.codigo === escolhido) ?? null;
  const k = dados.kpis;

  function escolher(codigo: string) {
    setEscolhido(codigo);
    // No celular o detalhe fica embaixo da lista: leva a pessoa até ele.
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
      requestAnimationFrame(() => detalhe.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <FilaDeKpis colunas={5}>
        <TiraKpi
          rotulo="Imóveis no ar"
          valor={inteiro(contagem(k?.no_ar))}
          apoio={`${inteiro(contagem(k?.a_venda))} à venda · ${inteiro(contagem(k?.para_alugar))} para alugar`}
        />
        <TiraKpi
          rotulo="Leads interessados"
          valor={inteiro(contagem(k?.leads_interessados))}
          apoio={`em pelo menos um imóvel · ${contar(contagem(k?.interesses), 'interesse', 'interesses')}`}
        />
        <TiraKpi
          rotulo="Muito interessados"
          valor={inteiro(contagem(k?.muito_interessados))}
          apoio={`${inteiro(contagem(k?.muito_sem_acao))} ${plural(contagem(k?.muito_sem_acao), 'dele', 'deles')} sem ação em dia`}
        />
        <TiraKpi
          rotulo="Mais procurado"
          valor={topo?.codigo ?? '—'}
          apoio={topo ? `${encurtar(topo.titulo, 36)} · ${contar(contagem(topo.total), 'lead', 'leads')}` : 'nenhum lead no período'}
        />
        <TiraKpi
          rotulo="Sem nenhum interessado"
          valor={inteiro(contagem(k?.sem_interessado))}
          apoio={
            k?.sem_interessado_exemplo
              ? [
                  k.sem_interessado_exemplo.codigo,
                  encurtar(k.sem_interessado_exemplo.titulo, 36),
                  numero(k.sem_interessado_exemplo.dias_no_ar) !== null
                    ? `${dias(k.sem_interessado_exemplo.dias_no_ar)} no ar`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'todo imóvel no ar tem interessado'
          }
        />
      </FilaDeKpis>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)]">
        <Cartao
          grande
          className="px-2 md:px-3"
          titulo={
            <span className="block px-2">
              {visiveis.length === 0 && imoveis.length > 0 ? 'Nenhum imóvel deste tipo no ar' : tituloDoRanking(visiveis, ordem)}
            </span>
          }
          sub={<span className="block px-2">Leads interessados em cada imóvel. Escolha um para ver quem são e o que falar.</span>}
        >
          <div role="group" aria-label="Tipo de imóvel" className="flex flex-wrap gap-0.5 px-1">
            {FILTROS_DE_TIPO.map((t) => (
              <Pilula key={t.chave} ativa={filtro === t.chave} aoClicar={() => setFiltro(t.chave)}>
                {t.rotulo}
              </Pilula>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 px-2">
            <LegendaDoInteresse />
            <div role="group" aria-label="Ordenar" className="flex gap-0.5">
              <Pilula pequena ativa={ordem === 'total'} aoClicar={() => setOrdem('total')}>
                Mais leads
              </Pilula>
              <Pilula pequena ativa={ordem === 'muito'} aoClicar={() => setOrdem('muito')}>
                Mais quentes
              </Pilula>
            </div>
          </div>

          {imoveis.length === 0 ? (
            <div className="px-2">
              <SemDado>Nenhum imóvel no ar. Os imóveis aparecem aqui quando houver anúncio publicado.</SemDado>
            </div>
          ) : visiveis.length === 0 ? (
            <div className="px-2">
              <SemDado>Nenhum imóvel deste tipo está no ar.</SemDado>
            </div>
          ) : (
            <ol className="flex flex-col gap-0.5">
              {naTela.map((m) => (
                <li key={m.codigo}>
                  <LinhaDoRanking imovel={m} maximo={maximo} ativa={m.codigo === escolhido} aoEscolher={escolher} />
                </li>
              ))}
            </ol>
          )}
          {visiveis.length > NA_LISTA ? (
            <Button variant="ghost" className="toque mx-2 h-11 self-start md:h-8" onClick={() => setTodos((v) => !v)}>
              {todos ? 'Mostrar menos' : `Mostrar os ${inteiro(visiveis.length)} imóveis`}
            </Button>
          ) : null}
        </Cartao>

        <div ref={detalhe} className="scroll-mt-4">
          {linha ? (
            <Detalhe
              key={linha.codigo}
              linha={linha}
              periodo={periodo}
              ehOMaisProcurado={topo?.codigo === linha.codigo}
            />
          ) : (
            <section className="sombra-base rounded-xl bg-card p-5">
              <SemDado>Escolha um imóvel na lista para ver os leads e o que falar.</SemDado>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function Pilula({
  ativa,
  aoClicar,
  pequena = false,
  children,
}: {
  ativa: boolean;
  aoClicar: () => void;
  pequena?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativa}
      onClick={aoClicar}
      className={cn(
        'toque inline-flex h-11 items-center rounded-full px-3 font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card focus-visible:outline-none',
        pequena ? 'text-xs md:h-7' : 'text-[13px] md:h-8',
        ativa ? 'bg-foreground text-background' : 'hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}

function LinhaDoRanking({
  imovel: m,
  maximo,
  ativa,
  aoEscolher,
}: {
  imovel: LinhaImovel;
  maximo: number;
  ativa: boolean;
  aoEscolher: (codigo: string) => void;
}) {
  const total = contagem(m.total);
  return (
    <Dica texto={textoDoInteresse(m)} lado="top">
      <button
        type="button"
        aria-pressed={ativa}
        aria-label={`${m.titulo}, ${m.codigo}: ${contar(total, 'lead', 'leads')} (${textoDoInteresse(m)})`}
        onClick={() => aoEscolher(m.codigo)}
        className={cn(
          'toque grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)_1.75rem] items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2.5 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          ativa ? 'bg-muted shadow-[inset_3px_0_0_var(--foreground)]' : 'hover:bg-muted',
        )}
      >
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] leading-snug font-semibold">{m.titulo}</span>
          <span className="numerico truncate text-[11px] text-muted-foreground">
            {m.codigo} · {precoCurto(m.preco_venda, m.preco_aluguel)}
          </span>
        </span>
        <BarraEmpilhada
          maximo={maximo}
          segmentos={[
            { valor: contagem(m.muito), cor: 'muito' },
            { valor: contagem(m.interessado), cor: 'interessado' },
            { valor: contagem(m.morno), cor: 'morno' },
          ]}
        />
        <span className="numerico text-right text-sm font-medium">{inteiro(total)}</span>
        <span className="col-span-3 truncate text-xs">
          {m.lider ? (
            <>
              Mais quente: {m.lider.nome} · calor <span className="numerico">{inteiro(m.lider.calor)}</span>
            </>
          ) : (
            <span className="text-muted-foreground">Nenhum lead interessado no período</span>
          )}
        </span>
      </button>
    </Dica>
  );
}

function Detalhe({
  linha: m,
  periodo,
  ehOMaisProcurado,
}: {
  linha: LinhaImovel;
  periodo: Periodo;
  ehOMaisProcurado: boolean;
}) {
  const consulta = useQuery({
    queryKey: ['relatorios', 'vende-imovel', m.codigo, periodo.de, periodo.ate],
    queryFn: () => carregarDetalheImovel(m.codigo, periodo),
  });

  return (
    <section
      aria-labelledby={`imovel-${m.codigo}`}
      className="sombra-base flex min-w-0 flex-col gap-5 rounded-xl bg-card p-4 md:p-5"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`imovel-${m.codigo}`} className="text-xl leading-tight font-semibold tracking-[-0.01em] md:text-[22px]">
              {m.titulo}
            </h3>
            {ehOMaisProcurado ? (
              <span className="inline-flex h-5 items-center rounded-full bg-foreground px-2 text-[11px] font-semibold text-background">
                O mais procurado
              </span>
            ) : null}
          </div>
          <p className="numerico text-[13px] text-muted-foreground">
            {[
              m.codigo,
              precoCurto(m.preco_venda, m.preco_aluguel),
              m.bairro,
              numero(m.dias_no_ar) !== null ? `${dias(m.dias_no_ar)} no ar` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <p className="flex items-baseline gap-2">
          <span className="numerico text-[40px] leading-none font-medium">{inteiro(contagem(m.total))}</span>
          <span className="text-[13px] leading-snug">
            {contagem(m.total) === 1 ? 'lead interessado' : 'leads interessados'}
            <br />
            <strong className="font-semibold">{inteiro(contagem(m.muito))}</strong>{' '}
            {contagem(m.muito) === 1 ? 'muito interessado' : 'muito interessados'}
          </span>
        </p>
      </header>

      {consulta.isPending ? (
        <EsqueletoDoDetalhe />
      ) : consulta.isError ? (
        <ErroDoRelatorio causa={mensagemDoErro(consulta.error)} aoTentar={() => void consulta.refetch()} />
      ) : !consulta.data ? (
        <SemDado>O banco não devolveu o detalhe deste imóvel.</SemDado>
      ) : (
        <CorpoDoDetalhe dados={consulta.data} />
      )}
    </section>
  );
}

function EsqueletoDoDetalhe() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">Carregando o imóvel.</span>
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="flex flex-col gap-2 border-t border-hairline pt-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </div>
  );
}

function CorpoDoDetalhe({ dados }: { dados: DetalheImovel }) {
  return (
    <>
      <FunilDoAnuncio funil={dados.funil} />
      <LeadsDoImovel dados={dados} />
      <ParaVender dados={dados} />
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        <SemanasDoImovel dados={dados} />
        <ListaDeContagem
          titulo="O que mais perguntam"
          itens={lista(dados.perguntas).map((p) => ({ rotulo: p.tema, n: contagem(p.leads) }))}
          vazio="Nenhuma pergunta anotada pela IA neste imóvel."
        />
        <ListaDeContagem
          titulo="Objeções"
          itens={lista(dados.objecoes).map((o) => ({ rotulo: o.objecao, n: contagem(o.leads) }))}
          vazio="Nenhuma objeção anotada neste imóvel."
        />
      </div>
    </>
  );
}

function FunilDoAnuncio({ funil }: { funil: DetalheImovel['funil'] | null | undefined }) {
  if (!funil) return null;
  const vis = numero(funil.visualizacoes);
  const cont = numero(funil.contatos);
  const int = contagem(funil.interessados);
  const vist = contagem(funil.visitas);
  const prop = contagem(funil.propostas);
  /** "1,1% de quem viu", "32% dos interessados"; nulo sem denominador. */
  const taxa = (parte: number | null, todo: number | null, de: string) => {
    if (parte === null || todo === null || todo <= 0) return null;
    const t = (parte / todo) * 100;
    return `${t < 10 ? decimalEnxuto(t) : Math.round(t)}% ${de}`;
  };

  const passos: { n: string; nome: string; taxa: string | null; fraca?: boolean }[] = [
    { n: vis === null ? '—' : inteiro(vis), nome: 'visualizações', taxa: vis === null ? 'sem dado do portal' : null },
    {
      n: cont === null ? '—' : inteiro(cont),
      nome: 'contatos',
      taxa: cont === null ? 'sem dado do portal' : taxa(cont, vis, 'de quem viu'),
    },
    { n: inteiro(int), nome: 'interessados', taxa: taxa(int, cont, 'dos contatos') },
    // Menos de 30% dos interessados visitando, ou visita sem proposta nenhuma: a
    // passagem que trava aparece marcada (seta + texto, não só a cor).
    { n: inteiro(vist), nome: 'visitas', taxa: taxa(vist, int, 'dos interessados'), fraca: int > 0 && vist / int < 0.3 },
    { n: inteiro(prop), nome: 'propostas', taxa: taxa(prop, vist, 'das visitas'), fraca: vist > 0 && prop === 0 },
  ];

  return (
    <div role="group" aria-label="Do anúncio à proposta" className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
      {passos.map((p) => (
        <Quadrinho
          key={p.nome}
          numero={p.n}
          texto={p.nome}
          apoio={
            p.taxa ? (
              <span
                className={cn(
                  'numerico inline-flex items-center gap-0.5 text-[11px] leading-snug',
                  p.fraca ? 'font-semibold text-quente-texto' : 'text-muted-foreground',
                )}
              >
                {p.fraca ? <TrendingDown className="size-3 shrink-0" aria-hidden="true" /> : null}
                {p.taxa}
                {p.fraca ? <span className="sr-only">, abaixo do esperado</span> : null}
              </span>
            ) : null
          }
        />
      ))}
    </div>
  );
}

function LeadsDoImovel({ dados }: { dados: DetalheImovel }) {
  const leads = lista(dados.leads);
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-[15px] font-semibold">Leads mais interessados e o que falar com cada um</h4>
        <p className="text-[11px] text-muted-foreground">
          Calor de 0 a 100: interesse lido pela IA, quão recente foi o contato e se há visita
        </p>
      </div>
      {leads.length === 0 ? (
        <SemDado>Nenhum lead interessado neste imóvel no período.</SemDado>
      ) : (
        <ol className="flex flex-col">
          {leads.map((l, i) => (
            <li
              key={l.conversation_id}
              className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3 gap-y-2 border-t border-hairline py-3 md:grid-cols-[1.25rem_minmax(9rem,0.9fr)_minmax(0,1.6fr)_auto] md:items-start"
            >
              <span className="numerico pt-px text-[13px] text-muted-foreground">{i + 1}</span>
              <span className="flex min-w-0 flex-col gap-1.5">
                <span className="truncate text-sm font-semibold">{l.nome}</span>
                <span className="flex items-center gap-2">
                  <BarraDeCalor calor={numero(l.calor)} cor={COR_DO_NIVEL[l.nivel] ?? 'resto'} />
                  <span className="numerico text-xs font-semibold">{inteiro(l.calor)}</span>
                  <span className="text-[11px] text-muted-foreground">{rotuloDoNivel(l.nivel)}</span>
                </span>
                {l.dono ? (
                  <span className="text-[11px] text-muted-foreground">com {l.dono}</span>
                ) : (
                  <span className="text-[11px] font-semibold text-quente-texto">Sem dono</span>
                )}
              </span>
              <span className="col-start-2 flex min-w-0 flex-col gap-1.5 md:col-start-3">
                {l.situacao ? <span className="text-xs leading-snug text-muted-foreground">{l.situacao}</span> : null}
                {l.falar ? (
                  <span className={cn('rounded-lg px-2.5 py-2 text-[13px] leading-snug', FUNDO_DA_IA)}>
                    <strong className="font-semibold">IA sugere:</strong> {l.falar}
                  </span>
                ) : null}
              </span>
              <Button
                asChild
                variant="outline"
                size="sm"
                className="toque col-start-2 h-11 justify-self-start md:col-start-4 md:h-8 md:justify-self-end"
              >
                <Link href={linkDoLead(l)}>
                  <MessageCircle aria-hidden="true" />
                  Abrir conversa
                  <span className="sr-only"> com {l.nome}</span>
                </Link>
              </Button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ParaVender({ dados }: { dados: DetalheImovel }) {
  const sugestoes = lista(dados.sugestoes);
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-[15px] font-semibold">Para vender este imóvel</h4>
        <SeloIA />
        {dados.sugestoes_em ? (
          <span className="text-[11px] text-muted-foreground">lidas {haQuantoCurto(dados.sugestoes_em)}</span>
        ) : null}
      </div>
      {sugestoes.length === 0 ? (
        <SemDado>A IA ainda não leu este imóvel. As sugestões aparecem depois da próxima leitura.</SemDado>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]">
          {sugestoes.map((s, i) => (
            <li key={i} className="flex flex-col gap-1.5 rounded-lg px-3.5 py-3 ring-1 ring-border ring-inset">
              <span
                className={cn(
                  'inline-flex h-5 items-center self-start rounded-full px-2 text-[11px] font-semibold',
                  s.tipo === 'falar' ? FUNDO_DA_IA : 'bg-muted',
                )}
              >
                {s.tipo === 'falar' ? 'Falar' : 'Fazer'}
              </span>
              <span className="text-sm leading-snug font-semibold">{s.acao}</span>
              <span className="text-xs leading-relaxed text-muted-foreground">{s.porque}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SemanasDoImovel({ dados }: { dados: DetalheImovel }) {
  const semanas = lista(dados.semanas);
  const maximo = Math.max(1, ...semanas.map((s) => contagem(s.novos)));
  const entrada = dados.entrou_no_ar_em
    ? indiceDaSemana(
        semanas.map((s) => s.inicio),
        dados.entrou_no_ar_em,
      )
    : -1;
  return (
    <figure className="flex min-w-0 flex-col gap-2.5">
      <figcaption className="flex flex-col gap-0.5">
        <span className="text-sm leading-snug font-semibold">
          {tituloDasSemanasDoImovel(semanas, dados.entrou_no_ar_em)}
        </span>
        <span className="text-xs text-muted-foreground">Leads novos interessados, por semana (8 semanas)</span>
      </figcaption>
      {semanas.length === 0 ? (
        <SemDado>Sem semanas para mostrar.</SemDado>
      ) : (
        <div className="pt-4">
          <Colunas
            maximo={maximo}
            altura="h-24"
            itens={semanas.map((s, i) => ({
              chave: s.inicio,
              valor: contagem(s.novos),
              destaque: i >= semanas.length - 2,
              marca: i === entrada ? 'entrou no ar' : undefined,
              eixo: i === 0 ? diaMes(s.inicio) : i === semanas.length - 1 ? 'esta' : undefined,
              dica: `Semana de ${diaMes(s.inicio)} · ${contar(contagem(s.novos), 'lead novo', 'leads novos')}`,
              aria: `Semana de ${diaMes(s.inicio)}: ${contar(contagem(s.novos), 'lead novo', 'leads novos')}`,
            }))}
          />
        </div>
      )}
    </figure>
  );
}

function ListaDeContagem({
  titulo,
  itens,
  vazio,
}: {
  titulo: string;
  itens: readonly { rotulo: string; n: number }[];
  vazio: string;
}) {
  const maximo = Math.max(1, ...itens.map((x) => x.n));
  const total = itens.reduce((s, x) => s + x.n, 0);
  return (
    <figure className="flex min-w-0 flex-col gap-2.5">
      <figcaption className="text-sm font-semibold">{titulo}</figcaption>
      {itens.length === 0 ? (
        <SemDado>{vazio}</SemDado>
      ) : (
        <ul className="flex flex-col gap-2">
          {itens.map((x) => (
            <li key={x.rotulo} className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_1.5rem] items-center gap-2 text-xs">
              <span className="min-w-0 truncate first-letter:uppercase">{x.rotulo}</span>
              <Dica texto={`${contar(x.n, 'lead', 'leads')}${parteDe(x.n, total) !== null ? ` · ${parteDe(x.n, total)}% das menções` : ''}`}>
                <button type="button" aria-label={`${x.rotulo}: ${contar(x.n, 'lead', 'leads')}`} className={cn(ALVO, 'py-1')}>
                  <Barra valor={x.n} maximo={maximo} altura="h-2.5" />
                </button>
              </Dica>
              <span className="numerico text-right">{inteiro(x.n)}</span>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}
