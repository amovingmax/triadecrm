'use client';

/**
 * O som do aviso de mensagem (29/10/2026): "Deve ser exibido um som ao chegar
 * novas notificações, porém esse som pode ser removido nas configurações".
 *
 * ===========================================================================
 * POR QUE WEB AUDIO, E NÃO UM ARQUIVO
 * ===========================================================================
 * Dois tons curtos, subindo, gerados aqui mesmo: nenhum arquivo para baixar,
 * nada para esperar carregar na primeira mensagem, e o mesmo toque no Windows e
 * no Mac — o som da notificação do sistema depende do sistema, e muita gente o
 * tem desligado.
 *
 * ===========================================================================
 * O QUE O NAVEGADOR EXIGE
 * ===========================================================================
 * Página só toca som com a licença do navegador. Sem ela, o `AudioContext` nasce
 * suspenso e não sai nada até um clique ou uma tecla NA PÁGINA CARREGADA. Por isso
 * `prepararSom` faz as duas coisas: tenta logo ao montar e, se não der, destrava no
 * primeiro gesto. Destravado, o toque sai mesmo com a aba escondida ou a janela
 * minimizada.
 *
 * A tentativa ao montar é para o que a documentação do Chrome libera sem clique: o
 * site muito usado e o app instalado (este ainda não conferido no Mac).
 *
 * RECARREGAR VOLTA A TRAVAR. Medido em 30/10/2026, no Chrome com a regra de
 * computador: clicar destrava, recarregar suspende de novo, e a mensagem que chega
 * em outra aba não toca nada até o próximo clique.
 *
 * Sem a licença, `tocarSom` devolve `false`, e quem chama pede o som à notificação
 * do sistema. Não dá para contar com ele: no Mac, em 30/10/2026, esse som não saiu.
 *
 * ===========================================================================
 * DUAS ABAS, UM TOQUE
 * ===========================================================================
 * Cada aba do CRM confere as mensagens por conta própria e chegaria ao mesmo
 * aviso. A primeira que toca anota a marca do aviso no aparelho; a outra lê a
 * anotação e fica quieta. A notificação do sistema já se resolvia sozinha pela
 * marca (`tag`).
 */

let contexto: AudioContext | null = null;

type ConstrutorDeAudio = typeof AudioContext;

function construtor(): ConstrutorDeAudio | null {
  if (typeof window === 'undefined') return null;
  const comPrefixo = window as unknown as { webkitAudioContext?: ConstrutorDeAudio };
  return window.AudioContext ?? comPrefixo.webkitAudioContext ?? null;
}

/**
 * Cria ou retoma o contexto. Fora de um gesto também: se o navegador deixar, ele
 * passa a tocar; se não deixar, fica suspenso até o gesto, e o Chrome só escreve um
 * aviso no console.
 */
function destravar(): void {
  const Construtor = construtor();
  if (!Construtor) return;
  try {
    contexto ??= new Construtor();
    if (contexto.state !== 'running') void contexto.resume().catch(() => undefined);
  } catch {
    // Navegador sem áudio, ou que recusou: o aviso continua, sem o toque.
  }
}

/**
 * Tenta destravar agora e escuta os gestos da pessoa para os casos em que não
 * deu. Fica escutando enquanto a casca estiver montada: o Safari volta a suspender
 * o contexto depois de um tempo sem som, e o gesto seguinte o retoma.
 */
export function prepararSom(): () => void {
  destravar();
  const aoGesto = () => {
    if (contexto?.state !== 'running') destravar();
  };
  window.addEventListener('pointerdown', aoGesto, { capture: true, passive: true });
  window.addEventListener('keydown', aoGesto, { capture: true, passive: true });
  return () => {
    window.removeEventListener('pointerdown', aoGesto, { capture: true });
    window.removeEventListener('keydown', aoGesto, { capture: true });
  };
}

/** O toque já pode sair agora, sem um gesto novo? */
export function somDestravado(): boolean {
  return contexto?.state === 'running';
}

/**
 * O toque de amostra, de dentro de um clique (ligar o som no menu): destrava e
 * toca, para a pessoa ouvir o que acabou de ligar.
 */
export function tocarAmostra(): void {
  destravar();
  const ctx = contexto;
  if (!ctx) return;
  if (ctx.state === 'running') tocarSom();
  else
    void ctx
      .resume()
      .then(() => tocarSom())
      .catch(() => undefined);
}

/** As duas notas do toque: lá e mi, uma quinta acima. */
const NOTAS: readonly { readonly hz: number; readonly comeca: number }[] = [
  { hz: 880, comeca: 0 },
  { hz: 1318.5, comeca: 0.14 },
];
const DURACAO_DA_NOTA_S = 0.32;
const VOLUME = 0.16;

/**
 * Toca o toque agora. Devolve `false` quando não tocou — contexto ainda não
 * destravado, ou navegador sem áudio —, para quem chama avisar de outro jeito.
 */
export function tocarSom(): boolean {
  const ctx = contexto;
  if (!ctx) return false;
  if (ctx.state !== 'running') {
    void ctx.resume().catch(() => undefined);
    return false;
  }
  try {
    const agora = ctx.currentTime;
    for (const nota of NOTAS) {
      const inicio = agora + nota.comeca;
      const oscilador = ctx.createOscillator();
      const volume = ctx.createGain();
      oscilador.type = 'sine';
      oscilador.frequency.setValueAtTime(nota.hz, inicio);
      // Ataque de 10 ms e queda exponencial: um "plim", sem estalo no começo.
      volume.gain.setValueAtTime(0.0001, inicio);
      volume.gain.exponentialRampToValueAtTime(VOLUME, inicio + 0.01);
      volume.gain.exponentialRampToValueAtTime(0.0001, inicio + DURACAO_DA_NOTA_S);
      oscilador.connect(volume).connect(ctx.destination);
      oscilador.start(inicio);
      oscilador.stop(inicio + DURACAO_DA_NOTA_S + 0.02);
    }
    return true;
  } catch {
    return false;
  }
}

const CHAVE_DO_ULTIMO_TOQUE = 'komune.avisos.som-tocado.v1';

/**
 * Outra aba já tocou este aviso? Se não, anota que esta vai tocar. A marca é a
 * mesma `marcaDoAviso` da notificação do sistema: duas abas que chegam ao mesmo
 * aviso chegam à mesma marca.
 */
export function outraAbaJaTocou(usuarioId: string, marca: string): boolean {
  const chave = `${CHAVE_DO_ULTIMO_TOQUE}:${usuarioId}`;
  try {
    if (window.localStorage.getItem(chave) === marca) return true;
    window.localStorage.setItem(chave, marca);
  } catch {
    // Sem armazenamento, cada aba toca o seu: melhor dois toques que nenhum.
  }
  return false;
}
