'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  BellOff,
  ChevronDown,
  CircleCheck,
  MessageSquareDot,
  MessageSquareText,
  Pin,
  PinOff,
  RotateCcw,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { useAcoesDosAvisos } from '@/components/avisos/provedor-avisos';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import {
  ErroDaConversa,
  fixarConversa,
  marcarComoLida,
  marcarComoNaoLida,
  silenciarConversa,
} from './acoes';
import { useEu } from './assumir-conversa';
import { CONCLUIR_NA_EMPRESA, useConcluirConversa } from './concluir-conversa';
import { CHAVE_CONVERSAS, CHAVE_PREFERENCIAS } from './dados';
import { ateDoSilencio, SILENCIOS, type Silencio } from './preferencias';
import { BotaoRedondo } from './wpp';

/**
 * O MENU DE CADA LINHA DA LISTA (03/11/2026), como no WhatsApp: a setinha que
 * aparece ao passar o mouse e o clique direito, no computador; o toque longo, no
 * celular, que seleciona a linha e troca o alto da tela pelas ações. São as ações
 * de quem está olhando a lista e não quer abrir a conversa para isso: concluir,
 * fixar, silenciar e marcar como lida ou não lida.
 *
 * Nenhuma delas manda mensagem: concluir é o arquivar, fixar e silenciar são de
 * quem pediu (`conversa_preferencias`), e lida/não lida mexem só no contador do
 * CRM.
 */
export type EstadoDaLinha = {
  fioId: string;
  nome: string;
  fixada: boolean;
  silenciada: boolean;
  naoLidas: number;
  concluidaEm: string | null;
};

function frase(erro: unknown): string {
  return erro instanceof ErroDaConversa ? erro.message : 'Tente de novo em alguns segundos.';
}

export function useAcoesDaLinha(linha: EstadoDaLinha) {
  const clientes = useQueryClient();
  const { reconferir } = useAcoesDosAvisos();
  const eu = useEu();
  const concluir = useConcluirConversa(linha.fioId);
  const podeEscrever = Boolean(eu?.podeEscrever);

  return {
    podeEscrever,
    podeConcluir: podeEscrever && CONCLUIR_NA_EMPRESA,
    concluir: () => concluir.mutate(linha.concluidaEm === null),
    async fixar() {
      try {
        await fixarConversa(linha.fioId, !linha.fixada);
        void clientes.invalidateQueries({ queryKey: CHAVE_PREFERENCIAS });
        toast.success(linha.fixada ? 'Desafixada.' : 'Fixada no topo da sua lista.');
      } catch (erro) {
        toast.error(linha.fixada ? 'Não desafixou.' : 'Não fixou.', { description: frase(erro) });
      }
    },
    async silenciar(silencio: Silencio | null) {
      try {
        await silenciarConversa(linha.fioId, silencio ? ateDoSilencio(silencio) : null);
        void clientes.invalidateQueries({ queryKey: CHAVE_PREFERENCIAS });
        reconferir();
        toast.success(
          silencio === null
            ? 'Som de volta: ela conta no número do menu de novo.'
            : 'Silenciada: não avisa nem conta no número do menu.',
        );
      } catch (erro) {
        toast.error('Não mudou o som.', { description: frase(erro) });
      }
    },
    async lida() {
      try {
        if (linha.naoLidas > 0) await marcarComoLida(linha.fioId);
        else await marcarComoNaoLida(linha.fioId);
        void clientes.invalidateQueries({ queryKey: CHAVE_CONVERSAS });
        reconferir();
      } catch (erro) {
        toast.error('Não marcou.', { description: frase(erro) });
      }
    },
  };
}

/**
 * A setinha da linha e o menu dela. `aberto` e `aoMudar` deixam a linha abrir o
 * menu pelo clique direito, no mesmo lugar da setinha.
 */
export function MenuDaLinha({
  linha,
  aberto,
  aoMudar,
  className,
}: {
  linha: EstadoDaLinha;
  aberto: boolean;
  aoMudar: (aberto: boolean) => void;
  className?: string;
}) {
  const acoes = useAcoesDaLinha(linha);
  const concluida = linha.concluidaEm !== null;
  return (
    <DropdownMenu open={aberto} onOpenChange={aoMudar} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Opções da conversa com ${linha.nome}`}
          className={cn(
            'flex size-[30px] items-center justify-center rounded-full bg-inherit text-wpp-suave outline-none',
            'opacity-0 transition-opacity group-hover/linha:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100',
            'focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:hidden',
            className,
          )}
        >
          <ChevronDown className="size-[18px]" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-[15.5rem] rounded-2xl border-wpp-linha p-1.5 shadow-wpp-pop [&_[role=menuitem]]:min-h-10 [&_[role=menuitem]]:rounded-[10px] [&_[role=menuitem]]:px-3 [&_[role=menuitem]]:text-sm"
      >
        {acoes.podeConcluir ? (
          <DropdownMenuItem onSelect={acoes.concluir}>
            {concluida ? <RotateCcw aria-hidden="true" /> : <CircleCheck aria-hidden="true" />}
            {concluida ? 'Reabrir a conversa' : 'Concluir conversa'}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => void acoes.fixar()}>
          {linha.fixada ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
          {linha.fixada ? 'Desafixar' : 'Fixar no topo'}
        </DropdownMenuItem>
        {linha.silenciada ? (
          <DropdownMenuItem onSelect={() => void acoes.silenciar(null)}>
            <Bell aria-hidden="true" />
            Reativar o som
          </DropdownMenuItem>
        ) : (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="min-h-10 rounded-[10px] px-3 text-sm">
              <BellOff aria-hidden="true" />
              Silenciar
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {SILENCIOS.map((s) => (
                <DropdownMenuItem key={s.id} onSelect={() => void acoes.silenciar(s.id)}>
                  {s.rotulo}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        {acoes.podeEscrever ? (
          <DropdownMenuItem onSelect={() => void acoes.lida()}>
            {linha.naoLidas > 0 ? (
              <MessageSquareText aria-hidden="true" />
            ) : (
              <MessageSquareDot aria-hidden="true" />
            )}
            {linha.naoLidas > 0 ? 'Marcar como lida' : 'Marcar como não lida'}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * O alto da lista com uma linha selecionada pelo toque longo, no celular: o "X"
 * que desfaz a seleção e as ações da linha, como a barra do WhatsApp. Cobre o
 * cabeçalho do CRM enquanto existe.
 */
export function BarraDaSelecao({
  linha,
  aoCancelar,
}: {
  linha: EstadoDaLinha;
  aoCancelar: () => void;
}) {
  const acoes = useAcoesDaLinha(linha);
  const concluida = linha.concluidaEm !== null;
  const depois = (acao: () => unknown) => () => {
    aoCancelar();
    void acao();
  };
  return (
    <div
      role="toolbar"
      aria-label={`Ações para ${linha.nome}`}
      className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-0.5 border-b border-wpp-linha bg-wpp-painel px-1.5 pt-[env(safe-area-inset-top)] shadow-wpp-caixa"
    >
      <BotaoRedondo
        onClick={aoCancelar}
        aria-label="Desfazer a seleção"
        className="text-foreground"
      >
        <X aria-hidden="true" />
      </BotaoRedondo>
      <span className="numerico flex-1 text-lg font-semibold">1</span>
      {acoes.podeConcluir ? (
        <BotaoRedondo
          onClick={depois(acoes.concluir)}
          aria-label={concluida ? 'Reabrir a conversa' : 'Concluir conversa'}
          className="text-foreground"
        >
          {concluida ? <RotateCcw aria-hidden="true" /> : <CircleCheck aria-hidden="true" />}
        </BotaoRedondo>
      ) : null}
      <BotaoRedondo
        onClick={depois(acoes.fixar)}
        aria-label={linha.fixada ? 'Desafixar' : 'Fixar no topo'}
        className="text-foreground"
      >
        {linha.fixada ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
      </BotaoRedondo>
      {linha.silenciada ? (
        <BotaoRedondo
          onClick={depois(() => acoes.silenciar(null))}
          aria-label="Reativar o som"
          className="text-foreground"
        >
          <Bell aria-hidden="true" />
        </BotaoRedondo>
      ) : (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <BotaoRedondo aria-label="Silenciar" className="text-foreground">
              <BellOff aria-hidden="true" />
            </BotaoRedondo>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {SILENCIOS.map((s) => (
              <DropdownMenuItem
                key={s.id}
                className="h-11"
                onSelect={depois(() => acoes.silenciar(s.id))}
              >
                Silenciar por {s.rotulo.toLowerCase()}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {acoes.podeEscrever ? (
        <BotaoRedondo
          onClick={depois(acoes.lida)}
          aria-label={linha.naoLidas > 0 ? 'Marcar como lida' : 'Marcar como não lida'}
          className="text-foreground"
        >
          {linha.naoLidas > 0 ? (
            <MessageSquareText aria-hidden="true" />
          ) : (
            <MessageSquareDot aria-hidden="true" />
          )}
        </BotaoRedondo>
      ) : null}
    </div>
  );
}
