'use client';

import { PhoneCall } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import { useSoftphone } from './voz-provedor';

/**
 * "Ligar" da ficha: a ligação sai do navegador e toca no telefone do parceiro.
 *
 * Só aparece quando a telefonia está ligada (`app_settings['voz.telefonia']`) e o
 * papel escreve no CRM; com ela desligada a ficha fica como sempre foi. Não recebe o
 * telefone — o número é escolhido pelo banco —, então ligar não exige revelar.
 *
 * Enquanto houver ligação em curso ou resultado por registrar, fica desligado: um
 * clique repetido não cria segunda chamada.
 */
export function BotaoLigar({
  organizationId,
  nome,
  temTelefone,
  className,
}: {
  organizationId: string;
  nome: string;
  temTelefone: boolean;
  className?: string;
}) {
  const softphone = useSoftphone();
  if (!softphone.disponivel || !temTelefone) return null;

  return (
    <Button
      type="button"
      variant="outline"
      className={cn('toque h-11 flex-1 px-4 sm:flex-none md:h-10', className)}
      disabled={softphone.ocupado}
      onClick={() => void softphone.ligar({ organizationId, nome })}
    >
      <PhoneCall aria-hidden="true" />
      Ligar
    </Button>
  );
}
