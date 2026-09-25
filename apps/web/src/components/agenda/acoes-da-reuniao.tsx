'use client';

import { useState } from 'react';
import { CalendarClock, CircleCheck, Loader2, MailWarning, Video, X } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useEhCelular } from '@/components/parceiros/usar-eh-celular';

import {
  cancelarReuniao,
  confirmarReuniao,
  faixaDoHorario,
  livresDoDia,
  recadoDoMotivo,
  remarcarReuniao,
  type HorarioLivre,
} from './acoes-reuniao';
import { diaDoInstante, type Compromisso } from './tipos';

/**
 * As ações de uma reunião de verdade — as que só existem quando o compromisso
 * tem linha em `public.reunioes` (ADR-15).
 *
 * O botão do Google Agenda que ficava aqui saiu com o calendário. No lugar:
 *
 *  · **Entrar na sala**, com o link CONGELADO na reunião (trocar a sala em
 *    Ajustes não retroage, e é assim de propósito: a sala que o parceiro
 *    recebeu por WhatsApp é a que vale);
 *  · **Confirmar o horário**, enquanto a rampa está ligada. A frase diz o
 *    porquê, porque um botão "confirmar" sem motivo é um botão que ninguém
 *    aperta: o fornecedor ainda NÃO sabe o horário;
 *  · **Remarcar**, que abre a folha com os livres da MESMA grade do robô;
 *  · **Cancelar**, com confirmação.
 *
 * Mais dois sinais que não são enfeite: o selo "marcada pelo robô", que é o que
 * permite ler a amostragem das primeiras semanas sem abrir cada conversa, e o
 * aviso de que o time não foi avisado por e-mail — fila silenciosa também é
 * falha silenciosa.
 */

/** Dez minutos de folga antes de acusar o e-mail: a fila roda por volta do laço. */
const FOLGA_DO_AVISO_MS = 10 * 60 * 1000;

export function avisoNaoSaiu(compromisso: Compromisso, agora: number = Date.now()): boolean {
  if (!compromisso.reuniaoId || compromisso.avisoEnviadoEm) return false;
  if (compromisso.estado === 'cancelada' || compromisso.estado === 'remarcada') return false;
  // A folga existe para o cartão não acusar o e-mail no minuto em que a reunião
  // foi criada: a fila roda por volta do laço do worker-wa, não na hora.
  const nasceu = compromisso.reuniaoCriadaEm ? Date.parse(compromisso.reuniaoCriadaEm) : NaN;
  if (Number.isNaN(nasceu)) return true;
  return agora - nasceu > FOLGA_DO_AVISO_MS;
}

export function AcoesDaReuniao({
  compromisso,
  aoMudar,
}: {
  compromisso: Compromisso;
  aoMudar: () => void;
}) {
  const ehCelular = useEhCelular();
  const [trabalhando, setTrabalhando] = useState(false);
  const [folhaAberta, setFolhaAberta] = useState(false);
  const [livres, setLivres] = useState<HorarioLivre[] | null>(null);

  const reuniaoId = compromisso.reuniaoId;
  if (!reuniaoId) return null;

  const precisaConfirmar = compromisso.estado === 'a_confirmar';
  const viva =
    compromisso.estado === 'a_confirmar' ||
    compromisso.estado === 'marcada' ||
    compromisso.estado === 'confirmada';

  async function comRecado(
    acao: () => Promise<{ ok: true } | { ok: false; motivo: string }>,
    certo: string,
  ) {
    setTrabalhando(true);
    const r = await acao();
    setTrabalhando(false);
    if (r.ok) {
      toast.success(certo);
      aoMudar();
    } else {
      toast.error(recadoDoMotivo(r.motivo));
    }
  }

  async function abrirFolha() {
    setFolhaAberta(true);
    setLivres(null);
    setLivres(await livresDoDia(diaDoInstante(compromisso.quando)));
  }

  return (
    <>
      {compromisso.marcadaPeloRobo ? (
        <Badge variant="pilula" className="font-normal text-muted-foreground">
          marcada pelo robô
        </Badge>
      ) : null}

      {/* O link só existe quando o formato é on-line: `reunioes_lugar_chk`
          garante sala para on-line e endereço para presencial, e nunca os dois. */}
      {compromisso.link ? (
        <Button asChild variant="outline" size="lg" className="toque h-11 md:h-9">
          <a href={compromisso.link} target="_blank" rel="noopener noreferrer">
            <Video aria-hidden="true" />
            Entrar na sala
          </a>
        </Button>
      ) : null}

      {viva ? (
        <>
          <Button
            variant="outline"
            size="lg"
            className="toque h-11 md:h-9"
            disabled={trabalhando}
            onClick={() => void abrirFolha()}
          >
            <CalendarClock aria-hidden="true" />
            Remarcar
          </Button>

          <Button
            variant="outline"
            size="lg"
            className="toque h-11 md:h-9"
            disabled={trabalhando}
            onClick={() => {
              if (!window.confirm('Cancelar esta reunião? O time é avisado por e-mail.')) return;
              void comRecado(() => cancelarReuniao(reuniaoId), 'Reunião cancelada.');
            }}
          >
            <X aria-hidden="true" />
            Cancelar
          </Button>
        </>
      ) : null}

      {precisaConfirmar ? (
        <div className="basis-full">
          <Button
            size="lg"
            className="toque h-11 md:h-9"
            disabled={trabalhando}
            onClick={() =>
              void comRecado(() => confirmarReuniao(reuniaoId), 'Horário confirmado.')
            }
          >
            {trabalhando ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <CircleCheck aria-hidden="true" />
            )}
            Confirmar o horário
          </Button>
          <p className="pt-1 text-xs text-muted-foreground">
            O fornecedor ainda não sabe o horário; confirme para o robô poder dizer.
          </p>
        </div>
      ) : null}

      {avisoNaoSaiu(compromisso) ? (
        <p className="flex basis-full items-start gap-1.5 text-xs text-muted-foreground">
          <MailWarning className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />O time não foi
          avisado por e-mail.
        </p>
      ) : null}

      <Sheet open={folhaAberta} onOpenChange={(aberta) => !trabalhando && setFolhaAberta(aberta)}>
        <SheetContent
          side={ehCelular ? 'bottom' : 'right'}
          className="sombra-base-forte max-h-[92dvh] overflow-y-auto pb-[calc(1rem+var(--area-segura-inferior))] max-md:rounded-t-xl sm:max-w-md md:max-h-none"
        >
          <SheetHeader>
            <SheetTitle>Remarcar</SheetTitle>
            <SheetDescription>
              {compromisso.organizacao} · os horários livres deste dia, na mesma grade que o robô
              usa
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-2 px-4 pb-4">
            {livres === null ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                <Loader2 className="inline size-4 animate-spin" aria-hidden="true" /> Procurando
                horários…
              </p>
            ) : livres.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nenhum horário livre neste dia. Cancele e marque em outro.
              </p>
            ) : (
              livres.map((h) => (
                <Button
                  key={h.inicio}
                  variant="outline"
                  size="lg"
                  className="toque h-11 justify-start md:h-9"
                  disabled={trabalhando}
                  onClick={() =>
                    void comRecado(async () => {
                      const r = await remarcarReuniao(reuniaoId, h.inicio);
                      if (r.ok) setFolhaAberta(false);
                      return r;
                    }, 'Reunião remarcada. O time é avisado por e-mail.')
                  }
                >
                  <span className="numerico">{faixaDoHorario(h)}</span>
                </Button>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
