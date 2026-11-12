'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronDown,
  CircleCheck,
  CircleDashed,
  FileSpreadsheet,
  Info,
  RotateCw,
  Trash2,
  TriangleAlert,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import { DialogoExcluirDuplicado } from './anuncios-no-canal-pro';
import { carregarCaminhoDoLead, CHAVE_DO_CAMINHO } from './dados';
import { formatarQuando } from './no-portal';
import { BotaoPorNoAr, EnderecoDeLeads, EnderecoDoArquivo } from './painel-canal-pro';
import {
  type AnuncioComPendencia,
  AVISOS_AO_LIGAR,
  caminhoDoLead,
  type EstadoDoCaminho,
  LIGAR_NO_CANAL_PRO,
  type PassoDaEntrega,
  type PassoDoArquivo,
  type PassoDoCaminho,
  type PassoDosAnuncios,
  type PassoDosRepetidos,
  type RepetidoNoRelatorio,
  type SituacaoDoPasso,
} from './passos-do-caminho';
import { oQueFalta } from './regras-do-cartao';

/**
 * O caminho até o primeiro lead dos portais (11/11/2026), no alto de Anúncios,
 * só para admin e gestor.
 *
 * Gargalo "entra pouco lead": 0 leads dos portais na produção, o Canal Pro lendo
 * o arquivo do sistema atual (a Arbo), os anúncios do CRM em rascunho, vagas do
 * plano com repetidos e nenhum lead de teste. Cada passo lê o estado real
 * (`public.anuncios_caminho_do_lead`, numa chamada) e diz o que falta, com a ação
 * ao lado — as que já existem: "Pôr no ar pelo CRM" e a URL do "Antes de colar"
 * (`painel-canal-pro.tsx`), o "Excluir duplicado" (`anuncios-no-canal-pro.tsx`)
 * e o "Atualizar do Canal Pro". A regra de cada passo mora em
 * `passos-do-caminho.ts`. Com tudo feito, a lista vira a linha "Portais ligados".
 *
 * O primeiro passo (12/11/2026) é ligar os leads: a URL de leads para copiar e
 * o caminho no Canal Pro (Integrações → aba Leads → "Receber leads no CRM"),
 * que não depende da troca do arquivo de anúncios.
 */
export function CaminhoDoLead({
  chave,
  noPortalSoPeloSistemaAtual,
  aoImportar,
}: {
  /** A chave da URL do arquivo (de `canal_pro_situacao`, só para admin e gestor). */
  chave: string | null;
  /** No portal pelo sistema atual e não no ar no CRM: a troca os tiraria do ar. */
  noPortalSoPeloSistemaAtual: number;
  /** Abre a folha "Atualizar do Canal Pro" (o relatório exportado). */
  aoImportar: () => void;
}) {
  const consulta = useQuery({
    queryKey: CHAVE_DO_CAMINHO,
    queryFn: carregarCaminhoDoLead,
    // Quem faz o lead de teste volta do celular para cá: o passo dos leads se atualiza.
    refetchOnWindowFocus: true,
  });
  const [aberto, setAberto] = useState(false);

  if (consulta.isPending) return <Skeleton className="h-12 w-full max-w-2xl rounded-xl" />;
  if (consulta.isError || !consulta.data) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        O caminho até o primeiro lead não carregou.
        <button
          type="button"
          onClick={() => void consulta.refetch()}
          className="inline-flex items-center gap-1 text-foreground underline underline-offset-4"
        >
          <RotateCw className="size-3.5" aria-hidden="true" />
          Tentar de novo
        </button>
      </p>
    );
  }

  const caminho = caminhoDoLead(consulta.data, new Date(), noPortalSoPeloSistemaAtual);

  if (caminho.ligado && !aberto) {
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <CircleCheck className="size-4 text-cliente-texto" aria-hidden="true" />
        <span className="font-medium">Portais ligados</span>
        {caminho.avisos.map((a) => (
          <span key={a} className="text-muted-foreground">
            · {a}
          </span>
        ))}
        <button
          type="button"
          onClick={() => setAberto(true)}
          className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Ver o caminho
        </button>
      </p>
    );
  }

  const faltam = caminho.passos.filter((p) => p.situacao === 'falta').length;

  return (
    <section
      aria-labelledby="caminho-do-lead"
      className="sombra-base flex flex-col gap-3 rounded-xl bg-card p-4 md:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id="caminho-do-lead" className="text-base font-medium">
            Caminho até o primeiro lead
          </h2>
          <p className="text-sm text-muted-foreground">
            {faltam === 0
              ? 'Tudo feito: os portais estão ligados ao CRM.'
              : `${faltam === 1 ? 'Falta 1 passo' : `Faltam ${faltam} passos`} para os leads do ZAP, do Viva Real e da OLX chegarem ao CRM. Os passos no Canal Pro pedem o login da Imova.`}
          </p>
        </div>
        {caminho.ligado ? (
          <Button
            type="button"
            variant="ghost"
            className="toque h-11 md:h-9"
            onClick={() => setAberto(false)}
          >
            <ChevronDown className="rotate-180" aria-hidden="true" />
            Recolher
          </Button>
        ) : null}
      </div>

      <ol className="flex flex-col divide-y divide-hairline">
        {caminho.passos.map((p, i) => (
          <li key={p.id} className="flex gap-3 py-3 first:pt-1 last:pb-0">
            <IconeDoPasso situacao={p.situacao} />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div>
                <p className="text-sm font-medium">
                  <span className="numerico text-muted-foreground">{i + 1}.</span> {p.nome}
                </p>
                <p
                  className={cn(
                    'text-sm',
                    p.situacao === 'feito' ? 'text-muted-foreground' : 'text-foreground',
                  )}
                >
                  {p.resumo}
                  {p.id === 'leads' && consulta.data.leads.ultimo ? (
                    <>
                      {' '}
                      <Link
                        href={`/anuncios/leads?lead=${encodeURIComponent(consulta.data.leads.ultimo.id)}`}
                        className="underline underline-offset-4"
                      >
                        Ver o lead
                      </Link>
                    </>
                  ) : null}
                </p>
              </div>
              {p.situacao !== 'feito' ? (
                <DetalheDoPasso
                  passo={p}
                  estado={consulta.data}
                  chave={chave}
                  aoImportar={aoImportar}
                />
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

const ICONE: Record<
  SituacaoDoPasso,
  { Icone: typeof CircleCheck; classe: string; leitura: string }
> = {
  feito: { Icone: CircleCheck, classe: 'text-cliente-texto', leitura: 'Feito' },
  falta: { Icone: CircleDashed, classe: 'text-muted-foreground', leitura: 'Falta' },
  atencao: { Icone: TriangleAlert, classe: 'text-morno-texto', leitura: 'Pede um olhar' },
};

function IconeDoPasso({ situacao }: { situacao: SituacaoDoPasso }) {
  const { Icone, classe, leitura } = ICONE[situacao];
  return (
    <span className="mt-0.5 shrink-0">
      <Icone className={cn('size-5', classe)} aria-hidden="true" />
      <span className="sr-only">{leitura}:</span>
    </span>
  );
}

function DetalheDoPasso({
  passo,
  estado,
  chave,
  aoImportar,
}: {
  passo: PassoDoCaminho;
  estado: EstadoDoCaminho;
  chave: string | null;
  aoImportar: () => void;
}) {
  return (
    <div className="flex flex-col gap-2.5 text-sm">
      {passo.detalhe ? <p className="text-muted-foreground">{passo.detalhe}</p> : null}
      {passo.id === 'entrega' ? (
        <DetalheDaEntrega passo={passo} />
      ) : passo.id === 'anuncios' ? (
        <DetalheDosAnuncios passo={passo} estado={estado} />
      ) : passo.id === 'arquivo' ? (
        <DetalheDoArquivo passo={passo} chave={chave} />
      ) : passo.id === 'repetidos' ? (
        <DetalheDosRepetidos passo={passo} estado={estado} aoImportar={aoImportar} />
      ) : null}
    </div>
  );
}

/**
 * Ligar os leads (12/11/2026): a URL de leads com o botão de copiar, o caminho
 * no Canal Pro em passos curtos e os três avisos (a Arbo, o suporte, o e-mail).
 */
function DetalheDaEntrega({ passo }: { passo: PassoDaEntrega }) {
  return (
    <>
      {passo.ligar ? (
        <div className="flex flex-col gap-2">
          <EnderecoDeLeads />
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-muted-foreground">
            {LIGAR_NO_CANAL_PRO.map((texto) => (
              <li key={texto}>{texto}</li>
            ))}
          </ol>
          <ul className="flex flex-col gap-1.5">
            {AVISOS_AO_LIGAR.map((texto, i) => {
              // O primeiro (a URL da Arbo no campo) é o que muda para onde os leads vão.
              const Icone = i === 0 ? TriangleAlert : Info;
              return (
                <li
                  key={texto}
                  className={cn(
                    'flex items-start gap-1.5 rounded-lg px-3 py-2',
                    i === 0 ? 'bg-morno-fundo text-morno-texto' : 'bg-muted text-muted-foreground',
                  )}
                >
                  <Icone className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {texto}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {passo.notas.map((nota) => (
        <p key={nota} className="text-xs text-muted-foreground">
          {nota}
        </p>
      ))}
    </>
  );
}

/** Uma linha com o código (que abre o anúncio), o título e, à direita, a ação. */
function LinhaDoAnuncio({
  id,
  codigo,
  texto,
  children,
}: {
  id: string;
  codigo: string;
  texto: string;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-2">
      <p className="min-w-0 flex-1 basis-56">
        <Link
          href={`/anuncios/${id}`}
          className="numerico font-medium underline-offset-4 hover:underline"
        >
          {codigo}
        </Link>
        <span className="text-muted-foreground"> · {texto}</span>
      </p>
      {children}
    </li>
  );
}

function ListaComPendencia({ titulo, lista }: { titulo: string; lista: AnuncioComPendencia[] }) {
  if (lista.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-xs font-medium text-muted-foreground">{titulo}</p>
      <ul className="flex flex-col divide-y divide-hairline">
        {lista.map((a) => (
          <LinhaDoAnuncio
            key={a.id}
            id={a.id}
            codigo={a.codigo}
            texto={`falta ${oQueFalta(a.pendencias)}`}
          />
        ))}
      </ul>
    </div>
  );
}

function DetalheDosAnuncios({
  passo,
  estado,
}: {
  passo: PassoDosAnuncios;
  estado: EstadoDoCaminho;
}) {
  return (
    <>
      <ListaComPendencia
        titulo="No ar no CRM, mas fora do arquivo"
        lista={estado.anuncios.foraDoArquivo}
      />
      {passo.cabem.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {passo.cabem.length > 1 ? <BotaoPorNoAr anuncios={passo.cabem} /> : null}
          <ul className="flex flex-col divide-y divide-hairline">
            {passo.cabem.map((a) => (
              <LinhaDoAnuncio
                key={a.id}
                id={a.id}
                codigo={a.codigo}
                texto={a.ocupaVaga ? `${a.titulo} (já ocupa a vaga dele)` : a.titulo}
              >
                <BotaoPorNoAr anuncios={[a]} variante="outline" rotulo="Pôr no ar" />
              </LinhaDoAnuncio>
            ))}
          </ul>
        </div>
      ) : null}
      {passo.esperamVaga.length > 0 ? (
        <p className="text-muted-foreground">
          Esperam vaga no plano:{' '}
          <span className="numerico">{passo.esperamVaga.map((a) => a.codigo).join(' · ')}</span>
        </p>
      ) : null}
      <ListaComPendencia
        titulo="Rascunhos que ainda não podem ir ao ar"
        lista={estado.anuncios.comPendencia}
      />
    </>
  );
}

function DetalheDoArquivo({ passo, chave }: { passo: PassoDoArquivo; chave: string | null }) {
  return (
    <>
      {passo.antesDeColar ? (
        <p className="flex items-start gap-1.5 rounded-lg bg-morno-fundo px-3 py-2 text-morno-texto">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {passo.antesDeColar}
        </p>
      ) : null}
      {passo.colar ? (
        chave ? (
          <div className="flex flex-col gap-2">
            <EnderecoDoArquivo chave={chave} />
            <ol className="flex list-decimal flex-col gap-1 pl-5 text-muted-foreground">
              <li>
                Entre no Canal Pro com o login da Imova e abra Configurações da conta → Integração
                de anúncios.
              </li>
              <li>
                Mantenha o software &ldquo;Desenvolvedor Próprio&rdquo;, troque o endereço do
                sistema atual por este e salve.
              </li>
              <li>
                Espere a primeira leitura do Grupo OLX (o Canal Pro mostra quando é a próxima). Ela
                aparece aqui.
              </li>
              <li>
                Depois, confira o Relatório de integração do Canal Pro: é lá que o Grupo OLX diz se
                recusou algum anúncio.
              </li>
            </ol>
          </div>
        ) : (
          <p className="text-muted-foreground">A URL do arquivo aparece para admin e gestor.</p>
        )
      ) : null}
      {passo.outraLeitura ? (
        <p className="text-xs text-muted-foreground">{passo.outraLeitura}</p>
      ) : null}
    </>
  );
}

function DetalheDosRepetidos({
  passo,
  estado,
  aoImportar,
}: {
  passo: PassoDosRepetidos;
  estado: EstadoDoCaminho;
  aoImportar: () => void;
}) {
  const [excluindo, setExcluindo] = useState<RepetidoNoRelatorio | null>(null);
  const { repetidosAtivos, repetidosInativos } = estado.relatorio;
  return (
    <>
      {repetidosAtivos.length > 0 ? (
        <ul className="flex flex-col divide-y divide-hairline">
          {repetidosAtivos.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-2"
            >
              <div className="min-w-0 flex-1 basis-56">
                <p>
                  <span className="numerico font-medium">{r.codigo}</span>
                  <span className="text-muted-foreground">
                    {' '}
                    · cópia antiga de <span className="numerico">{r.copiaDe}</span>, ocupa uma vaga
                  </span>
                </p>
                {r.marcadoExcluidoEm ? (
                  <p className="text-xs font-medium">
                    Marcado como excluído {formatarQuando(r.marcadoExcluidoEm)}, mas o relatório
                    seguinte ainda o trouxe: a exclusão não pegou no Canal Pro.
                  </p>
                ) : null}
              </div>
              <Button
                type="button"
                variant="outline"
                className="toque h-11 md:h-9"
                onClick={() => setExcluindo(r)}
              >
                <Trash2 aria-hidden="true" />
                Excluir duplicado
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {repetidosInativos > 0 ? (
        <p className="text-xs text-muted-foreground">
          {repetidosInativos === 1
            ? '1 repetido inativo não ocupa vaga; ele está na lista do Canal Pro, mais abaixo.'
            : `${repetidosInativos} repetidos inativos não ocupam vaga; eles estão na lista do Canal Pro, mais abaixo.`}
        </p>
      ) : null}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
        <FileSpreadsheet className="size-4" aria-hidden="true" />
        {passo.relatorio ? `${passo.relatorio}. O ideal é uma vez por semana.` : null}
        <button
          type="button"
          onClick={aoImportar}
          className="text-foreground underline underline-offset-4"
        >
          {passo.relatorio ? 'Importar de novo' : 'Importar o relatório'}
        </button>
      </p>
      {excluindo ? (
        <DialogoExcluirDuplicado
          anuncio={excluindo}
          original={{ codigo: excluindo.copiaDe }}
          aberto
          aoFechar={() => setExcluindo(null)}
        />
      ) : null}
    </>
  );
}
