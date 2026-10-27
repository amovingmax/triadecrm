'use client';

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  Copy,
  CornerUpRight,
  Info,
  PenLine,
  Plus,
  Reply,
  Star,
  StarOff,
  Trash2,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

import { ErroDaConversa, favoritarMensagem, reagirAMensagem, restaurarMensagem } from './acoes';
import { linkDoMapa, resumoDaMensagem, textoSemMarcas } from './conteudo';
import { useFio, type Fio } from './contexto-do-fio';
import { CHAVE_FAVORITAS } from './dados';
import {
  DialogoApagar,
  DialogoCorrigir,
  DialogoInformacoes,
  DialogoMaisEmojis,
} from './dialogos-da-mensagem';
import { REACOES_RAPIDAS } from './emojis';
import { EncaminharMensagem } from './encaminhar-mensagem';
import { copiar } from './partes-do-balao';
import type { MensagemDoFio } from './tipos';

/**
 * O menu de cada mensagem (27/10/2026): responder, reagir, copiar, encaminhar,
 * estrela, corrigir, apagar e informações.
 *
 * DOIS JEITOS DE ABRIR, UMA LISTA SÓ. No computador, a setinha que aparece ao
 * passar o mouse no balão abre um menu ao lado dele. No celular não há mouse:
 * segurar o balão abre uma folha por baixo, com os emojis em cima — o gesto do
 * WhatsApp. As ações são as mesmas e saem da mesma função (`acoesDe`); só o
 * desenho muda.
 *
 * O que não se pode agora não some calado quando a razão importa: reagir fora
 * da janela de 24 h diz por que não dá.
 */

type Acao = {
  id: string;
  rotulo: string;
  icone: LucideIcon;
  perigo?: boolean;
  fazer: () => void;
};

type Dialogo = 'apagar' | 'corrigir' | 'encaminhar' | 'info' | 'emojis' | null;

const TIPOS_COM_ARQUIVO = new Set(['audio', 'image', 'video', 'document']);

/** O que dá para copiar da mensagem: o texto, o link do mapa ou os números do cartão. */
export function textoParaCopiar(m: MensagemDoFio): string | null {
  const texto = textoSemMarcas(m.texto);
  if (texto) return texto;
  if (m.conteudo.localizacao) {
    return linkDoMapa(m.conteudo.localizacao.latitude, m.conteudo.localizacao.longitude);
  }
  const numeros = m.conteudo.contatos.flatMap((c) =>
    c.telefones.map((t) => `${c.nome}: ${t.numero}`),
  );
  if (numeros.length) return numeros.join('\n');
  return m.transcricao;
}

/** Por que não dá para reagir agora, ou `null` quando dá. */
export function motivoParaNaoReagir(m: MensagemDoFio, fio: Fio): string | null {
  if (!fio.podeEscrever || m.fioId !== fio.fioId || fio.bloqueada) return '';
  if (m.apagadaEm || m.cancelada || m.tipo === 'system') return '';
  if (!m.waId) return 'Dá para reagir depois que a mensagem sair.';
  if (!fio.janelaAberta) return 'Fora da janela de 24 h não dá para reagir.';
  return null;
}

function podeEncaminhar(m: MensagemDoFio): boolean {
  if (m.apagadaEm || m.cancelada || m.tipo === 'reaction' || m.tipo === 'system') return false;
  if (TIPOS_COM_ARQUIVO.has(m.tipo)) return m.midiaCaminho !== null;
  if (m.tipo === 'location' || m.tipo === 'contacts') return true;
  return textoSemMarcas(m.texto) !== null;
}

function podeCorrigir(m: MensagemDoFio, fio: Fio): boolean {
  return (
    fio.podeEscrever &&
    !fio.bloqueada &&
    m.fioId === fio.fioId &&
    !m.entrada &&
    m.tipo === 'text' &&
    m.autorTipo === 'human' &&
    m.status !== 'failed' &&
    !m.apagadaEm &&
    // A correção é uma mensagem nova: precisa da janela, a não ser que a errada
    // ainda esteja na fila (aí ela é trocada, e a porteira confere a nova).
    (fio.janelaAberta || m.status === 'queued')
  );
}

export function AcoesDaMensagem({
  mensagem,
  folhaAberta,
  aoMudarFolha,
  className,
}: {
  mensagem: MensagemDoFio;
  /** A folha do celular, aberta por quem segurou o balão. */
  folhaAberta: boolean;
  aoMudarFolha: (aberta: boolean) => void;
  className?: string;
}) {
  const fio = useFio();
  const clientes = useQueryClient();
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  if (!fio) return null;

  const m = mensagem;
  const favorita = fio.favoritas.has(m.id);
  const naoReage = motivoParaNaoReagir(m, fio);
  const nossa = m.reacoes.nossa?.emoji ?? null;
  const copiavel = textoParaCopiar(m);
  const apagada = m.apagadaEm !== null || m.cancelada;

  async function reagir(emoji: string) {
    try {
      // Tocar no emoji que já é o nosso tira a reação, como no WhatsApp.
      await reagirAMensagem(m.id, emoji === nossa ? null : emoji);
      fio?.atualizar();
    } catch (erro) {
      toast.error('Não reagiu.', {
        description: erro instanceof ErroDaConversa ? erro.message : 'Tente de novo.',
      });
    }
  }

  async function estrela() {
    try {
      await favoritarMensagem(m.id, !favorita);
      void clientes.invalidateQueries({ queryKey: CHAVE_FAVORITAS });
      toast.success(favorita ? 'Saiu das favoritas.' : 'Nas favoritas desta conversa.');
    } catch (erro) {
      toast.error('Não mudou.', {
        description: erro instanceof ErroDaConversa ? erro.message : 'Tente de novo.',
      });
    }
  }

  async function restaurar() {
    try {
      await restaurarMensagem(m.id);
      fio?.atualizar();
    } catch (erro) {
      toast.error('Não voltou.', {
        description: erro instanceof ErroDaConversa ? erro.message : 'Tente de novo.',
      });
    }
  }

  const acoes: Acao[] = [];
  const mesma = m.fioId === fio.fioId;
  if (
    fio.podeEscrever &&
    mesma &&
    fio.janelaAberta &&
    !fio.bloqueada &&
    !apagada &&
    m.tipo !== 'system'
  ) {
    acoes.push({ id: 'responder', rotulo: 'Responder', icone: Reply, fazer: () => fio.citar(m) });
  }
  if (copiavel) {
    acoes.push({ id: 'copiar', rotulo: 'Copiar', icone: Copy, fazer: () => void copiar(copiavel) });
  }
  if (fio.podeEscrever && podeEncaminhar(m)) {
    acoes.push({
      id: 'encaminhar',
      rotulo: 'Encaminhar',
      icone: CornerUpRight,
      fazer: () => setDialogo('encaminhar'),
    });
  }
  acoes.push({
    id: 'estrela',
    rotulo: favorita ? 'Tirar a estrela' : 'Favoritar',
    icone: favorita ? StarOff : Star,
    fazer: () => void estrela(),
  });
  if (podeCorrigir(m, fio)) {
    acoes.push({
      id: 'corrigir',
      rotulo: 'Corrigir',
      icone: PenLine,
      fazer: () => setDialogo('corrigir'),
    });
  }
  acoes.push({ id: 'info', rotulo: 'Informações', icone: Info, fazer: () => setDialogo('info') });
  if (fio.podeEscrever && m.apagadaEm && !m.cancelada) {
    acoes.push({
      id: 'restaurar',
      rotulo: 'Desfazer o apagar',
      icone: Undo2,
      fazer: () => void restaurar(),
    });
  } else if (fio.podeEscrever && !apagada) {
    acoes.push({
      id: 'apagar',
      rotulo: !m.entrada && m.status === 'queued' ? 'Cancelar o envio' : 'Apagar',
      icone: Trash2,
      perigo: true,
      fazer: () => setDialogo('apagar'),
    });
  }

  const fechar = () => setDialogo(null);

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              'flex size-7 items-center justify-center rounded-full bg-popover/90 text-muted-foreground shadow-sm ring-1 ring-foreground/10 outline-none',
              'opacity-0 transition-opacity group-hover/balao:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100',
              'pointer-coarse:hidden',
              className,
            )}
            aria-label="Mais ações da mensagem"
          >
            <ChevronDown className="size-4" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={m.entrada ? 'start' : 'end'} className="w-56">
          {naoReage === null ? (
            <>
              <div className="flex items-center justify-between gap-0.5 px-0.5 py-0.5">
                {REACOES_RAPIDAS.map((emoji) => (
                  <DropdownMenuItem
                    key={emoji}
                    onSelect={() => void reagir(emoji)}
                    className={cn(
                      'size-8 justify-center p-0 text-lg',
                      nossa === emoji && 'bg-accent',
                    )}
                    aria-label={nossa === emoji ? `Tirar a reação ${emoji}` : `Reagir com ${emoji}`}
                  >
                    {emoji}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem
                  onSelect={() => setDialogo('emojis')}
                  className="size-8 justify-center p-0"
                  aria-label="Mais emojis"
                >
                  <Plus aria-hidden="true" />
                </DropdownMenuItem>
              </div>
              <DropdownMenuSeparator />
            </>
          ) : naoReage ? (
            <>
              <p className="px-1.5 py-1 text-xs text-muted-foreground">{naoReage}</p>
              <DropdownMenuSeparator />
            </>
          ) : null}
          {acoes.map((a) => (
            <DropdownMenuItem
              key={a.id}
              onSelect={a.fazer}
              variant={a.perigo ? 'destructive' : 'default'}
            >
              <a.icone aria-hidden="true" />
              {a.rotulo}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {folhaAberta ? (
        <Sheet open onOpenChange={aoMudarFolha}>
          <SheetContent
            side="bottom"
            className="gap-3 rounded-t-2xl px-3 pt-4 pb-[calc(var(--area-segura-inferior,0px)+1rem)]"
          >
            <SheetHeader className="p-0 pr-10 text-left">
              <SheetTitle className="sr-only">Ações da mensagem</SheetTitle>
              <SheetDescription className="line-clamp-2 px-1 text-[13px]">
                {resumoDaMensagem(m)}
              </SheetDescription>
            </SheetHeader>
            {naoReage === null ? (
              <div className="flex items-center justify-between gap-1 rounded-2xl bg-muted/60 p-1.5">
                {REACOES_RAPIDAS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => {
                      aoMudarFolha(false);
                      void reagir(emoji);
                    }}
                    className={cn(
                      'toque flex size-11 items-center justify-center rounded-full text-2xl',
                      nossa === emoji && 'bg-background shadow-sm',
                    )}
                    aria-label={nossa === emoji ? `Tirar a reação ${emoji}` : `Reagir com ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    aoMudarFolha(false);
                    setDialogo('emojis');
                  }}
                  className="toque flex size-11 items-center justify-center rounded-full bg-background"
                  aria-label="Mais emojis"
                >
                  <Plus className="size-5" aria-hidden="true" />
                </button>
              </div>
            ) : naoReage ? (
              <p className="px-1 text-xs text-muted-foreground">{naoReage}</p>
            ) : null}
            <ul className="flex flex-col">
              {acoes.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => {
                      aoMudarFolha(false);
                      a.fazer();
                    }}
                    className={cn(
                      'toque flex h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] hover:bg-muted',
                      a.perigo && 'text-destructive-texto',
                    )}
                  >
                    <a.icone className="size-5 shrink-0" aria-hidden="true" />
                    {a.rotulo}
                  </button>
                </li>
              ))}
            </ul>
          </SheetContent>
        </Sheet>
      ) : null}

      {/* Montados só quando abertos: são oito peças por balão, e um fio de
          trezentas mensagens não precisa de 2.400 diálogos fechados. */}
      {dialogo === 'apagar' ? (
        <DialogoApagar mensagem={m} aberto aoFechar={fechar} aoMudar={fio.atualizar} />
      ) : null}
      {dialogo === 'corrigir' ? (
        <DialogoCorrigir mensagem={m} aberto aoFechar={fechar} aoMudar={fio.atualizar} />
      ) : null}
      {dialogo === 'encaminhar' ? (
        <EncaminharMensagem mensagem={m} aberto aoFechar={fechar} aoMudar={fio.atualizar} />
      ) : null}
      {dialogo === 'info' ? (
        <DialogoInformacoes
          mensagem={m}
          nomeDoParceiro={fio.nomeDoParceiro}
          aberto
          aoFechar={fechar}
        />
      ) : null}
      {dialogo === 'emojis' ? (
        <DialogoMaisEmojis aberto aoFechar={fechar} aoEscolher={(e) => void reagir(e)} />
      ) : null}
    </>
  );
}

/** Quanto tempo segurar o balão para abrir a folha. O do WhatsApp, mais ou menos. */
const SEGURAR_MS = 450;
/** O dedo que anda mais que isto está rolando, não segurando. */
const FOLGA_DO_DEDO_PX = 10;

/**
 * Segurar o balão (só no toque): abre a folha das ações. O mouse tem a setinha;
 * a caneta e o dedo têm isto. O menu do sistema que o Android abre no mesmo
 * gesto é calado — senão as duas coisas abriam juntas.
 */
export function useToqueLongo(aoSegurar: () => void, ativo: boolean) {
  const relogio = useRef<number | null>(null);
  const inicio = useRef<{ x: number; y: number } | null>(null);
  const dedo = useRef(false);

  const cancelar = () => {
    if (relogio.current !== null) window.clearTimeout(relogio.current);
    relogio.current = null;
    inicio.current = null;
  };

  return {
    onPointerDown: (e: React.PointerEvent) => {
      dedo.current = e.pointerType !== 'mouse';
      if (!ativo || !dedo.current) return;
      inicio.current = { x: e.clientX, y: e.clientY };
      relogio.current = window.setTimeout(() => {
        relogio.current = null;
        inicio.current = null;
        navigator.vibrate?.(10);
        aoSegurar();
      }, SEGURAR_MS);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const de = inicio.current;
      if (!de) return;
      if (Math.hypot(e.clientX - de.x, e.clientY - de.y) > FOLGA_DO_DEDO_PX) cancelar();
    },
    onPointerUp: cancelar,
    onPointerCancel: cancelar,
    onContextMenu: (e: React.MouseEvent) => {
      if (ativo && dedo.current) e.preventDefault();
    },
  };
}
