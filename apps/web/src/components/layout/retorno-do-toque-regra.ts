/**
 * Quando um toque num link leva a OUTRA tela do CRM — a regra de
 * `retorno-do-toque.tsx`, separada para ser testada sem navegador.
 *
 * Fica de fora tudo o que não troca a tela na mesma aba: botão do meio, tecla de
 * atalho (abrir em outra aba), `target` de outra janela, `download`, outro site, o
 * mesmo endereço (inclusive o que só muda o `#`), o toque num controle DENTRO do
 * link (o "Excluir" de um cartão que é link) e os itens do menu, que já se acendem
 * sozinhos (`nav-link.tsx`).
 */
export type Toque = {
  /** `MouseEvent.button`: 0 é o principal. */
  botao: number;
  /** Alguma de ⌘, Ctrl, Shift ou Alt apertada. */
  comTecla: boolean;
  /** `HTMLAnchorElement.href`: o endereço já resolvido, absoluto. */
  href: string;
  /** `HTMLAnchorElement.target`. */
  alvo: string;
  baixar: boolean;
  dentroDeControle: boolean;
  noMenu: boolean;
};

export type Aqui = { origem: string; caminho: string; busca: string };

export function levaAOutraTela(toque: Toque, aqui: Aqui): boolean {
  if (toque.botao !== 0 || toque.comTecla) return false;
  if (toque.alvo !== '' && toque.alvo !== '_self') return false;
  if (toque.baixar || toque.dentroDeControle || toque.noMenu) return false;
  let destino: URL;
  try {
    destino = new URL(toque.href);
  } catch {
    return false;
  }
  if (destino.origin !== aqui.origem) return false;
  return destino.pathname + destino.search !== aqui.caminho + aqui.busca;
}
