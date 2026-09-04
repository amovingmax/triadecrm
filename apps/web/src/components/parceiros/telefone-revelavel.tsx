'use client';

import { useState } from 'react';
import { Eye, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

import { formatarTelefone, linkWhatsapp } from './formatos';

/**
 * Telefone da ficha com revelação registrada (RF-BAS-14, RF-ADM-03).
 *
 * Para sdr e embaixador o banco entrega o número mascarado (a view e a busca já
 * fazem isso). Ver o número inteiro é uma ação deliberada: passa pela RPC
 * `reveal_phone`, que grava quem viu, quando e de quem, em `pii_access_log`.
 *
 * O aviso vem ANTES do clique, não depois. Quem toca no botão já sabe que a
 * revelação fica registrada; descobrir isso num toast seria uma pegadinha.
 */
export function TelefoneRevelavel({
  organizationId,
  telefone,
  mascarado,
}: {
  organizationId: string;
  /** O que veio do banco: número completo ou máscara, conforme o papel. */
  telefone: string | null;
  mascarado: boolean;
}) {
  const [revelado, setRevelado] = useState<string | null>(mascarado ? null : telefone);
  const [revelando, setRevelando] = useState(false);

  if (!telefone) {
    return <span className="text-muted-foreground">Sem WhatsApp cadastrado</span>;
  }

  const visivel = revelado ?? telefone;
  const whatsapp = linkWhatsapp(revelado);

  async function revelar() {
    setRevelando(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc('reveal_phone', {
      p_organization_id: organizationId,
    });
    setRevelando(false);

    if (error || !data) {
      toast.error('Não deu para revelar o telefone.', {
        description: error?.message ?? 'Tente de novo em instantes.',
      });
      return;
    }

    setRevelado(data);
    toast.success('Telefone revelado.', { description: 'A revelação ficou registrada.' });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="numerico">{formatarTelefone(visivel)}</span>

      {mascarado && !revelado ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => void revelar()}
          disabled={revelando}
          // 44px no celular: "Revelar" é a ação que destrava o telefone para ligar, ou
          // seja A ação da ficha em campo, e vinha com 36px de altura enquanto a lista
          // e a barra inferior já cumpriam 44 e 64. A classe `toque` só dá resposta
          // tátil (scale no :active); ela não define tamanho nenhum.
          className="toque h-11 md:h-7"
        >
          <Eye aria-hidden="true" />
          {revelando ? 'Revelando...' : 'Revelar'}
        </Button>
      ) : null}

      {whatsapp ? (
        <Button asChild variant="ghost" size="sm" className="toque h-11 md:h-7">
          <a href={whatsapp} target="_blank" rel="noopener noreferrer">
            <MessageCircle aria-hidden="true" />
            Abrir no WhatsApp
          </a>
        </Button>
      ) : null}

      {mascarado && !revelado ? (
        <span className="basis-full text-xs text-muted-foreground">
          A revelação fica registrada com o seu nome e a data (
          {/* Um código de requisito é átomo: quebrado no hífen ("RF-" numa linha,
              "BAS-14)." na outra, medido em 390px) ele deixa de ser pesquisável. */}
          <span className="whitespace-nowrap">RF-BAS-14</span>).
        </span>
      ) : null}
    </div>
  );
}
