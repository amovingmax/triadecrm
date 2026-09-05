'use client';

import Link from 'next/link';
import { FilterX, MessagesSquare, Plus, RotateCw, SearchX, Users } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { AvisoWhatsapp } from './aviso-whatsapp';
import type { DependenciasDaMeta } from './tipos';

/**
 * A espera, os vazios e o erro das Conversas.
 *
 * Mesma regra da lista de Parceiros: "o filtro não achou nada" e "ainda não há nada"
 * são situações diferentes e pedem saídas diferentes; misturar as duas manda a pessoa
 * para o lugar errado. E o erro diz o que fazer, nunca o texto cru do Postgres.
 */

/** Espera da lista da esquerda, no formato final: barra térmica, nome, prévia, dias. */
export function EsqueletoLista() {
  const larguras = ['w-32', 'w-40', 'w-28', 'w-36', 'w-44', 'w-24', 'w-38', 'w-32'];

  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando as conversas.</span>
      <ul>
        {larguras.map((largura, i) => (
          <li
            key={i}
            className="relative flex min-h-[4.5rem] items-center gap-3 border-b border-hairline py-3 pr-3 pl-4"
          >
            <Skeleton className="absolute inset-y-3 left-0 w-[3px] rounded-none" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className={cn('h-4', largura)} />
              <Skeleton className="h-3 w-28" />
            </div>
            <Skeleton className="h-4 w-8 shrink-0" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Espera da coluna da direita: cabeçalho, separador de dia e três eventos. */
export function EsqueletoLinha() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-5 p-4 md:p-5">
      <span className="sr-only">Carregando a linha do tempo.</span>
      <div className="space-y-2">
        <Skeleton className="h-5 w-52" />
        <Skeleton className="h-3.5 w-72" />
      </div>
      <Skeleton className="h-14 w-full rounded-xl" />
      <Skeleton className="mx-auto h-3 w-24" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** O recorte não devolveu ninguém: a saída é afrouxá-lo. */
export function VazioPorFiltro({
  descricao,
  soBusca,
  aoLimpar,
}: {
  descricao: string;
  soBusca: boolean;
  aoLimpar: () => void;
}) {
  return (
    <Moldura
      icone={<SearchX className="size-5" aria-hidden="true" />}
      titulo={soBusca ? 'Nenhum parceiro com esse nome' : 'Nenhuma conversa com esses filtros'}
      texto={descricao}
    >
      <Button variant="outline" onClick={aoLimpar} className="toque h-11 md:h-9">
        <FilterX aria-hidden="true" />
        {soBusca ? 'Limpar a busca' : 'Limpar filtros'}
      </Button>
    </Moldura>
  );
}

/** A base não tem parceiro nenhum: nem conversa nem lista existem antes disso. */
export function VazioDeVerdade() {
  return (
    <Moldura
      icone={<Users className="size-5" aria-hidden="true" />}
      titulo="Nenhum parceiro na base"
      texto="A linha do tempo é por parceiro, então ela começa quando o primeiro entrar na base."
    >
      <Button asChild variant="outline" className="toque h-11 md:h-9">
        <Link href="/parceiros?novo=1">
          <Plus aria-hidden="true" />
          Cadastrar parceiro
        </Link>
      </Button>
    </Moldura>
  );
}

/** Falha de rede ou de permissão, em português e com uma saída. */
export function ErroDaTela({
  causa,
  aoTentar,
  className,
}: {
  causa: string;
  aoTentar: () => void;
  className?: string;
}) {
  return (
    <Moldura
      className={className}
      icone={<RotateCw className="size-5" aria-hidden="true" />}
      titulo="Não deu para carregar as conversas"
      texto={`${causa} Confira a conexão e tente de novo. Se continuar, avise no grupo do time.`}
    >
      <Button variant="outline" onClick={aoTentar} className="toque h-11 md:h-9">
        <RotateCw aria-hidden="true" />
        Tentar de novo
      </Button>
    </Moldura>
  );
}

/**
 * Nada escolhido ainda, só no desktop (no celular a lista OCUPA a tela inteira até
 * alguém abrir uma conversa, então este estado nunca aparece lá).
 *
 * É o lugar certo para o aviso inteiro do WhatsApp: é a primeira coisa que alguém vê
 * ao abrir o módulo, e é onde a pergunta "cadê minhas mensagens?" nasce.
 */
export function NenhumaEscolhida({ meta }: { meta: DependenciasDaMeta | null }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <MessagesSquare className="size-5" aria-hidden="true" />
      </span>
      <div className="space-y-1">
        <p className="font-heading font-medium">Escolha um parceiro à esquerda</p>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          A conversa mostra tudo que já aconteceu com ele, na mesma coluna e em ordem:
          mensagem recebida e enviada, ligação, visita, nota e mudança de etapa, com quem fez
          e o desfecho.
        </p>
      </div>
      <AvisoWhatsapp meta={meta} className="max-w-md text-left" />
    </div>
  );
}

function Moldura({
  icone,
  titulo,
  texto,
  children,
  className,
}: {
  icone: React.ReactNode;
  titulo: string;
  texto: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-6 py-12 text-center', className)}>
      <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        {icone}
      </span>
      <div className="space-y-1">
        <p className="font-heading font-medium">{titulo}</p>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">{texto}</p>
      </div>
      {children}
    </div>
  );
}
