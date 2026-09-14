/**
 * Espera que ACORDA COM A PARADA.
 *
 * Na nuvem (Fly.io) o SIGTERM chega com prazo: passado o `kill_timeout`, vem o
 * SIGKILL. O worker-wa dorme de 45 a 180 s entre envios iniciados pela empresa
 * (R04 §4) — um `setTimeout` que não ouve o sinal faria o processo morrer no
 * meio do descanso, sem bater o ponto de "parado". Com o sinal, a espera acaba
 * na hora e o laço sai pela porta da frente.
 *
 * Sem `unref()`: um timer que não segura o laço mataria o worker no descanso.
 */
export function dormir(ms: number, sinal?: AbortSignal): Promise<void> {
  return new Promise((resolva) => {
    if (sinal?.aborted) {
      resolva();
      return;
    }
    const acordar = (): void => {
      clearTimeout(timer);
      sinal?.removeEventListener('abort', acordar);
      resolva();
    };
    const timer = setTimeout(acordar, Math.max(0, ms));
    sinal?.addEventListener('abort', acordar, { once: true });
  });
}
