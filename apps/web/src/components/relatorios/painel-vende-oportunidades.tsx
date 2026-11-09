'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MessageCircle, Sparkles } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import { linkDoLead } from './dados-imova';
import {
  carregarPainelOportunidades,
  type LinhaDaFila,
  type LinhaSituacao,
  type NivelDeInteresse,
  type PainelOportunidades,
  type Premissas,
  type SituacaoParada,
} from './dados-vende';
import {
  contagem,
  contar,
  decimalEnxuto,
  deltaDe,
  dias,
  dinheiroCurto,
  horaEmNatal,
  inteiro,
  lista,
  numero,
  ordenarFila,
  pctDaChance,
  rotuloDaSituacao,
  rotuloDoNivel,
  SITUACOES_EM_ORDEM,
  situacaoUrgente,
  tempoDaSituacao,
  tituloDasSituacoes,
  tituloDosDonos,
} from './formatos-vende';
import {
  Barra,
  BarraDeCalor,
  Cartao,
  FilaDeKpis,
  FUNDO_DA_IA,
  MolduraDaAba,
  Rodape,
  SemDado,
  SOMBRA_DE_ROLAGEM_NO_CARTAO,
  TiraKpi,
  type Cor,
} from './graficos-vende';
import { PremissasDaConta } from './premissas-vende';
import type { DefinicaoPainel } from './tipos';

/** Quantas linhas a fila mostra antes do "Mostrar todos". */
const NA_FILA = 15;

const COR_DO_NIVEL: Record<NivelDeInteresse, Cor> = {
  muito: 'muito',
  interessado: 'interessado',
  morno: 'morno',
};

/**
 * Oportunidades (09/11/2026): o retrato de AGORA — sem barra de período. Quanto de
 * comissão provável está parado, em que situação, com quem, e a fila de hoje, lead a
 * lead, com o que fazer. Escolher uma situação (no gráfico ou nas pílulas) filtra a
 * fila.
 *
 * Lê `relatorio_imova_painel_oportunidades()` (`dados-vende.ts`).
 */
export function PainelVendeOportunidades({ painel }: { painel: DefinicaoPainel }) {
  const consulta = useQuery({
    queryKey: ['relatorios', 'vende-oportunidades'],
    queryFn: carregarPainelOportunidades,
  });
  const atualizado = consulta.data?.atualizado_em ?? null;

  return (
    <MolduraDaAba
      painel={painel}
      consulta={consulta}
      tiras={4}
      apoio={
        <>
          <p className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <span aria-hidden="true" className="size-2 rounded-full bg-cliente" />
            Situação de agora{atualizado ? ` · atualizado às ${horaEmNatal(atualizado)}` : ''}
          </p>
          <PremissasDaConta premissas={consulta.data?.premissas} />
        </>
      }
    >
      {(dados) => <Conteudo dados={dados} />}
    </MolduraDaAba>
  );
}

function Conteudo({ dados }: { dados: PainelOportunidades }) {
  const [filtro, setFiltro] = useState<SituacaoParada | null>(null);
  const situacoes = lista(dados.situacoes).filter((s) => contagem(s.leads) > 0);
  const maisAntiga = dados.mais_antiga;

  return (
    <div className="flex flex-col gap-4">
      <FilaDeKpis colunas={4}>
        <TiraKpi
          rotulo="Comissão provável parada"
          valor={dinheiroCurto(dados.valor)}
          delta={deltaDe(dados.valor, dados.valor_ontem, 'dinheiro', { menorEMelhor: true })}
          apoio={numero(dados.valor_ontem) === null ? 'agora · subir é ruim' : 'desde ontem · subir é ruim'}
        />
        <TiraKpi
          rotulo="Leads parados"
          valor={inteiro(contagem(dados.leads))}
          delta={deltaDe(dados.leads, dados.leads_ontem, 'contagem', { menorEMelhor: true })}
          apoio="com chance de negócio e sem ação em dia"
        />
        <TiraKpi
          rotulo="Resolvidas ontem"
          valor={numero(dados.resolvidas_ontem) === null ? '—' : inteiro(dados.resolvidas_ontem)}
          apoio="leads que saíram da fila ontem"
        />
        <TiraKpi
          rotulo="A mais antiga"
          valor={maisAntiga ? dias(maisAntiga.dias) : '—'}
          apoio={
            maisAntiga ? `${maisAntiga.nome} · ${rotuloDaSituacao(maisAntiga.situacao)}` : 'nenhum lead parado agora'
          }
        />
      </FilaDeKpis>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <PorSituacao situacoes={situacoes} filtro={filtro} aoFiltrar={setFiltro} premissas={dados.premissas} />
        <PorDono donos={lista(dados.donos)} />
      </div>

      <Fila dados={dados} situacoes={situacoes} filtro={filtro} aoFiltrar={setFiltro} />
    </div>
  );
}

function PorSituacao({
  situacoes,
  filtro,
  aoFiltrar,
  premissas,
}: {
  situacoes: readonly LinhaSituacao[];
  filtro: SituacaoParada | null;
  aoFiltrar: (s: SituacaoParada | null) => void;
  premissas: Premissas | null | undefined;
}) {
  const ordem = [...situacoes].sort((a, b) => (numero(b.valor) ?? 0) - (numero(a.valor) ?? 0));
  const maximo = Math.max(1, ...ordem.map((s) => numero(s.valor) ?? 0));
  const alugueis = numero(premissas?.alugueis_na_locacao);

  return (
    <Cartao
      grande
      titulo={tituloDasSituacoes(situacoes)}
      sub="Comissão provável por situação. Escolha uma para filtrar a fila."
    >
      {ordem.length === 0 ? (
        <SemDado>Nenhum lead com chance de negócio está parado. A fila de hoje está vazia.</SemDado>
      ) : (
        <ul className="-mx-2 flex flex-col gap-0.5">
          {ordem.map((s) => {
            const ativa = filtro === s.situacao;
            return (
              <li key={s.situacao}>
                <button
                  type="button"
                  aria-pressed={ativa}
                  onClick={() => aoFiltrar(ativa ? null : s.situacao)}
                  className={cn(
                    'toque grid min-h-12 w-full grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_4.75rem] items-center gap-3 rounded-lg px-2.5 py-1.5 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_5.25rem]',
                    ativa ? 'bg-muted' : 'hover:bg-muted',
                  )}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="text-[13px] leading-snug font-semibold">{rotuloDaSituacao(s.situacao, 'longo')}</span>
                    <span className="text-[11px] text-muted-foreground">{contar(contagem(s.leads), 'lead', 'leads')}</span>
                  </span>
                  <Barra
                    valor={numero(s.valor)}
                    maximo={maximo}
                    cor={filtro === null || ativa ? 'tinta' : 'resto'}
                  />
                  <span className="numerico text-right text-[13px] font-medium">{dinheiroCurto(s.valor)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <Rodape>
        Comissão provável ={' '}
        {premissas
          ? `${decimalEnxuto(premissas.comissao_venda_pct)}% do valor na venda ou ${
              alugueis === null ? 'a comissão' : `${decimalEnxuto(alugueis)} ${alugueis > 0 && alugueis <= 1 ? 'aluguel' : 'aluguéis'}`
            } na locação`
          : 'a comissão da venda ou da locação'}
        , vezes a chance da etapa nos últimos 90 dias.
      </Rodape>
    </Cartao>
  );
}

function PorDono({ donos }: { donos: readonly PainelOportunidades['donos'][number][] }) {
  const ordem = [...donos]
    .filter((d) => contagem(d.leads) > 0)
    .sort((a, b) => (numero(b.valor) ?? 0) - (numero(a.valor) ?? 0));
  const maximo = Math.max(1, ...ordem.map((d) => numero(d.valor) ?? 0));
  const temSemDono = ordem.some((d) => d.dono === null);
  const destaque = temSemDono ? null : (ordem[0]?.dono ?? null);

  return (
    <Cartao grande titulo={tituloDosDonos(donos)} sub="Comissão provável parada, por responsável.">
      {ordem.length === 0 ? (
        <SemDado>Ninguém tem lead parado agora.</SemDado>
      ) : (
        <ul className="flex flex-col gap-3">
          {ordem.map((d) => {
            const forte = d.dono === null ? temSemDono : d.dono === destaque;
            return (
              <li
                key={d.dono ?? 'sem-dono'}
                className="grid grid-cols-[minmax(0,5.5rem)_minmax(0,1fr)_4.75rem_2.25rem] items-center gap-2.5 text-[13px]"
              >
                <span className={cn('truncate', forte && 'font-semibold', d.dono === null && 'text-quente-texto')}>
                  {d.dono ?? 'Sem dono'}
                </span>
                <Barra valor={numero(d.valor)} maximo={maximo} cor={forte ? 'tinta' : 'resto'} />
                <span className="numerico text-right font-medium">{dinheiroCurto(d.valor)}</span>
                <span className="numerico text-right text-muted-foreground">
                  {inteiro(contagem(d.leads))}
                  <span className="sr-only"> {contagem(d.leads) === 1 ? 'lead' : 'leads'}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <Rodape>À direita, quantos leads.</Rodape>
    </Cartao>
  );
}

function Fila({
  dados,
  situacoes,
  filtro,
  aoFiltrar,
}: {
  dados: PainelOportunidades;
  situacoes: readonly LinhaSituacao[];
  filtro: SituacaoParada | null;
  aoFiltrar: (s: SituacaoParada | null) => void;
}) {
  const [todos, setTodos] = useState(false);
  const fila = ordenarFila(lista(dados.fila));
  const filtrada = filtro === null ? fila : fila.filter((l) => l.situacao === filtro);
  const naTela = todos ? filtrada : filtrada.slice(0, NA_FILA);
  const total =
    filtro === null
      ? Math.max(contagem(dados.leads), fila.length)
      : Math.max(contagem(situacoes.find((s) => s.situacao === filtro)?.leads), filtrada.length);
  const pilulas = SITUACOES_EM_ORDEM.map((s) => ({ s, n: contagem(situacoes.find((x) => x.situacao === s)?.leads) })).filter(
    (p) => p.n > 0,
  );
  const agora = new Date();

  return (
    <section className="sombra-base flex min-w-0 flex-col gap-3 rounded-xl bg-card pt-4 pb-1.5 md:pt-5" aria-labelledby="fila-de-hoje">
      <div className="flex flex-col gap-0.5 px-4 md:px-5">
        <h3 id="fila-de-hoje" className="text-[17px] font-semibold">
          Fila de hoje
        </h3>
        <p className="text-xs text-muted-foreground">
          Primeiro quem espera resposta; depois o maior valor provável. O que tem{' '}
          <Sparkles className="inline size-3 align-[-1px]" aria-hidden="true" />
          <span className="sr-only">o ícone de brilho</span> é sugestão da IA; o
          resto é o passo padrão da situação.
        </p>
      </div>

      <div role="group" aria-label="Filtrar a fila" className="flex flex-wrap gap-0.5 px-3 md:px-4">
        <PilulaDaFila ativa={filtro === null} aoClicar={() => aoFiltrar(null)} n={contagem(dados.leads)}>
          Todos
        </PilulaDaFila>
        {pilulas.map((p) => (
          <PilulaDaFila key={p.s} ativa={filtro === p.s} aoClicar={() => aoFiltrar(p.s)} n={p.n}>
            {rotuloDaSituacao(p.s)}
          </PilulaDaFila>
        ))}
      </div>

      {filtrada.length === 0 ? (
        <div className="px-4 pb-3 md:px-5">
          <SemDado>
            {fila.length === 0
              ? 'Ninguém na fila: todo lead com chance de negócio tem uma ação em dia.'
              : 'Nenhum lead nesta situação agora.'}
          </SemDado>
        </div>
      ) : (
        // `relative`: o texto só para leitor de tela (`sr-only`) é absoluto e, sem um
        // contêiner posicionado, escapa da rolagem e alarga a página no celular.
        <div className="relative overflow-x-auto" style={SOMBRA_DE_ROLAGEM_NO_CARTAO}>
          <table className="w-full min-w-[1080px] border-collapse text-[13px]">
            <caption className="sr-only">Fila de hoje: os leads parados, um por linha</caption>
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th scope="col" className="w-10 py-2 pr-2 pl-4 font-semibold md:pl-5">
                  #
                </th>
                <th scope="col" className="px-2 py-2 font-semibold">
                  Lead e calor
                </th>
                <th scope="col" className="px-2 py-2 font-semibold">
                  Imóvel
                </th>
                <th scope="col" className="px-2 py-2 font-semibold">
                  Situação
                </th>
                <th scope="col" className="px-2 py-2 font-semibold">
                  O que fazer
                </th>
                <th scope="col" className="px-2 py-2 text-right font-semibold">
                  Em jogo
                </th>
                <th scope="col" className="px-2 py-2 font-semibold">
                  Com quem
                </th>
                <th scope="col" className="py-2 pr-4 pl-2 md:pr-5">
                  <span className="sr-only">Conversa</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {naTela.map((l, i) => (
                <LinhaDaTabela key={`${l.conversation_id}-${l.situacao}`} linha={l} posicao={i + 1} agora={agora} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline px-4 py-2 md:px-5">
        <p className="text-xs text-muted-foreground">
          Mostrando {inteiro(naTela.length)} de {inteiro(total)} {total === 1 ? 'lead parado' : 'leads parados'}
          {filtro ? ` em “${rotuloDaSituacao(filtro)}”` : ''}.
          {filtrada.length < total && naTela.length === filtrada.length
            ? ` A fila traz os ${inteiro(fila.length)} mais urgentes.`
            : ''}
        </p>
        {filtrada.length > NA_FILA ? (
          <Button variant="ghost" className="toque h-11 md:h-8" onClick={() => setTodos((v) => !v)}>
            {todos ? 'Mostrar menos' : `Mostrar os ${inteiro(filtrada.length)}`}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function PilulaDaFila({
  ativa,
  aoClicar,
  n,
  children,
}: {
  ativa: boolean;
  aoClicar: () => void;
  n: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativa}
      onClick={aoClicar}
      className={cn(
        'toque inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card focus-visible:outline-none md:h-8',
        ativa ? 'bg-foreground text-background' : 'hover:bg-muted',
      )}
    >
      {children}
      <span className="numerico text-xs opacity-75">{inteiro(n)}</span>
    </button>
  );
}

function LinhaDaTabela({ linha: l, posicao, agora }: { linha: LinhaDaFila; posicao: number; agora: Date }) {
  const urgente = situacaoUrgente(l.situacao);
  const tempo = tempoDaSituacao(l.situacao, l.desde, agora);
  return (
    <tr className="border-t border-hairline align-middle">
      <td className="numerico py-3 pr-2 pl-4 text-muted-foreground md:pl-5">{posicao}</td>
      <td className="px-2 py-3">
        <span className="flex min-w-[9rem] flex-col gap-1.5">
          <span className="text-sm font-semibold">{l.nome}</span>
          <span className="flex items-center gap-2">
            <BarraDeCalor calor={numero(l.calor)} cor={l.nivel ? COR_DO_NIVEL[l.nivel] : 'resto'} />
            <span className="numerico text-xs font-semibold">{inteiro(l.calor)}</span>
            <span className="text-[11px] text-muted-foreground">{rotuloDoNivel(l.nivel)}</span>
          </span>
        </span>
      </td>
      <td className="px-2 py-3">
        {l.codigo || l.imovel ? (
          <span className="flex max-w-[12rem] flex-col gap-0.5">
            {l.codigo ? <span className="numerico text-xs font-semibold">{l.codigo}</span> : null}
            {l.imovel ? <span className="text-xs leading-snug text-muted-foreground">{l.imovel}</span> : null}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-2 py-3">
        <span className="flex max-w-[14rem] flex-col gap-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                'inline-flex h-5 items-center rounded-full px-2 text-[11px] font-semibold whitespace-nowrap',
                urgente ? 'bg-quente-fundo text-quente-texto' : 'bg-muted',
              )}
            >
              {rotuloDaSituacao(l.situacao)}
            </span>
            {tempo ? (
              <span className={cn('numerico text-[11px]', urgente ? 'font-semibold text-quente-texto' : 'text-muted-foreground')}>
                {tempo}
              </span>
            ) : null}
          </span>
          <span className="text-xs leading-snug text-muted-foreground">{l.porque}</span>
        </span>
      </td>
      <td className="px-2 py-3">
        <span
          className={cn(
            'flex max-w-[22rem] min-w-[14rem] items-start gap-1.5 rounded-lg px-2.5 py-2 leading-snug',
            l.fazer_da_ia ? FUNDO_DA_IA : 'bg-muted',
          )}
        >
          {l.fazer_da_ia ? (
            <>
              <Sparkles className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
              <span className="sr-only">Sugestão da IA: </span>
            </>
          ) : null}
          <span>{l.fazer}</span>
        </span>
      </td>
      <td className="px-2 py-3 text-right">
        <span className="flex flex-col items-end gap-0.5">
          <span className="numerico font-medium">{dinheiroCurto(l.valor)}</span>
          <span className="text-[11px] whitespace-nowrap text-muted-foreground">chance {pctDaChance(l.chance)}</span>
        </span>
      </td>
      <td className="px-2 py-3">
        {l.dono ? (
          <span className="whitespace-nowrap">{l.dono}</span>
        ) : (
          <span className="font-semibold whitespace-nowrap text-quente-texto">Sem dono</span>
        )}
      </td>
      <td className="py-3 pr-4 pl-2 text-right md:pr-5">
        <Button asChild variant="outline" size="sm" className="toque h-9 md:h-8">
          <Link href={linkDoLead(l)}>
            <MessageCircle aria-hidden="true" />
            Abrir conversa
            <span className="sr-only"> com {l.nome}</span>
          </Link>
        </Button>
      </td>
    </tr>
  );
}
