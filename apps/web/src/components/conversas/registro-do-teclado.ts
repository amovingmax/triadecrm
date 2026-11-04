'use client';

/**
 * O DIÁRIO DO TECLADO — SÓ EM `next dev` (04/11/2026).
 *
 * O teclado do iPhone não se reproduz fora do iPhone: nem o Chrome do computador
 * nem o Playwright abrem um. No primeiro teste num iPhone de verdade a camada da
 * conversa ficou presa num número de passagem, e só o print contou o que houve.
 * Com a conversa aberta no celular de teste, cada mudança da área visível vira
 * uma linha que vai para o computador (`/auth/dev/teclado`), e dá para ler a
 * sequência exata do que o Safari contou. Em produção não faz nada.
 */
const LIGADO = process.env.NODE_ENV === 'development';

let linhas: string[] = [];
let ultima = '';
let comeco = 0;
let envio = 0;

export function registrarTeclado(motivo: string): void {
  if (!LIGADO) return;
  const vv = window.visualViewport;
  const camada = document.querySelector<HTMLElement>('[data-area-visivel]');
  const foco = document.activeElement;
  const estado = [
    `janela=${window.innerHeight}`,
    `area=${vv ? `${r(vv.height)}@${r(vv.offsetTop)}` : '-'}`,
    `rolou=${r(window.scrollY)}`,
    `camada=${camada ? `${camada.style.height || '-'}@${camada.style.top || '-'}` : '-'}`,
    `foco=${foco && foco !== document.body ? foco.id || foco.tagName.toLowerCase() : '-'}`,
  ].join(' ');
  // Os quadros sem mudança não contam: só o que mexeu.
  if (motivo === 'quadro' && estado === ultima) return;
  ultima = estado;
  if (comeco === 0) comeco = performance.now();
  linhas.push(`${r(performance.now() - comeco)}ms ${motivo} ${estado}`);
  if (linhas.length > 500) linhas = linhas.slice(-500);
  if (!envio) envio = window.setTimeout(enviar, 1500);
}

function enviar(): void {
  envio = 0;
  const corpo = linhas.join('\n');
  linhas = [];
  void fetch('/auth/dev/teclado', { method: 'POST', body: corpo, keepalive: true }).catch(
    () => undefined,
  );
}

function r(n: number): number {
  return Math.round(n);
}
