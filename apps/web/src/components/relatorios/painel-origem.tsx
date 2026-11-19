'use client';

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { cn } from '@/lib/utils';
import { APARENCIA_DO_CANAL } from '@/components/conversas/canal-de-chegada-regra';

import { chaveDoRelatorio, mensagemDoErro } from './dados';
import { linkDaConversa } from './dados-imova';
import {
  carregarPainelOrigem,
  marcarAnuncioDaMeta,
  type AnuncioDaMeta,
  type GrupoDeOrigem,
  type LinhaDoAnuncio,
  type LinhaDoGrupo,
  type MesDaOrigem,
  type PainelOrigem as DadosDaOrigem,
} from './dados-vende';
import {
  achadosDaOrigem,
  contatosDaLinha,
  divisaoDosMeses,
  GRUPOS_DE_ORIGEM,
  grupoQueMaisTrouxe,
  leituraDoAnuncio,
  mesCurto,
  notaDoGrupo,
  ordenarAnuncios,
  porDia,
  ROTULO_CURTO_DO_GRUPO,
  ROTULO_DO_GRUPO,
  rotuloDoSubcanal,
  separarAnuncios,
  tempoCurto,
  vistosDaLinha,
  type Achado,
  type AlvoDaOrigem,
  type OrdemDosAnuncios,
} from './formatos-origem';
import {
  contagem,
  contar,
  diaMes,
  encurtar,
  horaEmNatal,
  inteiro,
  lista,
  nomeDoMes,
  numero,
  parteDe,
  plural,
} from './formatos-vende';
import {
  Barra,
  Cartao,
  FilaDeKpis,
  MolduraDaAba,
  Rodape,
  SemDado,
  SOMBRA_DE_ROLAGEM_NO_CARTAO,
  TiraKpi,
} from './graficos-vende';
import { faixaDoPeriodo, type Periodo } from './periodo';
import type { DefinicaoPainel } from './tipos';

/**
 * Origem e interesse (18/11/2026): de onde vêm os clientes e como o sistema lida
 * com eles. O protótipo aprovado no mesmo dia, com os números de verdade.
 *
 * Lê `relatorio_imova_painel_origem(p_de, p_ate)` (`dados-vende.ts`): as chegadas
 * do período por caminho (a Meta à parte dos portais, cada anúncio da Meta pelo
 * nome), anúncio a anúncio, o interesse, as semanas, até seis meses e o
 * atendimento. Admin e gestor dizem se um anúncio da Meta é da Imova.
 */

/** A cor de cada caminho: a mesma do chip de canal da conversa; a Meta é o lilás claro dos anúncios. */
const COR_DO_GRUPO: Readonly<Record<GrupoDeOrigem, string>> = {
  placa: APARENCIA_DO_CANAL.placa.cor,
  meta: '#a98be0',
  portais: APARENCIA_DO_CANAL.anuncios.cor,
  redes_sociais: APARENCIA_DO_CANAL.redes_sociais.cor,
  outros: APARENCIA_DO_CANAL.outros.cor,
  nao_identificado: 'var(--vende-resto)',
};

/** O id de cada bloco, para os botões dos achados levarem até ele. */
const ID_DO_BLOCO: Readonly<Record<AlvoDaOrigem, string>> = {
  origem: 'origem-de-onde',
  anuncios: 'origem-anuncios',
  interesse: 'origem-interesse',
  meses: 'origem-meses',
  sistema: 'origem-sistema',
};

function irAoBloco(alvo: AlvoDaOrigem) {
  const el = document.getElementById(ID_DO_BLOCO[alvo]);
  if (!el) return;
  const reduzido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduzido ? 'auto' : 'smooth', block: 'start' });
}

const BLOCO = 'scroll-mt-(--topo-relatorios)';

/** Quantas chegadas sem resposta a lista mostra antes do "Mostrar todas". */
const SEM_RESPOSTA_NA_LISTA = 6;

export function PainelOrigem({ painel, periodo }: { painel: DefinicaoPainel; periodo: Periodo }) {
  const consulta = useQuery({
    queryKey: chaveDoRelatorio('origem', periodo),
    queryFn: () => carregarPainelOrigem(periodo),
  });
  const desde = consulta.data?.desde ?? null;

  return (
    <MolduraDaAba
      painel={painel}
      consulta={consulta}
      tiras={6}
      apoio={
        <p className="text-xs text-muted-foreground">
          Chegadas de {faixaDoPeriodo(periodo)}
          {desde ? (
            <>
              <span> · </span>O CRM recebe clientes desde {diaMes(desde)}
            </>
          ) : null}
        </p>
      }
    >
      {(dados) => <Conteudo dados={dados} periodo={periodo} />}
    </MolduraDaAba>
  );
}

function Conteudo({ dados, periodo }: { dados: DadosDaOrigem; periodo: Periodo }) {
  const achados = useMemo(() => achadosDaOrigem(dados), [dados]);
  return (
    <div className="flex flex-col gap-4 md:gap-5">
      {achados.length > 0 ? <Achados achados={achados} /> : null}
      <Numeros dados={dados} />
      <DeOndeVieram dados={dados} periodo={periodo} />
      <AnuncioAAnuncio dados={dados} />
      <Interesse dados={dados} />
      <MesAMes meses={lista(dados.meses)} />
      <ComoOSistemaLida dados={dados} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// O que o período diz
// ---------------------------------------------------------------------------

const TOM_DO_SELO: Record<Achado['tom'], string> = {
  neutro: 'bg-muted text-muted-foreground',
  atencao: 'bg-morno-fundo text-morno-texto',
  alerta: 'bg-quente-fundo text-quente-texto',
};

function Achados({ achados }: { achados: readonly Achado[] }) {
  return (
    <section aria-label="O que o período diz" className="grid gap-3 md:grid-cols-3 md:gap-4">
      {achados.map((a) => (
        <article
          key={a.chave}
          className="sombra-base flex min-w-0 flex-col gap-2 rounded-xl border border-hairline bg-card p-4 md:p-5"
        >
          <span className={cn('self-start rounded-full px-2 py-0.5 text-[11px] font-semibold', TOM_DO_SELO[a.tom])}>
            {a.selo}
          </span>
          <h3 className="text-[15px] leading-snug font-semibold tracking-[-0.01em] text-balance">{a.titulo}</h3>
          <p className="text-[13px] leading-relaxed text-muted-foreground">{a.texto}</p>
          {a.acao ? (
            <button
              type="button"
              onClick={() => irAoBloco(a.acao!.alvo)}
              className="toque group/ir mt-auto inline-flex min-h-11 items-center gap-1 self-start rounded-md text-[13px] font-semibold text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:min-h-9"
            >
              {a.acao.rotulo}
              <ChevronRight className="size-4 transition-transform group-hover/ir:translate-x-0.5" aria-hidden="true" />
            </button>
          ) : null}
        </article>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Os números do topo
// ---------------------------------------------------------------------------

function Numeros({ dados }: { dados: DadosDaOrigem }) {
  const k = dados.kpis;
  const meses = lista(dados.meses);
  const chegadas = contagem(k?.chegadas);
  const identificadas = contagem(k?.identificadas);
  const rapidas = contagem(k?.rapidas);
  const canceladas = contagem(k?.visitas_canceladas);
  const fechados = contagem(k?.fechados);
  const pctDe = (n: number) => {
    const p = parteDe(n, chegadas);
    return p === null ? '—' : `${p}%`;
  };
  const apoio = (linha: string, divisao: string | null) => (
    <>
      {linha}
      {divisao ? (
        <>
          <br />
          {divisao}
        </>
      ) : null}
    </>
  );
  const pctDoMes = (m: MesDaOrigem) => parteDe(contagem(m.rapidas), contagem(m.chegadas)) ?? 0;

  return (
    <FilaDeKpis colunas={6}>
      <TiraKpi
        rotulo="Chegadas"
        valor={inteiro(chegadas)}
        apoio={apoio('pessoas que procuraram a Imova', divisaoDosMeses(meses, (m) => contagem(m.chegadas)))}
      />
      <TiraKpi
        rotulo="Origem descoberta"
        valor={pctDe(identificadas)}
        apoio={apoio(
          `${inteiro(identificadas)} de ${inteiro(chegadas)} sem ninguém perguntar`,
          chegadas > identificadas ? `${inteiro(chegadas - identificadas)} sem pista nenhuma` : null,
        )}
      />
      <TiraKpi
        rotulo="Respondidas em até 5 min"
        valor={pctDe(rapidas)}
        apoio={apoio(
          `${inteiro(rapidas)} de ${inteiro(chegadas)}`,
          meses.length >= 2
            ? `${mesCurto(meses[meses.length - 1]!.mes)} ${pctDoMes(meses[meses.length - 1]!)}% · ${mesCurto(meses[meses.length - 2]!.mes)} ${pctDoMes(meses[meses.length - 2]!)}%`
            : null,
        )}
      />
      <TiraKpi
        rotulo="Ficaram mais interessadas"
        valor={inteiro(k?.subiram)}
        apoio={apoio('subiram de degrau no período', divisaoDosMeses(meses, (m) => contagem(m.subiram)))}
      />
      <TiraKpi
        rotulo="Esfriaram"
        valor={inteiro(k?.esfriaram)}
        apoio={apoio('eram interessadas e pararam', divisaoDosMeses(meses, (m) => contagem(m.esfriaram)))}
      />
      <TiraKpi
        rotulo="Visitas marcadas"
        valor={inteiro(k?.visitas)}
        apoio={apoio(
          canceladas > 0 ? `e ${contar(canceladas, 'cancelada', 'canceladas')}` : 'nenhuma cancelada',
          fechados > 0 ? contar(fechados, 'negócio fechado', 'negócios fechados') : 'nenhum negócio fechado',
        )}
      />
    </FilaDeKpis>
  );
}

// ---------------------------------------------------------------------------
// De onde vieram
// ---------------------------------------------------------------------------

/** A régua de 100%: um segmento por caminho, na cor dele. */
function ReguaDosGrupos({ grupos, total }: { grupos: readonly LinhaDoGrupo[]; total: number }) {
  const com = grupos.filter((g) => contagem(g.chegadas) > 0);
  return (
    <div className="flex flex-col gap-3">
      <div
        role="img"
        aria-label={`Chegadas por caminho: ${com.map((g) => `${ROTULO_CURTO_DO_GRUPO[g.grupo]} ${inteiro(g.chegadas)}`).join(', ')}`}
        className="flex h-3.5 w-full gap-0.5 overflow-hidden rounded-full bg-(--vende-grade)"
      >
        {com.map((g) => (
          <span
            key={g.grupo}
            className="h-full min-w-1"
            style={{ flex: `${contagem(g.chegadas)} 1 0`, backgroundColor: COR_DO_GRUPO[g.grupo] }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        {com.map((g) => (
          <li key={g.grupo} className="inline-flex items-center gap-1.5">
            <Ponto grupo={g.grupo} />
            {ROTULO_CURTO_DO_GRUPO[g.grupo]}
            <span className="numerico font-semibold text-foreground">{parteDe(contagem(g.chegadas), total) ?? 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Ponto({ grupo }: { grupo: GrupoDeOrigem }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-2.5 shrink-0 rounded-[3px]"
      style={{ backgroundColor: COR_DO_GRUPO[grupo] }}
    />
  );
}

const TH = 'px-2 py-2 text-right text-xs font-medium whitespace-nowrap text-muted-foreground first:pl-0 first:text-left';
const TD = 'numerico px-2 py-2.5 text-right whitespace-nowrap';

function DeOndeVieram({ dados, periodo }: { dados: DadosDaOrigem; periodo: Periodo }) {
  const grupos = lista(dados.grupos);
  const total = contagem(dados.kpis?.chegadas);
  const topo = grupoQueMaisTrouxe(grupos);
  const [abertos, setAbertos] = useState<ReadonlySet<GrupoDeOrigem>>(() => {
    const inicial = new Set<GrupoDeOrigem>();
    if (topo) inicial.add(topo.grupo);
    for (const g of grupos) {
      if (lista(g.anuncios).some((a) => a.da_imova === false)) inicial.add(g.grupo);
    }
    return inicial;
  });
  const alternar = (g: GrupoDeOrigem) =>
    setAbertos((atual) => {
      const novo = new Set(atual);
      if (novo.has(g)) novo.delete(g);
      else novo.add(g);
      return novo;
    });

  const titulo = topo
    ? `${ROTULO_CURTO_DO_GRUPO[topo.grupo]} trouxe ${inteiro(topo.chegadas)} das ${contar(total, 'chegada', 'chegadas')}`
    : total > 0
      ? `Nenhuma das ${contar(total, 'chegada', 'chegadas')} disse por onde conheceu a Imova`
      : 'Ninguém procurou a Imova no período';

  const soma = (campo: (g: LinhaDoGrupo) => number) => grupos.reduce((s, g) => s + campo(g), 0);

  return (
    <section id={ID_DO_BLOCO.origem} className={BLOCO}>
      <Cartao
        grande
        secao="de-onde-vieram"
        titulo={titulo}
        sub="Cada chegada é uma pessoa que procurou a Imova pela primeira vez, ou que voltou depois de 30 dias. Conversas que nós começamos não entram. Toque num caminho para ver o detalhe."
      >
        {total > 0 ? <ReguaDosGrupos grupos={grupos} total={total} /> : null}
        <div className="-mx-4 overflow-x-auto px-4 md:-mx-5 md:px-5 xl:-mx-6 xl:px-6" style={SOMBRA_DE_ROLAGEM_NO_CARTAO}>
          <table className="w-full min-w-[900px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-hairline">
                <th scope="col" className={TH}>Caminho</th>
                <th scope="col" className={TH}>Chegadas</th>
                <th scope="col" className={TH}>Do total</th>
                <th scope="col" className={TH}>Responderam</th>
                <th scope="col" className={TH}>Em até 5 min</th>
                <th scope="col" className={TH} title="Mediana do tempo até a primeira resposta nossa, de quem foi respondido">
                  1ª resposta
                </th>
                <th scope="col" className={TH} title="Etiqueta Interessado ou Muito interessado agora">
                  Interessados hoje
                </th>
                <th scope="col" className={TH}>Esfriaram</th>
                <th scope="col" className={TH}>Visita marcada</th>
              </tr>
            </thead>
            {grupos.map((g) => (
              <LinhasDoGrupo
                key={g.grupo}
                grupo={g}
                total={total}
                nota={notaDoGrupo(g, dados)}
                aberto={abertos.has(g.grupo)}
                aoAlternar={() => alternar(g.grupo)}
                podeMarcar={Boolean(dados.pode_marcar)}
                periodo={periodo}
              />
            ))}
            <tfoot>
              <tr className="font-semibold">
                <th scope="row" className="py-2.5 pl-7 text-left">Total</th>
                <td className={TD}>{inteiro(total)}</td>
                <td className={TD}>{total > 0 ? '100%' : '—'}</td>
                <td className={TD}>{inteiro(dados.kpis?.responderam)}</td>
                <td className={TD}>{inteiro(dados.kpis?.rapidas)}</td>
                <td className={TD}>{tempoCurto(dados.kpis?.mediana_min)}</td>
                <td className={TD}>{inteiro(soma((g) => contagem(g.interessados)))}</td>
                <td className={TD}>{inteiro(soma((g) => contagem(g.esfriando)))}</td>
                <td className={TD}>{inteiro(soma((g) => contagem(g.visitas)))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <Rodape>
          1ª resposta: mediana do tempo entre a primeira mensagem da pessoa e a primeira resposta nossa (IA ou equipe), só de
          quem foi respondido. A mensagem automática fixa não conta como resposta.
        </Rodape>
      </Cartao>
    </section>
  );
}

function LinhasDoGrupo({
  grupo: g,
  total,
  nota,
  aberto,
  aoAlternar,
  podeMarcar,
  periodo,
}: {
  grupo: LinhaDoGrupo;
  total: number;
  nota: string | null;
  aberto: boolean;
  aoAlternar: () => void;
  podeMarcar: boolean;
  periodo: Periodo;
}) {
  const chegadas = contagem(g.chegadas);
  const subs = lista(g.subs);
  const anuncios = lista(g.anuncios);
  const temDetalhe = chegadas > 0 && (subs.length > 0 || anuncios.length > 0 || nota !== null);
  const vazio = chegadas === 0;
  return (
    <tbody className="border-b border-hairline">
      <tr className={cn(vazio && 'text-muted-foreground')}>
        <th scope="row" className="py-1.5 pr-2 text-left font-semibold">
          {temDetalhe ? (
            <button
              type="button"
              onClick={aoAlternar}
              aria-expanded={aberto}
              className="toque inline-flex min-h-9 items-center gap-2 rounded-md text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <ChevronRight
                aria-hidden="true"
                className={cn('size-4 shrink-0 text-muted-foreground transition-transform', aberto && 'rotate-90')}
              />
              <Ponto grupo={g.grupo} />
              {ROTULO_DO_GRUPO[g.grupo]}
            </button>
          ) : (
            <span className="inline-flex min-h-9 items-center gap-2 pl-6">
              <Ponto grupo={g.grupo} />
              {ROTULO_DO_GRUPO[g.grupo]}
            </span>
          )}
        </th>
        <td className={cn(TD, 'font-semibold')}>{inteiro(chegadas)}</td>
        <td className={TD}>{total > 0 ? `${parteDe(chegadas, total) ?? 0}%` : '—'}</td>
        <td className={TD}>{vazio ? '—' : inteiro(g.responderam)}</td>
        <td className={TD}>{vazio ? '—' : inteiro(g.rapidas)}</td>
        <td className={TD}>{tempoCurto(g.mediana_min)}</td>
        <td className={TD}>{vazio ? '—' : inteiro(g.interessados)}</td>
        <td className={TD}>{vazio ? '—' : inteiro(g.esfriando)}</td>
        <td className={TD}>{vazio ? '—' : inteiro(g.visitas)}</td>
      </tr>
      {aberto && temDetalhe ? (
        <>
          {subs.map((s) => (
            <tr key={s.subcanal} className="text-[13px] text-muted-foreground">
              <td className="py-1.5 pl-[3.25rem]">{rotuloDoSubcanal(s.subcanal)}</td>
              <td className={cn(TD, 'py-1.5')}>{inteiro(s.chegadas)}</td>
              <td className={cn(TD, 'py-1.5')}>{parteDe(contagem(s.chegadas), chegadas) ?? 0}% do caminho</td>
              <td colSpan={6} />
            </tr>
          ))}
          {anuncios.map((a) => (
            <LinhaDoAnuncioDaMeta
              key={a.id ?? a.titulo ?? 'sem-id'}
              anuncio={a}
              chegadasDoGrupo={chegadas}
              podeMarcar={podeMarcar}
              periodo={periodo}
            />
          ))}
          {nota ? (
            <tr>
              <td colSpan={9} className="pt-1 pb-3 pl-[3.25rem]">
                <p className="max-w-[90ch] rounded-lg bg-muted/70 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                  {nota}
                </p>
              </td>
            </tr>
          ) : null}
        </>
      ) : null}
    </tbody>
  );
}

function LinhaDoAnuncioDaMeta({
  anuncio: a,
  chegadasDoGrupo,
  podeMarcar,
  periodo,
}: {
  anuncio: AnuncioDaMeta;
  chegadasDoGrupo: number;
  podeMarcar: boolean;
  periodo: Periodo;
}) {
  const cliente = useQueryClient();
  const marcar = useMutation({
    mutationFn: (daImova: boolean) => marcarAnuncioDaMeta(a.id!, daImova),
    onSuccess: (_, daImova) => {
      toast.success(daImova ? 'Anúncio marcado como da Imova' : 'Anúncio marcado como de fora');
      void cliente.invalidateQueries({ queryKey: chaveDoRelatorio('origem', periodo) });
    },
    onError: (erro) => toast.error(mensagemDoErro(erro)),
  });
  const deFora = a.da_imova === false;
  const sem = contagem(a.sem_resposta);
  return (
    <tr className="text-[13px] text-muted-foreground">
      <td className="py-1.5 pr-2 pl-[3.25rem] whitespace-normal">
        <span className="text-foreground">“{encurtar(a.titulo ?? 'Anúncio sem nome', 60)}”</span>
        {deFora ? (
          <span className="ml-2 inline-block rounded-full bg-quente-fundo px-2 py-0.5 text-[11px] font-semibold text-quente-texto">
            não é da Imova
          </span>
        ) : null}
        {sem > 0 ? <span className="ml-2 text-xs">{contar(sem, 'sem resposta', 'sem resposta')}</span> : null}
        {podeMarcar && a.id ? (
          <button
            type="button"
            disabled={marcar.isPending}
            onClick={() => marcar.mutate(deFora)}
            className="toque ml-2 inline-flex min-h-8 items-center rounded-md px-1.5 text-xs font-semibold text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
          >
            {deFora ? 'É da Imova' : 'Não é da Imova'}
          </button>
        ) : null}
      </td>
      <td className={cn(TD, 'py-1.5')}>{inteiro(a.chegadas)}</td>
      <td className={cn(TD, 'py-1.5')}>{parteDe(contagem(a.chegadas), chegadasDoGrupo) ?? 0}% do caminho</td>
      <td colSpan={6} />
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Anúncio a anúncio
// ---------------------------------------------------------------------------

const ORDENS: readonly { chave: OrdemDosAnuncios; rotulo: string }[] = [
  { chave: 'interesse', rotulo: 'Mais interesse no CRM' },
  { chave: 'vistos', rotulo: 'Mais vistos no portal' },
  { chave: 'contatos', rotulo: 'Mais contatos no portal' },
];

function AnuncioAAnuncio({ dados }: { dados: DadosDaOrigem }) {
  const [ordem, setOrdem] = useState<OrdemDosAnuncios>('interesse');
  const { noAr, fora } = useMemo(() => separarAnuncios(dados.anuncios), [dados.anuncios]);
  const porInteresse = useMemo(() => ordenarAnuncios(noAr, 'interesse'), [noAr]);
  const porVistos = useMemo(() => ordenarAnuncios(noAr.filter((a) => a.situacao === 'no_ar'), 'vistos'), [noAr]);
  const linhas = useMemo(() => ordenarAnuncios(noAr, ordem), [noAr, ordem]);
  const foraOrdenado = useMemo(() => ordenarAnuncios(fora, 'vistos'), [fora]);
  const maisInteresse = porInteresse[0] && contagem(porInteresse[0].interessados) > 0 ? porInteresse[0] : null;
  const maisVisto = porVistos[0] && (vistosDaLinha(porVistos[0]).valor ?? 0) > 0 ? porVistos[0] : null;
  const contexto = { maisInteresse: maisInteresse?.codigo ?? null, maisVisto: maisVisto?.codigo ?? null };

  const valorDaBarra = (a: LinhaDoAnuncio) =>
    ordem === 'vistos' ? vistosDaLinha(a).valor : ordem === 'contatos' ? contatosDaLinha(a).valor : contagem(a.interessados);
  const maximo = Math.max(1, ...linhas.map((a) => valorDaBarra(a) ?? 0));
  const algumDoPeriodo = linhas.some((a) => vistosDaLinha(a).doPeriodo);
  const algumAcumulado = [...linhas, ...fora].some((a) => !vistosDaLinha(a).doPeriodo && numero(a.vistos) !== null);

  const titulo = maisInteresse
    ? `“${encurtar(maisInteresse.titulo, 44)}” é o que mais interessa: ${contar(contagem(maisInteresse.interessados), 'interessado', 'interessados')}`
    : maisVisto
      ? `O mais visto no portal é “${encurtar(maisVisto.titulo, 44)}”`
      : 'Anúncio a anúncio';

  return (
    <section id={ID_DO_BLOCO.anuncios} className={BLOCO}>
      <Cartao
        grande
        secao="anuncio-a-anuncio"
        titulo={titulo}
        sub="Quanto cada imóvel é visto no portal e quanto interesse gera no CRM. Os anúncios antigos do mesmo imóvel entram somados."
        extra={
          <div role="group" aria-label="Ordenar os anúncios" className="flex flex-wrap gap-1.5">
            {ORDENS.map((o) => (
              <button
                key={o.chave}
                type="button"
                aria-pressed={ordem === o.chave}
                onClick={() => setOrdem(o.chave)}
                className={cn(
                  'toque inline-flex min-h-9 items-center rounded-lg border px-3 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  ordem === o.chave
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-hairline bg-card text-foreground hover:bg-muted',
                )}
              >
                {o.rotulo}
              </button>
            ))}
          </div>
        }
      >
        {linhas.length === 0 && fora.length === 0 ? (
          <SemDado>Nenhum anúncio no ar ainda. Os números aparecem quando o primeiro anúncio for para o portal.</SemDado>
        ) : (
          <div className="-mx-4 overflow-x-auto px-4 md:-mx-5 md:px-5 xl:-mx-6 xl:px-6" style={SOMBRA_DE_ROLAGEM_NO_CARTAO}>
            <table className="w-full min-w-[960px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-hairline">
                  <th scope="col" className={TH}>Imóvel</th>
                  <th scope="col" className={cn(TH, 'w-32 text-left')}>
                    <span className="sr-only">Barra: </span>
                    {ORDENS.find((o) => o.chave === ordem)?.rotulo.replace('Mais ', '')}
                  </th>
                  <th scope="col" className={TH}>Vistos no portal</th>
                  <th scope="col" className={TH}>Contatos no portal</th>
                  <th scope="col" className={TH}>Chegaram ao CRM</th>
                  <th scope="col" className={TH}>Interessados</th>
                  <th scope="col" className={cn(TH, 'text-left')}>Leitura</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((a) => (
                  <LinhaDeAnuncio
                    key={a.codigo}
                    anuncio={a}
                    barra={valorDaBarra(a)}
                    maximo={maximo}
                    corDaBarra={ordem === 'interesse' ? 'muito' : 'azul'}
                    leitura={leituraDoAnuncio(a, contexto)}
                  />
                ))}
              </tbody>
              {foraOrdenado.length > 0 ? (
                <tbody>
                  <tr>
                    <th colSpan={7} scope="rowgroup" className="pt-5 pb-1.5 text-left text-xs font-semibold text-muted-foreground">
                      Fora do ar no portal
                    </th>
                  </tr>
                  {foraOrdenado.map((a) => (
                    <LinhaDeAnuncio key={a.codigo} anuncio={a} leitura={leituraDoAnuncio(a, contexto)} apagada />
                  ))}
                </tbody>
              ) : null}
            </table>
          </div>
        )}
        <Rodape>
          {algumAcumulado
            ? `Os números do portal marcados com * são o total desde que o anúncio entrou no ar: o Canal Pro só informa o acumulado. O CRM guarda o número de cada dia${dados.numeros_desde ? ` desde ${diaMes(dados.numeros_desde)}` : ''}, e a coluna passa a mostrar só o período quando ele começa depois disso. `
            : algumDoPeriodo
              ? 'Vistos e contatos no portal dentro do período, pela foto diária do CRM. '
              : ''}
          Chegaram ao CRM: pessoas que vieram com o código do anúncio (WhatsApp do portal ou contato do Grupo OLX). Interessados:
          quem a IA viu interessado no imóvel numa conversa do período, por qualquer caminho.
        </Rodape>
      </Cartao>
    </section>
  );
}

function NumeroDoPortal({ valor, doPeriodo }: { valor: number | null; doPeriodo: boolean }) {
  if (valor === null) return <span className="text-muted-foreground">—</span>;
  return (
    <>
      {inteiro(valor)}
      {doPeriodo ? null : (
        <span className="text-muted-foreground" aria-label=" (total desde que entrou no ar)">
          *
        </span>
      )}
    </>
  );
}

function LinhaDeAnuncio({
  anuncio: a,
  barra,
  maximo = 1,
  corDaBarra = 'azul',
  leitura,
  apagada = false,
}: {
  anuncio: LinhaDoAnuncio;
  barra?: number | null;
  maximo?: number;
  corDaBarra?: 'muito' | 'azul';
  leitura: string;
  apagada?: boolean;
}) {
  const vistos = vistosDaLinha(a);
  const contatos = contatosDaLinha(a);
  const muito = contagem(a.muito);
  const mostraCodigo = a.codigo !== a.titulo;
  return (
    <tr className={cn('border-b border-hairline last:border-b-0', apagada && 'text-muted-foreground')}>
      <th scope="row" className="py-2.5 pr-3 text-left font-normal">
        {mostraCodigo ? <span className="numerico block text-[11px] text-muted-foreground">{a.codigo}</span> : null}
        <span className={cn('block leading-snug', !apagada && 'font-semibold')}>{encurtar(a.titulo, 56)}</span>
      </th>
      <td className="px-2 py-2.5">
        {barra === undefined ? null : <Barra valor={barra} maximo={maximo} cor={corDaBarra} altura="h-1.5" trilho />}
      </td>
      <td className={TD}>
        <NumeroDoPortal valor={vistos.valor} doPeriodo={vistos.doPeriodo} />
      </td>
      <td className={TD}>
        <NumeroDoPortal valor={contatos.valor} doPeriodo={contatos.doPeriodo} />
      </td>
      <td className={TD}>{inteiro(a.chegaram)}</td>
      <td className={TD}>
        <span className="font-semibold">{inteiro(a.interessados)}</span>
        {muito > 0 ? (
          <span className="mt-1 block text-[11px] font-semibold text-quente-texto">
            {contar(muito, 'muito interessado', 'muito interessados')}
          </span>
        ) : null}
      </td>
      <td className="max-w-[300px] px-2 py-2.5 text-xs leading-relaxed whitespace-normal text-muted-foreground">
        {leitura}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Interesse
// ---------------------------------------------------------------------------

const DEGRAUS: readonly {
  chave: 'sem_resposta' | 'morno' | 'interessado' | 'muito_interessado';
  rotulo: string;
  classe: string;
}[] = [
  { chave: 'sem_resposta', rotulo: 'Sem resposta', classe: 'bg-(--vende-resto)' },
  { chave: 'morno', rotulo: 'Morno', classe: 'bg-(--vende-morno)' },
  { chave: 'interessado', rotulo: 'Interessado', classe: 'bg-(--vende-interessado)' },
  { chave: 'muito_interessado', rotulo: 'Muito interessado', classe: 'bg-(--vende-muito)' },
];

function Interesse({ dados }: { dados: DadosDaOrigem }) {
  const i = dados.interesse;
  const hoje = i?.hoje;
  const total = contagem(hoje?.total);
  const interessados = contagem(hoje?.interessado) + contagem(hoje?.muito_interessado);
  const maior = Math.max(1, ...DEGRAUS.map((d) => contagem(hoje?.[d.chave])));
  const fora = [
    contagem(hoje?.esfriando) > 0 ? `${inteiro(hoje?.esfriando)} esfriando` : null,
    contagem(hoje?.sem_interesse) > 0 ? `${inteiro(hoje?.sem_interesse)} sem interesse` : null,
    contagem(hoje?.sem_etiqueta) > 0 ? `${inteiro(hoje?.sem_etiqueta)} sem etiqueta` : null,
  ].filter(Boolean);
  const juiza = i?.juiza;
  const avaliadas = contagem(juiza?.subiu) + contagem(juiza?.igual) + contagem(juiza?.caiu);

  return (
    <section id={ID_DO_BLOCO.interesse} className={cn(BLOCO, 'grid gap-4 lg:grid-cols-2 md:gap-5')}>
      <Cartao
        secao="degraus"
        titulo={
          total > 0
            ? `${inteiro(interessados)} de ${contar(total, 'conversa aberta está interessada', 'conversas abertas estão interessadas')}`
            : 'Nenhuma conversa aberta com etiqueta'
        }
        sub="Em que degrau está cada conversa aberta agora, e quem subiu ou esfriou no período."
      >
        <div className="grid grid-cols-4 items-end gap-2" role="img" aria-label={DEGRAUS.map((d) => `${d.rotulo} ${inteiro(hoje?.[d.chave])}`).join(', ')}>
          {DEGRAUS.map((d) => {
            const n = contagem(hoje?.[d.chave]);
            return (
              <div key={d.chave} className="flex min-w-0 flex-col gap-1.5">
                <span className="numerico text-lg leading-none font-medium">{inteiro(n)}</span>
                <span
                  aria-hidden="true"
                  className={cn('block w-full rounded-t-[6px]', d.classe)}
                  style={{ height: `${Math.round(12 + (n / maior) * 96)}px` }}
                />
                <span className="text-[11px] leading-tight text-muted-foreground">{d.rotulo}</span>
              </div>
            );
          })}
        </div>
        {fora.length > 0 ? (
          <p className="text-xs text-muted-foreground">Fora da escada: {fora.join(' · ')}.</p>
        ) : null}
        <dl className="flex flex-col text-[13px]">
          <LinhaDeConta rotulo="Subiram de degrau no período" valor={contar(contagem(i?.subiram), 'pessoa', 'pessoas')} forte />
          <LinhaDeConta rotulo="Responderam depois de um contato nosso (sem resposta → morno)" valor={inteiro(i?.responderam)} recuo />
          <LinhaDeConta rotulo="Ficaram interessadas depois de estar mornas, frias ou sem resposta" valor={inteiro(i?.ficaram_interessadas)} recuo />
          <LinhaDeConta rotulo="Viraram muito interessadas" valor={inteiro(i?.viraram_muito)} recuo />
          <LinhaDeConta rotulo="Esfriaram (eram interessadas e pararam de responder)" valor={inteiro(i?.esfriaram)} forte />
          <LinhaDeConta
            rotulo="Nota da juíza da IA: o interesse depois da conversa"
            valor={
              avaliadas > 0
                ? `${inteiro(juiza?.subiu)} subiu · ${inteiro(juiza?.igual)} igual · ${inteiro(juiza?.caiu)} caiu`
                : 'sem avaliação no período'
            }
          />
        </dl>
      </Cartao>
      <Semanas dados={dados} />
    </section>
  );
}

function LinhaDeConta({
  rotulo,
  valor,
  forte = false,
  recuo = false,
}: {
  rotulo: ReactNode;
  valor: ReactNode;
  forte?: boolean;
  recuo?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-hairline py-2 last:border-b-0">
      <dt className={cn(recuo ? 'pl-3 text-muted-foreground' : '', forte && 'font-medium')}>{rotulo}</dt>
      <dd className={cn('numerico shrink-0 text-right', forte ? 'font-semibold' : recuo && 'text-muted-foreground')}>
        {valor}
      </dd>
    </div>
  );
}

function Semanas({ dados }: { dados: DadosDaOrigem }) {
  const semanas = lista(dados.semanas);
  const totais = semanas.map((s) => GRUPOS_DE_ORIGEM.reduce((t, g) => t + contagem(s.grupos?.[g]), 0));
  const maior = Math.max(1, ...totais);
  const melhor = totais.length > 0 ? totais.indexOf(Math.max(...totais)) : -1;
  const usados = GRUPOS_DE_ORIGEM.filter((g) => semanas.some((s) => contagem(s.grupos?.[g]) > 0));
  const temParcial = semanas.some((s) => s.parcial);
  return (
    <Cartao
      secao="semanas"
      titulo={
        melhor >= 0 && totais[melhor]! > 0
          ? `A semana de ${diaMes(semanas[melhor]!.inicio)} foi a de mais chegadas: ${inteiro(totais[melhor])}`
          : 'Chegadas por semana'
      }
      sub="Por caminho, de segunda a domingo."
    >
      {semanas.length === 0 ? (
        <SemDado>Sem semanas no período.</SemDado>
      ) : (
        <>
          <div className="flex h-44 items-end gap-2 border-b border-(--vende-eixo) md:gap-3">
            {semanas.map((s, k) => (
              <div
                key={s.inicio}
                role="img"
                aria-label={`Semana de ${diaMes(s.inicio)}${s.parcial ? ' (incompleta)' : ''}: ${inteiro(totais[k])} chegadas`}
                className="flex h-full min-w-0 flex-1 flex-col items-center justify-end"
              >
                <span className="numerico mb-1 text-[11px] font-semibold">{totais[k] ? inteiro(totais[k]) : ''}</span>
                <div
                  className="flex w-[70%] max-w-10 flex-col-reverse gap-0.5 overflow-hidden rounded-t-[4px]"
                  style={{ height: `${((totais[k] ?? 0) / maior) * 85}%` }}
                >
                  {GRUPOS_DE_ORIGEM.filter((g) => contagem(s.grupos?.[g]) > 0).map((g) => (
                    <span
                      key={g}
                      className="block w-full"
                      style={{
                        flex: `${contagem(s.grupos?.[g])} 1 0`,
                        backgroundColor: COR_DO_GRUPO[g],
                        ...(s.parcial
                          ? { backgroundImage: 'repeating-linear-gradient(135deg, transparent 0 3px, var(--card) 3px 5px)' }
                          : null),
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2 md:gap-3">
            {semanas.map((s) => (
              <span key={s.inicio} className="numerico min-w-0 flex-1 text-center text-[11px] text-muted-foreground">
                {diaMes(s.inicio)}
              </span>
            ))}
          </div>
          {usados.length > 0 ? (
            <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
              {usados.map((g) => (
                <li key={g} className="inline-flex items-center gap-1.5">
                  <Ponto grupo={g} />
                  {ROTULO_CURTO_DO_GRUPO[g]}
                </li>
              ))}
            </ul>
          ) : null}
          {temParcial ? (
            <Rodape>As colunas listradas são semanas incompletas: começam antes do período ou ainda não acabaram.</Rodape>
          ) : null}
        </>
      )}
    </Cartao>
  );
}

// ---------------------------------------------------------------------------
// Mês a mês
// ---------------------------------------------------------------------------

type LinhaDoMes = {
  chave: string;
  rotulo: string;
  valor: (m: MesDaOrigem) => string;
  /** O número da conta "por dia" (contagens); nulo = a coluna fica vazia. */
  porDia?: (m: MesDaOrigem) => number;
  /** A comparação já pronta (as porcentagens). */
  comparar?: (m: MesDaOrigem) => string;
  forte?: boolean;
  recuo?: boolean;
};

function MesAMes({ meses }: { meses: readonly MesDaOrigem[] }) {
  const ultimo = meses[meses.length - 1];
  const anterior = meses.length >= 2 ? meses[meses.length - 2] : undefined;
  const usados = GRUPOS_DE_ORIGEM.filter((g) => meses.some((m) => contagem(m.grupos?.[g]) > 0));
  const pctRapidas = (m: MesDaOrigem) => {
    const p = parteDe(contagem(m.rapidas), contagem(m.chegadas));
    return p === null ? '—' : `${p}%`;
  };
  const linhas: LinhaDoMes[] = [
    { chave: 'chegadas', rotulo: 'Chegadas (pessoas que nos procuraram)', valor: (m) => inteiro(m.chegadas), porDia: (m) => contagem(m.chegadas), forte: true },
    ...usados.map<LinhaDoMes>((g) => ({
      chave: `g-${g}`,
      rotulo: ROTULO_CURTO_DO_GRUPO[g],
      valor: (m) => inteiro(m.grupos?.[g]),
      porDia: (m) => contagem(m.grupos?.[g]),
      recuo: true,
    })),
    { chave: 'nossas', rotulo: 'Conversas que nós começamos', valor: (m) => inteiro(m.nossas), porDia: (m) => contagem(m.nossas) },
    { chave: 'rapidas', rotulo: 'Respondidas em até 5 min', valor: (m) => `${inteiro(m.rapidas)} de ${inteiro(m.chegadas)}`, comparar: pctRapidas },
    { chave: 'mediana', rotulo: 'Primeira resposta (mediana)', valor: (m) => tempoCurto(m.mediana_min) },
    { chave: 'sem', rotulo: 'Ficaram sem resposta', valor: (m) => inteiro(m.sem_resposta) },
    { chave: 'recebidas', rotulo: 'Mensagens recebidas', valor: (m) => inteiro(m.recebidas), porDia: (m) => contagem(m.recebidas) },
    { chave: 'ia', rotulo: 'Respostas da IA', valor: (m) => inteiro(m.ia), porDia: (m) => contagem(m.ia) },
    { chave: 'equipe', rotulo: 'Respostas da equipe', valor: (m) => inteiro(m.equipe), porDia: (m) => contagem(m.equipe) },
    { chave: 'subiram', rotulo: 'Ficaram mais interessadas', valor: (m) => inteiro(m.subiram), forte: true },
    { chave: 'esfriaram', rotulo: 'Esfriaram', valor: (m) => inteiro(m.esfriaram) },
    { chave: 'visitas', rotulo: 'Visitas marcadas', valor: (m) => inteiro(m.visitas) },
    { chave: 'fechados', rotulo: 'Negócios fechados', valor: (m) => inteiro(m.fechados) },
  ];

  const titulo =
    ultimo && anterior
      ? `${nomeDoMes(ultimo.mes)}: ${porDia(ultimo.chegadas, ultimo.dias)} ${plural(Math.round((numero(ultimo.chegadas) ?? 0) / Math.max(1, ultimo.dias)), 'chegada', 'chegadas')} por dia, contra ${porDia(anterior.chegadas, anterior.dias)} em ${nomeDoMes(anterior.mes).toLowerCase()}`
      : ultimo
        ? `${nomeDoMes(ultimo.mes)} até agora: ${contar(contagem(ultimo.chegadas), 'chegada', 'chegadas')}`
        : 'Mês a mês';
  const parcial = meses.filter((m) => m.dias > 0 && m.dias < diasDoMes(m.mes));

  return (
    <section id={ID_DO_BLOCO.meses} className={BLOCO}>
      <Cartao
        grande
        secao="mes-a-mes"
        titulo={titulo}
        sub="O mesmo quadro para cada mês. Como os meses têm dias de CRM diferentes, a coluna “por dia” é a comparação justa."
      >
        {meses.length === 0 ? (
          <SemDado>Ainda não há mês com conversa.</SemDado>
        ) : (
          <div className="-mx-4 overflow-x-auto px-4 md:-mx-5 md:px-5 xl:-mx-6 xl:px-6" style={SOMBRA_DE_ROLAGEM_NO_CARTAO}>
            <table className="w-full min-w-[620px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-hairline">
                  <th scope="col" className={TH}>
                    <span className="sr-only">Indicador</span>
                  </th>
                  {meses.map((m) => (
                    <th key={m.mes} scope="col" className={TH}>
                      {nomeDoMes(m.mes)}
                      <span className="block text-[11px] font-normal">{rotuloDosDias(m)}</span>
                    </th>
                  ))}
                  {anterior && ultimo ? (
                    <th scope="col" className={TH}>
                      Por dia, {mesCurto(anterior.mes)} → {mesCurto(ultimo.mes)}
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.chave} className={cn('border-b border-hairline last:border-b-0', l.forte && 'font-semibold')}>
                    <th scope="row" className={cn('py-2 pr-3 text-left font-[inherit]', l.recuo && 'pl-3 font-normal text-muted-foreground')}>
                      {l.recuo ? `· ${l.rotulo}` : l.rotulo}
                    </th>
                    {meses.map((m) => (
                      <td key={m.mes} className={TD}>
                        {l.valor(m)}
                      </td>
                    ))}
                    {anterior && ultimo ? (
                      <td className={cn(TD, 'text-muted-foreground')}>
                        {l.comparar
                          ? `${l.comparar(anterior)} → ${l.comparar(ultimo)}`
                          : l.porDia
                            ? `${porDia(l.porDia(anterior), anterior.dias)} → ${porDia(l.porDia(ultimo), ultimo.dias)}`
                            : ''}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {parcial.length > 0 ? (
          <Rodape>
            {parcial.map((m) => `${nomeDoMes(m.mes)} tem ${contar(m.dias, 'dia', 'dias')} de CRM`).join(' e ')}. Com mais de
            seis meses, a tabela mostra os seis últimos.
          </Rodape>
        ) : null}
      </Cartao>
    </section>
  );
}

function diasDoMes(mes: string): number {
  const ano = Number(mes.slice(0, 4));
  const m = Number(mes.slice(5, 7));
  return Number.isFinite(ano) && Number.isFinite(m) ? new Date(Date.UTC(ano, m, 0)).getUTCDate() : 30;
}

function rotuloDosDias(m: MesDaOrigem): string {
  const total = diasDoMes(m.mes);
  return m.dias >= total ? 'mês inteiro' : contar(m.dias, 'dia', 'dias');
}

// ---------------------------------------------------------------------------
// Como o sistema está lidando
// ---------------------------------------------------------------------------

function ComoOSistemaLida({ dados }: { dados: DadosDaOrigem }) {
  const s = dados.sistema;
  const p = s?.primeiro;
  const ia = contagem(p?.ia);
  const equipe = contagem(p?.equipe);
  const ninguem = contagem(p?.ninguem);
  const total = ia + equipe + ninguem;
  const d = s?.descoberta;
  const olx = s?.grupo_olx;
  const semResposta = lista(s?.sem_resposta);
  const [todasSemResposta, setTodasSemResposta] = useState(false);
  const semRespostaNaTela = todasSemResposta ? semResposta : semResposta.slice(0, SEM_RESPOSTA_NA_LISTA);
  const redes =
    contagem(lista(dados.grupos).find((g) => g.grupo === 'redes_sociais')?.chegadas) +
    contagem(lista(dados.grupos).find((g) => g.grupo === 'outros')?.chegadas);
  const tiposOlx = [
    contagem(olx?.telefone) > 0 ? `${inteiro(olx?.telefone)} ${plural(contagem(olx?.telefone), 'viu', 'viram')} o telefone` : null,
    contagem(olx?.chat) > 0 ? `${inteiro(olx?.chat)} ${plural(contagem(olx?.chat), 'mandou', 'mandaram')} chat no portal` : null,
    contagem(olx?.formulario) > 0 ? `${inteiro(olx?.formulario)} pelo formulário` : null,
    contagem(olx?.whatsapp) > 0 ? `${inteiro(olx?.whatsapp)} pelo botão do WhatsApp` : null,
    contagem(olx?.visita) > 0 ? `${inteiro(olx?.visita)} ${plural(contagem(olx?.visita), 'pediu', 'pediram')} visita` : null,
  ].filter(Boolean);
  const porAnuncio = lista(olx?.por_anuncio)
    .map((x) => `${x.codigo} ${inteiro(x.contatos)}`)
    .join(', ');

  return (
    <section id={ID_DO_BLOCO.sistema} aria-labelledby="origem-sistema-titulo" className={cn(BLOCO, 'flex flex-col gap-3')}>
      <div className="flex flex-col gap-1 pt-2">
        <h3 id="origem-sistema-titulo" className="text-[17px] leading-snug font-semibold tracking-[-0.01em]">
          Como o sistema está lidando
        </h3>
        <p className="text-xs leading-relaxed text-muted-foreground">
          O que o CRM e a IA fizeram com quem chegou: quem respondeu, o que descobriram sozinhos e o que escapou.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Cartao secao="quem-respondeu" titulo="Quem respondeu primeiro">
          {total === 0 ? (
            <SemDado>Ninguém chegou no período.</SemDado>
          ) : (
            <>
              <div
                role="img"
                aria-label={`A IA ${ia}, a equipe ${equipe}, ninguém ${ninguem}`}
                className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-(--vende-grade)"
              >
                {ia > 0 ? <span className="h-full bg-(--vende-azul)" style={{ flex: `${ia} 1 0` }} /> : null}
                {equipe > 0 ? <span className="h-full bg-(--vende-laranja)" style={{ flex: `${equipe} 1 0` }} /> : null}
                {ninguem > 0 ? <span className="h-full bg-(--vende-caiu)" style={{ flex: `${ninguem} 1 0` }} /> : null}
              </div>
              <dl className="flex flex-col text-[13px]">
                <LinhaDeConta
                  rotulo={<Rotulado cor="bg-(--vende-azul)">A IA</Rotulado>}
                  valor={ia > 0 ? `${inteiro(ia)} · em ${tempoCurto(p?.ia_mediana_min)}` : '0'}
                />
                <LinhaDeConta
                  rotulo={<Rotulado cor="bg-(--vende-laranja)">A equipe</Rotulado>}
                  valor={equipe > 0 ? `${inteiro(equipe)} · em ${tempoCurto(p?.equipe_mediana_min)}` : '0'}
                />
                <LinhaDeConta rotulo={<Rotulado cor="bg-(--vende-caiu)">Ninguém</Rotulado>} valor={inteiro(ninguem)} forte={ninguem > 0} />
              </dl>
              <Rodape>Tempo: mediana até a primeira resposta.</Rodape>
            </>
          )}
        </Cartao>

        <Cartao secao="descoberta" titulo="Como a origem foi descoberta">
          <dl className="flex flex-col text-[13px]">
            <LinhaDeConta rotulo="Pela regra (texto pronto do portal, link, anúncio da Meta)" valor={inteiro(d?.regra)} />
            <LinhaDeConta rotulo="Pela IA, lendo a conversa e as fotos" valor={inteiro(d?.ia)} />
            <LinhaDeConta rotulo="A equipe corrigiu" valor={inteiro(d?.equipe)} />
            <LinhaDeConta rotulo="Sem pista nenhuma" valor={inteiro(d?.sem_pista)} />
          </dl>
          {contagem(d?.fotos) > 0 ? (
            <Rodape>
              A IA leu {contar(contagem(d?.fotos), 'foto', 'fotos')}
              {contagem(d?.fotos_da_imova) > 0 ? `: ${contar(contagem(d?.fotos_da_imova), 'placa ou banner da Imova', 'placas ou banners da Imova')}` : ''}
              {contagem(d?.prints) > 0 ? ` e ${contar(contagem(d?.prints), 'print de anúncio', 'prints de anúncio')}` : ''}.{' '}
              {contagem(d?.fotos_com_codigo) === 0
                ? 'Nenhuma trazia o código do imóvel.'
                : `${contar(contagem(d?.fotos_com_codigo), 'trazia', 'traziam')} o código do imóvel.`}
            </Rodape>
          ) : null}
        </Cartao>

        <Cartao secao="sem-resposta" titulo={semResposta.length > 0 ? `Ficaram sem resposta: ${inteiro(ninguem)}` : 'Ninguém ficou sem resposta'}>
          {semResposta.length === 0 ? (
            <SemDado>Todas as chegadas do período tiveram resposta da IA ou da equipe.</SemDado>
          ) : (
            <ul className="flex flex-col text-[13px]">
              {semRespostaNaTela.map((x) => (
                <li key={x.conversation_id} className="flex items-center justify-between gap-3 border-b border-hairline py-1.5 last:border-b-0">
                  <span className="min-w-0">
                    <span className="numerico">
                      {diaMes(x.inicio_em)}, {horaEmNatal(x.inicio_em)}
                    </span>
                    <span className="text-muted-foreground"> · {ROTULO_CURTO_DO_GRUPO[x.grupo] ?? x.grupo}</span>
                  </span>
                  <Link
                    href={linkDaConversa(x.organization_id, x.conversation_id)}
                    className="toque inline-flex min-h-9 items-center rounded-md px-1 text-[13px] font-semibold text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    Abrir
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {semResposta.length > SEM_RESPOSTA_NA_LISTA ? (
            <button
              type="button"
              onClick={() => setTodasSemResposta((v) => !v)}
              aria-expanded={todasSemResposta}
              className="toque inline-flex min-h-9 items-center self-start rounded-md text-[13px] font-semibold text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {todasSemResposta ? 'Mostrar menos' : `Mostrar todas as ${inteiro(semResposta.length)}`}
            </button>
          ) : null}
          {semResposta.length > 0 ? (
            <Rodape>
              Chegadas do período sem nenhuma mensagem nossa até agora
              {ninguem > semResposta.length ? ` (a lista mostra as ${inteiro(semResposta.length)} mais novas)` : ''}.
            </Rodape>
          ) : null}
        </Cartao>

        <Cartao secao="grupo-olx" titulo="Contatos do Grupo OLX direto no CRM">
          <p className="numerico text-[28px] leading-none font-medium tracking-[-0.02em]">{inteiro(olx?.contatos)}</p>
          {contagem(olx?.contatos) > 0 ? (
            <>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {tiposOlx.join(', ')}
                {porAnuncio ? ` (${porAnuncio})` : ''}.
              </p>
              <dl className="flex flex-col text-[13px]">
                <LinhaDeConta rotulo="Ainda sem conversa no WhatsApp" valor={inteiro(olx?.sem_conversa)} forte={contagem(olx?.sem_conversa) > 0} />
              </dl>
            </>
          ) : (
            <SemDado>
              {olx?.desde
                ? 'Nenhum contato do portal no período.'
                : 'O Grupo OLX ainda não mandou nenhum contato direto ao CRM.'}
            </SemDado>
          )}
          {olx?.desde ? <Rodape>O primeiro chegou em {diaMes(olx.desde)}.</Rodape> : null}
        </Cartao>

        <Cartao secao="mensagens" titulo="Mensagens no período">
          <dl className="flex flex-col text-[13px]">
            <LinhaDeConta rotulo="Recebidas dos clientes" valor={inteiro(s?.mensagens?.recebidas)} />
            <LinhaDeConta rotulo="Enviadas pela IA" valor={inteiro(s?.mensagens?.ia)} />
            <LinhaDeConta rotulo="Enviadas pela equipe" valor={inteiro(s?.mensagens?.equipe)} />
          </dl>
          <Rodape>Sem a conversa de treino da IA.</Rodape>
        </Cartao>

        <Cartao secao="redes" titulo="Redes sociais sem anúncio, indicação e site">
          <p className="numerico text-[28px] leading-none font-medium tracking-[-0.02em]">{inteiro(redes)}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {redes === 0
              ? 'Ninguém disse que veio pelo Instagram ou Facebook da Imova sem ser por anúncio, nem por indicação, site ou Google.'
              : `${contar(redes, 'pessoa veio', 'pessoas vieram')} pelas redes da Imova, por indicação, pelo site ou pelo Google.`}
          </p>
        </Cartao>
      </div>
    </section>
  );
}

function Rotulado({ cor, children }: { cor: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={cn('inline-block size-2.5 rounded-[3px]', cor)} />
      {children}
    </span>
  );
}
