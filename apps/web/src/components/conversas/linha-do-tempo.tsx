'use client';

import { Fragment } from 'react';
import { DoorOpen } from 'lucide-react';

import { Badge } from '@/components/ui/badge';

import { dataHoraCompleta, duracao, hora, rotuloDoDia } from './formatos';
import { ICONE_TIPO } from './icones';
import { Mensagem } from './mensagem-do-fio';
import { mesmoBloco, procedenciaDoEvento } from './montagem';
import { ROTULO_AUTOR, type DiaDaLinha, type EventoDaLinha } from './tipos';
import { PilulaDoFio } from './wpp';

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
 *
 * No jeito do WhatsApp (03/11/2026) o dia é a pílula branca do alto, o que não é
 * mensagem é um cartão translúcido no meio, e quem abre uma conversa com mensagem
 * nova vê o aviso "N mensagens não lidas" antes delas.
 */
export function LinhaDoTempo({
  dias,
  nomeDoParceiro = null,
  naoLidas = null,
}: {
  dias: DiaDaLinha[];
  /**
   * O aviso das não lidas: quantas eram ao abrir e a mensagem antes da qual ele
   * entra (a mais antiga delas). Fica onde estava até a conversa fechar, como no
   * WhatsApp, mesmo depois de a leitura zerar o número.
   */
  naoLidas?: { quantas: number; antesDe: string } | null;
  /** Vai até o balão recebido: é o nome que aparece em cima dele. */
  nomeDoParceiro?: string | null;
}) {
  return (
    <div className="flex flex-col gap-1">
      {dias.map((dia) => (
        <section key={dia.chave} className="flex flex-col">
          <SeparadorDeDia iso={dia.em} />
          <ol className="flex flex-col">
            {dia.eventos.map((evento, i) => (
              <Fragment key={evento.id}>
                {naoLidas && naoLidas.antesDe === evento.id ? (
                  <li
                    id="aviso-nao-lidas"
                    className="my-3 flex scroll-mt-16 justify-center rounded-lg bg-wpp-sis py-1.5"
                  >
                    <PilulaDoFio tom="dia" className="bg-wpp-painel">
                      <span className="numerico">{naoLidas.quantas}</span>
                      {naoLidas.quantas === 1 ? ' mensagem não lida' : ' mensagens não lidas'}
                    </PilulaDoFio>
                  </li>
                ) : null}
                <Evento
                  evento={evento}
                  anterior={dia.eventos[i - 1]}
                  seguinte={dia.eventos[i + 1]}
                  nomeDoParceiro={nomeDoParceiro}
                />
              </Fragment>
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
    // GRUDADO NO TOPO. Numa conversa de três meses, rolar para o meio deixava a
    // pessoa sem saber de que dia era aquilo — o separador tinha passado
    // trezentos pixels acima. `z-10` porque os balões rolam por baixo dele.
    // Com a pílula da janela de 24 h no alto, gruda logo abaixo dela
    // (`--topo-do-dia`, medido em `fio-wpp.tsx`).
    <div className="sticky top-[var(--topo-do-dia,0.375rem)] z-10 mt-4 mb-1.5 flex justify-center">
      <PilulaDoFio tom="dia" title={completo}>
        {/* "Hoje", "Ontem", "Segunda-feira, ": com maiúscula, como no WhatsApp. */}
        {palavra.charAt(0).toUpperCase() + palavra.slice(1)}
        {numero ? <span className="numerico">{numero}</span> : null}
      </PilulaDoFio>
    </div>
  );
}

function Evento({
  evento,
  anterior,
  seguinte,
  nomeDoParceiro,
}: {
  evento: EventoDaLinha;
  anterior?: EventoDaLinha;
  seguinte?: EventoDaLinha;
  nomeDoParceiro: string | null;
}) {
  // A mensagem é balão, e o balão não tem trilho: o lado já diz quem falou, e os
  // 44 px do trilho eram a diferença entre ler a conversa e espremê-la no celular.
  if (evento.genero === 'mensagem' && evento.mensagem) {
    return (
      // O id é a âncora da evidência: a leitura da IA cita `message_id`, e clicar
      // no sinal rola até a mensagem que o prova (`leitura-da-ia.tsx`).
      <li
        id={`evento-${evento.id}`}
        className="scroll-mt-4 rounded-lg transition-colors data-[apontada]:bg-wpp-cita-barra/15"
      >
        <Mensagem
          mensagem={evento.mensagem}
          agrupada={mesmoBloco(anterior, evento)}
          fechaGrupo={!mesmoBloco(evento, seguinte)}
          nomeDoParceiro={nomeDoParceiro}
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
    <li className="my-2.5 flex justify-center">
      <div className="w-full max-w-md space-y-1 rounded-lg bg-wpp-sis px-3 py-2 text-wpp-sis-texto shadow-wpp">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Icone className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="text-sm leading-snug font-medium text-foreground">{titulo}</span>
          <time
            dateTime={evento.em}
            title={dataHoraCompleta(evento.em)}
            className="numerico text-xs"
          >
            {hora(evento.em)}
          </time>
          {evento.portaAberta ? (
            <Badge variant="pilula" className="h-5 gap-1 px-1.5 text-[10px] font-normal">
              <DoorOpen className="size-3" aria-hidden="true" />
              porta aberta
            </Badge>
          ) : null}
        </p>

        {partes.length || tempo ? (
          <p className="text-xs leading-relaxed">
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
          <p className="text-xs">{evento.titulo}</p>
        ) : null}

        {evento.detalhe ? (
          <p className="text-sm leading-relaxed whitespace-pre-line text-foreground">
            {evento.detalhe}
          </p>
        ) : null}

        {semTexto ? (
          <p className="text-xs">
            Registro manual: o CRM guardou o desfecho, não o texto da mensagem.
          </p>
        ) : null}
      </div>
    </li>
  );
}
