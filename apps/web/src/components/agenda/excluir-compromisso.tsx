'use client';

import { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { excluirTarefa, recadoDaExclusao } from '@/components/exclusao/acoes';
import { DialogoExcluir } from '@/components/exclusao/dialogo-excluir';
import { VOCABULARIO } from '@/lib/vocabulario';

import { useAgendaDoLink } from './agenda-do-link';
import { efeitoDeCancelarNoCalendly, recadoDeReuniaoCancelada } from './efeito-no-calendly';
import { diaDoInstante, rotuloDiaPorExtenso, type Compromisso } from './tipos';

/**
 * Excluir da agenda o compromisso que não vai acontecer (07/10/2026).
 *
 * Só a reunião de verdade tinha saída — "Cancelar", em `acoes-da-reuniao.tsx`.
 * A visita e o compromisso sem reunião ficavam na lista para sempre, pedindo um
 * desfecho que não existia: a única forma de tirá-los era registrar um
 * "Não estava" que não era verdade, e que mexia no funil. O Rafael, em 07/10:
 * "como excluir uma agenda?".
 *
 * Este botão é para ESSES — os que não têm linha em `public.reunioes`. A reunião
 * continua saindo pelo "Cancelar" dela, que pede o motivo e avisa o time. (O
 * banco cobre o engano: se a tarefa excluída for o eco de uma reunião de pé,
 * `public.tarefa_excluir` cancela a reunião, e o aviso daqui diz isso.)
 *
 * Excluir NÃO mexe no funil. Se o parceiro desistiu, isso é um desfecho, e se
 * registra pelo caminho de sempre — o diálogo lembra.
 */
export function ExcluirCompromisso({
  compromisso,
  aoMudar,
}: {
  compromisso: Compromisso;
  aoMudar: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const ehVisita = compromisso.tipo === 'visita';
  const oQue = ehVisita ? 'visita' : 'compromisso';
  // O que o cliente marcou pelo link não se "exclui": se cancela, e o Calendly avisa
  // o cliente (`calendly_cancelamentos_pendentes` lê a tarefa cancelada; o
  // `imova-worker-wa` cancela lá em segundos).
  const doCalendly = compromisso.peloCalendly;
  // O que a equipe marcou, na agenda que o link oferece: o horário volta ao Calendly
  // (só na Imova, e só com o espelho ligado; ver `efeito-no-calendly.ts`).
  const noCalendly = efeitoDeCancelarNoCalendly(compromisso, useAgendaDoLink(aberto));

  async function excluir(motivo: string) {
    setOcupado(true);
    const r = await excluirTarefa(compromisso.taskId, motivo);
    setOcupado(false);
    if (!r.ok) {
      toast.error(doCalendly ? 'Não foi cancelado.' : 'Não foi excluído.', {
        description: recadoDaExclusao(r.motivo),
      });
      return;
    }
    setAberto(false);
    toast.success(
      r.eraReuniao
        ? recadoDeReuniaoCancelada()
        : doCalendly
          ? `${ehVisita ? 'Visita cancelada' : 'Compromisso cancelado'}. O Calendly avisa o cliente por e-mail.`
          : ehVisita
            ? 'Visita excluída da agenda.'
            : 'Compromisso excluído da agenda.',
    );
    aoMudar();
  }

  const dia = rotuloDiaPorExtenso(diaDoInstante(compromisso.quando));

  return (
    <>
      <Button
        variant="ghost"
        size="lg"
        className="toque h-11 text-muted-foreground hover:text-destructive-texto md:h-9"
        onClick={() => setAberto(true)}
      >
        {doCalendly ? <X aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
        {doCalendly ? 'Cancelar' : 'Excluir'}
      </Button>

      <DialogoExcluir
        aberto={aberto}
        aoFechar={() => setAberto(false)}
        titulo={
          doCalendly
            ? `Cancelar esta ${oQue}?`
            : ehVisita
              ? 'Excluir esta visita?'
              : 'Excluir este compromisso?'
        }
        descricao={
          doCalendly ? (
            <>
              <p>
                {compromisso.organizacao} · {dia}. A {oQue} sai da agenda, e o Calendly cancela o
                agendamento e avisa o cliente por e-mail: o horário volta a ficar livre no link.
              </p>
              <p>
                O cliente recebe o aviso do Calendly; o motivo fica só no CRM. O funil não muda.
              </p>
            </>
          ) : (
            <>
              <p>
                {compromisso.organizacao} · {dia}.
                {ehVisita
                  ? ' A visita sai da agenda e da rota do dia.'
                  : ' O compromisso sai da agenda.'}
                {noCalendly ? ` ${noCalendly}` : null}
              </p>
              <p>
                O funil não muda. Se o {VOCABULARIO.parceiro} desistiu ou pediu outra data, registre
                o contato em vez de excluir a {oQue}.
              </p>
            </>
          )
        }
        motivo="opcional"
        exemploDeMotivo={
          doCalendly
            ? 'Ex.: o cliente pediu por telefone para desmarcar'
            : `Ex.: marcada por engano, o ${VOCABULARIO.parceiro} é de outra cidade`
        }
        rotuloConfirmar={
          doCalendly
            ? `Cancelar ${oQue}`
            : ehVisita
              ? 'Excluir visita'
              : 'Excluir compromisso'
        }
        ocupado={ocupado}
        aoConfirmar={(motivo) => void excluir(motivo)}
      />
    </>
  );
}
