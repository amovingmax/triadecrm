'use client';

import { CornerDownLeft, DoorOpen, Send } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

import { dataHoraCompleta, duracao, hora, rotuloDoDia } from './formatos';
import { ICONE_TIPO } from './icones';
import { Mensagem } from './mensagem-do-fio';
import { ROTULO_AUTOR, ROTULO_CANAL, ROTULO_TIPO, type DiaDaLinha, type EventoDaLinha } from './tipos';

/**
 * A linha do tempo do parceiro: uma coluna só, do mais antigo ao mais recente.
 *
 * É o formato que vai receber as mensagens do WhatsApp quando o número for aprovado
 * (RF-CON-06): mesma coluna, mesmo separador de dia, mesma hora à direita do rótulo.
 * Por isso ela é cronológica ascendente, como uma conversa, e não a pilha invertida
 * de um histórico de auditoria — quando a mensagem entrar, ela cai no fim, onde o
 * olho já está.
 *
 * As três origens (interação, mudança de etapa e entrada na base) dividem a mesma
 * coluna de propósito: a ligação de terça e a mudança de etapa que ela causou
 * aconteceram no mesmo segundo, e separá-las em abas apagaria essa causa.
 *
 * Sem cor cromática: o desenho e o peso da fonte fazem a hierarquia. Cor nesta
 * interface é temperatura, e um evento passado não tem temperatura.
 */
export function LinhaDoTempo({ dias }: { dias: DiaDaLinha[] }) {
  return (
    <div className="flex flex-col gap-4">
      {dias.map((dia) => (
        <section key={dia.chave} className="flex flex-col gap-3">
          <SeparadorDeDia iso={dia.em} />
          <ol className="flex flex-col">
            {dia.eventos.map((evento) => (
              <Evento key={evento.id} evento={evento} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function SeparadorDeDia({ iso }: { iso: string }) {
  const { palavra, numero, completo } = rotuloDoDia(iso);

  return (
    <div className="flex items-center gap-3">
      <span className="h-px flex-1 bg-hairline" role="presentation" />
      <span className="text-xs text-muted-foreground" title={completo}>
        {palavra}
        {numero ? <span className="numerico">{numero}</span> : null}
      </span>
      <span className="h-px flex-1 bg-hairline" role="presentation" />
    </div>
  );
}

function Evento({ evento }: { evento: EventoDaLinha }) {
  // A mensagem é balão, não linha de registro: ela ocupa a largura do trilho e
  // dispensa o cabeçalho de procedência, porque a própria assinatura do balão já
  // diz quem escreveu, por onde e sob que regra saiu.
  if (evento.genero === 'mensagem' && evento.mensagem) {
    const recebida = evento.mensagem.entrada;
    const Seta = recebida ? CornerDownLeft : Send;
    return (
      <li className="group relative flex gap-3 pb-4 last:pb-0">
        <span
          className="absolute top-8 bottom-0 left-4 w-px -translate-x-1/2 bg-hairline group-last:hidden"
          role="presentation"
        />
        <span
          className={cn(
            'relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border border-hairline text-muted-foreground',
            recebida ? 'bg-muted text-foreground' : 'bg-card',
          )}
        >
          <Seta className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <Mensagem mensagem={evento.mensagem} />
        </div>
      </li>
    );
  }

  const Icone = ICONE_TIPO[evento.tipo ?? 'note'];
  const tempo = duracao(evento.duracaoMin);
  const titulo = evento.desfecho ?? evento.titulo;

  // A segunda linha é a procedência do evento: o que foi, por onde, com quem e quando.
  const partes: string[] = [];
  if (evento.genero === 'interacao' && evento.tipo) partes.push(ROTULO_TIPO[evento.tipo]);
  if (evento.genero === 'etapa') partes.push('Mudança de etapa');
  if (evento.canal) partes.push(ROTULO_CANAL[evento.canal]);
  if (evento.autor) partes.push(evento.autor);
  else if (evento.autorTipo !== 'human') partes.push(ROTULO_AUTOR[evento.autorTipo]);
  if (evento.comQuem) partes.push(evento.comQuem);

  // Registro de mensagem sem texto: o CRM guardou o desfecho, não o conteúdo. Dizer
  // isso é o que impede alguém de achar que a conversa some quando não aparece texto.
  const semTexto = evento.tipo === 'message' && !evento.detalhe;

  return (
    <li className="group relative flex gap-3 pb-4 last:pb-0">
      <span
        className="absolute top-8 bottom-0 left-4 w-px -translate-x-1/2 bg-hairline group-last:hidden"
        role="presentation"
      />

      <span
        className={cn(
          'relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border border-hairline bg-card text-muted-foreground',
          // A mudança de etapa é o evento estrutural da coluna: é ela que explica por
          // que o parceiro está onde está no funil. Ganha o preenchimento, não a cor.
          evento.genero === 'etapa' && 'bg-muted text-foreground',
        )}
      >
        <Icone className="size-4" aria-hidden="true" />
      </span>

      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm leading-snug font-medium">{titulo}</span>
          <time
            dateTime={evento.em}
            title={dataHoraCompleta(evento.em)}
            className="numerico text-xs text-muted-foreground"
          >
            {hora(evento.em)}
          </time>
          {evento.portaAberta ? (
            <Badge variant="pilula" className="h-5 gap-1 px-1.5 text-[10px] font-normal">
              <DoorOpen className="size-3 text-muted-foreground" aria-hidden="true" />
              porta aberta
            </Badge>
          ) : null}
        </p>

        {partes.length || tempo ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {partes.join(' · ')}
            {tempo ? (
              <>
                {partes.length ? ' · ' : ''}
                <span className="numerico">{tempo.numero}</span>
                {tempo.unidade}
              </>
            ) : null}
          </p>
        ) : null}

        {/* O título da mudança de etapa é a frase inteira ("De Identificado para
            Demonstração marcada"); quando o desfecho já ocupou a primeira linha, ela
            reaparece aqui para não se perder. */}
        {evento.genero === 'etapa' && titulo !== evento.titulo ? (
          <p className="text-xs text-muted-foreground">{evento.titulo}</p>
        ) : null}

        {evento.detalhe ? (
          <p className="rounded-lg border border-hairline bg-card/50 px-2.5 py-1.5 text-sm leading-relaxed whitespace-pre-line">
            {evento.detalhe}
          </p>
        ) : null}

        {semTexto ? (
          <p className="text-xs text-muted-foreground">
            Registro manual: o CRM guardou o desfecho, não o texto da mensagem.
          </p>
        ) : null}
      </div>
    </li>
  );
}
