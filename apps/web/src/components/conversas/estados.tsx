'use client';

import Link from 'next/link';
import {
  CircleCheck,
  FilterX,
  Inbox,
  Lock,
  MessagesSquare,
  Plus,
  RotateCw,
  SearchX,
  Users,
} from 'lucide-react';
import type { EmpresaSlug } from '@komune/schema/empresas';

import { cn } from '@/lib/utils';
import { EMPRESA } from '@/lib/empresa';
import { MarcaTriade } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

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

/**
 * "Minhas" está vazia, sem filtro nenhum ligado: a pessoa não atende ninguém
 * agora. A tela abre em "Minhas" desde 02/10/2026, então esta é a primeira
 * coisa que vê quem ainda não assumiu conversa — e a saída é mostrar todas.
 */
export function SemConversasMinhas({ aoVerTodas }: { aoVerTodas: () => void }) {
  return (
    <Moldura
      icone={<Inbox className="size-5" aria-hidden="true" />}
      titulo="Nenhuma conversa com você agora"
      texto="Aqui ficam as conversas que você está atendendo. Quem escreveu e ainda não tem ninguém respondendo está em Todas."
    >
      <Button variant="outline" onClick={aoVerTodas} className="toque h-11 md:h-9">
        <MessagesSquare aria-hidden="true" />
        Ver todas
      </Button>
    </Moldura>
  );
}

/**
 * A gaveta de "Concluídas" vazia (03/11/2026, Imova). Não é filtro demais — é
 * ninguém ter concluído nada neste recorte —, e "Limpar filtros" ou "Nenhum
 * parceiro com esse nome" mandariam a pessoa procurar o problema no lugar errado.
 */
export function SemConcluidas({
  soMinhas,
  aoVoltar,
}: {
  /** Em "Minhas": a frase fala das conversas DELA. */
  soMinhas: boolean;
  aoVoltar: () => void;
}) {
  return (
    <Moldura
      icone={<CircleCheck className="size-5" aria-hidden="true" />}
      titulo={soMinhas ? 'Você não concluiu nenhuma conversa' : 'Nenhuma conversa concluída'}
      texto="Quando uma conversa é concluída, ela sai da lista e fica guardada aqui, com o histórico inteiro. Se a pessoa escrever de novo, ela volta sozinha."
    >
      <Button variant="outline" onClick={aoVoltar} className="toque h-11 md:h-9">
        <MessagesSquare aria-hidden="true" />
        Ver as conversas abertas
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
/**
 * A direita de Conversas quando nenhuma conversa está aberta (04/11/2026): a
 * tela de entrada do WhatsApp do computador, com a marca da empresa no lugar da
 * do WhatsApp. Pedido: "uma tela que não abre nenhuma conversa de alguém
 * direto [...] aparece primeiro o logo da Imova na parte da direita". No
 * celular ela não aparece: lá a lista ocupa a tela.
 *
 * O aviso do que falta no WhatsApp (`AvisoWhatsapp`) não vem para cá: ele já
 * aparece dentro de cada conversa, que é onde ele muda o que a pessoa faz.
 */
export function TelaDeEntrada({
  texto = 'Escolha uma conversa na lista ao lado.',
}: {
  texto?: string;
}) {
  return (
    <div className="flex h-full min-h-64 flex-col items-center bg-wpp-painel2 px-6 text-center">
      <div className="flex flex-1 flex-col items-center justify-center gap-5 py-10">
        <MarcaDaEmpresa />
        <p className="text-sm text-wpp-suave">{texto}</p>
      </div>
      <p className="flex items-center gap-1.5 pb-7 text-xs text-wpp-suave">
        <Lock className="size-3.5 shrink-0" aria-hidden="true" />
        Conversas do WhatsApp oficial da {EMPRESA.nomeDoNumero}
      </p>
    </div>
  );
}

/**
 * O logo de cada empresa, em `public/marca/`. A da Imova é o arquivo dela com o
 * fundo branco tirado, para servir no claro e no escuro. Empresa sem arquivo
 * mostra a marca do Tríade com o nome, no desenho da tela do WhatsApp.
 */
const LOGOS: Partial<Record<EmpresaSlug, { src: string; largura: number; altura: number }>> = {
  imova: { src: '/marca/imova.png', largura: 640, altura: 238 },
};

function MarcaDaEmpresa() {
  const logo = LOGOS[EMPRESA.slug];
  if (logo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- arquivo fixo, já no dobro do tamanho em que aparece: o CRM não usa o otimizador de imagens da Vercel.
      <img
        src={logo.src}
        alt={EMPRESA.nome}
        width={logo.largura}
        height={logo.altura}
        className="h-auto w-72 max-w-full lg:w-80"
      />
    );
  }
  return (
    <div className="flex flex-col items-center gap-4">
      <MarcaTriade className="size-20" />
      <p className="font-heading text-4xl font-semibold tracking-tight text-wpp-suave">Tríade</p>
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
