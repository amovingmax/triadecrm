'use client';

import { useCallback, useState } from 'react';
import { Check, Send, X } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { DialogoConfirmar } from '@/components/admin/confirmar';

import { avisoDaSaudacao, desfazerSaudacao, mandarSaudacao, recadoDaSaudacao } from './saudacao';

/**
 * Os botões da saudação em Prospectados (07/10/2026). As regras e os textos estão
 * em `saudacao.ts`; aqui moram o clique, o aviso e o "Desfazer".
 *
 * Duas portas, para os dois jeitos de trabalhar a lista:
 *
 *   · o botão da LINHA, ao lado do WhatsApp: um clique e a saudação entra na
 *     fila. Sem diálogo — é o "mais fácil" que o Rafael pediu —, e por isso o
 *     aviso de depois traz "Desfazer", que tira da fila o que ainda não saiu;
 *   · a SELEÇÃO, para mandar a vários de uma vez: marca, confere o número e
 *     confirma. Aqui há diálogo, porque o número pode ser cinquenta.
 *
 * Nenhuma das duas manda na hora: a mensagem entra na fila da saudação, que
 * sai no ritmo e no horário de Ajustes. É o que mantém o número da KOMUNE
 * longe do bloqueio da Meta.
 */
export function useSaudacao() {
  // Quem foi pedido nesta visita à tela: o botão da linha vira "na fila".
  const [pedidos, setPedidos] = useState<ReadonlySet<string>>(new Set());
  const [ocupado, setOcupado] = useState(false);

  const desfazer = useCallback(async (ids: readonly string[]) => {
    const tiradas = await desfazerSaudacao(ids);
    if (tiradas === null) {
      toast.error('Não deu para desfazer.', { description: 'Tente de novo em instantes.' });
      return;
    }
    setPedidos((atual) => {
      const novo = new Set(atual);
      for (const id of ids) novo.delete(id);
      return novo;
    });
    toast.success(
      tiradas === 0
        ? 'Nada a tirar: a saudação já tinha saído.'
        : tiradas === 1
          ? 'Saudação tirada da fila.'
          : `${tiradas} saudações tiradas da fila.`,
    );
  }, []);

  const pedir = useCallback(
    async (ids: readonly string[]): Promise<boolean> => {
      setOcupado(true);
      const r = await mandarSaudacao(ids);
      setOcupado(false);
      if (!r.ok) {
        toast.error('A saudação não entrou na fila.', { description: recadoDaSaudacao(r.motivo) });
        return false;
      }
      const aviso = avisoDaSaudacao(r);
      if (aviso.entrou) {
        setPedidos((atual) => new Set([...atual, ...ids]));
        toast.success(aviso.titulo, {
          description: aviso.descricao,
          action: { label: 'Desfazer', onClick: () => void desfazer(ids) },
          duration: 10_000,
        });
      } else {
        toast.info(aviso.titulo, { description: aviso.descricao, duration: 8_000 });
      }
      return true;
    },
    [desfazer],
  );

  return { pedidos, ocupado, pedir };
}

/** O botão da linha. Só aparece para quem tem WhatsApp na ficha. */
export function BotaoSaudacao({
  nome,
  pedido,
  ocupado,
  aoPedir,
  className,
}: {
  nome: string;
  /** Já pedido nesta visita à tela. */
  pedido: boolean;
  ocupado: boolean;
  aoPedir: () => void;
  className?: string;
}) {
  if (pedido) {
    return (
      <span
        className={cn(
          'inline-flex size-8 items-center justify-center text-muted-foreground',
          className,
        )}
        title="Saudação na fila"
        aria-label={`Saudação de ${nome} na fila`}
        role="img"
      >
        <Check className="size-4" aria-hidden="true" />
      </span>
    );
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      disabled={ocupado}
      onClick={aoPedir}
      className={cn('toque text-muted-foreground hover:text-foreground', className)}
      aria-label={`Mandar a saudação para ${nome}`}
      title='Mandar a saudação ("Bom dia!" ou "Boa tarde!", conforme a hora)'
    >
      <Send aria-hidden="true" />
    </Button>
  );
}

/**
 * A barra que aparece quando há linha marcada. Fica grudada no alto da lista
 * enquanto ela rola: quem marcou a quinta linha não precisa voltar ao topo.
 */
export function BarraDaSelecao({
  quantos,
  ocupado,
  aoMandar,
  aoLimpar,
}: {
  quantos: number;
  ocupado: boolean;
  aoMandar: () => Promise<boolean>;
  aoLimpar: () => void;
}) {
  const [confirmando, setConfirmando] = useState(false);
  if (quantos === 0) return null;

  return (
    <>
      <div
        role="region"
        aria-label="Parceiros marcados"
        className="sombra-base sticky top-2 z-30 mb-2 flex flex-wrap items-center gap-2 rounded-xl bg-card px-3 py-2"
      >
        <p className="text-sm">
          <span className="numerico font-medium">{quantos}</span>
          {quantos === 1 ? ' marcado' : ' marcados'}
        </p>
        <Button
          size="sm"
          className="toque h-9"
          disabled={ocupado}
          onClick={() => setConfirmando(true)}
        >
          <Send aria-hidden="true" />
          Mandar a saudação
        </Button>
        <Button variant="ghost" size="sm" className="toque h-9" onClick={aoLimpar}>
          <X aria-hidden="true" />
          Desmarcar
        </Button>
      </div>

      <DialogoConfirmar
        aberto={confirmando}
        aoFechar={() => setConfirmando(false)}
        titulo={
          quantos === 1
            ? 'Mandar a saudação para 1 parceiro?'
            : `Mandar a saudação para ${quantos} parceiros?`
        }
        descricao={
          <>
            <p>
              Cada um recebe “Bom dia!”, “Boa tarde!” ou “Boa noite!”, conforme a hora em que a
              mensagem sair. A fila manda no ritmo de Ajustes, só no horário de envio — não sai tudo
              agora.
            </p>
            <p>
              Quem já conversa com a gente, não tem WhatsApp ou pediu para não ser contatado é
              pulado, e o aviso diz quantos. Até sair, dá para desfazer.
            </p>
          </>
        }
        rotuloConfirmar="Mandar a saudação"
        ocupado={ocupado}
        aoConfirmar={() => {
          void aoMandar().then((foi) => {
            if (foi) {
              setConfirmando(false);
              aoLimpar();
            }
          });
        }}
      />
    </>
  );
}
