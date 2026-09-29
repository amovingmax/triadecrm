import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(fileURLToPath(new URL('./globals.css', import.meta.url)), 'utf8');

/**
 * `background-image` só aceita gradiente ou url. Nunca uma cor.
 *
 * ESTE ARQUIVO NASCEU DE UM DEFEITO EM PRODUÇÃO, em 29/09/2026. Quando a ação
 * deixou de ser gradiente e virou tinta chapada (Tríade Design System), o token
 * `--acao-gradiente` passou a valer `#111110` — mas a utilidade que o consome
 * continuou escrevendo `background-image: var(--acao-gradiente)`.
 *
 * `background-image: #111110` não é CSS válido: o navegador descarta a
 * declaração inteira, em silêncio. Todo botão primário do CRM ficou SEM FUNDO,
 * transparente por cima do que estivesse atrás — o de enviar mensagem incluído.
 * Rafael viu no uso ("botões de enviar ficando na mesma tonalidade e bugando");
 * lint, typecheck, build e 918 testes passaram sem notar nada, porque CSS
 * inválido não quebra nenhum dos quatro.
 *
 * O teste é a regra em uma linha: se uma utilidade pinta com `background-image`,
 * o token que ela usa TEM de ser um gradiente. E o contrário também, porque foi
 * essa metade que falhou: um token que virou cor tem de ser pintado com
 * `background-color`.
 */
const FUNCOES_DE_IMAGEM = /^(linear-gradient|radial-gradient|conic-gradient|repeating-|url\()/;

/** Os valores de `:root` e `.dark`, achatados: o nome do token para o valor cru. */
function tokens(): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const [, nome, valor] of CSS.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
    // O primeiro valor vence: é o do tema claro, e é o que se mede aqui. O
    // escuro é o mesmo formato por construção (os dois saem do mesmo bloco).
    if (!mapa.has(nome)) mapa.set(nome, valor.trim());
  }
  return mapa;
}

/** Cada `background-image: var(--x)` do arquivo, com o token que ele consome. */
function fundosDeImagem(): string[] {
  return [...CSS.matchAll(/background-image:\s*var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]!);
}

describe('background-image no globals.css', () => {
  it('encontra as utilidades que pintam com background-image', () => {
    // Sem esta âncora, o arquivo passaria vazio no dia em que o regex quebrasse
    // e ninguém veria a diferença entre "está tudo certo" e "não mediu nada".
    expect(fundosDeImagem().length).toBeGreaterThan(0);
  });

  it('todo token pintado com background-image é mesmo um gradiente', () => {
    const t = tokens();
    for (const nome of fundosDeImagem()) {
      const valor = t.get(nome);
      expect(valor, `${nome} não existe em :root`).toBeDefined();
      expect(
        FUNCOES_DE_IMAGEM.test(valor!),
        `${nome} vale "${valor}" e é pintado com background-image, que descarta a declaração em silêncio. Use background-color.`,
      ).toBe(true);
    }
  });

  it('a ação é uma COR, e por isso é pintada com background-color', () => {
    // A regra do caso concreto, escrita por nome: a ação do Tríade Design System
    // é tinta chapada, e o dia em que alguém a devolver para background-image o
    // botão de enviar some outra vez.
    const t = tokens();
    expect(FUNCOES_DE_IMAGEM.test(t.get('--acao-gradiente') ?? '')).toBe(false);
    expect(CSS).toContain('background-color: var(--acao-gradiente)');
    expect(CSS).not.toContain('background-image: var(--acao-gradiente)');
  });
});
