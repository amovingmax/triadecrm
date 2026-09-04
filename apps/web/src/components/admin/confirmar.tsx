'use client';

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
 * Confirmação para o que muda a vida de outra pessoa ou o comportamento automático do
 * CRM: tirar o acesso de alguém, mudar o papel, desligar um desfecho de interação.
 *
 * A descrição não pergunta "tem certeza?": ela CONTA a consequência exata daquele
 * clique (quem perde o acesso quando, que automação para de acontecer). É a diferença
 * entre um alerta que se aprende a clicar sem ler e um alerta que informa.
 */
export function DialogoConfirmar({
  aberto,
  aoFechar,
  titulo,
  descricao,
  rotuloConfirmar,
  perigo = false,
  ocupado = false,
  aoConfirmar,
}: {
  aberto: boolean;
  aoFechar: () => void;
  titulo: string;
  descricao: React.ReactNode;
  rotuloConfirmar: string;
  perigo?: boolean;
  ocupado?: boolean;
  aoConfirmar: () => void;
}) {
  return (
    <Dialog open={aberto} onOpenChange={(estado) => (estado ? null : aoFechar())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 text-left leading-relaxed">{descricao}</div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={aoFechar} className="toque h-11 md:h-9">
            Cancelar
          </Button>
          <Button
            variant={perigo ? 'destructive' : 'default'}
            onClick={aoConfirmar}
            disabled={ocupado}
            className="toque h-11 md:h-9"
          >
            {ocupado ? 'Salvando...' : rotuloConfirmar}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
