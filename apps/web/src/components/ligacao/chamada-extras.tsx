'use client';

import { useId, useState } from 'react';
import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useEhCelular } from '@/components/parceiros/usar-eh-celular';
import {
  doInputLocal,
  formatarQuandoPorExtenso,
  paraInputLocal,
} from '@/components/registro/formatos';
import { FORMATOS_REUNIAO, type MotivoPerda } from '@/components/registro/tipos';

import { type DesfechoDeLigacao } from './tipos';

/**
 * Os quatro casos que custam um toque a mais — e nenhum deles por burocracia.
 *
 * - **Reunião marcada** pede data, hora e formato: a etapa `reuniao_marcada` os exige
 *   em `required_fields`, e `move_deal` recusa sem eles. Reunião sem data não é reunião.
 * - **Sem interesse** pede motivo de perda: RF-FUN-04, e `app.deals_before_write`
 *   recusa a perda sem ele. Sem essa lista o relatório de motivos nasce furado.
 * - **Atendeu, retorna depois** pede a data combinada: foi o cliente que a decidiu, e
 *   é ela que vira a tarefa. Inventar uma seria mentir para a agenda dela.
 * - **Não me ligue mais** pede confirmação, porque não tem volta: o número entra na
 *   `suppression_list` e nenhum contato sai mais para ele, em nenhum canal (RF-CON-18).
 *
 * Os outros desfechos nunca veem esta folha: vão do toque direto ao recibo.
 */
export type ExtrasDaChamada = {
  lostReasonId: number | null;
  reuniaoEm: string | null;
  reuniaoFormato: string | null;
  agendarPara: string | null;
  confirmouOptout: boolean;
};

export const EXTRAS_DA_CHAMADA_VAZIOS: ExtrasDaChamada = {
  lostReasonId: null,
  reuniaoEm: null,
  reuniaoFormato: null,
  agendarPara: null,
  confirmouOptout: false,
};

/** Slug do desfecho que agenda reunião de verdade dentro do módulo de ligação. */
const SLUG_REUNIAO = 'lig_reuniao_marcada';
/** Slug do desfecho cuja data foi combinada ao telefone. */
const SLUG_RETORNA = 'lig_atendeu_retorna';

/** `true` quando o desfecho (ou o pedido de opt-out) precisa da folha antes de gravar. */
export function precisaDeExtras(desfecho: DesfechoDeLigacao, pediuParaNaoLigar: boolean): boolean {
  return (
    desfecho.requires_lost_reason ||
    desfecho.slug === SLUG_REUNIAO ||
    desfecho.slug === SLUG_RETORNA ||
    pediuParaNaoLigar
  );
}

export function ChamadaExtras({
  desfecho,
  pediuParaNaoLigar,
  motivosPerda,
  formatosDaEtapa,
  sugestaoDeData,
  aoConfirmar,
  aoCancelar,
}: {
  desfecho: DesfechoDeLigacao | null;
  pediuParaNaoLigar: boolean;
  motivosPerda: readonly MotivoPerda[];
  formatosDaEtapa: readonly string[];
  /** A data que ela já combinou dentro do roteiro, quando combinou. */
  sugestaoDeData: string | null;
  aoConfirmar: (extras: ExtrasDaChamada) => void;
  aoCancelar: () => void;
}) {
  const ehCelular = useEhCelular();

  return (
    <Sheet
      open={desfecho !== null}
      onOpenChange={(aberta) => {
        if (!aberta) aoCancelar();
      }}
    >
      <SheetContent
        side={ehCelular ? 'bottom' : 'right'}
        className="sombra-base-forte max-h-[92dvh] overflow-y-auto pb-[calc(1rem+var(--area-segura-inferior))] max-md:rounded-t-xl sm:max-w-md md:max-h-none"
      >
        {/* A folha é REMONTADA a cada desfecho (`key`), e é assim que os campos
            nascem preenchidos com a data combinada no roteiro sem um efeito que
            reescreve estado depois da renderização. */}
        {desfecho ? (
          <Formulario
            key={desfecho.id}
            desfecho={desfecho}
            pediuParaNaoLigar={pediuParaNaoLigar}
            motivosPerda={motivosPerda}
            formatosDaEtapa={formatosDaEtapa}
            sugestaoDeData={sugestaoDeData}
            aoConfirmar={aoConfirmar}
          />
        ) : (
          <SheetHeader>
            <SheetTitle>Falta um dado</SheetTitle>
            <SheetDescription>Escolha o resultado da ligação.</SheetDescription>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Formulario({
  desfecho,
  pediuParaNaoLigar,
  motivosPerda,
  formatosDaEtapa,
  sugestaoDeData,
  aoConfirmar,
}: {
  desfecho: DesfechoDeLigacao;
  pediuParaNaoLigar: boolean;
  motivosPerda: readonly MotivoPerda[];
  formatosDaEtapa: readonly string[];
  sugestaoDeData: string | null;
  aoConfirmar: (extras: ExtrasDaChamada) => void;
}) {
  const id = useId();

  const pedeMotivo = desfecho.requires_lost_reason ?? false;
  const pedeReuniao = desfecho.slug === SLUG_REUNIAO;
  const pedeRetorno = desfecho.slug === SLUG_RETORNA;

  // A data combinada no roteiro entra sozinha na folha: ela já foi dita ao telefone,
  // e digitá-la de novo seria pedir duas vezes a mesma informação.
  const [valores, setValores] = useState<ExtrasDaChamada>(() => ({
    ...EXTRAS_DA_CHAMADA_VAZIOS,
    reuniaoEm: pedeReuniao ? sugestaoDeData : null,
    agendarPara: pedeRetorno ? sugestaoDeData : null,
  }));
  const [erro, setErro] = useState<string | null>(null);

  function confirmar() {
    if (pedeMotivo && valores.lostReasonId === null) {
      setErro('Escolha o motivo da perda.');
      return;
    }
    if (pedeReuniao && (!valores.reuniaoEm || !valores.reuniaoFormato)) {
      setErro('Reunião marcada precisa de data, hora e formato.');
      return;
    }
    if (pedeRetorno && !valores.agendarPara) {
      setErro('Diga o dia e a hora que ele combinou.');
      return;
    }
    if (pediuParaNaoLigar && !valores.confirmouOptout) {
      setErro('Confirme: este contato não volta para nenhuma fila.');
      return;
    }
    setErro(null);
    aoConfirmar(valores);
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>{desfecho.name}</SheetTitle>
        <SheetDescription>
          {pediuParaNaoLigar
            ? 'Isto não tem volta.'
            : pedeReuniao
              ? 'Uma reunião sem data não é uma reunião.'
              : pedeMotivo
                ? 'Perda exige motivo da lista fechada.'
                : 'A data foi combinada com ele, não é para eu inventar.'}
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-col gap-4 px-4 pb-4">
        {pedeReuniao ? (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-reuniao`}>Quando é a reunião</Label>
              <Input
                id={`${id}-reuniao`}
                type="datetime-local"
                className="numerico h-11"
                value={paraInputLocal(valores.reuniaoEm)}
                onChange={(e) =>
                  setValores((v) => ({ ...v, reuniaoEm: doInputLocal(e.target.value) }))
                }
              />
              <PorExtenso iso={valores.reuniaoEm} />
            </div>
            <fieldset className="flex flex-wrap gap-2">
              <legend className="mb-1.5 text-sm font-medium">Formato</legend>
              {formatosDaEtapa.map((formato) => (
                <button
                  key={formato}
                  type="button"
                  aria-pressed={valores.reuniaoFormato === formato}
                  onClick={() => setValores((v) => ({ ...v, reuniaoFormato: formato }))}
                  className={cn(
                    'toque inline-flex h-11 items-center rounded-lg border px-3.5 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                    valores.reuniaoFormato === formato
                      ? 'border-input bg-muted font-medium'
                      : 'border-hairline text-muted-foreground',
                  )}
                >
                  {FORMATOS_REUNIAO[formato] ?? formato}
                </button>
              ))}
            </fieldset>
          </>
        ) : null}

        {pedeRetorno ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-retorno`}>
              {desfecho.next_action_label ?? 'Quando ligar de novo'}
            </Label>
            <Input
              id={`${id}-retorno`}
              type="datetime-local"
              className="numerico h-11"
              value={paraInputLocal(valores.agendarPara)}
              onChange={(e) =>
                setValores((v) => ({ ...v, agendarPara: doInputLocal(e.target.value) }))
              }
            />
            <PorExtenso iso={valores.agendarPara} />
          </div>
        ) : null}

        {pedeMotivo ? (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-sm font-medium">Motivo da perda</legend>
            {motivosPerda.map((motivo) => (
              <button
                key={motivo.id}
                type="button"
                aria-pressed={valores.lostReasonId === motivo.id}
                onClick={() => setValores((v) => ({ ...v, lostReasonId: motivo.id }))}
                className={cn(
                  'toque flex min-h-11 items-center rounded-lg border px-3 text-left text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                  valores.lostReasonId === motivo.id
                    ? 'border-input bg-muted font-medium'
                    : 'border-hairline text-muted-foreground',
                )}
              >
                {motivo.name}
              </button>
            ))}
          </fieldset>
        ) : null}

        {pediuParaNaoLigar ? (
          <button
            type="button"
            aria-pressed={valores.confirmouOptout}
            onClick={() => setValores((v) => ({ ...v, confirmouOptout: !v.confirmouOptout }))}
            className={cn(
              'toque flex items-start gap-3 rounded-lg border px-3 py-3 text-left text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              valores.confirmouOptout
                ? 'border-input bg-muted'
                : 'border-hairline text-muted-foreground',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border',
                valores.confirmouOptout ? 'border-foreground bg-foreground' : 'border-input',
              )}
            >
              {valores.confirmouOptout ? (
                <Check className="size-3.5 text-background" aria-hidden="true" />
              ) : null}
            </span>
            <span>
              Entendi: o número entra na lista de supressão e ninguém mais liga nem manda mensagem
              para ele, em nenhum modo.
            </span>
          </button>
        ) : null}

        {erro ? <p className="text-sm text-destructive-texto">{erro}</p> : null}

        <Button type="button" className="h-12 w-full text-base" onClick={confirmar}>
          Registrar
        </Button>
      </div>
    </>
  );
}

/**
 * A data escolhida, escrita por extenso. O `<input type="datetime-local">` desenha o
 * formato do idioma do navegador: num aparelho em inglês "10/09/2026" quer dizer 9 de
 * outubro, e reunião marcada no dia errado é o pior defeito possível desta tela.
 */
function PorExtenso({ iso }: { iso: string | null }) {
  const texto = formatarQuandoPorExtenso(iso);
  if (!texto) return null;
  return <p className="text-xs text-muted-foreground">{texto}</p>;
}
