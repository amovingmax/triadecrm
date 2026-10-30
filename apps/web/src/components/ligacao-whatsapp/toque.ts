'use client';

/**
 * O som do telefone tocando. O navegador só libera o áudio depois de um clique na
 * página: sem ele o som não sai, e o painel na tela e o aviso do sistema continuam
 * valendo. Por isso nada aqui pode lançar erro.
 */

const CICLO_MS = 3000;

function bipe(ctx: AudioContext, inicio: number): void {
  const osc = ctx.createOscillator();
  const volume = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 480;
  volume.gain.setValueAtTime(0, inicio);
  volume.gain.linearRampToValueAtTime(0.18, inicio + 0.02);
  volume.gain.setValueAtTime(0.18, inicio + 0.38);
  volume.gain.linearRampToValueAtTime(0, inicio + 0.4);
  osc.connect(volume).connect(ctx.destination);
  osc.start(inicio);
  osc.stop(inicio + 0.42);
}

/** Começa a tocar e devolve a função que para. */
export function iniciarToque(): () => void {
  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioContext();
    void ctx.resume().catch(() => undefined);
  } catch {
    return () => undefined;
  }
  const contexto = ctx;
  const tocar = () => {
    try {
      if (contexto.state !== 'running') return;
      bipe(contexto, contexto.currentTime + 0.01);
      bipe(contexto, contexto.currentTime + 0.6);
    } catch {
      // sem som: o painel continua na tela
    }
  };
  tocar();
  const id = setInterval(tocar, CICLO_MS);
  return () => {
    clearInterval(id);
    void contexto.close().catch(() => undefined);
  };
}
