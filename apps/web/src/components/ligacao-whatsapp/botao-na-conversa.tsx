'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Phone, PhoneCall } from 'lucide-react';
import { toast } from 'sonner';

import { EMPRESA } from '@/lib/empresa';
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
import { Label } from '@/components/ui/label';

import { botaoDaConversa, fraseDaFaixa, fraseDoMotivo, textoPadraoDoPedido } from './logica';
import { chaveDaLigacaoNaConversa, useLigacaoWhatsapp } from './provedor';
import { ErroDaLigacao, lerEstadoNaConversa, pedirPermissao } from './rpc';

function useEstadoNaConversa(conversaId: string) {
  const { disponivel } = useLigacaoWhatsapp();
  return useQuery({
    queryKey: chaveDaLigacaoNaConversa(conversaId),
    queryFn: () => lerEstadoNaConversa(conversaId),
    enabled: disponivel,
    // A permissão muda pelo Realtime; a janela e o horário mudam com o relógio.
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/**
 * O botão de ligar, no cabeçalho da conversa. Sem a permissão do cliente ele pede; com
 * ela, liga. Fora da Imova não aparece nunca: `disponivel` é falso e a consulta nem sai.
 */
export function BotaoDeLigarNaConversa({
  conversaId,
  nome,
  compacto = false,
}: {
  conversaId: string;
  nome: string;
  /** O cabeçalho do celular: só o ícone. */
  compacto?: boolean;
}) {
  const { disponivel, ocupado, ligar } = useLigacaoWhatsapp();
  const clientes = useQueryClient();
  const { data: estado } = useEstadoNaConversa(conversaId);
  const [pedindo, setPedindo] = useState(false);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);

  if (!disponivel || !estado) return null;
  const botao = botaoDaConversa(estado, ocupado);
  if (botao.tipo === 'nenhum') return null;

  const rotulo = botao.tipo === 'ligar' ? 'Ligar' : 'Pedir para ligar';
  const Icone = botao.tipo === 'ligar' ? Phone : PhoneCall;
  const aoClicar = () => {
    if (botao.tipo === 'ligar') {
      void ligar(conversaId, nome);
      return;
    }
    setTexto(textoPadraoDoPedido(EMPRESA.nome));
    setPedindo(true);
  };

  async function enviar() {
    setEnviando(true);
    try {
      await pedirPermissao(conversaId, texto);
      toast.success('Pedido enviado. O botão de ligar aparece quando o cliente permitir.');
      setPedindo(false);
    } catch (e) {
      toast.error(fraseDoMotivo(e instanceof ErroDaLigacao ? e.motivo : undefined));
    } finally {
      setEnviando(false);
      void clientes.invalidateQueries({ queryKey: chaveDaLigacaoNaConversa(conversaId) });
    }
  }

  return (
    <>
      {compacto ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="toque size-11 shrink-0"
          disabled={botao.desligado}
          onClick={aoClicar}
          aria-label={botao.nota ? `${rotulo}: ${botao.nota}` : rotulo}
          title={botao.nota ?? rotulo}
        >
          <Icone aria-hidden="true" />
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="toque h-9"
          disabled={botao.desligado}
          onClick={aoClicar}
          title={botao.nota ?? undefined}
        >
          <Icone aria-hidden="true" />
          {rotulo}
        </Button>
      )}

      <Dialog open={pedindo} onOpenChange={setPedindo}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pedir para ligar pelo WhatsApp</DialogTitle>
            <DialogDescription>
              A Meta só deixa a empresa ligar depois que o cliente permite. Esta mensagem vai com o
              botão para ele responder. A Meta deixa pedir uma vez por dia e duas por semana.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="texto-do-pedido">Mensagem</Label>
            <textarea
              id="texto-do-pedido"
              rows={4}
              maxLength={1024}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              className="w-full resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="toque" onClick={() => setPedindo(false)}>
              Agora não
            </Button>
            <Button
              type="button"
              className="toque"
              onClick={() => void enviar()}
              disabled={enviando || texto.trim().length === 0}
            >
              {enviando ? 'Enviando...' : 'Enviar pedido'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** A linha que conta o que está acontecendo: a permissão, o limite ou a ligação perdida. */
export function FaixaDaLigacao({ conversaId, className }: { conversaId: string; className?: string }) {
  const { disponivel, ocupado } = useLigacaoWhatsapp();
  const { data: estado } = useEstadoNaConversa(conversaId);
  if (!disponivel || !estado) return null;
  const botao = botaoDaConversa(estado, ocupado);
  const nota = botao.tipo !== 'nenhum' && botao.desligado ? botao.nota : null;
  const frase = nota ?? fraseDaFaixa(estado);
  if (!frase) return null;
  return (
    <p className={cn('px-5 py-1.5 text-xs text-muted-foreground conversa-estreita:px-3', className)}>{frase}</p>
  );
}
