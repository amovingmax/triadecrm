'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import type { OrigemDeArquivo } from './tipos';

/**
 * De onde veio esta lista (RF-BAS-10; anexo R06).
 *
 * Até aqui a tela gravava `planilha` fixo em `import_batches.source_id`. Um lote
 * de raspagem rotulado "planilha" é mentira no registro legal das operações de
 * tratamento — e é essa linha que se lê quando alguém pergunta de onde saiu o
 * número dele. A lista vem de `sources`, das fontes que aceitam arquivo.
 */
export function SeletorDeOrigem({
  origens,
  valor,
  aoMudar,
  temColunaDeOrigem,
}: {
  origens: readonly OrigemDeArquivo[];
  /** `sources.id` da fonte escolhida. */
  valor: number;
  aoMudar: (id: number) => void;
  /** O arquivo traz coluna de origem? Então ela manda em cada linha. */
  temColunaDeOrigem: boolean;
}) {
  const escolhida = origens.find((o) => o.id === valor);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-hairline p-3">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="origem-do-lote" className="font-medium">
          De onde veio esta lista
        </label>
        <Select value={String(valor)} onValueChange={(v) => aoMudar(Number(v))}>
          <SelectTrigger id="origem-do-lote" className="toque h-11 w-full md:h-9 md:w-80">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {origens.map((o) => (
              <SelectItem key={o.id} value={String(o.id)}>
                {o.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="max-w-prose text-sm text-muted-foreground">
        {temColunaDeOrigem ? (
          <>
            O arquivo tem uma coluna de origem: ela manda em cada linha.{' '}
            <span className="text-foreground">{escolhida?.nome ?? 'A origem escolhida'}</span> fica
            registrada no lote.
          </>
        ) : (
          <>
            Cada linha entra como{' '}
            <span className="text-foreground">{escolhida?.nome ?? 'a origem escolhida'}</span>. É o
            que o CRM responde quando perguntarem de onde saiu aquele número.
          </>
        )}
      </p>
    </div>
  );
}
