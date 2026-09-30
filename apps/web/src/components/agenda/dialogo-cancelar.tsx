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

import { diaDoInstante, faixaDeHoras, rotuloDiaPorExtenso, type Compromisso } from './tipos';

/**
 * Cancelar uma reunião antes de ela acontecer, dizendo por quê.
 *
 * O motivo vai para `reuniao_cancelar` (`p_motivo`), que já o aceitava e que a tela
 * não perguntava: daqui a um mês, "cancelada" sem porquê não ajuda ninguém a
 * entender o funil. O time continua sendo avisado por e-mail, como antes.
 *
 * Cancelar NÃO mexe no funil. Se o parceiro desistiu, isso é um desfecho, e se
 * registra pelo caminho de sempre.
 */
export function DialogoCancelar({
  compromisso,
  gravando,
  aoConfirmar,
  aoFechar,
}: {
  compromisso: Compromisso | null;
  gravando: boolean;
  aoConfirmar: (motivo: string) => void;
  aoFechar: () => void;
}) {
  return (
    <Dialog
      open={compromisso !== null}
      onOpenChange={(aberto) => !aberto && !gravando && aoFechar()}
    >
      <DialogContent>
        {compromisso ? (
          <Conteudo
            key={compromisso.taskId}
            compromisso={compromisso}
            gravando={gravando}
            aoConfirmar={aoConfirmar}
            aoFechar={aoFechar}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Conteudo({
  compromisso,
  gravando,
  aoConfirmar,
  aoFechar,
}: {
  compromisso: Compromisso;
  gravando: boolean;
  aoConfirmar: (motivo: string) => void;
  aoFechar: () => void;
}) {
  const id = useId();
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  function confirmar() {
    if (motivo.trim().length < 3) {
      setErro('Escreva o motivo do cancelamento.');
      return;
    }
    aoConfirmar(motivo.trim());
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Cancelar esta reunião?</DialogTitle>
        <DialogDescription>
          {compromisso.organizacao} · {rotuloDiaPorExtenso(diaDoInstante(compromisso.quando))},{' '}
          <span className="numerico">{faixaDeHoras(compromisso)}</span>. O time é avisado por
          e-mail.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-motivo`} className="text-sm font-medium">
          Motivo
        </label>
        <textarea
          id={`${id}-motivo`}
          rows={3}
          maxLength={500}
          value={motivo}
          onChange={(e) => {
            setMotivo(e.target.value);
            setErro(null);
          }}
          placeholder="Ex.: o parceiro pediu para deixar para o mês que vem"
          aria-invalid={erro !== null}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
        {erro ? <p className="text-xs text-destructive-texto">{erro}</p> : null}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={aoFechar} disabled={gravando}>
          Voltar
        </Button>
        <Button type="button" variant="destructive" onClick={confirmar} disabled={gravando}>
          {gravando ? 'Cancelando...' : 'Cancelar reunião'}
        </Button>
      </DialogFooter>
    </>
  );
}
