'use client';

import {
  Copy,
  CornerUpRight,
  List,
  MapPin,
  Megaphone,
  MousePointerClick,
  UserRound,
} from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { formatarTelefone } from '@/components/parceiros/formatos';

import {
  linkDoMapa,
  type Anuncio,
  type CartaoDeContato,
  type Interativo,
  type Localizacao,
} from './conteudo';
import type { Citada, Reacoes } from './tipos';

/**
 * Os pedaços do balão que o WhatsApp completo trouxe (27/10/2026): a resposta
 * citada, o "encaminhada", o anúncio, a localização, o cartão de contato, os
 * botões, a opção escolhida e o selo das reações.
 *
 * Todos recebem `nossa` — a mensagem é do time — porque o balão nosso é verde
 * sólido e o deles é o cartão: o que é claro num é ilegível no outro.
 */

/** O véu de dentro do balão: um degrau acima do fundo dele, nos dois lados. */
function veu(nossa: boolean) {
  return nossa
    ? 'border-primary-foreground/25 bg-primary-foreground/10'
    : 'border-hairline bg-muted/50';
}

export async function copiar(texto: string, aviso = 'Copiado.'): Promise<void> {
  try {
    await navigator.clipboard.writeText(texto);
    toast.success(aviso);
  } catch {
    toast.error('O navegador não deixou copiar.');
  }
}

/**
 * A mensagem citada, em cima do texto. Um toque leva até ela — quando ela está
 * no CRM; a que não está (anterior à importação, de outro aparelho) só diz isso.
 */
export function Citacao({
  citada,
  nossa,
  nomeDoParceiro,
  aoIr,
}: {
  citada: Citada;
  nossa: boolean;
  nomeDoParceiro: string | null;
  aoIr?: (id: string) => void;
}) {
  const quem = citada.id
    ? citada.entrada
      ? nomeDoParceiro?.trim() || 'Contato'
      : (citada.autor ?? 'Time')
    : null;
  const conteudo = (
    <>
      {quem ? <span className="block text-xs font-semibold">{quem}</span> : null}
      <span className="line-clamp-2 text-[13px] leading-snug opacity-90">{citada.resumo}</span>
    </>
  );
  const classe = cn(
    'block w-full rounded-lg border-l-4 px-2.5 py-1.5 text-left',
    nossa
      ? 'border-l-primary-foreground/70 bg-primary-foreground/10'
      : 'border-l-primary bg-muted/60',
  );
  if (!citada.id || !aoIr) return <div className={classe}>{conteudo}</div>;
  const id = citada.id;
  return (
    <button
      type="button"
      onClick={() => aoIr(id)}
      className={cn(
        classe,
        'outline-none hover:opacity-90 focus-visible:ring-3 focus-visible:ring-ring/50',
      )}
      title="Ir até a mensagem citada"
    >
      {conteudo}
    </button>
  );
}

export function Encaminhada({ muito }: { muito: boolean }) {
  return (
    <p className="flex items-center gap-1 text-xs italic opacity-80">
      <CornerUpRight className="size-3.5" aria-hidden="true" />
      {muito ? 'Encaminhada muitas vezes' : 'Encaminhada'}
    </p>
  );
}

/** "Veio do anúncio": a pessoa tocou num anúncio da Meta para escrever. */
export function FaixaDoAnuncio({ anuncio, nossa }: { anuncio: Anuncio; nossa: boolean }) {
  return (
    <div
      className={cn('flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[13px]', veu(nossa))}
    >
      <Megaphone className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block font-medium">Veio do anúncio{anuncio.titulo ? ':' : ''}</span>
        {anuncio.titulo ? <span className="block">{anuncio.titulo}</span> : null}
        {anuncio.corpo ? (
          <span className="line-clamp-2 block text-xs opacity-80">{anuncio.corpo}</span>
        ) : null}
        {anuncio.url ? (
          <a
            href={anuncio.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs underline underline-offset-2"
          >
            Ver o anúncio
          </a>
        ) : null}
      </span>
    </div>
  );
}

export function CartaoDeLocalizacao({ local, nossa }: { local: Localizacao; nossa: boolean }) {
  const link = linkDoMapa(local.latitude, local.longitude);
  return (
    <div className={cn('min-w-56 space-y-1.5 rounded-xl border p-3', veu(nossa))}>
      <p className="flex items-start gap-2">
        <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0">
          <span className="block font-medium">{local.nome ?? 'Localização'}</span>
          {local.endereco ? (
            <span className="block text-[13px] opacity-85">{local.endereco}</span>
          ) : null}
          {!local.nome && !local.endereco ? (
            <span className="numerico block text-xs opacity-75">
              {local.latitude.toFixed(5)}, {local.longitude.toFixed(5)}
            </span>
          ) : null}
        </span>
      </p>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[13px]">
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium underline underline-offset-2"
        >
          Abrir no mapa
        </a>
        <button
          type="button"
          onClick={() => void copiar(link, 'Link do mapa copiado.')}
          className="underline-offset-2 opacity-80 hover:underline"
        >
          Copiar o link
        </button>
      </div>
    </div>
  );
}

export function CartaoDeContatos({
  contatos,
  nossa,
}: {
  contatos: readonly CartaoDeContato[];
  nossa: boolean;
}) {
  return (
    <ul className="min-w-56 space-y-2">
      {contatos.map((c, i) => (
        <li key={`${c.nome}-${i}`} className={cn('space-y-1 rounded-xl border p-3', veu(nossa))}>
          <p className="flex items-center gap-2 font-medium">
            <UserRound className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">{c.nome}</span>
          </p>
          {c.empresa ? <p className="text-xs opacity-80">{c.empresa}</p> : null}
          {c.telefones.map((t) => (
            <p key={t.numero} className="flex items-center gap-2 text-[13px]">
              <span className="numerico">{formatarTelefone(t.numero) || t.numero}</span>
              {t.tipo ? <span className="text-xs opacity-70">{t.tipo.toLowerCase()}</span> : null}
              <button
                type="button"
                onClick={() => void copiar(t.numero, 'Número copiado.')}
                className="ml-auto inline-flex items-center gap-1 rounded px-1 text-xs opacity-80 hover:opacity-100"
                title="Copiar o número"
              >
                <Copy className="size-3" aria-hidden="true" />
                Copiar
              </button>
            </p>
          ))}
          {c.emails.map((e) => (
            <p key={e} className="truncate text-xs opacity-80">
              {e}
            </p>
          ))}
        </li>
      ))}
    </ul>
  );
}

/**
 * A pergunta com botões, a lista e o pedido de localização, como saíram: os
 * botões aparecem como o contato os vê, mas apagados — quem toca é ele.
 */
export function OpcoesEnviadas({ interativo, nossa }: { interativo: Interativo; nossa: boolean }) {
  const chip = cn(
    'inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border px-3 py-1 text-[13px] font-medium',
    veu(nossa),
  );
  if (interativo.tipo === 'pedir_localizacao') {
    return (
      <p className={chip}>
        <MapPin className="size-3.5" aria-hidden="true" />
        Enviar localização
      </p>
    );
  }
  if (interativo.tipo === 'botoes') {
    return (
      <div className="flex flex-col gap-1">
        {interativo.botoes.map((b) => (
          <span key={b} className={chip}>
            {b}
          </span>
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <p className={chip}>
        <List className="size-3.5" aria-hidden="true" />
        {interativo.botao}
      </p>
      <ol className={cn('space-y-1 rounded-lg border px-3 py-2 text-[13px]', veu(nossa))}>
        {interativo.itens.map((item) => (
          <li key={item.titulo}>
            <span className="font-medium">{item.titulo}</span>
            {item.descricao ? (
              <span className="block text-xs opacity-75">{item.descricao}</span>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** O botão ou a opção da lista que o contato tocou. */
export function OpcaoEscolhida({
  titulo,
  descricao,
}: {
  titulo: string;
  descricao: string | null;
}) {
  return (
    <p className="flex items-start gap-2">
      <MousePointerClick className="mt-1 size-4 shrink-0 opacity-70" aria-hidden="true" />
      <span>
        <span className="text-xs opacity-75">Escolheu </span>
        <span className="font-medium">{titulo}</span>
        {descricao ? <span className="block text-xs opacity-75">{descricao}</span> : null}
      </span>
    </p>
  );
}

/**
 * As reações embaixo do balão, uma de cada lado. A nossa é botão: tocar tira
 * (com a janela aberta — é a mesma regra de reagir).
 */
export function SelosDeReacao({
  reacoes,
  entrada,
  aoTirarANossa,
}: {
  reacoes: Reacoes;
  entrada: boolean;
  aoTirarANossa?: () => void;
}) {
  if (!reacoes.nossa && !reacoes.deles) return null;
  const selo =
    'inline-flex h-7 items-center gap-1 rounded-full border border-hairline bg-popover px-2 text-sm shadow-sm';
  return (
    <div
      className={cn('-mt-2 flex gap-1 px-2', entrada ? 'justify-start' : 'justify-end')}
      aria-label="Reações"
    >
      {reacoes.deles ? (
        <span className={selo} title="Reação do contato">
          {reacoes.deles.emoji}
        </span>
      ) : null}
      {reacoes.nossa ? (
        aoTirarANossa ? (
          <button
            type="button"
            onClick={aoTirarANossa}
            className={cn(
              selo,
              'outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
            )}
            title={`Reação de ${reacoes.nossa.quem ?? 'alguém do time'}${reacoes.nossa.naFila ? ' (na fila)' : ''} · toque para tirar`}
          >
            <span className={cn(reacoes.nossa.naFila && 'opacity-60')}>{reacoes.nossa.emoji}</span>
          </button>
        ) : (
          <span className={selo} title={`Reação de ${reacoes.nossa.quem ?? 'alguém do time'}`}>
            {reacoes.nossa.emoji}
          </span>
        )
      ) : null}
    </div>
  );
}
