'use client';

import { useId, useState } from 'react';
import { Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Excluir, com o motivo quando ele importa.
 *
 * ===========================================================================
 * POR QUE EXISTE (07/10/2026)
 * ===========================================================================
 * O Rafael pediu: "trabalhe bem sobre as funcionalidades de exclusão; em várias
 * abas não tem isso". Não tinha mesmo — e, onde tinha, cada tela confirmava de
 * um jeito (um `window.confirm` aqui, nenhuma confirmação ali). Este é o diálogo
 * que as exclusões novas usam: o parceiro, o compromisso da agenda e a próxima
 * ação da ficha.
 *
 * Três regras, que são as do `DialogoConfirmar` do Ajustes levadas adiante:
 *
 *  1. A descrição CONTA a consequência daquele clique — o que some, o que é
 *     cancelado junto, o que fica guardado e como se desfaz. Nunca "tem certeza?".
 *  2. O motivo é pedido quando alguém vai precisar dele depois: quem abre a
 *     lista de excluídos daqui a um mês decide se restaura lendo essa frase.
 *     `motivo="obrigatorio"` trava o botão sem ela; `"opcional"` só oferece o
 *     campo; `"nenhum"` nem mostra.
 *  3. Quem fecha é o "Voltar", à esquerda, e ele não fica vermelho. O botão que
 *     exclui diz o que exclui ("Excluir parceiro"), não "Confirmar".
 *
 * NADA AQUI APAGA LINHA DO BANCO: as três exclusões são reversíveis ou deixam
 * rastro (`organizations.deleted_at`, `tasks.status = 'cancelled'`, `audit_log`).
 * É isso que permite o diálogo ser curto.
 */
export type MotivoDaExclusao = 'obrigatorio' | 'opcional' | 'nenhum';

export function DialogoExcluir({
  aberto,
  aoFechar,
  titulo,
  descricao,
  rotuloConfirmar,
  motivo = 'nenhum',
  exemploDeMotivo,
  ocupado = false,
  aoConfirmar,
}: {
  aberto: boolean;
  aoFechar: () => void;
  titulo: string;
  /** O que acontece ao confirmar. Parágrafos soltos, sem "tem certeza?". */
  descricao: React.ReactNode;
  rotuloConfirmar: string;
  motivo?: MotivoDaExclusao;
  /** O texto de exemplo do campo: uma frase que alguém de fato escreveria. */
  exemploDeMotivo?: string;
  ocupado?: boolean;
  aoConfirmar: (motivo: string) => void;
}) {
  return (
    <Dialog open={aberto} onOpenChange={(estado) => !estado && !ocupado && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        {/* O conteúdo nasce a cada abertura: o motivo digitado para um não
            pode aparecer escrito na exclusão do próximo. */}
        {aberto ? (
          <Conteudo
            aoFechar={aoFechar}
            titulo={titulo}
            descricao={descricao}
            rotuloConfirmar={rotuloConfirmar}
            motivo={motivo}
            exemploDeMotivo={exemploDeMotivo}
            ocupado={ocupado}
            aoConfirmar={aoConfirmar}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** O menor motivo que diz alguma coisa. É o mesmo piso de `public.parceiro_excluir`. */
export const MOTIVO_MINIMO = 3;

function Conteudo({
  aoFechar,
  titulo,
  descricao,
  rotuloConfirmar,
  motivo,
  exemploDeMotivo,
  ocupado,
  aoConfirmar,
}: {
  aoFechar: () => void;
  titulo: string;
  descricao: React.ReactNode;
  rotuloConfirmar: string;
  motivo: MotivoDaExclusao;
  exemploDeMotivo?: string;
  ocupado: boolean;
  aoConfirmar: (motivo: string) => void;
}) {
  const id = useId();
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  function confirmar() {
    const limpo = texto.trim();
    if (motivo === 'obrigatorio' && limpo.length < MOTIVO_MINIMO) {
      setErro('Escreva o motivo: é o que explica esta exclusão para quem vier depois.');
      return;
    }
    aoConfirmar(limpo);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{titulo}</DialogTitle>
        <DialogDescription asChild>
          <div className="space-y-2 text-left leading-relaxed">{descricao}</div>
        </DialogDescription>
      </DialogHeader>

      {motivo !== 'nenhum' ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-motivo`} className="text-sm font-medium">
            Motivo
            {motivo === 'opcional' ? (
              <span className="font-normal text-muted-foreground"> (se quiser)</span>
            ) : null}
          </label>
          <textarea
            id={`${id}-motivo`}
            rows={2}
            maxLength={500}
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value);
              setErro(null);
            }}
            placeholder={exemploDeMotivo}
            aria-invalid={erro !== null}
            aria-describedby={erro ? `${id}-erro` : undefined}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
          {erro ? (
            <p id={`${id}-erro`} className="text-xs text-destructive-texto">
              {erro}
            </p>
          ) : null}
        </div>
      ) : null}

      <DialogFooter className="gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={aoFechar}
          disabled={ocupado}
          className="toque h-11 md:h-9"
        >
          Voltar
        </Button>
        <Button
          type="button"
          variant="destructive"
          onClick={confirmar}
          disabled={ocupado}
          className="toque h-11 md:h-9"
        >
          <Trash2 aria-hidden="true" />
          {ocupado ? 'Excluindo...' : rotuloConfirmar}
        </Button>
      </DialogFooter>
    </>
  );
}
