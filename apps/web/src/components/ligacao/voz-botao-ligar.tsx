'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PhoneCall } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import { avisoDaRecusa } from './voz-logica';
import { useSoftphone } from './voz-provedor';
import { montarLoteAvulso } from './voz-rpc';

/**
 * "Ligar" da ficha: a ligação sai do navegador, com o roteiro na tela.
 *
 * O botão não liga sozinho. Ele monta um lote de UM contato para este parceiro
 * (`montar_lote_avulso`) e abre a tela de ligar do módulo, que é onde estão a fala, as
 * respostas do parceiro como botões e o resultado — o mesmo padrão da ligação do lote,
 * porque é a mesma tela. A chamada começa sozinha quando a tela abre (`?discar=1`).
 *
 * Só aparece com a telefonia ligada (`app_settings['voz.telefonia']`) e para quem
 * escreve no CRM. Enquanto houver ligação em curso fica desligado: um clique repetido
 * não cria segunda chamada.
 */
export function BotaoLigar({
  organizationId,
  temTelefone,
  className,
}: {
  organizationId: string;
  temTelefone: boolean;
  className?: string;
}) {
  const router = useRouter();
  const softphone = useSoftphone();
  const [abrindo, setAbrindo] = useState(false);
  // O estado só vale no desenho seguinte; dois cliques no mesmo instante passam por
  // ele. Quem segura o segundo é o `ref`.
  const trava = useRef(false);
  if (!softphone.disponivel || !temTelefone) return null;

  async function ligar() {
    if (trava.current) return;
    trava.current = true;
    setAbrindo(true);
    const lote = await montarLoteAvulso(organizationId);
    if (!lote.ok) {
      trava.current = false;
      setAbrindo(false);
      const aviso = avisoDaRecusa(lote.motivo, { dono: lote.dono, loteNome: lote.lote_nome });
      toast.error(aviso.titulo, {
        description: aviso.frase,
        // O padrão (4 s) some antes de a pessoa ler por que a ligação não saiu.
        duration: 10_000,
        action:
          lote.motivo === 'ja_no_seu_lote' && lote.lote_id
            ? { label: 'Abrir o lote', onClick: () => router.push(`/ligar/${lote.lote_id}`) }
            : undefined,
      });
      return;
    }
    // Sem `setAbrindo(false)`: o botão fica travado até a tela de ligar assumir.
    router.push(`/ligar/${lote.lote_id}?org=${organizationId}&discar=1`);
  }

  return (
    <Button
      type="button"
      variant="outline"
      className={cn('toque h-11 flex-1 px-4 sm:flex-none md:h-10', className)}
      disabled={softphone.ocupado || abrindo}
      onClick={() => void ligar()}
    >
      <PhoneCall aria-hidden="true" />
      {abrindo ? 'Abrindo...' : 'Ligar'}
    </Button>
  );
}
