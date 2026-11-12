'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Inbox, RotateCw, Search, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ChipsDeSecao, SeletorDeAba } from '@/components/ui/abas';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { formatarTelefone } from '@/components/parceiros/formatos';

import { SecoesDosAnuncios } from '../secoes';
import { BotaoDescartar, FichaDoLead } from './ficha-do-lead';
import { CHAVE_DA_LISTA_DE_LEADS, carregarLeads, TETO_DOS_LEADS } from './leads-dados';
import {
  chegouEm,
  codigoDoAnuncioDoLead,
  comoChegou,
  comoChegouOLead,
  contagemPorSituacao,
  cortarMensagem,
  dataHoraDoLead,
  duracao,
  ehJeitoDeChegar,
  filtrarLeads,
  FILTROS_INICIAIS,
  jeitoDeChegar,
  JEITOS_DE_CHEGAR,
  nomeDoLead,
  origemDoLead,
  primeiraMensagemDoLead,
  recebidoHa,
  respostaDoLead,
  resumoDosLeads,
  resumoPorAnuncio,
  rotuloDoTipo,
  TIPO_DA_CHEGADA,
  TIPOS_DE_CLIQUE,
  tiposDoLead,
  tituloCurto,
  type FiltrosDosLeads,
  type GrupoDoLead,
  type LeadDoPortal,
  type RecorteDosLeads,
  type ResumoDoAnuncio,
} from './leads-rotulos';
import {
  ChipDaTemperatura,
  ComoChegou,
  IconeDoTipo,
  SeloDaSituacao,
  TelefoneDoLead,
  TipoDeContato,
} from './partes-do-lead';

/** Valor do "sem filtro" no Radix Select, que não aceita item com valor vazio. */
const TODOS = '__todos__';

/** O relógio da tela: "há 14 min" anda sozinho, de minuto em minuto. */
function useAgora(passoMs = 60_000): Date {
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setAgora(new Date()), passoMs);
    return () => clearInterval(timer);
  }, [passoMs]);
  return agora;
}

/**
 * Leads dos portais (05/11/2026), só na Imova.
 *
 * Desde a migração 20261105130000, o lead só chega quando a pessoa MANDA
 * MENSAGEM: no WhatsApp (a conversa do mesmo telefone, depois do clique no
 * anúncio) ou pelo chat, formulário ou pedido de visita do portal. É a lista
 * "Mandaram mensagem", e responde três perguntas, nesta ordem: quantos chegaram,
 * quem ainda não teve resposta (e há quanto tempo), e de qual anúncio veio cada
 * um. Quem tocou no WhatsApp, em "ver telefone" ou em agendar e não escreveu
 * fica em "Clicaram e não chamaram": sem ficha e sem conversa, para a equipe
 * ligar; o contato que o portal mandou some 90 dias depois.
 *
 * Desde 12/11/2026, quem manda o texto pronto do anúncio no WhatsApp entra
 * sozinho, mesmo sem o aviso do Grupo OLX: é a "Mensagem no WhatsApp" ("WhatsApp
 * pelo ZAP Imóveis"), com o filtro e a conta próprios.
 *
 * No computador é uma tabela; no celular, cartões. Tocar abre a ficha do lead
 * (`ficha-do-lead.tsx`), com as ações. O filtro de anúncio vem da URL
 * (`?anuncio=<código>`), que é o atalho do número de leads de cada anúncio na
 * lista de Anúncios; o resto dos filtros é da tela.
 */
export function TelaLeads({
  euId,
  anuncioInicial,
  leadInicial = null,
}: {
  euId: string;
  anuncioInicial: string | null;
  /** `?lead=<id>`: o toque no aviso de lead novo abre a ficha dele (11/11/2026). */
  leadInicial?: string | null;
}) {
  const [filtros, setFiltros] = useState<FiltrosDosLeads>({
    ...FILTROS_INICIAIS,
    anuncio: anuncioInicial,
  });
  const [abertoId, setAbertoId] = useState<string | null>(leadInicial);
  // Já na tela, o toque num aviso troca só a URL: a ficha do lead novo abre igual.
  const [leadDaUrl, setLeadDaUrl] = useState(leadInicial);
  if (leadInicial !== leadDaUrl) {
    setLeadDaUrl(leadInicial);
    if (leadInicial) setAbertoId(leadInicial);
  }
  const agora = useAgora();

  const consulta = useQuery({
    queryKey: CHAVE_DA_LISTA_DE_LEADS,
    queryFn: carregarLeads,
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
  const leads = useMemo(() => consulta.data ?? [], [consulta.data]);
  const resumo = useMemo(() => resumoDosLeads(leads, agora), [leads, agora]);
  const porAnuncio = useMemo(() => resumoPorAnuncio(leads, agora), [leads, agora]);
  // O número de cada lista respeita o anúncio e a busca, que valem para as duas.
  const porGrupo = useMemo(() => {
    const base = { ...filtros, recorte: 'todos' as const, tipo: null, chegouPor: null };
    return {
      mensagem: filtrarLeads(leads, { ...base, grupo: 'mensagem' }).length,
      clicou: filtrarLeads(leads, { ...base, grupo: 'clicou' }).length,
    };
  }, [leads, filtros]);
  // Os chips contam dentro dos outros filtros: "3 sem resposta" deste anúncio.
  const contagem = useMemo(
    () => contagemPorSituacao(filtrarLeads(leads, filtros, { semRecorte: true })),
    [leads, filtros],
  );
  const linhas = useMemo(() => filtrarLeads(leads, filtros), [leads, filtros]);
  const anuncios = useMemo(() => {
    const codigos = new Set<string>();
    for (const l of leads) {
      const c = codigoDoAnuncioDoLead(l);
      if (c) codigos.add(c);
    }
    return [...codigos].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [leads]);
  const aberto = abertoId ? (leads.find((l) => l.id === abertoId) ?? null) : null;
  const mandaram = filtros.grupo === 'mensagem';

  function mudar(parcial: Partial<FiltrosDosLeads>) {
    setFiltros((f) => ({ ...f, ...parcial }));
  }

  // Trocar de lista zera o que é só dela: a situação e o jeito de chegar ou tocar.
  function trocarGrupo(grupo: GrupoDoLead) {
    mudar({ grupo, recorte: 'todos', tipo: null, chegouPor: null });
  }

  // O anúncio mora na URL: o link copiado e o voltar do navegador levam ao mesmo recorte.
  function escolherAnuncio(codigo: string | null) {
    mudar({ anuncio: codigo });
    const url = codigo
      ? `/anuncios/leads?anuncio=${encodeURIComponent(codigo)}`
      : '/anuncios/leads';
    window.history.replaceState(null, '', url);
  }

  const temFiltro =
    filtros.tipo !== null ||
    filtros.chegouPor !== null ||
    filtros.anuncio !== null ||
    filtros.busca.trim() !== '';

  return (
    <div className="flex w-full max-w-6xl flex-col gap-5">
      <header className="flex flex-col gap-4">
        <SecoesDosAnuncios ativa="leads" />
        <div className="min-w-0">
          <h1 className="font-heading text-[32px] leading-tight font-normal tracking-[-0.02em]">
            Leads dos portais
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Quem mandou mensagem depois de ver um anúncio da Imova no ZAP Imóveis, no Viva Real ou
            na OLX, pelo WhatsApp ou pelo próprio portal. Quem só clicou fica à parte, para a equipe
            ligar.
          </p>
        </div>

        {consulta.isPending ? (
          <Skeleton className="h-11 w-full max-w-md rounded-full md:h-10" />
        ) : leads.length > 0 ? (
          <SeletorDeAba<GrupoDoLead>
            rotulo="Que lista mostrar"
            ativo={filtros.grupo}
            aoTrocar={trocarGrupo}
            itens={[
              {
                id: 'mensagem',
                rotulo: 'Mandaram mensagem',
                rotuloCurto: 'Mensagem',
                contagem: porGrupo.mensagem,
              },
              {
                id: 'clicou',
                rotulo: 'Clicaram e não chamaram',
                rotuloCurto: 'Só clicaram',
                contagem: porGrupo.clicou,
              },
            ]}
          />
        ) : null}

        {consulta.isPending ? (
          <Skeleton className="h-[68px] w-full max-w-3xl rounded-xl" />
        ) : leads.length === 0 ? null : mandaram ? (
          <dl className="grid max-w-3xl grid-cols-2 gap-2 md:grid-cols-4">
            <Numero rotulo="Hoje" valor={resumo.hoje} />
            <Numero rotulo="Últimos 7 dias" valor={resumo.seteDias} />
            <Numero rotulo="Sem resposta" valor={resumo.semResposta} destaque />
            <div className="sombra-base flex flex-col gap-0.5 rounded-xl bg-card px-3 py-2.5">
              <dt className="text-xs text-muted-foreground">1ª resposta, em média</dt>
              <dd className="text-xl leading-tight">
                {resumo.tempoMedioMs === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <Duracao texto={duracao(resumo.tempoMedioMs)} />
                )}
                <span className="sr-only"> nos últimos 7 dias</span>
              </dd>
            </div>
          </dl>
        ) : (
          <p className="max-w-2xl text-sm text-muted-foreground">
            Tocaram no WhatsApp, em ver o telefone ou em agendar visita, e não mandaram mensagem.
            Não têm ficha nem conversa: ligue para eles. O contato que o portal mandou é apagado 90
            dias depois do clique.
          </p>
        )}

        {leads.length > 0 ? (
          <ResumoPorAnuncio
            anuncios={porAnuncio.anuncios}
            leadCerto={porAnuncio.leadCerto}
            whatsapp={porAnuncio.whatsapp}
            aoEscolher={escolherAnuncio}
          />
        ) : null}
      </header>

      {consulta.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-2">
          <span className="sr-only">Carregando os leads.</span>
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-[60px] w-full rounded-xl" />
          ))}
        </div>
      ) : consulta.isError ? (
        <Vazio titulo="A lista não carregou." texto="Não deu para falar com o servidor.">
          <Button
            variant="outline"
            onClick={() => void consulta.refetch()}
            className="toque h-11 md:h-9"
          >
            <RotateCw aria-hidden="true" />
            Tentar de novo
          </Button>
        </Vazio>
      ) : leads.length === 0 ? (
        <Vazio
          titulo="Nenhum lead ainda."
          texto="Quem mandar mensagem por um anúncio no ZAP Imóveis, Viva Real ou OLX aparece aqui: pelo WhatsApp, assim que o CRM reconhece o texto do anúncio na conversa; pelo chat, formulário ou pedido de visita do portal, quando o Grupo OLX liberar a integração de leads do CRM."
        >
          <Button asChild variant="outline" className="toque h-11 md:h-9">
            <Link href="/anuncios">Ver os anúncios</Link>
          </Button>
        </Vazio>
      ) : (
        <>
          <section aria-label="Filtros" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full md:w-72">
                <label htmlFor="busca-leads" className="sr-only">
                  Buscar pelo nome
                </label>
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  id="busca-leads"
                  type="search"
                  inputMode="search"
                  autoComplete="off"
                  enterKeyHint="search"
                  placeholder="Buscar pelo nome"
                  value={filtros.busca}
                  onChange={(e) => mudar({ busca: e.target.value })}
                  className="h-11 pl-9 md:h-9"
                />
              </div>

              {mandaram ? (
                <Select
                  value={filtros.chegouPor ?? TODOS}
                  onValueChange={(v) => mudar({ chegouPor: ehJeitoDeChegar(v) ? v : null })}
                >
                  <SelectTrigger
                    aria-label="Como chegou"
                    className={cn(
                      'toque h-11 shrink-0 md:h-8',
                      filtros.chegouPor !== null && 'border-foreground/40 font-medium',
                    )}
                  >
                    <SelectValue>
                      {comoChegou(filtros.chegouPor) ?? 'Todo jeito de chegar'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TODOS}>Todo jeito de chegar</SelectItem>
                    {JEITOS_DE_CHEGAR.map((j) => (
                      <SelectItem key={j} value={j}>
                        <IconeDoTipo tipo={TIPO_DA_CHEGADA[j]} className="text-muted-foreground" />
                        {comoChegou(j)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Select
                  value={filtros.tipo ?? TODOS}
                  onValueChange={(v) => mudar({ tipo: v === TODOS ? null : v })}
                >
                  <SelectTrigger
                    aria-label="O que tocou"
                    className={cn(
                      'toque h-11 shrink-0 md:h-8',
                      filtros.tipo !== null && 'border-foreground/40 font-medium',
                    )}
                  >
                    <SelectValue>
                      {filtros.tipo === null ? 'Todo toque' : rotuloDoTipo(filtros.tipo)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TODOS}>Todo toque</SelectItem>
                    {TIPOS_DE_CLIQUE.map((t) => (
                      <SelectItem key={t} value={t}>
                        <IconeDoTipo tipo={t} className="text-muted-foreground" />
                        {rotuloDoTipo(t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {filtros.anuncio ? (
                <span className="inline-flex h-11 items-center gap-1 rounded-full bg-foreground pr-1 pl-3.5 text-sm text-background md:h-8">
                  Anúncio <span className="numerico">{filtros.anuncio}</span>
                  <button
                    type="button"
                    onClick={() => escolherAnuncio(null)}
                    className="toque inline-flex size-9 items-center justify-center rounded-full outline-none hover:bg-background/15 focus-visible:ring-3 focus-visible:ring-ring/50 md:size-6"
                    aria-label={`Tirar o filtro do anúncio ${filtros.anuncio}`}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                </span>
              ) : anuncios.length > 0 ? (
                <Select
                  value={TODOS}
                  onValueChange={(v) => escolherAnuncio(v === TODOS ? null : v)}
                >
                  <SelectTrigger aria-label="Anúncio" className="toque h-11 shrink-0 md:h-8">
                    <SelectValue>Todos os anúncios</SelectValue>
                  </SelectTrigger>
                  <SelectContent className="max-h-80">
                    <SelectItem value={TODOS}>Todos os anúncios</SelectItem>
                    {anuncios.map((c) => (
                      <SelectItem key={c} value={c}>
                        <span className="numerico">{c}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}

              {temFiltro ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="toque h-11 md:h-8"
                  onClick={() => {
                    mudar({ tipo: null, chegouPor: null, busca: '' });
                    escolherAnuncio(null);
                  }}
                >
                  Limpar filtros
                </Button>
              ) : null}
            </div>

            <ChipsDeSecao<RecorteDosLeads>
              rotulo="Que leads mostrar"
              ativo={filtros.recorte}
              aoTrocar={(recorte) => mudar({ recorte })}
              itens={
                mandaram
                  ? [
                      { id: 'todos', rotulo: 'Todos', contagem: contagem.todos },
                      { id: 'novo', rotulo: 'Sem resposta', contagem: contagem.novo },
                      {
                        id: 'em_atendimento',
                        rotulo: 'Em atendimento',
                        contagem: contagem.em_atendimento,
                      },
                      { id: 'respondido', rotulo: 'Respondidos', contagem: contagem.respondido },
                      { id: 'descartado', rotulo: 'Descartados', contagem: contagem.descartado },
                    ]
                  : [
                      { id: 'todos', rotulo: 'Para ligar', contagem: contagem.todos },
                      { id: 'descartado', rotulo: 'Descartados', contagem: contagem.descartado },
                    ]
              }
            />
          </section>

          {linhas.length === 0 ? (
            temFiltro || filtros.recorte !== 'todos' ? (
              <Vazio
                titulo="Nenhum lead com esses filtros."
                texto="Troque o filtro acima ou limpe a busca para ver os outros."
              />
            ) : mandaram ? (
              <Vazio
                titulo="Ninguém mandou mensagem ainda."
                texto="Quem escrever no WhatsApp depois de tocar num anúncio, ou pelo chat, formulário ou pedido de visita do portal, aparece aqui."
              />
            ) : (
              <Vazio
                titulo="Ninguém na lista para ligar."
                texto="Quem tocar no WhatsApp, em ver o telefone ou em agendar e não mandar mensagem aparece aqui."
              />
            )
          ) : mandaram ? (
            <>
              <TabelaDeLeads linhas={linhas} euId={euId} agora={agora} aoAbrir={setAbertoId} />
              <CartoesDeLeads linhas={linhas} euId={euId} agora={agora} aoAbrir={setAbertoId} />
            </>
          ) : (
            <>
              <TabelaDeCliques linhas={linhas} euId={euId} agora={agora} aoAbrir={setAbertoId} />
              <CartoesDeCliques linhas={linhas} euId={euId} agora={agora} aoAbrir={setAbertoId} />
            </>
          )}
          {leads.length >= TETO_DOS_LEADS ? (
            <p className="text-xs text-muted-foreground">
              Mostrando os <span className="numerico">{TETO_DOS_LEADS}</span> leads mais recentes.
            </p>
          ) : null}
        </>
      )}

      <FichaDoLead lead={aberto} euId={euId} agora={agora} aoFechar={() => setAbertoId(null)} />
    </div>
  );
}

function Numero({
  rotulo,
  valor,
  destaque = false,
}: {
  rotulo: string;
  valor: number;
  destaque?: boolean;
}) {
  return (
    <div className="sombra-base flex flex-col gap-0.5 rounded-xl bg-card px-3 py-2.5">
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd
        className={cn(
          'numerico text-xl leading-tight',
          destaque && valor > 0 && 'font-semibold text-quente-texto',
        )}
      >
        {valor}
      </dd>
    </div>
  );
}

/** "1 h 5 min" com só os números em mono: a unidade fica na letra do texto. */
function Duracao({ texto }: { texto: string }) {
  return (
    <>
      {texto.split(/(\d+)/).map((parte, i) =>
        /^\d+$/.test(parte) ? (
          <span key={i} className="numerico">
            {parte}
          </span>
        ) : (
          parte
        ),
      )}
    </>
  );
}

/**
 * Quanto cada anúncio rendeu nos últimos 7 dias, fechado por padrão (a lista é o
 * trabalho do dia; isto é a olhada da semana). Uma tabela de quatro colunas que
 * cabe em 390 px: o código e o título cortado à esquerda, os três números à
 * direita, com nomes curtos no celular. Tocar no código filtra a lista por ele.
 */
function ResumoPorAnuncio({
  anuncios,
  leadCerto,
  whatsapp,
  aoEscolher,
}: {
  anuncios: ResumoDoAnuncio[];
  leadCerto: number;
  /** Dos que mandaram mensagem, quantos nasceram da conversa ("Mensagem no WhatsApp"). */
  whatsapp: number;
  aoEscolher: (codigo: string) => void;
}) {
  const numeroDeAnuncios = anuncios.filter((a) => a.codigo !== null).length;
  return (
    <details className="group sombra-base max-w-3xl rounded-xl bg-card">
      <summary className="toque flex h-11 cursor-pointer list-none items-center gap-3 rounded-xl px-4 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:h-10 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">Resumo por anúncio</span>
          <span className="text-muted-foreground">
            {' · '}
            <span className="hidden min-[420px]:inline">últimos </span>7 dias
          </span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          <span className="numerico">{numeroDeAnuncios}</span>{' '}
          {numeroDeAnuncios === 1 ? 'anúncio' : 'anúncios'}
        </span>
        <ChevronDown
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      {anuncios.length === 0 ? (
        <p className="border-t border-hairline px-4 py-3 text-sm text-muted-foreground">
          Nenhum contato nos últimos 7 dias.
        </p>
      ) : (
        <table className="w-full table-fixed border-t border-hairline text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th scope="col" className="px-4 py-2 font-normal">
                Anúncio
              </th>
              <ColunaDoResumo curto="Mensagem" longo="Mandaram mensagem" />
              <ColunaDoResumo curto="Só clicou" longo="Clicaram e não chamaram" />
              <ColunaDoResumo curto="Sem resposta" longo="Sem resposta" ultima />
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {anuncios.map((a) => {
              const titulo = tituloCurto(a.titulo, 48);
              return (
                <tr key={a.chave} className="align-top">
                  <td className="px-4 py-2">
                    {a.codigo ? (
                      <button
                        type="button"
                        onClick={() => aoEscolher(a.codigo!)}
                        title={`Ver só os leads do anúncio ${a.codigo}`}
                        className="numerico max-w-full rounded text-left break-all underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        {a.codigo}
                      </button>
                    ) : (
                      <span className="text-muted-foreground">Sem código</span>
                    )}
                    {titulo ? (
                      <span className="block truncate text-xs text-muted-foreground">{titulo}</span>
                    ) : null}
                  </td>
                  <NumeroDoResumo
                    valor={a.mensagem}
                    titulo={
                      a.whatsapp > 0
                        ? `${a.whatsapp} pela mensagem no WhatsApp (o texto do anúncio)`
                        : undefined
                    }
                  />
                  <NumeroDoResumo valor={a.clicou} />
                  <NumeroDoResumo valor={a.semResposta} destaque ultima />
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {whatsapp > 0 ? (
        <p className="border-t border-hairline px-4 py-2 text-xs text-muted-foreground">
          Mensagem no WhatsApp: <span className="numerico">{whatsapp}</span> dos que mandaram
          mensagem chegaram pelo texto do anúncio, que o CRM reconheceu na conversa.
        </p>
      ) : null}
      {leadCerto > 0 ? (
        <p className="border-t border-hairline px-4 py-2 text-xs text-muted-foreground">
          Fora da conta: <span className="numerico">{leadCerto}</span> Lead Certo (a pessoa viu um
          imóvel parecido, não o anúncio).
        </p>
      ) : null}
    </details>
  );
}

function ColunaDoResumo({
  curto,
  longo,
  ultima = false,
}: {
  curto: string;
  longo: string;
  ultima?: boolean;
}) {
  return (
    <th
      scope="col"
      className={cn(
        'w-[4.5rem] py-2 pl-2 text-right leading-tight font-normal md:w-32',
        ultima ? 'pr-4' : 'pr-2',
      )}
    >
      <span className="md:hidden">{curto}</span>
      <span className="hidden md:inline">{longo}</span>
    </th>
  );
}

function NumeroDoResumo({
  valor,
  destaque = false,
  ultima = false,
  titulo,
}: {
  valor: number;
  destaque?: boolean;
  ultima?: boolean;
  /** A dica ao passar o mouse ("2 pela mensagem no WhatsApp"). */
  titulo?: string;
}) {
  return (
    <td
      title={titulo}
      className={cn(
        'numerico py-2 pl-2 text-right',
        ultima ? 'pr-4' : 'pr-2',
        valor === 0 && 'text-muted-foreground',
        destaque && valor > 0 && 'font-semibold text-quente-texto',
      )}
    >
      {valor}
    </td>
  );
}

/** "com Ana" ou "com você", para quem está em atendimento. */
function quemResponde(lead: LeadDoPortal, euId: string): string | null {
  if (!lead.responsavel_id) return null;
  if (lead.responsavel_id === euId) return 'com você';
  return `com ${lead.responsavel_nome ?? 'alguém da equipe'}`;
}

function telefoneDaLinha(lead: LeadDoPortal): string | null {
  return lead.phone_e164 ? formatarTelefone(lead.phone_e164) : null;
}

/** O código do anúncio em mono, o título curto e, no Lead Certo, o "parecido com". */
function AnuncioDaLinha({ lead, comLink }: { lead: LeadDoPortal; comLink: boolean }) {
  const origem = origemDoLead(lead);
  if (!origem.codigo) {
    return <span className="text-muted-foreground">{origem.tipo === 'mcmv' ? 'MCMV' : '—'}</span>;
  }
  const titulo = tituloCurto(lead.anuncio_titulo, 34);
  const codigo =
    comLink && lead.anuncio_id ? (
      <Link
        href={`/anuncios/${lead.anuncio_id}`}
        onClick={(e) => e.stopPropagation()}
        className="numerico underline-offset-4 hover:underline"
      >
        {origem.codigo}
      </Link>
    ) : (
      <span className="numerico">{origem.codigo}</span>
    );
  return (
    <span className="flex min-w-0 flex-col">
      {/* O código nunca é cortado: é por ele que se acha o anúncio no portal. */}
      <span className="break-words">
        {origem.tipo === 'parecido' ? (
          <span className="text-muted-foreground">parecido com </span>
        ) : null}
        {codigo}
      </span>
      {titulo ? <span className="truncate text-xs text-muted-foreground">{titulo}</span> : null}
    </span>
  );
}

/** A primeira mensagem numa linha; mídia sem texto vira "Foto", "Áudio"... */
function PrimeiraMensagem({ lead, limite }: { lead: LeadDoPortal; limite: number }) {
  const primeira = primeiraMensagemDoLead(lead);
  if (!primeira) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn('line-clamp-2 text-muted-foreground', primeira.midia && 'italic')}>
      {primeira.midia ? primeira.texto : `“${cortarMensagem(primeira.texto, limite)}”`}
    </span>
  );
}

/**
 * A situação com o que importa ao lado: há quanto tempo a pessoa espera, ou em
 * quanto tempo e quem respondeu ("Respondido · em 13 min · gestor.teste").
 */
function SituacaoDaLinha({
  lead,
  euId,
  agora,
  className,
}: {
  lead: LeadDoPortal;
  euId: string;
  agora: Date;
  className?: string;
}) {
  const resposta = respostaDoLead(lead, agora);
  const com = lead.situacao === 'em_atendimento' ? quemResponde(lead, euId) : null;
  return (
    <span className={cn('flex flex-col items-start gap-1', className)}>
      <SeloDaSituacao situacao={lead.situacao} />
      {resposta?.detalhe ? (
        <span
          className={cn(
            'max-w-full text-xs break-words',
            resposta.respondido ? 'text-muted-foreground' : 'text-foreground',
          )}
          title={resposta.frase}
        >
          {resposta.detalhe}
        </span>
      ) : null}
      {com ? (
        <span className="max-w-full truncate text-xs text-muted-foreground">{com}</span>
      ) : null}
    </span>
  );
}

function TabelaDeLeads({
  linhas,
  euId,
  agora,
  aoAbrir,
}: {
  linhas: LeadDoPortal[];
  euId: string;
  agora: Date;
  aoAbrir: (id: string) => void;
}) {
  return (
    <div className="sombra-base hidden overflow-hidden rounded-xl bg-card md:block">
      <table className="corpo-tabela w-full table-fixed text-sm">
        <thead>
          <tr className="border-b border-hairline text-left text-xs text-muted-foreground">
            <th scope="col" className="w-[7.5rem] px-4 py-2.5 font-normal">
              Chegou
            </th>
            <th scope="col" className="w-[11.5rem] px-3 py-2.5 font-normal">
              Contato
            </th>
            <th scope="col" className="w-[10rem] px-3 py-2.5 font-normal">
              Como chegou
            </th>
            <th scope="col" className="w-[11.5rem] px-3 py-2.5 font-normal">
              Anúncio
            </th>
            <th scope="col" className="px-3 py-2.5 font-normal">
              Primeira mensagem
            </th>
            <th scope="col" className="w-[5.5rem] px-3 py-2.5 font-normal">
              Temperatura
            </th>
            <th scope="col" className="w-[10.5rem] px-4 py-2.5 font-normal">
              Situação
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {linhas.map((lead) => {
            const chegou = chegouEm(lead);
            const { nome, semNome } = nomeDoLead(lead);
            const telefone = telefoneDaLinha(lead);
            return (
              <tr
                key={lead.id}
                onClick={() => aoAbrir(lead.id)}
                className="cursor-pointer align-top transition-colors hover:bg-muted/40"
              >
                <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                  <span title={dataHoraDoLead(chegou)}>{recebidoHa(chegou, agora)}</span>
                </td>
                <td className="px-3 py-3">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      aoAbrir(lead.id);
                    }}
                    className={cn(
                      'block max-w-full truncate rounded text-left font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                      semNome && 'font-normal text-muted-foreground',
                    )}
                  >
                    {nome}
                  </button>
                  {telefone ? (
                    <span className="numerico block truncate text-xs text-muted-foreground">
                      {telefone}
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-3">
                  <ComoChegou lead={lead} />
                </td>
                <td className="px-3 py-3">
                  <AnuncioDaLinha lead={lead} comLink />
                </td>
                <td className="px-3 py-3">
                  <PrimeiraMensagem lead={lead} limite={120} />
                </td>
                <td className="px-3 py-3">
                  <ChipDaTemperatura valor={lead.temperatura} />
                </td>
                <td className="px-4 py-3">
                  <SituacaoDaLinha lead={lead} euId={euId} agora={agora} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * No celular, cartões: o nome e quando chegou na primeira linha, por onde chegou
 * e de qual anúncio na segunda, a primeira mensagem cortada, e embaixo a
 * situação com o tempo. O cartão inteiro abre a ficha (o link do anúncio mora nela).
 */
function CartoesDeLeads({
  linhas,
  euId,
  agora,
  aoAbrir,
}: {
  linhas: LeadDoPortal[];
  euId: string;
  agora: Date;
  aoAbrir: (id: string) => void;
}) {
  return (
    <ul className="sombra-base flex flex-col divide-y divide-hairline overflow-hidden rounded-xl bg-card md:hidden">
      {linhas.map((lead) => {
        const chegou = chegouEm(lead);
        const { nome, semNome } = nomeDoLead(lead);
        const telefone = telefoneDaLinha(lead);
        const titulo = tituloCurto(lead.anuncio_titulo, 40);
        const jeito = jeitoDeChegar(lead);
        return (
          <li key={lead.id}>
            <button
              type="button"
              onClick={() => aoAbrir(lead.id)}
              className="toque flex w-full min-w-0 flex-col gap-1.5 px-4 py-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
            >
              <span className="flex w-full min-w-0 items-baseline justify-between gap-3">
                <span
                  className={cn(
                    'truncate text-[15px] font-medium',
                    semNome && 'font-normal text-muted-foreground',
                  )}
                >
                  {nome}
                </span>
                <span
                  className="shrink-0 text-xs text-muted-foreground"
                  title={dataHoraDoLead(chegou)}
                >
                  {recebidoHa(chegou, agora)}
                </span>
              </span>
              <span className="flex w-full min-w-0 items-center gap-1.5 text-sm">
                <IconeDoTipo
                  tipo={jeito ? TIPO_DA_CHEGADA[jeito] : null}
                  className="text-muted-foreground"
                />
                <span className="shrink-0">{comoChegouOLead(lead) ?? 'Mensagem'}</span>
                <span className="text-muted-foreground">·</span>
                <span className="min-w-0 truncate text-muted-foreground">
                  {origemDoLead(lead).tipo === 'parecido' ? 'parecido com ' : ''}
                  <span className="numerico">{codigoDoAnuncioDoLead(lead) ?? 'sem anúncio'}</span>
                  {titulo ? ` ${titulo}` : ''}
                </span>
              </span>
              {telefone ? (
                <span className="numerico text-xs text-muted-foreground">{telefone}</span>
              ) : null}
              <span className="text-sm">
                <PrimeiraMensagem lead={lead} limite={90} />
              </span>
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <SeloDaSituacao situacao={lead.situacao} />
                <ChipDaTemperatura valor={lead.temperatura} completo />
                <DetalheDaResposta lead={lead} euId={euId} agora={agora} />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** O tempo da resposta ao lado do selo, no cartão do celular. */
function DetalheDaResposta({
  lead,
  euId,
  agora,
}: {
  lead: LeadDoPortal;
  euId: string;
  agora: Date;
}) {
  const resposta = respostaDoLead(lead, agora);
  const com = lead.situacao === 'em_atendimento' ? quemResponde(lead, euId) : null;
  const texto = [resposta?.detalhe, com].filter(Boolean).join(' · ');
  if (!texto) return null;
  return (
    <span
      className={cn(
        'text-xs',
        resposta && !resposta.respondido ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      {texto}
    </span>
  );
}

/** O que a pessoa tocou no anúncio, um por linha, com o ícone. */
function ToquesDoLead({ lead }: { lead: LeadDoPortal }) {
  const tipos = tiposDoLead(lead.tipos);
  if (tipos.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex min-w-0 flex-col gap-1">
      {tipos.map((t) => (
        <TipoDeContato key={t} tipo={t} />
      ))}
    </span>
  );
}

/** Quem pediu para não ser contatado já ficou de fora; aqui, o contato apagado aos 90 dias. */
function TelefoneDaLinhaDeClique({ lead }: { lead: LeadDoPortal }) {
  if (lead.contato_apagado_em && !lead.organization_id) {
    return <span className="text-muted-foreground">Apagado aos 90 dias</span>;
  }
  return (
    // O revelar é botão dentro da linha que abre a folha: o clique para aqui.
    <span className="block" onClick={(e) => e.stopPropagation()}>
      <TelefoneDoLead lead={lead} compacto />
    </span>
  );
}

/**
 * Quem clicou e não chamou, no computador: uma lista para ligar. O telefone se
 * revela na própria linha (com registro) e o descarte também; o resto abre a
 * folha.
 */
function TabelaDeCliques({
  linhas,
  euId,
  agora,
  aoAbrir,
}: {
  linhas: LeadDoPortal[];
  euId: string;
  agora: Date;
  aoAbrir: (id: string) => void;
}) {
  return (
    <div className="sombra-base hidden overflow-hidden rounded-xl bg-card md:block">
      <table className="corpo-tabela w-full table-fixed text-sm">
        <thead>
          <tr className="border-b border-hairline text-left text-xs text-muted-foreground">
            <th scope="col" className="w-[7.5rem] px-4 py-2.5 font-normal">
              Clicou
            </th>
            <th scope="col" className="w-[14rem] px-3 py-2.5 font-normal">
              Nome no portal
            </th>
            <th scope="col" className="w-[15rem] px-3 py-2.5 font-normal">
              Telefone
            </th>
            <th scope="col" className="w-[10rem] px-3 py-2.5 font-normal">
              O que tocou
            </th>
            <th scope="col" className="px-3 py-2.5 font-normal">
              Anúncio
            </th>
            <th scope="col" className="w-[8.5rem] px-4 py-2.5 font-normal">
              <span className="sr-only">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {linhas.map((lead) => {
            const chegou = chegouEm(lead);
            const { nome, semNome } = nomeDoLead(lead);
            const descartado = lead.situacao === 'descartado';
            const com = quemResponde(lead, euId);
            return (
              <tr
                key={lead.id}
                onClick={() => aoAbrir(lead.id)}
                className="cursor-pointer align-top transition-colors hover:bg-muted/40"
              >
                <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                  <span title={dataHoraDoLead(chegou)}>{recebidoHa(chegou, agora)}</span>
                </td>
                <td className="px-3 py-3">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      aoAbrir(lead.id);
                    }}
                    className={cn(
                      'block max-w-full truncate rounded text-left font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                      semNome && 'font-normal text-muted-foreground',
                    )}
                  >
                    {nome}
                  </button>
                  {lead.email ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {lead.email}
                    </span>
                  ) : null}
                  {com ? <span className="block text-xs text-muted-foreground">{com}</span> : null}
                </td>
                <td className="px-3 py-3">
                  <TelefoneDaLinhaDeClique lead={lead} />
                </td>
                <td className="px-3 py-3">
                  <ToquesDoLead lead={lead} />
                </td>
                <td className="px-3 py-3">
                  <AnuncioDaLinha lead={lead} comLink />
                </td>
                <td className="px-4 py-3">
                  {descartado ? (
                    <SeloDaSituacao situacao="descartado" />
                  ) : (
                    <BotaoDescartar
                      lead={lead}
                      nome={semNome ? null : nome}
                      className="toque -ml-2 h-8 px-2 text-muted-foreground"
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * No celular: o nome, quando clicou, o que tocou e o anúncio abrem a folha; o
 * telefone (com o revelar) e o descartar ficam embaixo, fora do botão.
 */
function CartoesDeCliques({
  linhas,
  euId,
  agora,
  aoAbrir,
}: {
  linhas: LeadDoPortal[];
  euId: string;
  agora: Date;
  aoAbrir: (id: string) => void;
}) {
  return (
    <ul className="sombra-base flex flex-col divide-y divide-hairline overflow-hidden rounded-xl bg-card md:hidden">
      {linhas.map((lead) => {
        const chegou = chegouEm(lead);
        const { nome, semNome } = nomeDoLead(lead);
        const tipos = tiposDoLead(lead.tipos);
        const titulo = tituloCurto(lead.anuncio_titulo, 40);
        const descartado = lead.situacao === 'descartado';
        const com = quemResponde(lead, euId);
        return (
          <li key={lead.id} className="flex flex-col">
            <button
              type="button"
              onClick={() => aoAbrir(lead.id)}
              className="toque flex w-full min-w-0 flex-col gap-1.5 px-4 pt-3 pb-1.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
            >
              <span className="flex w-full min-w-0 items-baseline justify-between gap-3">
                <span
                  className={cn(
                    'truncate text-[15px] font-medium',
                    semNome && 'font-normal text-muted-foreground',
                  )}
                >
                  {nome}
                </span>
                <span
                  className="shrink-0 text-xs text-muted-foreground"
                  title={dataHoraDoLead(chegou)}
                >
                  {recebidoHa(chegou, agora)}
                </span>
              </span>
              <span className="flex w-full min-w-0 items-center gap-1.5 text-sm">
                <IconeDoTipo tipo={tipos[0] ?? null} className="text-muted-foreground" />
                <span className="shrink-0">
                  {tipos.length > 0 ? tipos.map((t) => rotuloDoTipo(t)).join(' e ') : 'Clicou'}
                </span>
                <span className="text-muted-foreground">·</span>
                <span className="min-w-0 truncate text-muted-foreground">
                  {origemDoLead(lead).tipo === 'parecido' ? 'parecido com ' : ''}
                  <span className="numerico">{codigoDoAnuncioDoLead(lead) ?? 'sem anúncio'}</span>
                  {titulo ? ` ${titulo}` : ''}
                </span>
              </span>
              {lead.email ? (
                <span className="truncate text-xs text-muted-foreground">{lead.email}</span>
              ) : null}
              {com ? <span className="text-xs text-muted-foreground">{com}</span> : null}
            </button>
            <div className="flex flex-wrap items-center gap-2 px-4 pb-3 text-sm">
              <span className="min-w-0">
                <TelefoneDaLinhaDeClique lead={lead} />
              </span>
              {descartado ? (
                <span className="ml-auto">
                  <SeloDaSituacao situacao="descartado" />
                </span>
              ) : (
                <BotaoDescartar
                  lead={lead}
                  nome={semNome ? null : nome}
                  className="toque ml-auto h-11 text-muted-foreground"
                />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Vazio({
  titulo,
  texto,
  children,
}: {
  titulo: string;
  texto: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="sombra-base flex flex-col items-start gap-3 rounded-xl bg-card p-5">
      <Inbox className="size-5 text-muted-foreground" aria-hidden="true" />
      <div>
        <p className="font-medium">{titulo}</p>
        <p className="max-w-xl text-sm text-muted-foreground">{texto}</p>
      </div>
      {children}
    </div>
  );
}
