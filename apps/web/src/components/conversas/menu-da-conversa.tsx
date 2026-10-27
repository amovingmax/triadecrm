'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  BellOff,
  ChevronDown,
  ChevronUp,
  Ellipsis,
  MessageSquareDot,
  Pin,
  PinOff,
  Search,
  ShieldBan,
  ShieldCheck,
  Star,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { useAcoesDosAvisos } from '@/components/avisos/provedor-avisos';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

import {
  bloquearConversa,
  ErroDaConversa,
  fixarConversa,
  marcarComoNaoLida,
  silenciarConversa,
} from './acoes';
import { resumoDaMensagem } from './conteudo';
import { useFio } from './contexto-do-fio';
import { carregarPreferencias, CHAVE_CONVERSAS, CHAVE_PREFERENCIAS } from './dados';
import { dataHoraCompleta, hora, rotuloDoDia } from './formatos';
import { ateDoSilencio, ehSilenciada, SILENCIOS, type Silencio } from './preferencias';

/**
 * O "⋯" da conversa (27/10/2026): fixar, silenciar, marcar como não lida,
 * procurar, as favoritas e bloquear — o menu do WhatsApp, no CRM.
 *
 * Fixar e silenciar são de quem pediu (`conversa_preferencias`); "não lida" e
 * bloquear são da conversa, para o time todo. Duas variantes, como o resto do
 * cabeçalho: o menu do computador e a lista de botões da folha do celular.
 */
function frase(erro: unknown): string {
  return erro instanceof ErroDaConversa ? erro.message : 'Tente de novo em alguns segundos.';
}

/** As preferências desta pessoa, lidas uma vez para a lista e o cabeçalho. */
export function usePreferencias() {
  return useQuery({
    queryKey: CHAVE_PREFERENCIAS,
    queryFn: carregarPreferencias,
    staleTime: 60_000,
  });
}

export function MenuDaConversa({
  fioId,
  bloqueada,
  podeEscrever,
  atualizar,
  aoFecharConversa,
  variante = 'menu',
  aoEscolher,
}: {
  fioId: string;
  bloqueada: boolean;
  podeEscrever: boolean;
  /** As leituras desta conversa, além da lista (o bloqueio muda o fio). */
  atualizar: readonly (readonly unknown[])[];
  /** "Não lida" fecha a conversa: aberta, ela seria lida de novo na hora. */
  aoFecharConversa: () => void;
  variante?: 'menu' | 'folha';
  /** Na folha: fecha a folha antes de agir. */
  aoEscolher?: () => void;
}) {
  const fio = useFio();
  const clientes = useQueryClient();
  const { reconferir } = useAcoesDosAvisos();
  const preferencias = usePreferencias();
  const minha = preferencias.data?.get(fioId);
  const fixada = Boolean(minha?.fixadaEm);
  const silenciada = ehSilenciada(minha?.silenciadaAte);
  const [dialogo, setDialogo] = useState<'bloquear' | 'favoritas' | null>(null);

  const refazer = () => {
    void clientes.invalidateQueries({ queryKey: CHAVE_PREFERENCIAS });
  };

  async function fixar() {
    try {
      await fixarConversa(fioId, !fixada);
      refazer();
      toast.success(fixada ? 'Desafixada.' : 'Fixada no topo da sua lista.');
    } catch (erro) {
      toast.error(fixada ? 'Não desafixou.' : 'Não fixou.', { description: frase(erro) });
    }
  }

  async function silenciar(silencio: Silencio | null) {
    try {
      await silenciarConversa(fioId, silencio ? ateDoSilencio(silencio) : null);
      refazer();
      reconferir();
      toast.success(
        silencio === null
          ? 'Som de volta: ela conta no número do menu de novo.'
          : 'Silenciada: não avisa nem conta no número do menu.',
      );
    } catch (erro) {
      toast.error('Não mudou o som.', { description: frase(erro) });
    }
  }

  async function naoLida() {
    try {
      await marcarComoNaoLida(fioId);
      void clientes.invalidateQueries({ queryKey: CHAVE_CONVERSAS });
      aoFecharConversa();
      toast.success('Marcada como não lida.');
    } catch (erro) {
      toast.error('Não marcou.', { description: frase(erro) });
    }
  }

  const fazer = (acao: () => void) => () => {
    aoEscolher?.();
    acao();
  };

  const dialogos = (
    <>
      <DialogoBloquear
        fioId={fioId}
        bloqueada={bloqueada}
        aberto={dialogo === 'bloquear'}
        aoFechar={() => setDialogo(null)}
        atualizar={atualizar}
      />
      <FavoritasDaConversa aberto={dialogo === 'favoritas'} aoFechar={() => setDialogo(null)} />
    </>
  );

  if (variante === 'folha') {
    const botao =
      'toque flex h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] hover:bg-muted';
    return (
      <>
        <ul className="flex flex-col">
          <li>
            <button type="button" className={botao} onClick={fazer(() => void fixar())}>
              {fixada ? (
                <PinOff className="size-5" aria-hidden="true" />
              ) : (
                <Pin className="size-5" aria-hidden="true" />
              )}
              {fixada ? 'Desafixar' : 'Fixar no topo'}
            </button>
          </li>
          <li>
            {silenciada ? (
              <button type="button" className={botao} onClick={fazer(() => void silenciar(null))}>
                <Bell className="size-5" aria-hidden="true" />
                Reativar o som
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-[15px]">
                <BellOff className="size-5 shrink-0" aria-hidden="true" />
                <span className="mr-auto">Silenciar</span>
                {SILENCIOS.map((s) => (
                  <Button
                    key={s.id}
                    type="button"
                    variant="outline"
                    className="toque h-9 px-3"
                    onClick={fazer(() => void silenciar(s.id))}
                  >
                    {s.rotulo}
                  </Button>
                ))}
              </div>
            )}
          </li>
          {podeEscrever ? (
            <li>
              <button type="button" className={botao} onClick={fazer(() => void naoLida())}>
                <MessageSquareDot className="size-5" aria-hidden="true" />
                Marcar como não lida
              </button>
            </li>
          ) : null}
          {fio ? (
            <>
              <li>
                <button type="button" className={botao} onClick={fazer(() => fio.abrirBusca())}>
                  <Search className="size-5" aria-hidden="true" />
                  Buscar na conversa
                </button>
              </li>
              <li>
                <button type="button" className={botao} onClick={() => setDialogo('favoritas')}>
                  <Star className="size-5" aria-hidden="true" />
                  Favoritas
                </button>
              </li>
            </>
          ) : null}
          {podeEscrever ? (
            <li>
              <button
                type="button"
                className={cn(botao, !bloqueada && 'text-destructive-texto')}
                onClick={() => setDialogo('bloquear')}
              >
                {bloqueada ? (
                  <ShieldCheck className="size-5" aria-hidden="true" />
                ) : (
                  <ShieldBan className="size-5" aria-hidden="true" />
                )}
                {bloqueada ? 'Desbloquear' : 'Bloquear'}
              </button>
            </li>
          ) : null}
        </ul>
        {dialogos}
      </>
    );
  }

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="toque size-9" title="Mais da conversa">
            <Ellipsis aria-hidden="true" />
            <span className="sr-only">Mais: fixar, silenciar, buscar, bloquear</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={() => void fixar()}>
            {fixada ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
            {fixada ? 'Desafixar' : 'Fixar no topo'}
          </DropdownMenuItem>
          {silenciada ? (
            <DropdownMenuItem onSelect={() => void silenciar(null)}>
              <Bell aria-hidden="true" />
              Reativar o som
            </DropdownMenuItem>
          ) : (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <BellOff aria-hidden="true" />
                Silenciar
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {SILENCIOS.map((s) => (
                  <DropdownMenuItem key={s.id} onSelect={() => void silenciar(s.id)}>
                    {s.rotulo}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          {podeEscrever ? (
            <DropdownMenuItem onSelect={() => void naoLida()}>
              <MessageSquareDot aria-hidden="true" />
              Marcar como não lida
            </DropdownMenuItem>
          ) : null}
          {fio ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => fio.abrirBusca()}>
                <Search aria-hidden="true" />
                Buscar na conversa
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDialogo('favoritas')}>
                <Star aria-hidden="true" />
                Favoritas
              </DropdownMenuItem>
            </>
          ) : null}
          {podeEscrever ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant={bloqueada ? 'default' : 'destructive'}
                onSelect={() => setDialogo('bloquear')}
              >
                {bloqueada ? <ShieldCheck aria-hidden="true" /> : <ShieldBan aria-hidden="true" />}
                {bloqueada ? 'Desbloquear' : 'Bloquear'}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {dialogos}
    </>
  );
}

/** Bloquear e desbloquear, dizendo o que acontece de cada lado. */
function DialogoBloquear({
  fioId,
  bloqueada,
  aberto,
  aoFechar,
  atualizar,
}: {
  fioId: string;
  bloqueada: boolean;
  aberto: boolean;
  aoFechar: () => void;
  atualizar: readonly (readonly unknown[])[];
}) {
  const clientes = useQueryClient();
  const [indo, setIndo] = useState(false);

  async function confirmar() {
    setIndo(true);
    try {
      await bloquearConversa(fioId, !bloqueada);
      void clientes.invalidateQueries({ queryKey: CHAVE_CONVERSAS });
      for (const chave of atualizar) void clientes.invalidateQueries({ queryKey: chave });
      aoFechar();
      toast.success(bloqueada ? 'Desbloqueado.' : 'Bloqueado: nada mais sai para este número.');
    } catch (erro) {
      toast.error(bloqueada ? 'Não desbloqueou.' : 'Não bloqueou.', { description: frase(erro) });
    } finally {
      setIndo(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && !indo && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{bloqueada ? 'Desbloquear o contato' : 'Bloquear o contato'}</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 text-left leading-relaxed">
              {bloqueada ? (
                <p>O CRM volta a mandar mensagem para este número, e o pedido vai ao WhatsApp.</p>
              ) : (
                <>
                  <p>
                    Nada mais sai para este número, e o que estava na fila é cancelado. Ele continua
                    podendo escrever, e a conversa fica aqui.
                  </p>
                  <p>
                    O pedido vai ao WhatsApp também, mas a Meta só bloqueia quem escreveu nas
                    últimas 24 h. Não é o mesmo que &ldquo;não contatar&rdquo;: isso é outra coisa.
                  </p>
                </>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={aoFechar}
            disabled={indo}
            className="toque h-11 md:h-9"
          >
            Voltar
          </Button>
          <Button
            type="button"
            variant={bloqueada ? 'default' : 'destructive'}
            onClick={() => void confirmar()}
            disabled={indo}
            className="toque h-11 md:h-9"
          >
            {bloqueada ? <ShieldCheck aria-hidden="true" /> : <ShieldBan aria-hidden="true" />}
            {indo ? 'Um instante...' : bloqueada ? 'Desbloquear' : 'Bloquear'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * No lugar da caixa de escrever, quando o contato está bloqueado: o que vale e
 * o que a Meta respondeu ao pedido, com o "Desbloquear" à mão.
 */
export function AvisoDeBloqueio({
  fioId,
  quem,
  naMeta,
  erro,
  atualizar,
  className,
}: {
  fioId: string;
  quem: string | null;
  naMeta: 'pedido' | 'feito' | 'falhou' | null;
  erro: string | null;
  atualizar: readonly (readonly unknown[])[];
  className?: string;
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <div className={cn('space-y-2 rounded-xl border border-dashed border-hairline p-3', className)}>
      <p className="flex items-center gap-2 text-sm font-medium">
        <ShieldBan className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        Contato bloqueado{quem ? ` por ${quem}` : ''}: nada sai para este número.
      </p>
      {naMeta === 'pedido' ? (
        <p className="text-xs text-muted-foreground">Bloqueando no WhatsApp…</p>
      ) : naMeta === 'falhou' ? (
        <p className="text-xs text-muted-foreground">
          No WhatsApp a Meta não bloqueou{erro ? `: ${erro}` : '.'} No CRM continua bloqueado.
        </p>
      ) : null}
      <Button
        type="button"
        variant="outline"
        onClick={() => setAberto(true)}
        className="toque h-11 md:h-9"
      >
        <ShieldCheck aria-hidden="true" />
        Desbloquear
      </Button>
      <DialogoBloquear
        fioId={fioId}
        bloqueada
        aberto={aberto}
        aoFechar={() => setAberto(false)}
        atualizar={atualizar}
      />
    </div>
  );
}

/** A lupa da conversa, embaixo do cabeçalho, enquanto estiver aberta. */
export function BarraDeBuscaNoFio({ className }: { className?: string }) {
  const fio = useFio();
  const campo = useRef<HTMLInputElement>(null);
  const aberta = fio?.busca.aberta ?? false;
  useEffect(() => {
    if (aberta) campo.current?.focus();
  }, [aberta]);
  if (!fio || !aberta) return null;
  const { achados, atual, termo } = fio.busca;
  const posicao = atual ? achados.indexOf(atual) + 1 : 0;

  return (
    <div
      role="search"
      className={cn('flex items-center gap-1 border-b border-hairline px-3 py-1.5', className)}
    >
      <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <input
        ref={campo}
        value={termo}
        onChange={(e) => fio.procurar(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') fio.fecharBusca();
          if (e.key === 'Enter') {
            e.preventDefault();
            fio.andarNaBusca(e.shiftKey ? 1 : -1);
          }
        }}
        type="search"
        placeholder="Buscar na conversa"
        aria-label="Buscar na conversa"
        className="h-10 min-w-0 flex-1 bg-transparent px-1 text-base outline-none md:h-8 md:text-sm"
      />
      {termo.trim().length >= 2 ? (
        <span className="numerico shrink-0 px-1 text-xs text-muted-foreground">
          {achados.length === 0 ? 'nada' : `${posicao} de ${achados.length}`}
        </span>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="toque size-9 shrink-0"
        disabled={achados.length === 0}
        onClick={() => fio.andarNaBusca(-1)}
        aria-label="Achado anterior (mais antigo)"
      >
        <ChevronUp aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="toque size-9 shrink-0"
        disabled={achados.length === 0}
        onClick={() => fio.andarNaBusca(1)}
        aria-label="Próximo achado (mais recente)"
      >
        <ChevronDown aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="toque size-9 shrink-0"
        onClick={fio.fecharBusca}
        aria-label="Fechar a busca"
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  );
}

/** As mensagens com estrela desta conversa; um toque leva até a mensagem. */
function FavoritasDaConversa({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  const fio = useFio();
  const lista = fio ? fio.mensagens.filter((m) => fio.favoritas.has(m.id)) : [];
  return (
    <Sheet open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <SheetContent side="right" className="w-full gap-3 overflow-y-auto sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>Favoritas</SheetTitle>
          <SheetDescription>
            As mensagens que você marcou com estrela nesta conversa.
          </SheetDescription>
        </SheetHeader>
        {lista.length === 0 ? (
          <p className="px-4 text-sm text-muted-foreground">
            Nenhuma ainda. No menu de qualquer mensagem, toque em Favoritar.
          </p>
        ) : (
          <ul className="flex flex-col px-2">
            {lista.map((m) => {
              const dia = rotuloDoDia(m.em);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => {
                      aoFechar();
                      window.setTimeout(() => fio?.irPara(m.id), 200);
                    }}
                    className="flex w-full flex-col gap-0.5 rounded-xl px-3 py-2.5 text-left hover:bg-muted"
                  >
                    <span className="text-xs text-muted-foreground" title={dataHoraCompleta(m.em)}>
                      {m.entrada ? (fio?.nomeDoParceiro ?? 'Contato') : (m.autor ?? 'Time')} ·{' '}
                      <span className="numerico">
                        {dia.palavra}
                        {dia.numero ?? ''} {hora(m.em)}
                      </span>
                    </span>
                    <span className="line-clamp-3 text-sm">{resumoDaMensagem(m)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}
