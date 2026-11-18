import Link from 'next/link';
import { ArrowRight, CircleCheck, Clock, Flame, Hand, Phone, Sparkles } from 'lucide-react';

import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';

import type { IaDoPainel, ImovelEmAlta, Pendencia, PeriodoDoPainel } from './dados';
import { codigoCurto, fraseDaIa, haQuanto, horaDe, textoDoEvento } from './formatos';
import { Bloco, FotoDoImovel, LinkDoBloco } from './pecas';

// ---------------------------------------------------------------------------
// A IA
// ---------------------------------------------------------------------------

/**
 * O que a IA fez no período (17/11/2026): a frase, os três números e as últimas
 * ações (passou para a equipe, marcou visita, retomou), cada uma com o link da
 * conversa. É o único cartão escuro da tela, de propósito: é a parte "viva".
 */
export function CartaoDaIa({
  ia,
  periodo,
  agora,
}: {
  ia: IaDoPainel;
  periodo: PeriodoDoPainel;
  agora: number;
}) {
  return (
    <section
      aria-labelledby="painel-ia"
      className="overflow-hidden rounded-xl bg-[linear-gradient(160deg,#17504b_0%,#0e2826_100%)] text-[#e6f1ef] shadow-[0_1px_2px_rgb(14_40_38/0.15)]"
    >
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-2 sm:px-5">
        <h2
          id="painel-ia"
          className="flex items-center gap-2 font-heading text-[17px] font-semibold text-white"
        >
          <Sparkles className="size-4.5" aria-hidden="true" />A IA{' '}
          {periodo === 'hoje' ? 'hoje' : periodo === 'semana' ? 'em 7 dias' : 'no mês'}
        </h2>
        {ia.atendendo > 0 ? (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-[#9fd8cf]">
            <span
              className="size-2 rounded-full bg-[#5fd3a2] shadow-[0_0_0_3px_rgb(95_211_162/0.22)]"
              aria-hidden="true"
            />
            atendendo agora
          </span>
        ) : null}
      </div>
      <p className="px-4 text-[14.5px] leading-relaxed text-[#cfe3df] sm:px-5">
        {fraseDaIa(ia, periodo)}
      </p>
      <dl className="mx-4 mt-4 grid grid-cols-3 rounded-[14px] border border-white/10 sm:mx-5">
        {(
          [
            ['conversas', ia.conversas],
            ['visitas', ia.visitas],
            ['pra equipe', ia.passadas],
          ] as const
        ).map(([rotulo, valor], i) => (
          <div key={rotulo} className={cn('px-3.5 py-3', i > 0 && 'border-l border-white/10')}>
            <dd className="numerico font-heading text-2xl leading-none font-semibold text-white">
              {valor}
            </dd>
            <dt className="mt-1 text-xs text-[#9fbdb8]">{rotulo}</dt>
          </div>
        ))}
      </dl>
      {ia.eventos.length > 0 ? (
        <ul className="mt-3 px-4 sm:px-5">
          {ia.eventos.map((e) => (
            <li
              key={`${e.acao}-${e.quando}`}
              className="flex gap-3 border-t border-white/8 py-2.5 text-[13.5px] text-[#d7e7e4]"
            >
              <time
                dateTime={e.quando}
                className="numerico w-10 shrink-0 pt-px text-[12.5px] text-[#8fb1ab]"
              >
                {horaDe(e.quando)}
              </time>
              {e.caminho ? (
                <Link href={e.caminho} className="min-w-0 hover:text-white hover:underline">
                  {textoDoEvento(e, agora)}
                </Link>
              ) : (
                <span className="min-w-0">{textoDoEvento(e, agora)}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="px-4 pt-2 pb-4 sm:px-5">
        <Link
          href="/conversas?ver=todas"
          className="toque inline-flex min-h-11 items-center gap-1 text-[13px] font-semibold text-[#ffd2a8] hover:underline sm:min-h-8"
        >
          Ver as conversas
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Precisa de você
// ---------------------------------------------------------------------------

const MARCA_DA_PENDENCIA: Record<
  Pendencia['tipo'],
  { icone: typeof Hand; classe: string; rotulo: (p: Pendencia, agora: number) => string }
> = {
  ia: {
    icone: Hand,
    classe: 'bg-primary/12 text-primary',
    rotulo: (p, agora) =>
      `A IA passou para você${p.quando ? ` · ${haQuanto(p.quando, agora)}` : ''}`,
  },
  venceu: {
    icone: Clock,
    classe: 'bg-quente-fundo text-quente-texto',
    rotulo: (p, agora) =>
      `Venceu${p.quando ? ` · ${haQuanto(p.quando, agora).replace(/^há /, 'há ')}` : ''}`,
  },
  hoje: {
    icone: Phone,
    classe: 'bg-menta-fundo text-menta-texto',
    rotulo: (p) => `Hoje${p.quando ? ` às ${horaDe(p.quando)}` : ''}`,
  },
};

const ROTULO_DA_ACAO: Record<Pendencia['acao'], string> = {
  responder: 'Responder',
  abrir: 'Abrir',
  ligar: 'Ligar',
};

/**
 * Precisa de você (17/11/2026): no máximo 5 itens (a IA passou e ninguém
 * respondeu; tarefa vencida; tarefa de hoje), cada um com o porquê e um botão.
 * O resto continua na lista completa ("Ver todas").
 */
export function PrecisaDeVoce({
  total,
  itens,
  agora,
}: {
  total: number;
  itens: readonly Pendencia[];
  agora: number;
}) {
  const resto = Math.max(0, total - itens.length);
  return (
    <Bloco rotulo="painel-precisa" titulo="Precisa de você" contagem={total}>
      {itens.length === 0 ? (
        <div className="flex items-center gap-3 px-4 pb-5 sm:px-5">
          <span className="flex size-10 items-center justify-center rounded-xl bg-cliente-fundo text-cliente-texto">
            <CircleCheck className="size-5" aria-hidden="true" />
          </span>
          <p className="text-sm text-muted-foreground">
            Tudo em dia: nada esperando por você agora.
          </p>
        </div>
      ) : (
        <ul className="px-2 pb-1 sm:px-3">
          {itens.map((p, i) => {
            const marca = MARCA_DA_PENDENCIA[p.tipo];
            const Icone = p.acao === 'ligar' ? Phone : marca.icone;
            return (
              <li
                key={`${p.tipo}-${p.titulo}-${i}`}
                className="flex items-center gap-3 border-t border-border/60 px-2 py-2.5 first:border-t-0"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-9 shrink-0 items-center justify-center rounded-[10px]',
                    marca.classe,
                  )}
                >
                  <Icone className="size-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{p.titulo}</p>
                  <p className="truncate text-[12.5px] text-muted-foreground">
                    {p.tipo === 'ia' && p.detalhe ? p.detalhe : marca.rotulo(p, agora)}
                    {p.tipo !== 'ia' && p.detalhe ? ` · ${p.detalhe}` : ''}
                  </p>
                </div>
                {p.caminho ? (
                  <Link
                    href={p.caminho}
                    className={cn(
                      buttonVariants({ variant: p.acao === 'responder' ? 'default' : 'outline' }),
                      'shrink-0',
                    )}
                  >
                    {p.acao === 'ligar' ? <Phone className="size-4" aria-hidden="true" /> : null}
                    {ROTULO_DA_ACAO[p.acao]}
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-2 text-[13px] text-muted-foreground sm:px-5">
        <span>
          {resto > 0 ? (
            <>
              Mais <span className="numerico">{resto}</span> {resto === 1 ? 'item' : 'itens'} na
              lista completa
            </>
          ) : (
            'A lista completa tem também os próximos dias'
          )}
        </span>
        <LinkDoBloco href="/meu-dia?aba=fazer">Ver todas</LinkDoBloco>
      </div>
    </Bloco>
  );
}

// ---------------------------------------------------------------------------
// Imóveis em alta
// ---------------------------------------------------------------------------

/** Os 3 imóveis com mais interessados nos últimos 7 dias, com a foto. */
export function ImoveisEmAlta({ imoveis }: { imoveis: readonly ImovelEmAlta[] }) {
  if (imoveis.length === 0) return null;
  return (
    <Bloco
      rotulo="painel-imoveis"
      titulo="Imóveis em alta"
      acao={<span className="text-[12.5px] text-muted-foreground">últimos 7 dias</span>}
    >
      <ul className="grid grid-cols-3 gap-2.5 px-3 pb-4 sm:gap-3 sm:px-4">
        {imoveis.map((im) => {
          const conteudo = (
            <>
              <span className="relative block">
                <FotoDoImovel caminho={im.foto} className="h-20 w-full rounded-none sm:h-24" />
                <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-[rgb(14_40_38/0.78)] px-2 py-0.5 text-[11.5px] font-semibold text-white">
                  <Flame className="size-3.5" aria-hidden="true" />
                  <span className="numerico">{im.interessados}</span>
                  <span className="sr-only"> interessados</span>
                </span>
              </span>
              <span className="block px-2.5 pt-2 pb-2.5">
                <span className="block truncate text-[13.5px] font-semibold">
                  {codigoCurto(im.codigo)}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {im.bairro ?? 'Natal'}
                </span>
              </span>
            </>
          );
          return (
            <li
              key={im.codigo}
              className="min-w-0 overflow-hidden rounded-[14px] border border-border/60 bg-card"
            >
              {im.anuncioId ? (
                <Link href={`/anuncios/${im.anuncioId}`} className="block hover:bg-muted/40">
                  {conteudo}
                </Link>
              ) : (
                conteudo
              )}
            </li>
          );
        })}
      </ul>
    </Bloco>
  );
}
