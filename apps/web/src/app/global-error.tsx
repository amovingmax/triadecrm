'use client';

import { useEffect } from 'react';

import './globals.css';

/** A mesma chave que o `ProvedorTema` passa ao next-themes. */
const CHAVE_DO_TEMA = 'komune-crm-tema';

/**
 * Último anteparo: a falha aconteceu no próprio layout raiz.
 *
 * Quando o layout raiz quebra, o limite de `(app)` não chega a existir — ele é
 * filho justamente do que falhou. Sem este arquivo, o que aparece é o documento
 * de erro embutido do Next, em inglês e sem nada do produto. Aqui o `global-error`
 * SUBSTITUI o layout raiz, então ele precisa desenhar o próprio `<html>` e
 * `<body>`: nada do que o layout monta (fontes do next/font, ProvedorTema,
 * Toaster) alcança esta tela.
 *
 * Duas consequências que o código abaixo existe para tratar:
 *
 * 1. As variáveis `--font-geist` viviam no `<html>` do layout raiz. Aqui a
 *    tipografia cai na pilha do sistema que o `globals.css` já mantém atrás do
 *    Geist — de propósito, e não por descuido: puxar `next/font` numa tela de
 *    último recurso adicionaria um pedido de rede a um momento em que a única
 *    certeza é que algo já falhou.
 * 2. A classe do tema era escrita pelo `ProvedorTema`, que morreu junto. O
 *    documento nasce no escuro, que é o padrão do produto, e o efeito abaixo
 *    corrige para quem escolheu o claro. Sem isso, quem trabalha no claro
 *    levaria uma tela preta debaixo do sol, e o inverso às dez da noite.
 *
 * A saída é um `<a>` comum, e não um `<Link>`: numa falha desta altura não dá
 * para confiar que o roteador do cliente ainda esteja de pé, e uma navegação
 * dura recarrega o aplicativo inteiro — que é exatamente o que se quer aqui.
 */
export default function ErroGlobal({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // Mesmo formato de `lib/registro-do-servidor.ts`, mesma regra: o texto cru do
    // erro pode carregar detalhe de banco e não vai para a tela nem para cá; o
    // `digest` é o que liga esta tela ao erro que o servidor já registrou.
    const campos = [
      error.name ? `erro=${error.name}` : '',
      error.digest ? `digest=${error.digest}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    console.error(`[erro] layout-raiz motivo=render_falhou${campos ? ' ' + campos : ''}`);
  }, [error]);

  useEffect(() => {
    // O `defaultTheme` do ProvedorTema é `dark`, então "nada salvo" significa
    // escuro — só `light` e `system` mudam alguma coisa. O acesso ao
    // localStorage vai em try porque navegador com armazenamento bloqueado
    // levanta exceção na leitura, e uma tela de erro que quebra ao tentar
    // acertar a cor seria a piada pronta.
    let escolha: string | null = null;
    try {
      escolha = window.localStorage.getItem(CHAVE_DO_TEMA);
    } catch {
      escolha = null;
    }
    const escuro =
      escolha === 'light'
        ? false
        : escolha === 'system'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
          : true;
    document.documentElement.classList.toggle('dark', escuro);
  }, []);

  return (
    <html lang="pt-BR" className="dark h-full antialiased">
      <body className="flex min-h-full flex-col bg-background text-foreground">
        {/* `metadata` não existe em componente de cliente; o título entra pelo
            elemento, que o React hoisteia para o <head>. */}
        <title>Não deu para carregar · Tríade</title>

        <main
          role="alert"
          className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-6 py-10 text-center"
        >
          <h1 className="font-heading text-lg font-semibold">Não deu para carregar esta tela.</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            A falha é do CRM, não de algo que você tenha feito. Tente de novo — muitas vezes é só a
            conexão caindo por um instante. Se voltar a acontecer, avise um admin (Rafael, Luiz ou
            Matheus).
          </p>

          {/* Botões escritos à mão: o `Button` de @/components/ui é um componente a
              mais para carregar num momento em que a renderização já falhou uma vez.
              As classes são as mesmas do variante `default` e `outline`. */}
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <button
              type="button"
              onClick={() => retry()}
              className="acao-gradiente toque inline-flex h-11 shrink-0 items-center justify-center rounded-lg px-3 text-sm font-medium md:h-9"
            >
              Tentar de novo
            </button>
            <a
              href="/meu-dia"
              className="toque inline-flex h-11 shrink-0 items-center justify-center rounded-lg border border-input bg-background px-3 text-sm font-medium hover:bg-muted md:h-9"
            >
              Ir para o Meu dia
            </a>
          </div>

          {error.digest ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Código desta falha: <span className="numerico font-medium">{error.digest}</span>. É
              por ele que o admin acha o que aconteceu no registro do servidor.
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
