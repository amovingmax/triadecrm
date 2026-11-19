'use client';

import { useEffect } from 'react';

/**
 * A chave em que o CRM guarda o tema (`storageKey` de `components/tema/provedor-tema.tsx`;
 * o teste `pagina-pronta.test.ts` confere que é a mesma).
 */
export const CHAVE_DO_TEMA = 'komune-crm-tema';

/**
 * O endereço da página pronta, com o tema do CRM (`?tema=dark` ou `?tema=light`) e o
 * `#` de onde a pessoa queria ir (`/inteligencia#mapa` abre a página pronta no Mapa).
 *
 * O tema vai pelo endereço porque a página pronta roda em sandbox (origem opaca) e
 * não lê o localStorage do CRM; a ponte do `adaptar.mjs` o recebe. "Sistema" (ou
 * nada salvo) não vai: a página segue o sistema sozinha.
 */
export function enderecoComTema(endereco: string, temaSalvo: string | null, hash: string): string {
  const tema = temaSalvo === 'dark' || temaSalvo === 'light' ? `?tema=${temaSalvo}` : '';
  return `${endereco}${tema}${hash}`;
}

/**
 * Troca esta casca pela página pronta da Inteligência de mercado.
 *
 * `location.replace`, e não `push`: o "voltar" do navegador sai da página pronta
 * direto para a tela do CRM de onde a pessoa veio, sem parar de novo nesta casca
 * (que a mandaria de volta para a página pronta, num laço).
 */
export function AbrirPaginaPronta({ endereco }: { endereco: string }) {
  useEffect(() => {
    let tema: string | null = null;
    try {
      tema = window.localStorage.getItem(CHAVE_DO_TEMA);
    } catch {
      // Sem acesso ao armazenamento (janela privada, bloqueio): a página segue o sistema.
    }
    window.location.replace(enderecoComTema(endereco, tema, window.location.hash));
  }, [endereco]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-sm text-muted-foreground" role="status">
        Abrindo a Inteligência de mercado…
      </p>
      {/* Se o navegador demorar (ou o script não rodar), o link faz o mesmo. */}
      <a className="text-sm font-medium underline underline-offset-4" href={endereco}>
        Abrir agora
      </a>
    </main>
  );
}
