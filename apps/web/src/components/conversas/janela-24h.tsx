'use client';

import { useEffect, useState } from 'react';
import { Clock, LockKeyhole, MessageSquareOff, Unlock } from 'lucide-react';

import { cn } from '@/lib/utils';

import { dataHoraCompleta } from './formatos';
import { duracaoLonga, estadoDaJanela, JANELA_APERTADA_MIN, tempoCurto } from './mensagens';
import type { EstadoDaJanela } from './tipos';

/**
 * O relógio da janela de 24 h da Meta (R04 §2.1) — a regra que decide, sozinha,
 * o que pode sair desta conversa.
 *
 * ===========================================================================
 * POR QUE ELE É GRANDE, E POR QUE ELE ANDA
 * ===========================================================================
 * Dentro da janela, texto e áudio são livres e GRATUITOS. Fora dela, só modelo
 * aprovado atravessa, custa dinheiro (marketing ≈ US$ 0,0625) e — no nosso caso
 * — nem existe, porque a Meta ainda não aprovou nenhum. A diferença entre um
 * lado e o outro não é um detalhe de custo: é a diferença entre poder responder
 * a pessoa e não poder.
 *
 * Quem decide isso é a Heloísa, no ônibus, com o celular na mão. Então o relógio
 * fica em cima da caixa de resposta, escrito em português, e ANDA: um "faltam 40
 * minutos" congelado na hora do carregamento é pior que nenhum, porque parece
 * atual. Ele se recalcula a cada 30 s — nunca a cada segundo, que faria a tela
 * repintar sem que ninguém precisasse.
 *
 * A hora vem do banco: `window_expires_at` é derivada de `last_inbound_at` pelo
 * gatilho, e ninguém escreve nela. Esta tela não tem opinião sobre quando a
 * janela fecha; ela só conta o que falta.
 */

/** De quanto em quanto a contagem se refaz. Meio minuto: o relógio da Meta é grosso. */
const PASSO_MS = 30_000;

/** Recalcula o estado da janela enquanto a conversa está aberta. */
export function useJanela(janelaExpiraEm: string | null): EstadoDaJanela {
  const [agora, setAgora] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setAgora(new Date()), PASSO_MS);
    return () => clearInterval(timer);
  }, []);

  return estadoDaJanela(janelaExpiraEm, agora);
}

/**
 * A barra inteira, acima da caixa de resposta.
 *
 * Três estados e três frases diferentes, porque as três pedem coisas diferentes
 * de quem lê: aberta = escreva agora; fechada = só modelo, e não temos nenhum
 * aprovado; nunca = não existe janela, alguém precisa começar a conversa.
 */
export function Janela24h({ estado, className }: { estado: EstadoDaJanela; className?: string }) {
  const apertada = estado.situacao === 'aberta' && estado.restanteMin <= JANELA_APERTADA_MIN;

  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-xl border px-3 py-2.5',
        estado.situacao === 'aberta'
          ? 'border-hairline bg-card/60'
          : 'border-dashed border-hairline bg-muted/40',
        className,
      )}
    >
      <Icone estado={estado} apertada={apertada} />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm leading-snug font-medium">
          <Titulo estado={estado} />
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          <Explicacao estado={estado} />
        </p>
      </div>
    </div>
  );
}

function Icone({ estado, apertada }: { estado: EstadoDaJanela; apertada: boolean }) {
  const classe = cn('mt-0.5 size-4 shrink-0', apertada ? 'text-foreground' : 'text-muted-foreground');
  if (estado.situacao === 'aberta') {
    return apertada ? (
      <Clock className={classe} aria-hidden="true" />
    ) : (
      <Unlock className={classe} aria-hidden="true" />
    );
  }
  if (estado.situacao === 'fechada') return <LockKeyhole className={classe} aria-hidden="true" />;
  return <MessageSquareOff className={classe} aria-hidden="true" />;
}

function Titulo({ estado }: { estado: EstadoDaJanela }) {
  if (estado.situacao === 'nunca') return <>Nunca escreveram para a gente</>;

  if (estado.situacao === 'aberta') {
    return (
      <>
        <span>Janela aberta</span>
        <span className="text-xs font-normal text-muted-foreground">
          fecha em <Tempo minutos={estado.restanteMin} />
          <span className="hidden sm:inline">
            , às{' '}
            <span className="numerico">{dataHoraCompleta(estado.expiraEm).split(', ')[1]}</span>
          </span>
        </span>
      </>
    );
  }

  return (
    <>
      <span>Janela fechada</span>
      <span className="text-xs font-normal text-muted-foreground">
        faz <Tempo minutos={estado.fechadaHaMin} />
      </span>
    </>
  );
}

function Explicacao({ estado }: { estado: EstadoDaJanela }) {
  if (estado.situacao === 'aberta') {
    return (
      <>
        Dá para responder livremente, com texto ou áudio, e não custa nada. Vale{' '}
        <span className="numerico">24</span> h a contar da última mensagem que o parceiro
        mandou.
      </>
    );
  }
  if (estado.situacao === 'fechada') {
    return (
      <>
        Fora da janela, a Meta só deixa passar modelo aprovado — e nenhum dos nossos foi
        aprovado ainda. Texto livre daqui não sai. Ligar continua valendo.
      </>
    );
  }
  return (
    <>
      A janela de <span className="numerico">24</span> h só existe depois que a pessoa
      escreve. Enquanto ela não escrever, o caminho é a ligação ou o primeiro contato pelo
      celular da Heloísa.
    </>
  );
}

/** "3 horas 12 min", com cada dígito na mono e cada palavra fora dela. */
function Tempo({ minutos }: { minutos: number }) {
  return (
    <>
      {duracaoLonga(minutos).map((parte, i) => (
        <span key={i}>
          {i > 0 ? ' ' : ''}
          <span className="numerico">{parte.numero}</span>
          {parte.unidade}
        </span>
      ))}
    </>
  );
}

/**
 * A versão de uma linha, para a linha da lista da esquerda.
 *
 * Só aparece quando a janela está ABERTA: é a informação acionável ("dá para
 * responder agora, e o relógio está correndo"). "Fechada" numa lista de cem
 * parceiros seria ruído — é o estado de quase todo mundo, quase sempre.
 */
export function ChipDaJanela({ estado }: { estado: EstadoDaJanela }) {
  if (estado.situacao !== 'aberta') return null;
  const apertada = estado.restanteMin <= JANELA_APERTADA_MIN;
  const resta = tempoCurto(estado.restanteMin);

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border border-hairline px-1.5 text-[10px]',
        apertada ? 'text-foreground' : 'text-muted-foreground',
      )}
      title={`Janela de 24 h aberta até ${dataHoraCompleta(estado.expiraEm)}`}
    >
      <Clock className="size-2.5" aria-hidden="true" />
      janela <span className="numerico">{resta.numero}</span>
      {resta.unidade}
    </span>
  );
}
