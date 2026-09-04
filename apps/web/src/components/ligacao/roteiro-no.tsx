'use client';

import { useId } from 'react';
import { CornerDownRight, Info } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  doInputLocal,
  formatarQuandoPorExtenso,
  paraInputLocal,
} from '@/components/registro/formatos';

import { falaDoNo } from './roteiro-texto';
import {
  saidasNaVariante,
  type ItemDoLote,
  type NoRoteiro,
  type Roteiro,
  type SaidaDoNo,
  type VarianteRoteiro,
} from './tipos';

/**
 * Um nó do roteiro: a fala em corpo grande e as respostas do cliente como botões.
 *
 * A tela mostra UMA fala, para ler em voz alta, e embaixo a resposta do cliente na
 * boca dele ("Tô cheio, não preciso", "Manda por WhatsApp"). Cada toque vira a tela
 * para a fala seguinte e empilha o id do nó em `caminho_script` — que é o que responde
 * depois, sem palpite, em qual frase as pessoas desligam (R13 §3.2).
 *
 * O corpo é grande porque quem lê está lendo em voz alta enquanto olha para outra
 * coisa: o texto precisa ser pego de relance, a meio metro da tela.
 *
 * O campo de anotação aparece em TODO nó que declara `campo`, e não só nos de
 * `tipo: captura`: quem decide onde cada resposta é guardada é a árvore publicada, e
 * amarrar a anotação ao `tipo` era o que podia deixar uma pergunta com campo — a de
 * volume, "Quantos eventos o [empresa] faz por mês?" — sem onde ser escrita.
 *
 * A linha de baixo do campo diz a verdade sobre o que acontece em branco, e ela muda
 * com a árvore: quando alguma saída declara `valor`, o toque grava sozinho; quando
 * nenhuma declara (porque ali o rótulo é instrução para quem liga, e não resposta do
 * cliente), campo em branco não grava nada.
 */
export function RoteiroNo({
  roteiro,
  no,
  variante,
  item,
  quemLiga,
  combinadoEm,
  sugestaoDeData,
  aoCombinar,
  captura,
  aoCapturar,
  aoResponder,
  somenteLeitura = false,
}: {
  roteiro: Roteiro;
  no: NoRoteiro;
  variante: VarianteRoteiro;
  item: ItemDoLote;
  quemLiga: string;
  /** A data combinada até aqui: é ela que preenche `[dia]` e `[hora]` na fala. */
  combinadoEm: string | null;
  /**
   * A data que a tela PROPÕE enquanto ela não combinou nada: a próxima abertura da
   * janela de ligação. Sem isso, "Então eu ligo [dia], por volta das [hora]" viraria
   * "Então eu ligo, por volta das" na hora de ler em voz alta — e ler uma frase
   * quebrada ao telefone é pior do que ler uma proposta que ela pode mudar num toque.
   */
  sugestaoDeData: string | null;
  aoCombinar: (iso: string | null) => void;
  captura: string;
  aoCapturar: (valor: string) => void;
  aoResponder: (saida: SaidaDoNo) => void;
  /** Prévia antes de discar: mostra a fala, esconde o que só faz sentido na conversa. */
  somenteLeitura?: boolean;
}) {
  const campoData = useId();
  const campoCaptura = useId();

  const combinado = combinadoEm ?? sugestaoDeData;
  const fala = falaDoNo(no.texto, item, quemLiga, combinado);
  const saidas = saidasNaVariante(roteiro, no, variante);
  const combinaData = !somenteLeitura && /\[dia\]|\[hora\]/.test(no.texto);

  return (
    <div className="flex flex-col gap-5">
      {no.nota ? (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            <span className="sr-only">Dica, não leia em voz alta: </span>
            {no.nota}
          </span>
        </p>
      ) : null}

      {/* A fala. `text-balance` para a linha não quebrar numa palavra órfã no meio
          de uma frase que está sendo lida em voz alta. */}
      <p
        data-no={no.id}
        className={cn(
          'text-balance text-2xl leading-snug font-medium sm:text-3xl',
          no.tipo === 'acao' && 'text-xl text-muted-foreground sm:text-2xl',
        )}
      >
        {no.tipo === 'acao' ? <span className="sr-only">Faça agora: </span> : null}
        {fala}
      </p>

      {combinaData ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={campoData}>O que você vai combinar</Label>
          <Input
            id={campoData}
            type="datetime-local"
            className="numerico h-11 max-w-xs"
            value={paraInputLocal(combinado)}
            onChange={(e) => aoCombinar(doInputLocal(e.target.value))}
          />
          <p className="text-xs text-muted-foreground">
            {formatarQuandoPorExtenso(combinado) ?? 'Sem data, a frase segue sem o dia e a hora.'}
          </p>
        </div>
      ) : null}

      {no.campo && !somenteLeitura ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={campoCaptura}>Anotar (opcional)</Label>
          <Input
            id={campoCaptura}
            value={captura}
            onChange={(e) => aoCapturar(e.target.value)}
            placeholder={PLACEHOLDER_DA_CAPTURA[no.campo] ?? 'O que ele respondeu'}
            className="h-11 max-w-md"
          />
          <p className="text-xs text-muted-foreground">
            {saidas.some((s) => s.valor)
              ? 'Em branco, fica gravada a resposta que você tocar abaixo.'
              : 'Em branco, este campo não é gravado.'}
          </p>
        </div>
      ) : null}

      {saidas.length > 0 && !somenteLeitura ? (
        <div className="flex flex-col gap-2 sm:grid sm:grid-cols-2">
          <p className="sr-only" id={`${no.id}-legenda`}>
            O que ele respondeu
          </p>
          {saidas.map((saida, indice) => (
            <button
              key={`${saida.destino}-${indice}`}
              type="button"
              onClick={() => aoResponder(saida)}
              className="toque flex min-h-14 items-center gap-2.5 rounded-lg border border-hairline bg-card px-4 py-3 text-left text-base leading-snug font-medium transition-colors outline-none hover:border-input hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <CornerDownRight
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span>{falaDoNo(saida.rotulo, item, quemLiga, combinado)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Um exemplo do que se anota em cada campo do roteiro `captacao_v1`.
 *
 * A chave é o `campo` do nó, e o mapa é só o placeholder: quem decide ONDE cada
 * resposta é guardada é a árvore publicada, não esta tela. Campo que a árvore trouxer
 * e não estiver aqui cai no texto genérico em vez de sumir.
 */
const PLACEHOLDER_DA_CAPTURA: Readonly<Record<string, string>> = {
  decisor: 'Nome do dono e melhor horário',
  retorno_combinado: 'O que ficou combinado',
  reuniao_combinada: 'Onde e com quem',
  whatsapp_do_decisor: 'O WhatsApp que ele passou',
  eventos_por_mes: 'Quantos eventos por mês',
  eventos_por_ano: 'Quantos eventos por ano',
  prioridade_do_dono: 'Mais pedido, ou pedido melhor',
  maior_aperto: 'O que mais aperta hoje',
};
