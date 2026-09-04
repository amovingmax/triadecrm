'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, MessageSquarePlus } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatarProximaAcao } from '@/components/parceiros/formatos';
import { TelefoneRevelavel } from '@/components/parceiros/telefone-revelavel';
import { ChipTemperatura, DiasSemContato } from '@/components/temperatura';

import { AvisoWhatsapp } from './aviso-whatsapp';
import { carregarLinhaDoParceiro, chaveDaLinha, mensagemDoErro } from './dados';
import { ErroDaTela, EsqueletoLinha } from './estados';
import { contagemDeInteracoes, local } from './formatos';
import { LinhaDoTempo } from './linha-do-tempo';
import { agruparPorDia, escolherNegocio, montarLinhaDoTempo, type CatalogosConversas } from './montagem';
import type { ItemConversa } from './tipos';

/**
 * A coluna da direita: quem é o parceiro, o que já aconteceu com ele, e por onde
 * continuar.
 *
 * O cabeçalho é o que o RF-CON-05 chama de "ficha ao lado da conversa": nome,
 * temperatura, etapa, responsável, telefone (revelado pela mesma RPC auditada da
 * ficha) e a próxima ação combinada. Abaixo dele vem a linha do tempo inteira.
 *
 * A ação da tela é REGISTRAR CONTATO, e ela é um link para `/registrar?org=<id>` —
 * o passo 2 da tela de três toques, que já é o contrato publicado daquele módulo.
 * Duplicar aqui o formulário de registro criaria uma segunda porta de entrada para
 * `registrar_contato`, com outra previsão de temperatura e outra fila offline.
 */
export function Conversa({
  item,
  catalogos,
  aoVoltar,
}: {
  item: ItemConversa;
  catalogos: CatalogosConversas;
  /** Só o celular usa: lá a conversa OCUPA a tela e precisa devolver para a lista. */
  aoVoltar: () => void;
}) {
  const consulta = useQuery({
    queryKey: chaveDaLinha(item.id),
    queryFn: () => carregarLinhaDoParceiro(item.id),
  });

  const dias = useMemo(() => {
    if (!consulta.data) return [];
    return agruparPorDia(
      montarLinhaDoTempo({
        atividades: consulta.data.atividades,
        historico: consulta.data.historico,
        catalogos,
      }),
    );
  }, [consulta.data, catalogos]);

  const negocio = consulta.data ? escolherNegocio(consulta.data.negocios) : null;
  const proxima = formatarProximaAcao(negocio?.next_action_at);
  const onde = local(item.bairro, item.cidade);
  const contagem = contagemDeInteracoes(item.interacoes);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-col gap-3 border-b border-hairline p-4 md:p-5">
        <div className="flex items-start gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={aoVoltar}
            className="toque -ml-2 size-11 shrink-0 md:hidden"
          >
            <ArrowLeft aria-hidden="true" />
            <span className="sr-only">Voltar para a lista de conversas</span>
          </Button>

          <div className="min-w-0 flex-1">
            <h2 className="font-heading text-lg leading-tight font-semibold tracking-tight">
              {item.nome}
            </h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <ChipTemperatura
                temperatura={item.temperatura}
                esfriando={item.precisaAtencao}
                className="text-[11px]"
              />
              {item.etapa ? (
                <Badge variant="pilula" className="h-5 px-2 text-[11px] font-normal">
                  {item.etapa}
                  {item.funil ? <span className="text-muted-foreground"> · {item.funil}</span> : null}
                </Badge>
              ) : null}
              {item.naoContatar ? (
                <Badge variant="pilula" className="h-5 px-2 text-[11px] font-normal">
                  não contatar
                </Badge>
              ) : null}
            </p>
          </div>
        </div>

        {/* Duas colunas já no celular: em uma coluna estes seis campos empurravam a
            linha do tempo 640px para baixo, e a linha do tempo é a razão da tela. */}
        <dl className="grid max-w-3xl grid-cols-2 gap-x-4 gap-y-2 text-xs md:gap-x-6">
          <Campo rotulo="Onde">{onde || 'Sem endereço na base'}</Campo>
          <Campo rotulo="Categoria">{item.categoria ?? 'Sem categoria'}</Campo>
          <Campo rotulo="Responsável">
            {item.responsavel ?? <span className="text-muted-foreground">Sem dono</span>}
          </Campo>
          <Campo rotulo="Último contato">
            <span className="flex items-center gap-1.5">
              <DiasSemContato dias={item.diasSemContato} atencao={item.precisaAtencao} />
              <span className="text-muted-foreground">
                (<span className="numerico">{contagem.numero}</span>
                {contagem.palavra})
              </span>
            </span>
          </Campo>
          <Campo rotulo="Telefone" largo>
            <TelefoneRevelavel
              organizationId={item.id}
              telefone={item.telefone}
              mascarado={item.telefoneMascarado}
            />
          </Campo>
          {negocio?.next_action || proxima ? (
            <Campo rotulo="Próxima ação" largo>
              <span className={cn('flex flex-wrap items-baseline gap-1.5', proxima?.atrasada && 'font-medium')}>
                {negocio?.next_action ?? 'Combinada'}
                {proxima ? (
                  <span className="text-muted-foreground" title={proxima.detalhe}>
                    {proxima.prefixo}
                    {proxima.numero ? <span className="numerico">{proxima.numero}</span> : null}
                    {proxima.sufixo}
                  </span>
                ) : null}
              </span>
            </Campo>
          ) : null}
        </dl>

        <div className="flex flex-wrap gap-2">
          <Button asChild className="toque h-11 md:h-9">
            <Link href={`/registrar?org=${item.id}`}>
              <MessageSquarePlus aria-hidden="true" />
              Registrar contato
            </Link>
          </Button>
          <Button asChild variant="outline" className="toque h-11 md:h-9">
            <Link href={`/parceiros/${item.id}`}>
              <ExternalLink aria-hidden="true" />
              Abrir ficha
            </Link>
          </Button>
        </div>
      </header>

      {/* A coluna de leitura fica em 48rem: numa tela de 1440 o painel tem mais de
          1.100px, e uma nota de visita esticada nessa largura vira uma linha de 200
          caracteres, que ninguém lê. */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
        <AvisoWhatsapp compacto className="mb-5 max-w-3xl" />

        {consulta.isPending ? (
          <EsqueletoLinha />
        ) : consulta.isError ? (
          <ErroDaTela
            causa={mensagemDoErro(consulta.error)}
            aoTentar={() => void consulta.refetch()}
          />
        ) : dias.length === 0 ? (
          <SemHistorico organizacaoId={item.id} />
        ) : (
          <div className="max-w-3xl">
            <LinhaDoTempo dias={dias} />
          </div>
        )}
      </div>
    </div>
  );
}

function Campo({
  rotulo,
  children,
  largo = false,
}: {
  rotulo: string;
  children: React.ReactNode;
  largo?: boolean;
}) {
  return (
    <div className={cn('min-w-0', largo && 'col-span-2')}>
      <dt className="text-[11px] text-muted-foreground">{rotulo}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

/**
 * Nem o import da lista-semente aparece: é o caso de um parceiro cadastrado à mão,
 * sem nenhuma atividade e sem negócio. Raro na base atual, mas é o estado que qualquer
 * cadastro rápido produz no primeiro segundo de vida.
 */
function SemHistorico({ organizacaoId }: { organizacaoId: string }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-hairline px-4 py-6">
      <div className="space-y-1">
        <p className="font-heading font-medium">Nada aconteceu com este parceiro ainda</p>
        <p className="max-w-prose text-sm text-muted-foreground">
          A linha do tempo começa no primeiro contato. Registre a ligação, a visita ou a
          mensagem e ela aparece aqui, com o desfecho e a etapa para onde o negócio foi.
        </p>
      </div>
      <Button asChild className="toque h-11 md:h-9">
        <Link href={`/registrar?org=${organizacaoId}`}>
          <MessageSquarePlus aria-hidden="true" />
          Registrar o primeiro contato
        </Link>
      </Button>
    </div>
  );
}
