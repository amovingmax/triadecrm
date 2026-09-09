'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { RotateCw, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * Limite de erro da área autenticada.
 *
 * Sem este arquivo, qualquer falha de renderização dentro de `(app)` subia até o
 * fallback cru do Next: texto em inglês, fundo branco e — o que pesa de verdade —
 * sem `AppShell`. Cabeçalho, lateral e barra inferior só existem dentro da casca,
 * então a pessoa perdia a navegação inteira de uma vez. E o manifesto pede
 * `display: 'standalone'` (manifest.ts), ou seja: no CRM instalado, que é como o
 * time usa na rua, não há nem barra de navegador com botão de voltar. A única
 * saída era fechar e reabrir o aplicativo, entre uma visita e outra.
 *
 * O arquivo é irmão do `layout.tsx` do mesmo segmento, e é justamente por isso
 * que ele resolve: o `error.js` NÃO envolve o layout do próprio segmento, é
 * envolvido por ele. A casca sobrevive à falha, as quatro abas e o menu "Mais"
 * continuam à mão, e o que quebrou fica sendo só o miolo da tela.
 *
 * Duas saídas, de propósito. `retry()` cobre o caso comum (conexão que caiu por
 * um instante) sem tirar a pessoa de onde ela estava; se ele falhar de novo, o
 * link para o Meu dia devolve o chão sem depender de um botão de voltar que o
 * modo instalado não tem.
 *
 * `retry` e não `reset`: desde o Next 16.3 são props diferentes. `reset()` só
 * limpa o estado do limite e renderiza os mesmos filhos, o que repete a falha
 * quando a causa está no servidor; `retry()` refaz a busca antes de renderizar,
 * que é o que o botão "Tentar de novo" promete a quem clica.
 */
export default function ErroDaArea({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const rota = usePathname();

  useEffect(() => {
    // A mensagem crua não vai para a tela: em falha de Server Component ela pode
    // trazer nome de tabela, trecho de SQL ou o motivo que a RPC recusou, e esta
    // tela é vista no meio da rua, às vezes com o parceiro olhando junto. Para a
    // pessoa fica o `digest`, que é só um hash — e é por ele que quem for
    // investigar amarra o que ela viu ao erro que o servidor já registrou.
    //
    // O formato da linha é o mesmo de `lib/registro-do-servidor.ts` de propósito:
    // procurar por `motivo=` passa a achar também as falhas de tela, e não só as
    // de rota. Este efeito só roda no navegador, então a linha nasce no console
    // do aparelho; o par dela no log da Vercel é o erro original, gravado pelo
    // servidor com o mesmo `digest`. Telefone, e-mail e token não entram aqui,
    // pela mesma razão que não entram no registro do servidor.
    const campos = [
      error.name ? `erro=${error.name}` : '',
      error.digest ? `digest=${error.digest}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    console.error(`[erro] ${rota} motivo=render_falhou${campos ? ' ' + campos : ''}`);
  }, [error, rota]);

  return (
    <div
      role="alert"
      className="mx-auto flex w-full max-w-md flex-col items-center gap-4 py-10 text-center"
    >
      <span className="flex size-11 items-center justify-center rounded-xl bg-destructive/10 text-destructive-texto">
        <TriangleAlert className="size-5" aria-hidden="true" />
      </span>

      <div className="space-y-1.5">
        <h1 className="font-heading text-lg font-semibold">Não deu para carregar esta tela.</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          A falha é do CRM, não de algo que você tenha feito. Tente de novo — muitas vezes é só a
          conexão caindo por um instante. Se voltar a acontecer, avise um admin (Rafael, Luiz ou
          Matheus).
        </p>
      </div>

      {/* No celular os dois botões ocupam a largura toda e empilham: o polegar de quem
          está em pé na calçada não acerta dois alvos lado a lado de 8px de altura. */}
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
        <Button onClick={() => retry()} className="toque h-11 md:h-9">
          <RotateCw aria-hidden="true" />
          Tentar de novo
        </Button>
        <Button asChild variant="outline" className="toque h-11 md:h-9">
          <Link href="/meu-dia">Ir para o Meu dia</Link>
        </Button>
      </div>

      {error.digest ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Código desta falha: <span className="numerico font-medium">{error.digest}</span>. É por
          ele que o admin acha o que aconteceu no registro do servidor.
        </p>
      ) : null}
    </div>
  );
}
