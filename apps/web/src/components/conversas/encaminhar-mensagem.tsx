'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, CornerUpRight, Search } from 'lucide-react';
import { toast } from 'sonner';

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
import { Input } from '@/components/ui/input';

import { encaminharMensagem, ErroDaConversa } from './acoes';
import { resumoDaMensagem } from './conteudo';
import { carregarConversas, CHAVE_CONVERSAS } from './dados';
import { nomeDoCliente } from './fora-da-base-dados';
import { estadoDaJanela, podeEscreverLivre } from './mensagens';
import { normalizar } from './montagem';
import type { MensagemDoFio } from './tipos';

/** O WhatsApp encaminha para 5 conversas por vez, e o CRM também (`mensagem_encaminhar`). */
const TETO_DE_DESTINOS = 5;

type Destino = { id: string; nome: string; aberta: boolean };

/**
 * Encaminhar (27/10/2026). Os destinos são as conversas que a lista já leu, na
 * ordem dela; a de janela fechada aparece apagada, porque fora das 24 h só sai
 * modelo aprovado — e encaminhar é texto livre. Cada destino passa pela porteira
 * dele, e o resultado diz qual saiu e qual não.
 */
export function EncaminharMensagem({
  mensagem,
  aberto,
  aoFechar,
  aoMudar,
}: {
  mensagem: MensagemDoFio;
  aberto: boolean;
  aoFechar: () => void;
  aoMudar: () => void;
}) {
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="max-h-[85svh] grid-rows-[auto_auto_minmax(0,1fr)_auto] sm:max-w-md">
        {aberto ? <Escolha mensagem={mensagem} aoFechar={aoFechar} aoMudar={aoMudar} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Escolha({
  mensagem,
  aoFechar,
  aoMudar,
}: {
  mensagem: MensagemDoFio;
  aoFechar: () => void;
  aoMudar: () => void;
}) {
  const lista = useQuery({ queryKey: CHAVE_CONVERSAS, queryFn: carregarConversas });
  const [busca, setBusca] = useState('');
  const [escolhidos, setEscolhidos] = useState<string[]>([]);
  const [indo, setIndo] = useState(false);

  const destinos = useMemo<Destino[]>(() => {
    const dados = lista.data;
    if (!dados) return [];
    const nomeDaFicha = new Map(dados.organizacoes.map((o) => [o.id, o.name]));
    return dados.fios
      .filter((f) => !f.bloqueada_em)
      .map((f) => ({
        id: f.id,
        nome: (f.organization_id ? nomeDaFicha.get(f.organization_id) : null) ?? nomeDoCliente(f),
        aberta: podeEscreverLivre(estadoDaJanela(f.window_expires_at)),
      }));
  }, [lista.data]);

  const procura = normalizar(busca);
  const visiveis = procura
    ? destinos.filter((d) => normalizar(d.nome).includes(procura))
    : destinos;

  function alternar(id: string) {
    setEscolhidos((atuais) =>
      atuais.includes(id)
        ? atuais.filter((x) => x !== id)
        : atuais.length >= TETO_DE_DESTINOS
          ? atuais
          : [...atuais, id],
    );
  }

  async function encaminhar() {
    setIndo(true);
    try {
      const resultados = await encaminharMensagem(mensagem.id, escolhidos);
      const foram = resultados.filter((r) => r.ok).length;
      const recusas = resultados.filter((r) => !r.ok);
      aoMudar();
      if (recusas.length === 0) {
        toast.success(foram === 1 ? 'Encaminhada.' : `Encaminhada para ${foram} conversas.`);
        aoFechar();
        return;
      }
      const nome = (id: string) => destinos.find((d) => d.id === id)?.nome ?? 'uma conversa';
      toast.error(
        foram > 0 ? `Foi para ${foram}; ${recusas.length} não.` : 'Não foi para ninguém.',
        { description: recusas.map((r) => `${nome(r.conversaId)}: ${r.frase}`).join(' · ') },
      );
      if (foram > 0) aoFechar();
    } catch (erro) {
      toast.error('Não encaminhou.', {
        description: erro instanceof ErroDaConversa ? erro.message : 'Tente de novo.',
      });
    } finally {
      setIndo(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Encaminhar</DialogTitle>
        <DialogDescription className="line-clamp-2">{resumoDaMensagem(mensagem)}</DialogDescription>
      </DialogHeader>

      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Procurar conversa"
          aria-label="Procurar conversa"
          className="h-11 pl-9 md:h-9"
        />
      </div>

      <ul className="min-h-0 overflow-y-auto rounded-lg border border-hairline">
        {lista.isPending ? (
          <li className="px-3 py-4 text-sm text-muted-foreground">Carregando as conversas...</li>
        ) : visiveis.length === 0 ? (
          <li className="px-3 py-4 text-sm text-muted-foreground">
            Nenhuma conversa com esse nome.
          </li>
        ) : (
          visiveis.slice(0, 60).map((d) => {
            const marcado = escolhidos.includes(d.id);
            const cheio = !marcado && escolhidos.length >= TETO_DE_DESTINOS;
            return (
              <li key={d.id} className="border-b border-hairline last:border-b-0">
                <button
                  type="button"
                  disabled={!d.aberta || cheio}
                  onClick={() => alternar(d.id)}
                  aria-pressed={marcado}
                  className={cn(
                    'flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left text-sm outline-none',
                    'hover:bg-muted/60 focus-visible:bg-muted/60 disabled:opacity-50',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-5 shrink-0 items-center justify-center rounded-full border',
                      marcado
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input',
                    )}
                    aria-hidden="true"
                  >
                    {marcado ? <Check className="size-3.5" /> : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{d.nome}</span>
                  {d.aberta ? null : (
                    <span className="shrink-0 text-xs text-muted-foreground">janela fechada</span>
                  )}
                </button>
              </li>
            );
          })
        )}
      </ul>

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
          onClick={() => void encaminhar()}
          disabled={indo || escolhidos.length === 0}
          className="toque h-11 md:h-9"
        >
          <CornerUpRight aria-hidden="true" />
          {indo
            ? 'Encaminhando...'
            : escolhidos.length > 1
              ? `Encaminhar para ${escolhidos.length}`
              : 'Encaminhar'}
        </Button>
      </DialogFooter>
    </>
  );
}
