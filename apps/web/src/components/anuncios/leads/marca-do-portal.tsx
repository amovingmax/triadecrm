import { House } from 'lucide-react';

import { cn } from '@/lib/utils';

import { ehPortal, rotuloDoPortal, type Portal } from './leads-rotulos';

/**
 * A marca do portal de onde o lead veio (23/11/2026, pedido do usuário: "sempre
 * deve aparecer o ícone do portal em que ela enviou a mensagem"). Fica antes de
 * "Chegou pelo WhatsApp", "Chegou pelo chat da OLX"..., na lista e na ficha.
 *
 * DESENHO NOSSO, não o arquivo oficial do logo: as letras de cada portal na cor
 * dele, num selo do tamanho de um ícone. A OLX com o O branco, o L verde e o X
 * laranja sobre o roxo (a versão da marca para fundo escuro); o ZAP em laranja;
 * o Viva Real em azul. As cores do ZAP e do Viva Real não foram conferidas num
 * manual da marca (o CRM não abre os sites do Grupo OLX): para usar o logo de
 * verdade, troque o selo aqui, e só aqui.
 *
 * Sem portal (o aviso do Grupo OLX não diz de qual site veio e nada o casou com
 * uma conversa), o selo é neutro, com a casinha, e a dica diz que não se sabe.
 */
const SELO =
  'inline-flex h-5 min-w-5 shrink-0 select-none items-center justify-center rounded-[5px] px-1 text-[10px] leading-none font-black tracking-[-0.02em]';

const DESENHO: Record<Portal, { fundo: string; letras: readonly (readonly [string, string])[] }> = {
  olx: {
    fundo: 'bg-[#6E0AD6]',
    letras: [
      ['O', 'text-white'],
      ['L', 'text-[#8CE563]'],
      ['X', 'text-[#F28000]'],
    ],
  },
  zap: { fundo: 'bg-[#FF5D05]', letras: [['ZAP', 'text-white']] },
  vivareal: { fundo: 'bg-[#1D56D6]', letras: [['VR', 'text-white']] },
};

export function MarcaDoPortal({
  portal,
  className,
}: {
  portal: string | null | undefined;
  className?: string;
}) {
  if (!ehPortal(portal)) {
    return (
      <span
        role="img"
        aria-label="Portal não identificado"
        title="O aviso do portal não diz se veio do ZAP Imóveis, do Viva Real ou da OLX"
        className={cn(SELO, 'border border-hairline bg-muted text-muted-foreground', className)}
      >
        <House className="size-3" aria-hidden="true" />
      </span>
    );
  }
  const nome = rotuloDoPortal(portal) ?? '';
  const desenho = DESENHO[portal];
  return (
    <span role="img" aria-label={nome} title={nome} className={cn(SELO, desenho.fundo, className)}>
      {desenho.letras.map(([letra, cor]) => (
        <span key={letra} className={cor} aria-hidden="true">
          {letra}
        </span>
      ))}
    </span>
  );
}
