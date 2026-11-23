'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Handshake, UserRound } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EscolherImovel } from '@/components/agenda/escolher-imovel';
import { ESCOLHA_VAZIA, type EscolhaDoImovel } from '@/components/agenda/imovel-da-visita';
import { CHAVE_DA_IA } from '@/components/ia-que-atende/dados';
import { CHAVE_CONSULTORIA } from '@/components/parceiros/consultoria';

import { CHAVE_CONVERSAS } from './dados';
import {
  CLIENTES_E_PARCEIROS,
  descricaoDoParceiro,
  recadoDoPerfil,
  rotuloDaParceria,
  TIPOS_DE_PARCERIA,
  type RecorteDosParceiros,
} from './perfil-regra';
import type { PerfilDoParceiro, TipoDeParceria } from './tipos';
import { ChipDeAba } from './wpp';

/**
 * CLIENTES E PARCEIROS NA TELA (Imova, 23/11/2026). As regras estão em
 * `perfil-regra.ts`; no banco, `public.parceiro_mudar`.
 *
 * Onde se muda o perfil: na faixa logo abaixo do cabeçalho da conversa ("Mudar
 * para Parceiro" / "Voltar para Clientes") e na setinha de cada linha da lista.
 * Virar Parceiro abre um diálogo curto (o tipo da parceria e, se quiser, o
 * imóvel); voltar para Clientes é um clique, com "Desfazer" no aviso.
 */

/** A ficha cujo perfil vai mudar, e o que a tela já sabe dela. */
export type AlvoDoPerfil = {
  organizacaoId: string;
  nome: string;
  /** O perfil de hoje: `null` = Cliente. */
  parceiro: PerfilDoParceiro | null;
  /** O tipo que o diálogo traz marcado (`sugestaoDeTipo`). */
  sugestao?: TipoDeParceria | null;
};

type AcoesDoPerfil = {
  /** Abre o diálogo de virar Parceiro (ou de corrigir a parceria). */
  pedirParceiro: (alvo: AlvoDoPerfil) => void;
  /** Volta para Clientes na hora, com "Desfazer" no aviso. */
  voltarParaClientes: (alvo: AlvoDoPerfil) => void;
};

const Contexto = createContext<AcoesDoPerfil | null>(null);

/** `null` fora da tela de Conversas, ou onde o módulo está desligado. */
export function usePerfilDaConversa(): AcoesDoPerfil | null {
  return useContext(Contexto);
}

type Pedido = { parceiro: boolean; tipo: TipoDeParceria | null; anuncioId: string | null };

async function mudarPerfil(organizacaoId: string, pedido: Pedido): Promise<void> {
  const { data, error } = await createClient().rpc('parceiro_mudar', {
    p_organization_id: organizacaoId,
    p_parceiro: pedido.parceiro,
    p_tipo: pedido.tipo ?? undefined,
    p_anuncio_id: pedido.anuncioId ?? undefined,
  });
  if (error) throw new Error(recadoDoPerfil(error.code === '42501' ? 'sem_permissao' : 'falhou'));
  const r = (data ?? {}) as { ok?: boolean; motivo?: string };
  if (r.ok !== true) throw new Error(recadoDoPerfil(r.motivo ?? 'falhou'));
}

export function ProvedorDoPerfil({ children }: { children: React.ReactNode }) {
  const clientes = useQueryClient();
  const [aberto, setAberto] = useState<AlvoDoPerfil | null>(null);

  const atualizar = useCallback(() => {
    void clientes.invalidateQueries({ queryKey: CHAVE_CONVERSAS });
    void clientes.invalidateQueries({ queryKey: CHAVE_CONSULTORIA });
    void clientes.invalidateQueries({ queryKey: CHAVE_DA_IA });
  }, [clientes]);

  const mudar = useMutation({
    mutationFn: ({ alvo, pedido }: { alvo: AlvoDoPerfil; pedido: Pedido; desfazendo?: boolean }) =>
      mudarPerfil(alvo.organizacaoId, pedido),
    onSuccess: (_, { alvo, pedido, desfazendo }) => {
      atualizar();
      setAberto(null);
      if (desfazendo) {
        toast.success('Desfeito.');
        return;
      }
      // O "Desfazer" devolve o perfil de antes, com o tipo e o imóvel de antes.
      const antes: Pedido = alvo.parceiro
        ? { parceiro: true, tipo: alvo.parceiro.tipo, anuncioId: alvo.parceiro.anuncioId }
        : { parceiro: false, tipo: null, anuncioId: null };
      const desfazer = () => mudar.mutate({ alvo, pedido: antes, desfazendo: true });
      if (!pedido.parceiro) {
        toast.success(`${alvo.nome} voltou para Clientes.`, {
          description: 'A IA que atende volta a responder, como em qualquer cliente.',
          action: { label: 'Desfazer', onClick: desfazer },
          duration: 8_000,
        });
      } else if (alvo.parceiro) {
        toast.success('Parceria corrigida.', {
          action: { label: 'Desfazer', onClick: desfazer },
          duration: 8_000,
        });
      } else {
        toast.success(`${alvo.nome} agora está em Parceiros.`, {
          description: 'A IA que atende não responde Parceiros: quem responde é a equipe.',
          action: { label: 'Desfazer', onClick: desfazer },
          duration: 8_000,
        });
      }
    },
    onError: (erro, { pedido }) =>
      toast.error(pedido.parceiro ? 'Não mudou para Parceiro.' : 'Não voltou para Clientes.', {
        description: erro instanceof Error ? erro.message : undefined,
      }),
  });

  const acoes = useMemo<AcoesDoPerfil>(
    () => ({
      pedirParceiro: (alvo) => setAberto(alvo),
      voltarParaClientes: (alvo) =>
        mudar.mutate({ alvo, pedido: { parceiro: false, tipo: null, anuncioId: null } }),
    }),
    // `mudar.mutate` é estável no TanStack Query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  if (!CLIENTES_E_PARCEIROS) return <>{children}</>;
  return (
    <Contexto.Provider value={acoes}>
      {children}
      <DialogoDoParceiro
        alvo={aberto}
        enviando={mudar.isPending}
        aoFechar={() => !mudar.isPending && setAberto(null)}
        aoConfirmar={(pedido) => aberto && mudar.mutate({ alvo: aberto, pedido })}
      />
    </Contexto.Provider>
  );
}

/** O diálogo de virar Parceiro: o tipo (obrigatório) e o imóvel (opcional). */
function DialogoDoParceiro({
  alvo,
  enviando,
  aoFechar,
  aoConfirmar,
}: {
  alvo: AlvoDoPerfil | null;
  enviando: boolean;
  aoFechar: () => void;
  aoConfirmar: (pedido: Pedido) => void;
}) {
  return (
    <Dialog open={alvo !== null} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-md">
        {alvo ? (
          <FormularioDoParceiro
            key={alvo.organizacaoId}
            alvo={alvo}
            enviando={enviando}
            aoFechar={aoFechar}
            aoConfirmar={aoConfirmar}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function FormularioDoParceiro({
  alvo,
  enviando,
  aoFechar,
  aoConfirmar,
}: {
  alvo: AlvoDoPerfil;
  enviando: boolean;
  aoFechar: () => void;
  aoConfirmar: (pedido: Pedido) => void;
}) {
  const corrigindo = alvo.parceiro !== null;
  const [tipo, setTipo] = useState<TipoDeParceria | null>(
    alvo.parceiro?.tipo ?? alvo.sugestao ?? null,
  );
  const [imovel, setImovel] = useState<EscolhaDoImovel>(
    alvo.parceiro?.anuncioId
      ? { modo: 'anuncio', anuncioId: alvo.parceiro.anuncioId }
      : ESCOLHA_VAZIA,
  );

  return (
    <form
      className="flex min-w-0 flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!tipo) return;
        aoConfirmar({
          parceiro: true,
          tipo,
          anuncioId: imovel.modo === 'anuncio' ? imovel.anuncioId : null,
        });
      }}
    >
      <DialogHeader>
        <DialogTitle className="font-heading text-lg leading-tight">
          {corrigindo ? `A parceria de ${alvo.nome}` : `Mudar ${alvo.nome} para Parceiro`}
        </DialogTitle>
        <DialogDescription>
          {corrigindo
            ? 'Corrija o tipo ou o imóvel. A conversa continua em Parceiros.'
            : `A conversa sai de Clientes e passa a ficar em Parceiros. Quando escrever de novo, continua lá. A IA que atende não responde Parceiros: quem responde é a equipe.`}
        </DialogDescription>
      </DialogHeader>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Que parceria?</legend>
        <div role="radiogroup" aria-label="Que parceria" className="flex flex-wrap gap-2">
          {TIPOS_DE_PARCERIA.map((t) => {
            const marcado = tipo === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={marcado}
                onClick={() => setTipo(t.id)}
                className={cn(
                  'toque inline-flex h-11 items-center rounded-full border px-4 text-sm transition-colors outline-none md:h-9',
                  'focus-visible:ring-3 focus-visible:ring-ring/50',
                  marcado
                    ? 'border-wpp-cliente bg-wpp-cliente-fundo font-semibold text-wpp-cliente-texto'
                    : 'border-transparent bg-wpp-chip text-wpp-chip-texto hover:bg-foreground/10',
                )}
              >
                {t.rotulo}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1">
        <EscolherImovel valor={imovel} aoMudar={setImovel} permiteSemAnuncio={false} />
        <p className="text-xs text-muted-foreground">Opcional: o imóvel do contrato.</p>
      </div>

      <DialogFooter className="gap-2">
        <Button
          type="button"
          variant="outline"
          className="toque h-11 md:h-9"
          onClick={aoFechar}
          disabled={enviando}
        >
          Cancelar
        </Button>
        <Button type="submit" className="toque h-11 md:h-9" disabled={!tipo || enviando}>
          <Handshake aria-hidden="true" />
          {corrigindo ? 'Salvar' : 'Mudar para Parceiro'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * A faixa do perfil, logo abaixo do cabeçalho da conversa. Cliente: o selo e o
 * "Mudar para Parceiro" (com negócio ganho, a faixa fica amarela e sugere).
 * Parceiro: o tipo, o imóvel, desde quando e por quem, e "Voltar para Clientes".
 */
export function FaixaDoPerfil({
  alvo,
  ganhou,
  podeMudar,
  nomeDe,
}: {
  alvo: AlvoDoPerfil;
  ganhou: boolean;
  podeMudar: boolean;
  nomeDe: (id: string) => string | null;
}) {
  const acoes = usePerfilDaConversa();
  if (!CLIENTES_E_PARCEIROS || !acoes) return null;
  const perfil = alvo.parceiro;

  if (perfil) {
    const descricao = descricaoDoParceiro(perfil, nomeDe);
    return (
      <div
        aria-label="Perfil"
        className="flex min-h-10 shrink-0 items-center gap-2 border-b border-wpp-linha bg-wpp-painel px-3 py-1.5 text-[13px] md:px-4"
      >
        <SeloDoPerfil parceiro={perfil} />
        {descricao ? (
          <span className="min-w-0 flex-1 truncate text-wpp-suave">{descricao}</span>
        ) : (
          <span className="flex-1" />
        )}
        {podeMudar ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="toque h-9 shrink-0 rounded-full px-3 text-[13px] text-wpp-suave md:h-8"
              onClick={() => acoes.pedirParceiro(alvo)}
            >
              Corrigir
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="toque h-9 shrink-0 rounded-full border-wpp-linha-forte bg-transparent px-3 text-[13px] md:h-8"
              onClick={() => acoes.voltarParaClientes(alvo)}
            >
              <UserRound aria-hidden="true" />
              <span className="max-sm:sr-only">Voltar para Clientes</span>
            </Button>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div
      aria-label="Perfil"
      className={cn(
        'flex min-h-10 shrink-0 items-center gap-2 border-b border-wpp-linha px-3 py-1.5 text-[13px] md:px-4',
        ganhou ? 'bg-wpp-janela text-wpp-janela-texto' : 'bg-wpp-painel',
      )}
    >
      {ganhou ? (
        <>
          <BadgeCheck className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">
            <strong className="font-semibold">Negócio ganho.</strong> Mudar o perfil para Parceiro?
          </span>
        </>
      ) : (
        <>
          <SeloDoPerfil parceiro={null} />
          <span className="flex-1" />
        </>
      )}
      {podeMudar ? (
        <Button
          type="button"
          variant={ganhou ? 'default' : 'outline'}
          size="sm"
          className={cn(
            'toque h-9 shrink-0 rounded-full px-3 text-[13px] md:h-8',
            !ganhou && 'border-wpp-linha-forte bg-transparent',
          )}
          onClick={() => acoes.pedirParceiro(alvo)}
        >
          <Handshake aria-hidden="true" />
          Mudar para Parceiro
        </Button>
      ) : null}
    </div>
  );
}

/** "Cliente" ou "Parceiro · Inquilino", como na faixa da conversa. */
export function SeloDoPerfil({
  parceiro,
  className,
}: {
  parceiro: PerfilDoParceiro | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-semibold',
        parceiro
          ? 'bg-wpp-cliente-fundo text-wpp-cliente-texto'
          : 'bg-wpp-chip-ativo text-wpp-chip-ativo-texto',
        className,
      )}
    >
      {parceiro ? (
        <Handshake className="size-3.5" aria-hidden="true" />
      ) : (
        <UserRound className="size-3.5" aria-hidden="true" />
      )}
      {parceiro ? `Parceiro · ${rotuloDaParceria(parceiro.tipo)}` : 'Cliente'}
    </span>
  );
}

/** O tipo da parceria na linha da lista, miúdo como as outras marcas de lá. */
export function ParceriaNaLista({ parceiro }: { parceiro: PerfilDoParceiro }) {
  return (
    <>
      <span className="inline-flex h-4 shrink-0 items-center gap-1 rounded-full bg-wpp-cliente-fundo px-1.5 text-[11px] font-semibold text-wpp-cliente-texto md:text-[10px]">
        <Handshake className="size-3" aria-hidden="true" />
        {rotuloDaParceria(parceiro.tipo)}
      </span>
      {parceiro.imovel ? <span className="min-w-0 truncate">{parceiro.imovel}</span> : null}
    </>
  );
}

/** "Negócio ganho" na linha de quem ainda é Cliente: a sugestão de virar Parceiro. */
export function GanhoNaLista() {
  return (
    <span
      className="inline-flex h-4 shrink-0 items-center gap-1 rounded-full bg-wpp-janela px-1.5 text-[11px] font-semibold text-wpp-janela-texto md:text-[10px]"
      title="Negócio ganho: na conversa, dá para mudar o perfil para Parceiro."
    >
      <BadgeCheck className="size-3" aria-hidden="true" />
      Negócio ganho
    </span>
  );
}

/** As pílulas da caixa Parceiros: todos ou um tipo só. */
export function FiltroDaParceria({
  tipo,
  total,
  porTipo,
  aoTrocar,
}: {
  tipo: RecorteDosParceiros['tipo'];
  total: number;
  porTipo: ReadonlyMap<TipoDeParceria, number>;
  aoTrocar: (tipo: RecorteDosParceiros['tipo']) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Que parceria mostrar"
      className="relative -mx-3.5 flex gap-1.5 overflow-x-auto px-3.5 pb-0.5 [scrollbar-width:none]"
    >
      <ChipDeAba ativo={tipo === 'todos'} contagem={total} onClick={() => aoTrocar('todos')}>
        Todos
      </ChipDeAba>
      {TIPOS_DE_PARCERIA.filter((t) => (porTipo.get(t.id) ?? 0) > 0 || tipo === t.id).map((t) => (
        <ChipDeAba
          key={t.id}
          ativo={tipo === t.id}
          contagem={porTipo.get(t.id) ?? 0}
          onClick={() => aoTrocar(t.id)}
        >
          {t.plural}
        </ChipDeAba>
      ))}
    </div>
  );
}
