import { Hourglass, MessageSquareDashed, Radio } from 'lucide-react';

import { cn } from '@/lib/utils';

import { dataHoraCompleta } from './formatos';
import type { DependenciasDaMeta } from './tipos';

/**
 * O que ainda falta para o WhatsApp funcionar inteiro dentro do CRM, dito na
 * própria tela — e MEDIDO.
 *
 * ===========================================================================
 * POR QUE O TEXTO MUDOU (DE NOVO)
 * ===========================================================================
 * Este aviso já mudou três vezes, e toda vez pelo mesmo motivo: a frase fixa
 * envelhece calada. A última dizia que o número "Heloísa · Komune" esperava a
 * verificação do CNPJ e que o jeito de falar agora era o celular dela com o eco
 * do Coexistence. Em 14/09/2026 a decisão mudou — o número fica SÓ na Cloud
 * API, e o CRM é o único lugar de onde a mensagem sai (migração
 * 20260914100000) —, e a frase virou mentira no mesmo dia.
 *
 * Por isso ele não afirma: ele CONTA. São três peças, as três lidas do banco,
 * e cada uma que falta vira uma frase:
 *   1. o número conectado (`whatsapp.envio.numero_padrao`);
 *   2. o envio rodando (o ponto que o worker-wa bate em `worker_heartbeats`);
 *   3. pelo menos um modelo aprovado pela Meta — sem ele dá para responder quem
 *      escreveu nas últimas 24 h, mas não para começar conversa.
 * Com as três de pé, o aviso sai da tela. Modelo recusado pela Meta não segura o
 * aviso para sempre: o que importa para quem usa é haver modelo para mandar.
 *
 * Sem cor cromática: a escala térmica é a única cromia da interface, e um aviso
 * não tem temperatura.
 */
export function AvisoWhatsapp({
  meta,
  compacto = false,
  className,
}: {
  /** Contado no banco; `null` enquanto a leitura não voltou. */
  meta: DependenciasDaMeta | null;
  /** No cabeçalho da conversa o aviso vira uma linha só; na tela vazia ele é inteiro. */
  compacto?: boolean;
  className?: string;
}) {
  if (meta === null) return null;

  const faltas = faltasDoWhatsapp(meta);
  if (faltas.length === 0) return null;

  return (
    <aside
      className={cn(
        'flex gap-3 rounded-xl border border-hairline bg-card/50 px-3 py-2.5',
        className,
      )}
    >
      <MessageSquareDashed
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <div className="min-w-0 space-y-1">
        <p className="text-sm leading-snug font-medium">{tituloDoAviso(meta)}</p>

        {compacto ? (
          <p className="text-xs leading-relaxed text-muted-foreground">{faltas[0]}</p>
        ) : (
          <ul className="space-y-0.5 text-xs leading-relaxed text-muted-foreground">
            {faltas.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}

        <Contagem meta={meta} />
      </div>
    </aside>
  );
}

/** As frases do que falta, na ordem em que destravam. */
export function faltasDoWhatsapp(meta: DependenciasDaMeta): string[] {
  const faltas: string[] = [];
  if (!meta.numeroConfigurado) {
    faltas.push(
      'O número de WhatsApp da KOMUNE ainda não foi conectado ao CRM. Enquanto isso, nada sai e nada chega por aqui.',
    );
  }
  if (meta.worker.estado !== 'ok') {
    faltas.push(
      meta.naFila > 0
        ? 'O envio está parado: o que você mandar fica na fila e sai quando ele voltar.'
        : 'O envio está parado: mensagem nova fica na fila e sai quando ele voltar.',
    );
  }
  if (meta.modelosAprovados === 0) {
    faltas.push(
      'A Meta ainda não aprovou nenhum modelo de mensagem: dá para responder quem escreveu nas últimas 24 h, mas não para começar conversa.',
    );
  }
  return faltas;
}

function tituloDoAviso(meta: DependenciasDaMeta): string {
  if (!meta.numeroConfigurado) return 'O WhatsApp ainda não está ligado ao CRM.';
  if (meta.worker.estado !== 'ok') return 'As mensagens não estão saindo agora.';
  return 'Ainda não dá para começar conversa por aqui.';
}

/** As contas que dizem, sem adjetivo, de quanto é a espera. */
function Contagem({ meta }: { meta: DependenciasDaMeta }) {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      <span>
        <span className="numerico">{meta.modelosAprovados}</span> de{' '}
        <span className="numerico">{meta.modelosAprovados + meta.modelosAguardando}</span> modelos
        aprovados pela Meta
      </span>
      <span aria-hidden="true">·</span>
      <span>{meta.numeroConfigurado ? 'número conectado' : 'nenhum número conectado'}</span>
      <span aria-hidden="true">·</span>
      <Worker worker={meta.worker} />
      {meta.naFila > 0 ? (
        <>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1 text-foreground">
            <Hourglass className="size-3" aria-hidden="true" />
            <span className="numerico">{meta.naFila}</span>
            {meta.naFila === 1 ? ' mensagem esperando' : ' mensagens esperando'}
          </span>
        </>
      ) : null}
    </p>
  );
}

/** O sinal de vida do worker que entrega. */
function Worker({ worker }: { worker: DependenciasDaMeta['worker'] }) {
  const texto =
    worker.estado === 'ok'
      ? 'envio rodando'
      : worker.estado === 'nunca'
        ? 'envio nunca ligado'
        : worker.estado === 'degradado'
          ? 'envio com falhas'
          : 'envio parado';

  return (
    <span
      className="inline-flex items-center gap-1"
      title={
        worker.ultimaBatidaEm
          ? `Última batida de ponto em ${dataHoraCompleta(worker.ultimaBatidaEm)}`
          : undefined
      }
    >
      <Radio className="size-3" aria-hidden="true" />
      {texto}
    </span>
  );
}
