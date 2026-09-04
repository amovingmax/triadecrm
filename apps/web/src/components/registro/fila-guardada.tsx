'use client';

import { CloudOff, Loader2, RotateCw, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { formatarQuando } from './formatos';
import type { RegistroNaFila } from './tipos';

/**
 * O que está guardado no aparelho e ainda não subiu.
 *
 * Existe por um motivo só: **falha silenciosa é o pior resultado possível.** Quem
 * registra na calçada perde sinal o tempo todo, e um registro que some sem deixar
 * rastro vira meta errada, parceiro sem follow-up e desconfiança na tela inteira.
 * Então tudo o que não gravou aparece aqui, com nome do parceiro, o que ela marcou e o
 * motivo — e com um botão para tentar de novo.
 *
 * São dois estados, e a diferença de peso visual é proposital:
 *
 * - **esperando**: a rede caiu, o item sobe sozinho quando voltar. Uma linha fina, sem
 *   susto: não há nada para ela fazer.
 * - **parado**: parou de tentar sozinho (sessão vencida, tentativas esgotadas, recusa
 *   do servidor). Aí sim precisa de olho humano, e a caixa fica em brasa.
 *
 * A caixa não some sozinha e não se fecha: sair da tela com registro parado é
 * justamente o que não pode acontecer sem ela ver.
 */
export function FilaGuardada({
  itens,
  drenando,
  aoTentar,
  aoDescartar,
}: {
  itens: readonly RegistroNaFila[];
  drenando: boolean;
  aoTentar: () => void;
  aoDescartar: (clientKey: string) => void;
}) {
  const parados = itens.filter((i) => i.esgotado);
  const esperando = itens.filter((i) => !i.esgotado);
  if (itens.length === 0) return null;

  if (parados.length === 0) {
    return (
      <div className="mb-3 flex items-center gap-2.5 rounded-lg border border-hairline bg-card/50 px-3 py-2.5 text-sm">
        {drenando ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
        ) : (
          <CloudOff className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <p className="min-w-0 flex-1 text-muted-foreground">
          {esperando.length === 1
            ? '1 registro guardado neste aparelho.'
            : `${esperando.length} registros guardados neste aparelho.`}{' '}
          <span className="text-foreground">
            {esperando.length === 1
              ? 'Sobe sozinho quando a rede voltar.'
              : 'Sobem sozinhos quando a rede voltar.'}
          </span>
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 shrink-0 px-3"
          onClick={aoTentar}
          disabled={drenando}
        >
          Tentar agora
        </Button>
      </div>
    );
  }

  return (
    <div className="mb-3 flex flex-col gap-2.5 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-3">
      <p className="flex items-start gap-2.5 text-sm">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive-texto" aria-hidden />
        <span>
          <span className="font-medium">
            {parados.length === 1
              ? '1 registro não subiu.'
              : `${parados.length} registros não subiram.`}
          </span>{' '}
          <span className="text-muted-foreground">
            Nada se perdeu: ficaram guardados neste aparelho.
          </span>
        </span>
      </p>

      <ul className="flex flex-col divide-y divide-hairline border-y border-hairline">
        {parados.map((item) => (
          <li key={item.clientKey} className="flex items-center gap-2 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                <span className="font-medium">{item.parceiro}</span>
                <span className="text-muted-foreground"> · {item.desfecho}</span>
              </p>
              {/* Duas linhas, não `truncate`: o motivo é a parte acionável ("entre de
                  novo", "não está na sua carteira"), e cortá-lo na metade em 390px
                  devolveria a mesma opacidade que esta caixa existe para acabar. */}
              <p className="line-clamp-2 text-xs text-muted-foreground">
                {item.ultimoErro ?? 'Não deu para gravar.'}
                {formatarQuando(item.criadoEm) ? ` · ${formatarQuando(item.criadoEm)}` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={() => aoDescartar(item.clientKey)}
              className="toque h-11 shrink-0 rounded-lg px-2.5 text-sm text-muted-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Descartar
            </button>
          </li>
        ))}
      </ul>

      {esperando.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {esperando.length === 1
            ? 'Mais 1 registro ainda esperando a rede.'
            : `Mais ${esperando.length} registros ainda esperando a rede.`}
        </p>
      ) : null}

      <Button type="button" className="h-11 w-full" onClick={aoTentar} disabled={drenando}>
        {drenando ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCw aria-hidden />}
        Tentar de novo
      </Button>
    </div>
  );
}
