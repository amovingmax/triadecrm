'use client';

import { useState } from 'react';
import {
  CalendarCheck,
  CalendarClock,
  CircleDot,
  Copy,
  Eye,
  FileText,
  MessageCircle,
  MessagesSquare,
  Phone,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatarTelefone } from '@/components/parceiros/formatos';
import { TelefoneRevelavel } from '@/components/parceiros/telefone-revelavel';

import { revelarTelefoneDoLead } from './leads-dados';
import {
  comoChegouOLead,
  jeitoDeChegar,
  rotuloDoTipo,
  SITUACOES_DO_LEAD,
  temperaturaDoLead,
  TIPO_DA_CHEGADA,
  type LeadDoPortal,
  type SituacaoDoLead,
  type Tom,
} from './leads-rotulos';

/**
 * As peças que a lista e a ficha do lead repetem (05/11/2026): o ícone de cada
 * tipo de contato, por onde a mensagem chegou, a temperatura que o portal dá, a
 * situação do lead e o telefone que se revela.
 */

const ICONE_DO_TIPO: Record<string, LucideIcon> = {
  CLICK_WHATSAPP: MessageCircle,
  VISIT_REQUEST: CalendarCheck,
  CLICK_SCHEDULE: CalendarClock,
  CONTACT_FORM: FileText,
  CONTACT_CHAT: MessagesSquare,
  PHONE_VIEW: Phone,
  // 12/11/2026: o lead que nasce da conversa de WhatsApp (o texto do anúncio).
  WHATSAPP_DO_PORTAL: MessageCircle,
};

export function IconeDoTipo({ tipo, className }: { tipo: string | null; className?: string }) {
  const Icone = (tipo && ICONE_DO_TIPO[tipo]) || CircleDot;
  return <Icone className={cn('size-4 shrink-0', className)} aria-hidden="true" />;
}

/** "WhatsApp" com o ícone; a lista inteira de tipos é da ficha. */
export function TipoDeContato({ tipo, className }: { tipo: string; className?: string }) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <IconeDoTipo tipo={tipo} className="text-muted-foreground" />
      <span className="truncate">{rotuloDoTipo(tipo)}</span>
    </span>
  );
}

/**
 * "Pelo WhatsApp", "Pelo chat do portal", "WhatsApp pelo ZAP Imóveis"... com o
 * ícone do mesmo canal.
 */
export function ComoChegou({
  lead,
  className,
}: {
  lead: Pick<LeadDoPortal, 'chegou_por' | 'origem' | 'tipos' | 'portal'>;
  className?: string;
}) {
  const jeito = jeitoDeChegar(lead);
  const rotulo = comoChegouOLead(lead);
  if (!rotulo || !jeito) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <IconeDoTipo tipo={TIPO_DA_CHEGADA[jeito]} className="text-muted-foreground" />
      <span className="min-w-0">{rotulo}</span>
    </span>
  );
}

/**
 * O telefone do lead. Com ficha, é o botão de sempre (`reveal_phone`); sem
 * ficha, o número que o portal mandou, que o SDR revela por
 * `portal_lead_revelar_telefone`. As duas revelações ficam registradas.
 * `compacto` (a linha da lista) põe o aviso do registro na dica do botão.
 */
export function TelefoneDoLead({
  lead,
  compacto = false,
}: {
  lead: Pick<LeadDoPortal, 'id' | 'organization_id' | 'phone_e164' | 'phone_is_masked'>;
  compacto?: boolean;
}) {
  if (!lead.phone_e164) {
    return <span className="text-muted-foreground">Sem telefone</span>;
  }
  if (lead.organization_id) {
    return (
      <TelefoneRevelavel
        organizationId={lead.organization_id}
        telefone={lead.phone_e164}
        mascarado={Boolean(lead.phone_is_masked)}
        whatsapp="nenhum"
      />
    );
  }
  return (
    <TelefoneDoPortal
      key={lead.phone_e164}
      leadId={lead.id}
      telefone={lead.phone_e164}
      mascarado={Boolean(lead.phone_is_masked)}
      compacto={compacto}
    />
  );
}

function TelefoneDoPortal({
  leadId,
  telefone,
  mascarado,
  compacto,
}: {
  leadId: string;
  telefone: string;
  mascarado: boolean;
  compacto: boolean;
}) {
  const [revelado, setRevelado] = useState<string | null>(mascarado ? null : telefone);
  const [revelando, setRevelando] = useState(false);
  const aviso = 'A revelação fica registrada com o seu nome e a data.';

  async function revelar() {
    setRevelando(true);
    const r = await revelarTelefoneDoLead(leadId);
    setRevelando(false);
    if (!r.ok) {
      toast.error('Não deu para revelar o telefone.', { description: r.motivo });
      return;
    }
    setRevelado(r.telefone);
    toast.success('Telefone revelado.', { description: 'A revelação ficou registrada.' });
  }

  async function copiar(numero: string) {
    try {
      await navigator.clipboard.writeText(numero);
      toast.success('Número copiado.');
    } catch {
      toast.error('O navegador não deixou copiar.', {
        description: 'Selecione o número na tela e copie à mão.',
      });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="numerico">{formatarTelefone(revelado ?? telefone)}</span>
      {revelado ? (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => void copiar(revelado)}
          className="toque size-11 text-muted-foreground md:size-7"
          aria-label="Copiar o número"
          title="Copiar o número"
        >
          <Copy aria-hidden="true" />
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => void revelar()}
          disabled={revelando}
          title={compacto ? aviso : undefined}
          className="toque h-11 md:h-7"
        >
          <Eye aria-hidden="true" />
          {revelando ? 'Revelando...' : 'Revelar'}
        </Button>
      )}
      {!revelado && !compacto ? (
        <span className="basis-full text-xs text-muted-foreground">{aviso}</span>
      ) : null}
    </div>
  );
}

/** As cores da escala térmica, porque é a mesma pergunta: o quanto essa pessoa quer. */
const TOM: Record<Tom, string> = {
  quente: 'bg-quente-fundo text-quente-texto font-semibold',
  morno: 'bg-morno-fundo text-morno-texto',
  frio: 'bg-frio-fundo text-frio-texto',
};

/**
 * A temperatura que o Grupo OLX dá ao lead. Na coluna da tabela basta "Alta";
 * solta num cartão, a palavra precisa dizer do que é.
 */
export function ChipDaTemperatura({
  valor,
  completo = false,
}: {
  valor: string | null;
  completo?: boolean;
}) {
  const t = temperaturaDoLead(valor);
  if (!t) return completo ? null : <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] leading-none',
        TOM[t.tom],
      )}
      title={`Temperatura do lead no portal: ${t.rotulo.toLowerCase()}`}
    >
      {completo ? `Temperatura ${t.rotulo.toLowerCase()}` : t.rotulo}
    </span>
  );
}

/** "Sem resposta" é o que pede gente: vai cheio. O resto é contorno. */
export function SeloDaSituacao({ situacao }: { situacao: SituacaoDoLead }) {
  return (
    <Badge
      variant={situacao === 'novo' ? 'default' : 'outline'}
      className={cn(
        'shrink-0',
        (situacao === 'descartado' || situacao === 'respondido') && 'text-muted-foreground',
      )}
    >
      {SITUACOES_DO_LEAD[situacao]}
    </Badge>
  );
}
