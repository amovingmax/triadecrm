'use client';

import { DoorOpen } from 'lucide-react';

import { Badge } from '@/components/ui/badge';

import { dataHoraCompleta, duracao, hora, rotuloDoDia } from './formatos';
import { ICONE_TIPO } from './icones';
import { Mensagem } from './mensagem-do-fio';
import { mesmoBloco, procedenciaDoEvento } from './montagem';
import { ROTULO_AUTOR, type DiaDaLinha, type EventoDaLinha } from './tipos';

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
    <div className="flex flex-col gap-5">
      {dias.map((dia) => (
        <section key={dia.chave} className="flex flex-col gap-3">
          <SeparadorDeDia iso={dia.em} />
          <ol className="flex flex-col">
            {dia.eventos.map((evento, i) => (
              <Evento
                key={evento.id}
                evento={evento}
                anterior={dia.eventos[i - 1]}
                seguinte={dia.eventos[i + 1]}
              />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

/** O dia numa pílula no meio da coluna, como em qualquer conversa. */
function SeparadorDeDia({ iso }: { iso: string }) {
  const { palavra, numero, completo } = rotuloDoDia(iso);

  return (
    <div className="flex justify-center">
      <span
        className="rounded-full bg-muted px-3 py-1 text-[11px] text-muted-foreground"
        title={completo}
      >
        {palavra}
        {numero ? <span className="numerico">{numero}</span> : null}
      </span>
    </div>
  );
}

function Evento({
  evento,
  anterior,
  seguinte,
}: {
  evento: EventoDaLinha;
  anterior?: EventoDaLinha;
  seguinte?: EventoDaLinha;
}) {
  // A mensagem é balão, e o balão não tem trilho: o lado já diz quem falou, e os
  // 44 px do trilho eram a diferença entre ler a conversa e espremê-la no celular.
  if (evento.genero === 'mensagem' && evento.mensagem) {
    return (
      // O id é a âncora da evidência: a leitura da IA cita `message_id`, e clicar
      // no sinal rola até a mensagem que o prova (`leitura-da-ia.tsx`).
      <li
        id={`evento-${evento.id}`}
        className="scroll-mt-4 transition-colors data-[apontada]:bg-muted/60"
      >
        <Mensagem
          mensagem={evento.mensagem}
          agrupada={mesmoBloco(anterior, evento)}
          fechaGrupo={!mesmoBloco(evento, seguinte)}
        />
      </li>
    );
  }

  const Icone = ICONE_TIPO[evento.tipo ?? 'note'];
  const tempo = duracao(evento.duracaoMin);
  const titulo = evento.desfecho ?? evento.titulo;

  // A segunda linha é a procedência do evento: o que foi, por onde, com quem e quando.
  //
  // O "o que foi, por onde" sai de `procedenciaDoEvento`, que devolve uma palavra só
  // quando o tipo e o canal dizem a mesma coisa ("Ligação · Telefone" era o par que
  // mandava a pessoa procurar diferença entre dois sinônimos). A escolha da palavra
  // mora lá, e não aqui, porque é regra de vocabulário — a mesma que os relatórios e
  // a régua de cadência usam — e porque assim ela é testável sem navegador.
  const partes = procedenciaDoEvento(evento);
  if (evento.autor) partes.push(evento.autor);
  else if (evento.autorTipo !== 'human') partes.push(ROTULO_AUTOR[evento.autorTipo]);
  if (evento.comQuem) partes.push(evento.comQuem);

  // Registro de mensagem sem texto: o CRM guardou o desfecho, não o conteúdo. Dizer
  // isso é o que impede alguém de achar que a conversa some quando não aparece texto.
  const semTexto = evento.tipo === 'message' && !evento.detalhe;

  // O que NÃO é mensagem vira nota no meio da coluna — a ligação de terça e a
  // mudança de etapa que ela causou continuam no mesmo fio, na mesma ordem, mas
  // sem disputar o lugar dos balões: elas são o que aconteceu, não o que foi dito.
  return (
    <li className="flex justify-center pb-3">
      <div className="w-full max-w-md space-y-1 rounded-xl border border-hairline bg-muted/40 px-3 py-2">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Icone className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
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
          <p className="text-sm leading-relaxed whitespace-pre-line">{evento.detalhe}</p>
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
