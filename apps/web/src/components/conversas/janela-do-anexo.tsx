'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { EMPRESA } from '@/lib/empresa';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { enviarEspecial, ErroDaConversa, type EnvioEspecial } from './acoes';

/**
 * A moldura dos anexos que não são arquivo (27/10/2026): localização, contato,
 * pergunta com botões, lista, pedir localização e figurinha. Um diálogo curto,
 * no meio da tela, com o título dizendo o que sai.
 */
export function JanelaDoAnexo({
  aberto,
  aoFechar,
  titulo,
  descricao,
  children,
}: {
  aberto: boolean;
  aoFechar: () => void;
  titulo: string;
  descricao?: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="max-h-[88svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription className={descricao ? undefined : 'sr-only'}>
            {descricao ?? titulo}
          </DialogDescription>
        </DialogHeader>
        {/* O formulário nasce a cada abertura: o que foi digitado para uma
            conversa não aparece na próxima. */}
        {aberto ? children : null}
      </DialogContent>
    </Dialog>
  );
}

/** O que todo anexo precisa saber para sair: a conversa, a citação e o depois. */
export type DestinoDoAnexo = {
  fioId: string;
  /** A mensagem citada na caixa, que vai junto. */
  respondeA: string | null;
  /** Saiu: refaz as leituras, fecha a citação e a janela. */
  aoEnviar: () => void;
};

/**
 * O envio do anexo, com o aviso de sempre. A recusa do banco já vem em
 * português (`app.messages_forma`), e é ela que aparece.
 */
export function useEnvioDoAnexo(destino: DestinoDoAnexo) {
  const [indo, setIndo] = useState(false);
  async function enviar(envio: Omit<EnvioEspecial, 'fioId' | 'respondeA'>): Promise<boolean> {
    setIndo(true);
    try {
      await enviarEspecial({ ...envio, fioId: destino.fioId, respondeA: destino.respondeA });
      toast.success('Na fila do WhatsApp.', {
        description: `Sai pelo número da ${EMPRESA.nomeDoNumero} em instantes.`,
      });
      destino.aoEnviar();
      return true;
    } catch (erro) {
      toast.error('Não entrou na fila.', {
        description:
          erro instanceof ErroDaConversa ? erro.message : 'Tente de novo em alguns segundos.',
      });
      return false;
    } finally {
      setIndo(false);
    }
  }
  return { enviar, indo };
}

/** O rótulo e o campo, empilhados: o desenho de todo formulário daqui. */
export function Campo({
  rotulo,
  dica,
  children,
}: {
  rotulo: string;
  dica?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{rotulo}</span>
      {children}
      {dica ? <span className="text-xs text-muted-foreground">{dica}</span> : null}
    </label>
  );
}

/** A classe do campo de texto dos anexos: 16 px no celular (o Safari não dá zoom). */
export const CAMPO =
  'h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 md:h-9 md:text-sm';
