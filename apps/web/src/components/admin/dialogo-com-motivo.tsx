'use client';

import { useId, useState } from 'react';

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
 * Decidir com motivo: ligar ou desligar a coleta, liberar ou recolher uma fonte
 * (Ajustes → Inteligência de mercado, 19/11/2026).
 *
 * É o `DialogoExcluir` (`components/exclusao/dialogo-excluir`) para uma decisão que
 * não exclui nada, com as mesmas três regras:
 *
 *  1. A descrição CONTA a consequência daquele clique. Nunca "tem certeza?".
 *  2. O motivo é obrigatório, porque fica no `audit_log` e explica a decisão a quem
 *     vier depois. Ele já vem escrito (uma sugestão que a pessoa pode trocar), e o
 *     piso é o do banco (5 letras).
 *  3. Quem fecha é o "Voltar", à esquerda. O botão que decide diz o que faz
 *     ("Ligar a coleta", "Liberar a fonte"), não "Confirmar".
 *
 * A recusa do banco (`ok: false`) aparece aqui dentro, em frase clara, e o diálogo
 * continua aberto com o motivo digitado: a pessoa corrige e tenta de novo.
 */
export function DialogoComMotivo({
  aberto,
  aoFechar,
  titulo,
  descricao,
  rotuloConfirmar,
  motivoInicial,
  validarMotivo,
  erro,
  ocupado = false,
  aoConfirmar,
}: {
  aberto: boolean;
  aoFechar: () => void;
  titulo: string;
  /** O que acontece ao confirmar. Parágrafos soltos, sem "tem certeza?". */
  descricao: React.ReactNode;
  rotuloConfirmar: string;
  /** O motivo sugerido, já escrito no campo. */
  motivoInicial: string;
  /** Devolve a frase do problema, ou `null` quando o motivo serve. */
  validarMotivo: (motivo: string) => string | null;
  /** A recusa do banco, já em português. */
  erro: string | null;
  ocupado?: boolean;
  aoConfirmar: (motivo: string) => void;
}) {
  return (
    <Dialog open={aberto} onOpenChange={(estado) => !estado && !ocupado && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        {/* O conteúdo nasce a cada abertura: o motivo de uma decisão não pode
            aparecer escrito na próxima. */}
        {aberto ? (
          <Conteudo
            aoFechar={aoFechar}
            titulo={titulo}
            descricao={descricao}
            rotuloConfirmar={rotuloConfirmar}
            motivoInicial={motivoInicial}
            validarMotivo={validarMotivo}
            erro={erro}
            ocupado={ocupado}
            aoConfirmar={aoConfirmar}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Conteudo({
  aoFechar,
  titulo,
  descricao,
  rotuloConfirmar,
  motivoInicial,
  validarMotivo,
  erro,
  ocupado,
  aoConfirmar,
}: {
  aoFechar: () => void;
  titulo: string;
  descricao: React.ReactNode;
  rotuloConfirmar: string;
  motivoInicial: string;
  validarMotivo: (motivo: string) => string | null;
  erro: string | null;
  ocupado: boolean;
  aoConfirmar: (motivo: string) => void;
}) {
  const id = useId();
  const [texto, setTexto] = useState(motivoInicial);
  const [problema, setProblema] = useState<string | null>(null);
  const aviso = problema ?? erro;

  function confirmar() {
    const achado = validarMotivo(texto);
    if (achado) {
      setProblema(achado);
      return;
    }
    aoConfirmar(texto.trim());
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="pr-8">{titulo}</DialogTitle>
        <DialogDescription asChild>
          <div className="space-y-2 text-left leading-relaxed">{descricao}</div>
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-motivo`} className="text-sm font-medium">
          Motivo
          <span className="font-normal text-muted-foreground"> (fica registrado)</span>
        </label>
        <textarea
          id={`${id}-motivo`}
          rows={3}
          maxLength={1000}
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setProblema(null);
          }}
          aria-invalid={aviso !== null}
          aria-describedby={aviso ? `${id}-erro` : undefined}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-base focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:text-sm"
        />
        {aviso ? (
          <p id={`${id}-erro`} role="alert" className="text-xs text-destructive-texto">
            {aviso}
          </p>
        ) : null}
      </div>

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
        <Button type="button" onClick={confirmar} disabled={ocupado} className="toque h-11 md:h-9">
          {ocupado ? 'Gravando...' : rotuloConfirmar}
        </Button>
      </DialogFooter>
    </>
  );
}
