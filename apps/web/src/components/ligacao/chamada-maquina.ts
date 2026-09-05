/**
 * A máquina da chamada: o que a tela de ligar DECIDE, sem React e sem rede.
 *
 * Isto aqui não é uma camada nova — é o miolo que já morava dentro de
 * `tela-chamada.tsx` e que ninguém conseguia testar sem um navegador. A tela continua
 * dona do estado (é ela que tem os `useState`); o que mudou é que as quatro decisões
 * que ela toma trinta vezes por turno passaram a ser funções puras:
 *
 *  1. **em que passo a ligação está** (`passoDaLigacao`) — discar → falando → tabular
 *     → recibo, os quatro do R13 §3.4;
 *  2. **quantos segundos a chamada tem** (`segundosDecorridos`), que é relógio de
 *     parede e não um contador de tiques: uma aba que dormiu não volta atrasada;
 *  3. **quanto disso pode ser GRAVADO** (`duracaoParaGravar`), que não é a mesma
 *     pergunta — ver o comentário da função;
 *  4. **para onde o roteiro anda e o que fica registrado do caminho**
 *     (`responderNoRoteiro`, `desviarParaObjecao`), que é o que vira
 *     `call_attempts.caminho_script` e as capturas da atividade.
 *
 * O motivo de existirem aqui, e não lá, está no laudo da varredura §3.11: a tela de
 * ligação tinha 903 linhas e nenhum teste, e o defeito §3.8 (chamada de mais de duas
 * horas que não podia ser tabulada) morava exatamente na costura entre o item 2 e o
 * item 3, onde ninguém comparava o que a tela mandava com o que o banco aceita.
 */
import {
  DURACAO_MAXIMA_SEG,
  NO_DE_ABERTURA,
  type CaminhoDoScript,
  type NoRoteiro,
  type PassoDaLigacao,
  type SaidaDoNo,
} from './tipos';

// ---------------------------------------------------------------------------
// 1. O passo
// ---------------------------------------------------------------------------

/** O que a tela tem em mãos quando pergunta "em que passo eu estou?". */
export type MaoDaChamada = {
  /** Existe chamada aberta (`iniciar_chamada` respondeu). */
  chamada: boolean;
  /** Alguém atendeu: a pessoa tocou na primeira resposta do roteiro. */
  atendeu: boolean;
  /** A tabulação está a caminho do banco. */
  gravando: boolean;
  /** O recibo do que acabou de ser gravado está na tela. */
  recibo: boolean;
};

/**
 * O passo em que a ligação está, na ordem do R13 §3.4.
 *
 * A ordem dos testes é a ordem da precedência, e ela não é arbitrária:
 *
 * - o **recibo** ganha de tudo, porque ele é o que está desenhado na tela depois de
 *   uma tabulação aceita — inclusive por cima de uma chamada que ainda não foi
 *   limpa do estado;
 * - sem chamada aberta, o passo é **discar**, mesmo com o roteiro já lido: quem não
 *   discou não falou com ninguém;
 * - **gravando** é `tabular`, porque o commit já partiu;
 * - com atendimento, **falando**; sem atendimento, **tabular** — e este é o caso que
 *   parece errado e não é: sem ninguém do outro lado, a única coisa na tela são os
 *   quatro botões de resultado técnico, e um toque neles grava. É o "discar → tabular
 *   em um toque" do módulo.
 */
export function passoDaLigacao(mao: MaoDaChamada): PassoDaLigacao {
  if (mao.recibo) return 'recibo';
  if (!mao.chamada) return 'discar';
  if (mao.gravando) return 'tabular';
  return mao.atendeu ? 'falando' : 'tabular';
}

// ---------------------------------------------------------------------------
// 2 e 3. O cronômetro, e o que dele pode ser gravado
// ---------------------------------------------------------------------------

/**
 * Quantos segundos a chamada tem AGORA.
 *
 * Relógio de parede, e de propósito: contar tiques de `setInterval` faz a duração
 * atrasar em toda aba que dormiu (celular no bolso entre uma ligação e outra), e a
 * duração é o número do relatório por horário do R13 §7.7.
 *
 * Nunca negativo: o servidor é quem carimba `iniciada_em`, e um relógio de aparelho
 * atrasado em relação ao do banco produziria um começo no futuro.
 */
export function segundosDecorridos(iniciadaEmMs: number, agoraMs: number): number {
  return Math.max(0, Math.round((agoraMs - iniciadaEmMs) / 1000));
}

/**
 * Quantos segundos podem ser GRAVADOS. Não é a mesma pergunta que a de cima.
 *
 * O cronômetro só cresce; o campo `call_attempts.duracao_seg` tem teto — o `check` da
 * migração 20260904001300 (`between 0 and 7200`) e o `max` de `tabularChamadaSchema`.
 * Sem este corte, a tela que ficou aberta mais de duas horas (almoço, aba esquecida,
 * distração na rua) montava um pedido que o próprio zod recusava ANTES da rede, com
 * uma mensagem que mandava "tentar de novo" — e tentar de novo nunca ia funcionar,
 * porque o relógio só anda para a frente. `iniciar_chamada` é idempotente e devolve o
 * `iniciada_em` original, então nem recarregar salvava: o contato ficava intabulável
 * até a reserva de 30 minutos expirar, com a tentativa gravada sem resultado.
 * (Laudo da varredura §3.8; a gravidade foi rebaixada a média em §4.1 porque a esquina
 * é estreita — a reserva expira em 30 min —, mas o conserto é este.)
 *
 * Cortar em vez de recusar é a escolha certa aqui: o que importa da ligação é o
 * desfecho, e "durou duas horas" é uma duração honesta o bastante para um relatório
 * quando a alternativa é perder a tabulação inteira.
 */
export function duracaoParaGravar(segundos: number): number {
  if (!Number.isFinite(segundos)) return 0;
  return Math.min(Math.max(0, Math.trunc(segundos)), DURACAO_MAXIMA_SEG);
}

// ---------------------------------------------------------------------------
// 4. O caminho pelo roteiro
// ---------------------------------------------------------------------------

/**
 * O que a tela guarda da conversa: onde ela está, por onde passou e o que anotou.
 *
 * `caminho` é o que vai para `call_attempts.caminho_script` — a prova de que a
 * conversa aconteceu do jeito que o desfecho diz. Ele é uma LISTA, e não um conjunto:
 * voltar a um nó pela objeção e seguir de novo é informação, não repetição a limpar.
 */
export type EstadoDoRoteiro = {
  noAtual: string;
  caminho: CaminhoDoScript;
  capturas: Record<string, string>;
  /** Alguém atendeu. É o eixo técnico do R13 §3.3, e ele não volta atrás. */
  atendeu: boolean;
};

/** O estado no instante em que a chamada abre: no nó de abertura, sem atendimento. */
export function estadoAoDiscar(): EstadoDoRoteiro {
  return { noAtual: NO_DE_ABERTURA, caminho: [NO_DE_ABERTURA], capturas: {}, atendeu: false };
}

/**
 * Um toque numa resposta do nó.
 *
 * Três coisas acontecem, e a primeira é a que não é óbvia:
 *
 * 1. **o primeiro toque afirma que alguém atendeu.** No adaptador manual não há AMD, e
 *    a única coisa honesta que se pode dizer é que ninguém lê a segunda fala do
 *    roteiro sem ter alguém do outro lado (R13 §3.3).
 * 2. **o campo guarda `saida.valor`, e só ele** — nunca o rótulo do botão. No nó do
 *    volume ("Quantos eventos por mês?") os rótulos são instrução para quem liga
 *    ("Ele respondeu quantos"), e gravá-los enchia `eventos_por_mes` com uma frase que
 *    não é número. O que a pessoa escreveu tem precedência sobre o valor do botão: um
 *    campo já preenchido não é sobrescrito por um toque posterior.
 * 3. **o destino entra no caminho**, sempre.
 */
export function responderNoRoteiro(
  estado: EstadoDoRoteiro,
  no: NoRoteiro | null,
  saida: SaidaDoNo,
): EstadoDoRoteiro {
  const capturas =
    no?.campo && saida.valor && !estado.capturas[no.campo]?.trim()
      ? { ...estado.capturas, [no.campo]: saida.valor }
      : estado.capturas;

  return {
    noAtual: saida.destino,
    caminho: [...estado.caminho, saida.destino],
    capturas,
    atendeu: true,
  };
}

/**
 * Um desvio para um nó de objeção, alcançável de QUALQUER nó (R13: o bloco lateral é
 * acessível de qualquer ponto da conversa). Também afirma o atendimento — ninguém
 * responde a uma objeção que não ouviu — e também entra no caminho, porque a objeção
 * levantada é a parte mais útil do histórico de uma ligação perdida.
 */
export function desviarParaObjecao(estado: EstadoDoRoteiro, no: NoRoteiro): EstadoDoRoteiro {
  return {
    ...estado,
    noAtual: no.id,
    caminho: [...estado.caminho, no.id],
    atendeu: true,
  };
}

/** O texto capturado do nó em foco, para o campo da tela. */
export function capturaDoNo(estado: EstadoDoRoteiro, no: NoRoteiro | null): string {
  return (no?.campo ? estado.capturas[no.campo] : '') ?? '';
}
