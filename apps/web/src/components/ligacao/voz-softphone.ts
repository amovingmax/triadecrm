'use client';

import type { Call, Device } from '@twilio/voice-sdk';

import { pedirCredencial } from './voz-rpc';

/**
 * O telefone virtual: a única parte do CRM que conhece o SDK do provedor.
 *
 * É o segundo adaptador de telefonia do R13 §3.4 (o primeiro é o `manual`, em
 * `chamada-provedor.ts`). Trocar de provedor é trocar este arquivo e as três Edge
 * Functions `voz-*`; o resto da tela só conhece `LigacaoNoNavegador`.
 *
 * UM APARELHO POR ABA. O `Device` é criado uma vez e reaproveitado: recriá-lo a cada
 * ligação reabriria a sinalização toda vez, e dois aparelhos na mesma aba disputam o
 * mesmo microfone. A credencial dura uma hora e é renovada sozinha antes de vencer.
 *
 * O SDK só é carregado quando alguém liga pela primeira vez (`import()`), porque ele
 * é grande e a maior parte das telas nunca liga.
 */

export type LigacaoNoNavegador = {
  desligar(): void;
  silenciar(mudo: boolean): void;
};

export type OuvintesDaLigacao = {
  /** O navegador está conectado ao provedor; o telefone do parceiro vai tocar. */
  aoConectar(): void;
  /** A ligação acabou, por qualquer lado. Chamado uma vez só. */
  aoDesligar(): void;
  /** Deu errado. `aoDesligar` vem em seguida. */
  aoErro(erro: { nome: string | null; codigo: number | null }): void;
  /** A rede oscilou e o SDK está tentando retomar (`true`) ou retomou (`false`). */
  aoReconectar(tentando: boolean): void;
};

let aparelho: Promise<Device> | null = null;

function lerErro(erro: unknown): { nome: string | null; codigo: number | null } {
  if (typeof erro !== 'object' || erro === null) return { nome: null, codigo: null };
  const e = erro as { name?: unknown; code?: unknown };
  return {
    nome: typeof e.name === 'string' ? e.name : null,
    codigo: typeof e.code === 'number' ? e.code : null,
  };
}

async function criarAparelho(): Promise<Device> {
  const [{ Device: Aparelho, Call: Chamada }, token] = await Promise.all([
    import('@twilio/voice-sdk'),
    pedirCredencial(),
  ]);
  const novo = new Aparelho(token, {
    // A voz entra pela borda de São Paulo, a mais perto de Natal; se ela falhar, o
    // SDK escolhe a próxima pela latência.
    edge: ['sao-paulo', 'roaming'],
    // Opus aguenta perda de pacote e Wi‑Fi instável melhor que o PCMU padrão.
    codecPreferences: [Chamada.Codec.Opus, Chamada.Codec.PCMU],
    // Fechar a aba no meio de uma ligação pede confirmação.
    closeProtection: 'Há uma ligação em andamento. Sair desta página encerra a chamada.',
    // Avisa 60 s antes de a credencial vencer.
    tokenRefreshMs: 60_000,
  });
  novo.on('tokenWillExpire', () => {
    pedirCredencial()
      .then((renovada) => novo.updateToken(renovada))
      .catch((erro) => console.error('[voz] renovar credencial', erro));
  });
  // Erro do aparelho fora de uma chamada (sinalização caiu, credencial recusada):
  // o próximo `ligar` recria tudo do zero em vez de insistir num aparelho morto.
  novo.on('error', (erro: unknown) => {
    console.error('[voz] aparelho', lerErro(erro));
    if (!novo.isBusy) descartarAparelho();
  });
  return novo;
}

function obterAparelho(): Promise<Device> {
  if (!aparelho) {
    aparelho = criarAparelho().catch((erro) => {
      aparelho = null;
      throw erro;
    });
  }
  return aparelho;
}

/** Joga o aparelho fora. O próximo `conectar` cria outro, com credencial nova. */
export function descartarAparelho(): void {
  const atual = aparelho;
  aparelho = null;
  void atual?.then((d) => d.destroy()).catch(() => undefined);
}

/**
 * Pede o microfone ANTES de abrir a chamada no banco: quem nega a permissão não
 * deixa uma chamada pela metade para trás. Lança o erro do navegador
 * (`NotAllowedError`, `NotFoundError`...), que `classificarFalha` traduz.
 */
export async function pedirMicrofone(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error('sem mediaDevices'), { name: 'NotFoundError' });
  }
  const fluxo = await navigator.mediaDevices.getUserMedia({ audio: true });
  // Só a permissão interessa aqui; quem abre o microfone de verdade é o SDK.
  for (const trilha of fluxo.getTracks()) trilha.stop();
}

/**
 * Conecta o navegador ao provedor para a chamada `ligacaoId`, que
 * `voz_abrir_ligacao` já abriu. O número não viaja: o provedor pergunta ao banco.
 *
 * O ERRO PODE VIR DO APARELHO, e não da chamada: credencial recusada e sinalização
 * fora do ar chegam em `Device.on('error')`, e a chamada fica muda, esperando para
 * sempre. Por isso, enquanto esta chamada existe, o erro do aparelho é erro dela.
 */
export async function conectar(
  ligacaoId: string,
  ouvintes: OuvintesDaLigacao,
): Promise<LigacaoNoNavegador> {
  const d = await obterAparelho();

  let acabou = false;
  let chamada: Call | null = null;
  const fim = () => {
    if (acabou) return;
    acabou = true;
    d.off('error', aoErroDoAparelho);
    ouvintes.aoDesligar();
  };
  const aoErroDoAparelho = (erro: unknown) => {
    if (acabou) return;
    ouvintes.aoErro(lerErro(erro));
    chamada?.disconnect();
    fim();
    // Um aparelho que errou não serve à próxima ligação: ela começa com outro.
    descartarAparelho();
  };
  d.on('error', aoErroDoAparelho);

  try {
    chamada = await d.connect({ params: { ligacao: ligacaoId } });
  } catch (erro) {
    acabou = true;
    d.off('error', aoErroDoAparelho);
    throw erro;
  }
  const emCurso = chamada;
  // O erro do aparelho chegou enquanto o `connect` ainda estava a caminho.
  if (acabou) emCurso.disconnect();

  emCurso.on('accept', () => ouvintes.aoConectar());
  emCurso.on('ringing', () => ouvintes.aoConectar());
  emCurso.on('disconnect', fim);
  emCurso.on('cancel', fim);
  emCurso.on('reject', fim);
  emCurso.on('reconnecting', () => ouvintes.aoReconectar(true));
  emCurso.on('reconnected', () => ouvintes.aoReconectar(false));
  emCurso.on('error', (erro: unknown) => {
    if (acabou) return;
    ouvintes.aoErro(lerErro(erro));
    // Nem todo erro derruba a chamada no SDK; a tela não pode ficar esperando.
    emCurso.disconnect();
    fim();
  });

  return {
    desligar: () => {
      emCurso.disconnect();
      // Antes de a sinalização subir, o SDK pode não emitir `disconnect`.
      fim();
    },
    silenciar: (mudo) => emCurso.mute(mudo),
  };
}
