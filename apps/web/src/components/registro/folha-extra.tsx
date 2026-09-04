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

import { doInputLocal, formatarQuandoPorExtenso, paraInputLocal } from './formatos';
import {
  extraDoDesfecho,
  FORMATOS_REUNIAO,
  pedeDataDaProximaAcao,
  type DesfechoCatalogo,
  type MotivoPerda,
} from './tipos';

/**
 * O ÚNICO ramo do fluxo: o campo que falta, quando falta.
 *
 * São 12 dos 34 desfechos, e cada um por um motivo que não é burocracia:
 *
 * - os 6 com `requires_lost_reason` pedem o motivo, porque `app.deals_before_write` e
 *   o `move_deal` recusam a perda sem ele (RF-FUN-04) e porque o relatório de motivos
 *   de perda nasce furado se essa lista for opcional;
 * - `lig_reuniao_marcada` e `reu_reagendada` pedem data e formato, que é o
 *   `required_fields` da etapa `reuniao_marcada` — reunião sem data não é reunião;
 * - `reu_autorizou` pede a frase literal da autorização, porque o pré-cadastro na
 *   Komune só pode acontecer depois de `consent_events` (guardrail do CLAUDE.md);
 * - `wa_optout` e `dm_optout` pedem confirmação, porque não têm volta (RF-CON-18);
 * - `lig_atendeu_retorna` pede a data combinada, porque o mundo já a decidiu e
 *   inventar uma seria mentir para a agenda dela.
 *
 * Os outros 22 nunca veem esta folha: vão do toque no desfecho direto para o recibo.
 */
export type ValoresExtras = {
  lostReasonId: number | null;
  reuniaoEm: string | null;
  reuniaoFormato: string | null;
  autorizacaoEvidencia: string | null;
  confirmouOptout: boolean;
  /** Data combinada da próxima ação, quando é o desfecho que a exige. */
  proximaAcaoEm: string | null;
};

export const EXTRAS_VAZIOS: ValoresExtras = {
  lostReasonId: null,
  reuniaoEm: null,
  reuniaoFormato: null,
  autorizacaoEvidencia: null,
  confirmouOptout: false,
  proximaAcaoEm: null,
};

/** `true` quando o desfecho precisa da folha antes de gravar. */
export function precisaDeExtra(desfecho: DesfechoCatalogo): boolean {
  return extraDoDesfecho(desfecho) !== null || pedeDataDaProximaAcao(desfecho);
}

export function FolhaExtra({
  desfecho,
  motivosPerda,
  formatosDaEtapa,
  aoConfirmar,
  aoCancelar,
}: {
  desfecho: DesfechoCatalogo | null;
  motivosPerda: readonly MotivoPerda[];
  /** Opções aceitas pela etapa `reuniao_marcada` do funil deste negócio. */
  formatosDaEtapa: readonly string[];
  aoConfirmar: (valores: ValoresExtras) => void;
  aoCancelar: () => void;
}) {
  const ehCelular = useEhCelular();
  const idFormulario = useId();
  const [valores, setValores] = useState<ValoresExtras>(EXTRAS_VAZIOS);
  const [erro, setErro] = useState<string | null>(null);

  const tipo = desfecho ? extraDoDesfecho(desfecho) : null;
  const pedeData = desfecho ? pedeDataDaProximaAcao(desfecho) && tipo !== 'reuniao' : false;

  function confirmar() {
    if (!desfecho) return;
    if (tipo === 'motivo_perda' && valores.lostReasonId === null) {
      setErro('Escolha o motivo da perda.');
      return;
    }
    if (tipo === 'reuniao' && (!valores.reuniaoEm || !valores.reuniaoFormato)) {
      setErro('Reunião marcada precisa de data, hora e formato.');
      return;
    }
    if (tipo === 'autorizacao' && (valores.autorizacaoEvidencia ?? '').trim().length < 10) {
      setErro('Escreva o que ele autorizou, com as palavras dele.');
      return;
    }
    if (tipo === 'confirmar_optout' && !valores.confirmouOptout) {
      setErro('Confirme: este contato não volta para nenhuma fila.');
      return;
    }
    if (pedeData && !valores.proximaAcaoEm) {
      setErro('Diga o dia e a hora combinados.');
      return;
    }
    setErro(null);
    aoConfirmar(valores);
    setValores(EXTRAS_VAZIOS);
  }

  return (
    <Sheet
      open={desfecho !== null}
      onOpenChange={(aberta) => {
        if (!aberta) {
          setValores(EXTRAS_VAZIOS);
          setErro(null);
          aoCancelar();
        }
      }}
    >
      <SheetContent
        side={ehCelular ? 'bottom' : 'right'}
        className="sombra-base-forte max-h-[92dvh] overflow-y-auto pb-[calc(1rem+var(--area-segura-inferior))] max-md:rounded-t-xl sm:max-w-md md:max-h-none"
      >
        <SheetHeader>
          <SheetTitle>{desfecho?.name ?? 'Falta um dado'}</SheetTitle>
          <SheetDescription>{descricaoDoExtra(tipo, pedeData)}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-4">
          {tipo === 'motivo_perda' ? (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="sr-only">Motivo da perda</legend>
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

          {tipo === 'reuniao' ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${idFormulario}-quando`}>Quando é a reunião</Label>
                <Input
                  id={`${idFormulario}-quando`}
                  type="datetime-local"
                  className="h-11"
                  value={paraInputLocal(valores.reuniaoEm)}
                  onChange={(e) =>
                    setValores((v) => ({ ...v, reuniaoEm: doInputLocal(e.target.value) }))
                  }
                />
                <ConfirmacaoDaData iso={valores.reuniaoEm} />
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

          {tipo === 'autorizacao' ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${idFormulario}-autorizacao`}>O que ele autorizou</Label>
              <textarea
                id={`${idFormulario}-autorizacao`}
                rows={3}
                value={valores.autorizacaoEvidencia ?? ''}
                onChange={(e) =>
                  setValores((v) => ({ ...v, autorizacaoEvidencia: e.target.value }))
                }
                placeholder="Pode cadastrar meu buffet na Komune, mando as fotos amanhã."
                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Com as palavras dele. É essa frase que vira a autorização registrada, e sem ela o
                pré-cadastro na Komune não pode acontecer.
              </p>
            </div>
          ) : null}

          {/* Botão com `aria-pressed`, e não `<input type="checkbox">`: a caixa nativa
              não aceita a cor do sistema e some sobre a base escura do Ocean Breeze,
              justamente na única confirmação da tela que não tem volta. É o mesmo
              gesto dos chips de motivo e de formato, logo acima. */}
          {tipo === 'confirmar_optout' ? (
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
                Entendi: o número entra na lista de supressão e nenhuma mensagem sai mais para ele,
                em nenhum modo.
              </span>
            </button>
          ) : null}

          {pedeData ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${idFormulario}-retorno`}>
                {desfecho?.next_action_label ?? 'Quando voltar a falar'}
              </Label>
              <Input
                id={`${idFormulario}-retorno`}
                type="datetime-local"
                className="h-11"
                value={paraInputLocal(valores.proximaAcaoEm)}
                onChange={(e) =>
                  setValores((v) => ({ ...v, proximaAcaoEm: doInputLocal(e.target.value) }))
                }
              />
              <ConfirmacaoDaData iso={valores.proximaAcaoEm} />
            </div>
          ) : null}

          {erro ? <p className="text-sm text-destructive-texto">{erro}</p> : null}

          <Button type="button" className="h-12 w-full text-base" onClick={confirmar}>
            Registrar
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function descricaoDoExtra(tipo: ReturnType<typeof extraDoDesfecho>, pedeData: boolean): string {
  if (tipo === 'motivo_perda') return 'Perda exige motivo da lista fechada.';
  if (tipo === 'reuniao') return 'Uma reunião sem data não é uma reunião.';
  if (tipo === 'autorizacao') return 'A frase dele, para valer como autorização.';
  if (tipo === 'confirmar_optout') return 'Isto não tem volta.';
  if (pedeData) return 'A data foi combinada com ele, não é para eu inventar.';
  return 'Falta um dado.';
}

/**
 * A data escolhida, escrita por extenso.
 *
 * O `<input type="datetime-local">` é controle NATIVO: o formato que ele desenha vem
 * do idioma do navegador, não do `lang` da página, e num aparelho em inglês
 * "10/09/2026" quer dizer 9 de outubro. Reunião marcada no dia errado é o pior
 * defeito possível desta tela, então a data confirmada aparece por extenso, em pt-BR
 * e no fuso de Fortaleza, embaixo do campo.
 */
function ConfirmacaoDaData({ iso }: { iso: string | null }) {
  const porExtenso = formatarQuandoPorExtenso(iso);
  if (!porExtenso) return null;
  return <p className="text-xs text-muted-foreground">{porExtenso}</p>;
}
