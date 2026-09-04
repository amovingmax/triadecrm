import {
  ArrowRightLeft,
  AtSign,
  CircleDashed,
  Footprints,
  Handshake,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Sprout,
  StickyNote,
  type LucideIcon,
} from 'lucide-react';

import type { ActivityType, Channel } from '@komune/schema';

/**
 * Os desenhos do canal e do tipo de interação.
 *
 * São ícones de LEITURA, não de ação: sempre acompanhados do rótulo em texto (o
 * sistema visual não deixa informação viver só em desenho) e sempre em cinza. A cor
 * desta interface pertence à escala térmica.
 *
 * `instagram` usa o arroba e não o logo: a lucide 1.39 não traz mais marcas, e o
 * arroba é justamente como o resto do CRM chama o campo (`@instagram`, RF-BAS-12).
 */
export const ICONE_CANAL: Record<Channel, LucideIcon> = {
  whatsapp: MessageCircle,
  phone: Phone,
  presencial: MapPin,
  instagram: AtSign,
  email: Mail,
  other: CircleDashed,
};

export const ICONE_TIPO: Record<ActivityType, LucideIcon> = {
  call: Phone,
  visit: Footprints,
  meeting: Handshake,
  message: MessageCircle,
  note: StickyNote,
  email: Mail,
  stage_change: ArrowRightLeft,
  // O parceiro entrou na base pela lista-semente da pesquisa R09: é semente, não conversa.
  system: Sprout,
};
