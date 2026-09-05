import { Hourglass, MessageSquareDashed, Radio } from 'lucide-react';

import { cn } from '@/lib/utils';

import { dataHoraCompleta } from './formatos';
import type { DependenciasDaMeta } from './tipos';

/**
 * O que ainda falta para uma mensagem SAIR daqui, dito na própria tela — e
 * MEDIDO.
 *
 * ===========================================================================
 * POR QUE O TEXTO MUDOU DUAS VEZES
 * ===========================================================================
 * Até a migração 20260905000200 o aviso dizia "as mensagens de WhatsApp ainda
 * não chegam aqui": era verdade, não havia tabela. Depois passou a ser "entram,
 * mas não saem, porque o worker é um esqueleto" — e no mesmo dia o worker foi
 * escrito, com a Cloud API oficial e tudo. As duas frases teriam continuado na
 * tela sem ninguém mexer numa linha. É assim que um aviso honesto apodrece: ele
 * envelhece calado.
 *
 * O que sobrou de verdadeiro é mais curto e não é software: falta a CREDENCIAL.
 * O número "Heloísa · Komune" espera a verificação do CNPJ da Komune no Meta
 * Business, o token da Meta não está (nem deve estar) neste repositório, e
 * nenhum modelo foi aprovado (RF-CON-02).
 *
 * ===========================================================================
 * POR QUE ELE CONTA EM VEZ DE AFIRMAR
 * ===========================================================================
 * Os números vêm do banco (`DependenciasDaMeta`), e o último deles não é
 * configuração: é o ponto que o worker-wa bate em `worker_heartbeats`. Um
 * worker parado explica uma fila que não anda melhor do que qualquer parágrafo,
 * e explica sozinho — no dia em que ele subir, esta caixa muda de texto sem
 * ninguém editar nada; no dia em que a Meta aprovar tudo, ela some.
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
  // Tudo pronto do lado de fora: o aviso não tem mais o que avisar e sai da
  // tela. É a única coisa que um aviso honesto pode fazer quando deixa de ser
  // verdade.
  const pronto =
    meta !== null &&
    meta.numeroConfigurado &&
    meta.modelosAguardando === 0 &&
    meta.worker.estado === 'ok';
  if (pronto) return null;

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
        <p className="text-sm leading-snug font-medium">
          As mensagens entram aqui, mas ainda não saem daqui.
        </p>

        {compacto ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            O número <span className="text-foreground">Heloísa &middot; Komune</span> espera a
            verificação do CNPJ no Meta Business. O que você aprovar fica na fila e sai quando o
            número existir.
          </p>
        ) : (
          <p className="text-xs leading-relaxed text-muted-foreground">
            O que falta não é software: é credencial. O número{' '}
            <span className="text-foreground">Heloísa &middot; Komune</span> depende da
            verificação do CNPJ da Komune no Meta Business e da aprovação dos modelos de
            mensagem, que levam semanas e não dependem do CRM. O worker que entrega
            (worker-wa) já existe e fala com a Cloud API oficial; ele só não tem para onde
            mandar. Então: mensagem recebida, rascunho da IA, aprovação e registro já funcionam
            de verdade; o envio espera na fila, e a fila é o que sai no primeiro dia em que a
            Meta liberar.
          </p>
        )}

        {meta ? <Contagem meta={meta} /> : null}
      </div>
    </aside>
  );
}

/** As quatro contas que dizem, sem adjetivo, de quanto é a espera. */
function Contagem({ meta }: { meta: DependenciasDaMeta }) {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      <span>
        <span className="numerico">{meta.modelosAprovados}</span> de{' '}
        <span className="numerico">{meta.modelosAprovados + meta.modelosAguardando}</span> modelos
        aprovados pela Meta
      </span>
      <span aria-hidden="true">·</span>
      <span>{meta.numeroConfigurado ? 'número configurado' : 'nenhum número configurado'}</span>
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
      ? 'worker de envio rodando'
      : worker.estado === 'nunca'
        ? 'worker de envio nunca subiu aqui'
        : worker.estado === 'degradado'
          ? 'worker de envio com falhas'
          : 'worker de envio parado';

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
