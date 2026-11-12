'use client';

import {
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Mic,
  Phone,
  Reply,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import type { Pedaco } from './formatos';
import type { Botao } from './tipos';

/**
 * Os pedaços de uma mensagem na tela. No balão, o que muda por pessoa vem
 * sublinhado; no cartão, o campo ainda sem pessoa vira etiqueta ("[Nome]").
 */
export function TextoEmPedacos({
  pedacos,
  onde,
}: {
  pedacos: readonly Pedaco[];
  onde: 'balao' | 'cartao';
}) {
  return (
    <>
      {pedacos.map((p, i) =>
        p.tipo === 'texto' ? (
          <span key={i}>{p.texto}</span>
        ) : p.tipo === 'valor' ? (
          <span
            key={i}
            className="underline decoration-menta-texto decoration-dotted decoration-2 underline-offset-4"
          >
            {p.texto}
          </span>
        ) : (
          <span
            key={i}
            className={cn(
              'rounded-md px-1 font-medium',
              onde === 'cartao'
                ? 'bg-muted text-xs text-foreground'
                : 'bg-black/[0.06] text-[13px] dark:bg-white/10',
            )}
          >
            {p.texto}
          </span>
        ),
      )}
    </>
  );
}

export type ContatoNoCelular = { nome: string; sub: string; inicial: string };

/**
 * O celular fixo ao lado da montagem: a conversa de WhatsApp de quem recebe,
 * com o texto que ela vai ler. Sem pessoa ainda, mostra o modelo com os campos
 * como etiqueta; com pessoa, o corpo que o banco montou para ela.
 *
 * O balão é o verde do WhatsApp (#D9FDD3 sobre o bege #EFEAE2, o papel de
 * parede de Conversas), e não o `--wpp-sai` do CRM: aqui o retrato é do
 * WhatsApp de verdade. Mensagem de modelo não ganha o "*Nome:*" em cima (o
 * gatilho `messages_nome_do_atendente` só assina texto livre), e por isso o
 * celular também não mostra assinatura nenhuma.
 */
export function Celular({
  frase,
  navegacao,
  contato,
  pedacos,
  apagado,
  botoes,
  hora,
  dia,
  horaDoRelogio,
  vazio,
  nota,
  legenda,
}: {
  frase: React.ReactNode;
  navegacao: {
    rotulo: string;
    aoVoltar: () => void;
    aoAvancar: () => void;
    desligada: boolean;
  } | null;
  contato: ContatoNoCelular | null;
  pedacos: readonly Pedaco[];
  /** Texto provisório (montando, ou quem não vai receber): esmaecido. */
  apagado: boolean;
  botoes: readonly Botao[];
  /** A hora do balão (a de envio). */
  hora: string;
  /** "Hoje", "Amanhã", "20/11". */
  dia: string;
  /** O relógio da barra de status do celular. */
  horaDoRelogio: string;
  /** O que o celular diz quando ainda não há mensagem. */
  vazio: string;
  nota: { texto: string; tom: 'erro' | 'neutro' } | null;
  legenda: string;
}) {
  return (
    <aside
      id="celular-do-disparo"
      aria-labelledby="titulo-celular"
      className="flex min-w-0 scroll-mt-20 flex-col items-center gap-3 lg:sticky lg:top-20"
    >
      <h2 id="titulo-celular" className="sr-only">
        Como a mensagem chega
      </h2>
      <p
        className="max-w-[340px] text-center text-[15px] leading-snug font-medium"
        aria-live="polite"
      >
        {frase}
      </p>
      {navegacao ? (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="toque size-11 md:size-8"
            aria-label="Pessoa anterior"
            disabled={navegacao.desligada}
            onClick={navegacao.aoVoltar}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <span className="numerico min-w-36 text-center text-sm font-medium">
            {navegacao.rotulo}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="toque size-11 md:size-8"
            aria-label="Próxima pessoa"
            disabled={navegacao.desligada}
            onClick={navegacao.aoAvancar}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      ) : null}

      <div
        role="group"
        aria-label="Prévia da conversa no WhatsApp"
        className="w-full max-w-[340px] rounded-[44px] bg-[#111110] p-2.5 shadow-[0_18px_40px_rgba(17,17,16,0.14)]"
      >
        <div className="papel-de-parede flex h-[460px] flex-col overflow-hidden rounded-[36px] lg:h-[540px]">
          {/* A barra de status: enfeite, fora da leitura. */}
          <div
            aria-hidden="true"
            className="flex h-7 shrink-0 items-center justify-between bg-wpp-painel2 px-5 text-xs font-semibold text-foreground"
          >
            <span className="numerico">{horaDoRelogio}</span>
            <span className="h-5 w-20 rounded-full bg-[#111110]" />
            <span className="flex h-[11px] w-[22px] rounded-[3px] border-[1.5px] border-current p-px">
              <span className="flex-1 rounded-[1px] bg-current" />
            </span>
          </div>

          <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-wpp-linha bg-wpp-painel2 px-3">
            <ChevronLeft className="size-5 shrink-0 text-foreground" aria-hidden="true" />
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-wpp-avatar text-sm font-semibold text-wpp-avatar-texto"
            >
              {contato?.inicial ?? '?'}
            </span>
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-[15px] font-semibold">
                {contato?.nome ?? 'Quem recebe'}
              </span>
              <span className="truncate text-xs text-wpp-suave">
                {contato?.sub ?? 'ninguém escolhido ainda'}
              </span>
            </span>
            <Phone className="size-5 shrink-0 text-wpp-suave" aria-hidden="true" />
          </div>

          <div className="flex min-h-0 flex-1 flex-col justify-end gap-1.5 overflow-y-auto p-3">
            <span className="mb-1 self-center rounded-lg bg-wpp-dia px-2.5 py-1 text-xs text-wpp-dia-texto shadow-wpp">
              {dia}
            </span>
            {pedacos.length === 0 ? (
              <p className="self-center rounded-lg bg-wpp-sis px-3 py-2 text-center text-xs text-wpp-sis-texto shadow-wpp">
                {vazio}
              </p>
            ) : (
              <div
                className={cn(
                  'flex max-w-[86%] flex-col gap-1 self-end transition-opacity',
                  apagado && 'opacity-55',
                )}
              >
                <div className="rounded-lg rounded-tr-none bg-[#D9FDD3] px-2.5 pt-1.5 pb-1 text-[15px] leading-[1.42] text-[#111B21] shadow-wpp dark:bg-[#005C4B] dark:text-[#E9EDEF]">
                  <p className="break-words whitespace-pre-wrap">
                    <TextoEmPedacos pedacos={pedacos} onde="balao" />
                  </p>
                  <span className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-wpp-meta-s">
                    <span className="numerico">{hora}</span>
                    <CheckCheck className="size-3.5" aria-hidden="true" />
                  </span>
                </div>
                {botoes.map((b) => (
                  <span
                    key={b.texto}
                    className="flex items-center justify-center gap-1.5 rounded-lg bg-wpp-entra px-2.5 py-2 text-center text-sm font-medium text-wpp-autor shadow-wpp"
                  >
                    {b.tipo === 'link' ? (
                      <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
                    ) : (
                      <Reply className="size-3.5 shrink-0" aria-hidden="true" />
                    )}
                    {b.texto}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div
            aria-hidden="true"
            className="flex h-12 shrink-0 items-center gap-2 bg-wpp-painel2 px-2.5"
          >
            <span className="flex h-9 flex-1 items-center rounded-full border border-wpp-linha bg-wpp-campo px-3.5 text-[13px] text-wpp-suave">
              Mensagem
            </span>
            <span className="flex size-9 items-center justify-center rounded-full bg-[#00A884] text-white">
              <Mic className="size-4" />
            </span>
          </div>
        </div>
      </div>

      {nota ? (
        <p
          className={cn(
            'max-w-[340px] text-center text-xs leading-relaxed font-medium',
            nota.tom === 'erro' ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {nota.texto}
        </p>
      ) : null}
      <p className="max-w-[340px] text-center text-xs leading-relaxed text-muted-foreground">
        {legenda}
      </p>
    </aside>
  );
}
