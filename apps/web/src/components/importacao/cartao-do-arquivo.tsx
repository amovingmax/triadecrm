'use client';

import { useState } from 'react';
import { ChevronRight, FileSpreadsheet } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatarNumero } from '@/components/parceiros/formatos';

import type { OrigemDetectada } from './origem-detectada';
import { rotuloComRessalva, type ReciboDeLeitura } from './recibo-de-leitura';
import type { OrigemDeArquivo, PlanilhaLida } from './tipos';

/**
 * O arquivo escolhido, numa linha: o nome, quantas linhas e de onde veio.
 *
 * Substitui TRÊS blocos que a tela empilhava antes de chegar ao que importa
 * (30/09/2026): o cartão do arquivo, a frase "Google Maps (raspagem local) —
 * reconheci por cid, plus_code, data_id, não é?" e o recibo "O CRM leu 10
 * colunas das 36", com a lista das colunas ignoradas e o porquê de cada uma.
 * Tudo isso continua aqui, mas o recibo das colunas fica atrás de um "ver" —
 * ele é conferência para quem desconfia, não leitura obrigatória.
 *
 * A ORIGEM continua sendo afirmada, e não perguntada: o CRM lê o cabeçalho e
 * diz de onde a lista veio (é isso que decide qual mapa de categorias o banco
 * consulta). Só que o porquê técnico ("cid, plus_code, data_id") saiu da tela:
 * quem importa quer saber SE está certo, não como o CRM descobriu. Errado, o
 * "trocar" abre o menu logo abaixo.
 */
export function CartaoDoArquivo({
  arquivo,
  planilha,
  origens,
  origemId,
  aoMudarOrigem,
  deteccao,
  temColunaDeOrigem,
  menuAberto,
  aoAbrirMenu,
  recibo,
  aoTrocarArquivo,
  aoAjustarColunas,
}: {
  arquivo: File | null;
  planilha: PlanilhaLida;
  origens: readonly OrigemDeArquivo[];
  origemId: number;
  aoMudarOrigem: (id: number) => void;
  deteccao: OrigemDetectada | null;
  /** O arquivo traz coluna de origem? Então ela manda em cada linha. */
  temColunaDeOrigem: boolean;
  menuAberto: boolean;
  aoAbrirMenu: () => void;
  /** O que o CRM leu. Nulo no passo das colunas, que mostra a grade inteira. */
  recibo: ReciboDeLeitura | null;
  aoTrocarArquivo: () => void;
  /** Volta ao passo das colunas. Só existe depois dele. */
  aoAjustarColunas?: () => void;
}) {
  const [vendoColunas, setVendoColunas] = useState(false);
  const escolhida = origens.find((o) => o.id === origemId);
  const linhas = planilha.linhas.length;

  return (
    <section
      aria-label="Arquivo escolhido"
      className="sombra-base flex flex-col gap-3 rounded-xl bg-card p-4 sm:p-5"
    >
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
          <FileSpreadsheet className="size-[18px]" aria-hidden="true" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium" title={arquivo?.name ?? planilha.aba}>
            {arquivo?.name ?? planilha.aba}
          </p>
          <p className="text-[13px] text-muted-foreground">
            <span className="numerico">{formatarNumero(linhas)}</span>{' '}
            {linhas === 1 ? 'linha' : 'linhas'}
            {' · '}
            {temColunaDeOrigem ? (
              'a origem vem de cada linha'
            ) : (
              <>
                {escolhida?.nome ?? 'origem não escolhida'}
                {deteccao?.origem && !menuAberto ? (
                  <span className="sr-only"> (reconhecida pelas colunas do arquivo)</span>
                ) : null}
                {menuAberto ? null : (
                  <>
                    {' · '}
                    <button
                      type="button"
                      onClick={aoAbrirMenu}
                      className="toque underline underline-offset-4 hover:text-foreground"
                    >
                      trocar
                    </button>
                  </>
                )}
              </>
            )}
          </p>
        </div>
        {/* "Trocar" no celular: com "Trocar arquivo" o nome do arquivo virava
            "maps-natal-foto..." e a linha de baixo quebrava em três. */}
        <Button variant="outline" onClick={aoTrocarArquivo} className="toque h-11 shrink-0 md:h-9">
          <span className="sm:hidden">Trocar</span>
          <span className="hidden sm:inline">Trocar arquivo</span>
        </Button>
      </div>

      {menuAberto && !temColunaDeOrigem ? (
        <div className="flex flex-col gap-2 rounded-lg bg-muted/45 p-3 sm:flex-row sm:items-center sm:gap-3">
          <label htmlFor="origem-do-lote" className="text-sm font-medium">
            De onde veio esta lista?
          </label>
          <Select value={String(origemId)} onValueChange={(v) => aoMudarOrigem(Number(v))}>
            <SelectTrigger id="origem-do-lote" className="toque h-11 w-full bg-card md:h-9 md:w-80">
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
          <p className="text-xs text-muted-foreground">
            É por ela que o CRM entende as categorias da lista.
          </p>
        </div>
      ) : null}

      {recibo ? (
        <div className="border-t border-hairline pt-2">
          <button
            type="button"
            aria-expanded={vendoColunas}
            onClick={() => setVendoColunas((v) => !v)}
            className="toque flex min-h-11 items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground sm:min-h-8"
          >
            <ChevronRight
              className={`size-3.5 shrink-0 transition-transform ${vendoColunas ? 'rotate-90' : ''}`}
              aria-hidden="true"
            />
            O que o CRM leu do arquivo:{' '}
            <span className="numerico">{recibo.lidas.length}</span> de{' '}
            <span className="numerico">{recibo.totalDeColunas}</span> colunas
          </button>

          {vendoColunas ? (
            <div className="mt-1 flex max-w-[90ch] flex-col gap-2 pl-5 text-sm">
              <p>{recibo.lidas.map(rotuloComRessalva).join(' · ')}</p>
              {recibo.ignoradas.some((i) => i.motivo) ? (
                <ul className="flex flex-col gap-0.5 text-[13px] text-muted-foreground">
                  {recibo.ignoradas
                    .filter((i) => i.motivo)
                    .map((i) => (
                      <li key={i.indice}>
                        <span className="text-foreground">{i.titulo}</span>: {i.motivo}
                      </li>
                    ))}
                </ul>
              ) : null}
              {planilha.tituloIgnorado.length > 0 ? (
                <p className="text-[13px] text-muted-foreground">
                  A primeira linha do arquivo foi lida como título, e não como cabeçalho:{' '}
                  <span className="text-foreground">
                    {planilha.tituloIgnorado.map((l) => `“${l}”`).join('; ')}
                  </span>
                  .
                </p>
              ) : null}
              {aoAjustarColunas ? (
                <div>
                  <Button variant="outline" size="sm" onClick={aoAjustarColunas} className="toque h-11 md:h-8">
                    Ajustar as colunas
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
