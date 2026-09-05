'use client';

import { useCallback, useId, useRef, useState } from 'react';
import { FileSpreadsheet, Upload } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/**
 * Passo 1: o arquivo.
 *
 * Arrastar e soltar é o gesto natural no computador; no celular ele não existe, e
 * por isso o botão nunca é decoração — é o caminho principal do aparelho da
 * Heloísa. A área toda é um `<label>`, então tocar em qualquer lugar dela abre o
 * seletor, e o teclado chega no `<input>` por Tab como em qualquer formulário.
 */
export function PassoArquivo({
  aoEscolher,
  ocupado,
  passo,
}: {
  aoEscolher: (arquivo: File) => void;
  ocupado: boolean;
  /** Em que ponto a leitura está, para a área dizer algo verdadeiro enquanto lê. */
  passo: 'lendo' | 'abrindo' | 'varrendo' | null;
}) {
  const id = useId();
  const entrada = useRef<HTMLInputElement>(null);
  const [sobre, setSobre] = useState(false);

  const soltar = useCallback(
    (evento: React.DragEvent) => {
      evento.preventDefault();
      setSobre(false);
      const arquivo = evento.dataTransfer.files?.[0];
      if (arquivo) aoEscolher(arquivo);
    },
    [aoEscolher],
  );

  const legenda =
    passo === 'lendo'
      ? 'Lendo o arquivo...'
      : passo === 'abrindo'
        ? 'Abrindo a planilha...'
        : passo === 'varrendo'
          ? 'Varrendo as linhas...'
          : null;

  return (
    <label
      htmlFor={id}
      onDragOver={(e) => {
        e.preventDefault();
        setSobre(true);
      }}
      onDragLeave={() => setSobre(false)}
      onDrop={soltar}
      className={cn(
        'flex cursor-pointer flex-col items-center gap-3 rounded-xl border border-dashed border-hairline px-6 py-10 text-center transition-colors',
        sobre && 'border-ring bg-muted/60',
        ocupado && 'pointer-events-none opacity-60',
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        {ocupado ? (
          <FileSpreadsheet className="size-5 animate-pulse" aria-hidden="true" />
        ) : (
          <Upload className="size-5" aria-hidden="true" />
        )}
      </span>

      <div className="space-y-1">
        <p className="font-heading font-medium">
          {legenda ?? 'Arraste a planilha aqui ou escolha o arquivo'}
        </p>
        <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
          Aceita .xlsx e .csv. A planilha-ponte do Dia 0 entra sem ajuste nenhum; qualquer outra
          lista também entra, e você corrige as colunas no passo seguinte.
        </p>
      </div>

      <input
        ref={entrada}
        id={id}
        type="file"
        accept=".xlsx,.xlsm,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
        className="sr-only"
        disabled={ocupado}
        onChange={(e) => {
          const arquivo = e.target.files?.[0];
          // Limpa para que escolher o MESMO arquivo de novo dispare o evento
          // (o navegador não avisa quando o valor não muda).
          e.target.value = '';
          if (arquivo) aoEscolher(arquivo);
        }}
      />

      <Button
        type="button"
        variant="outline"
        disabled={ocupado}
        onClick={() => entrada.current?.click()}
        className="toque h-11 md:h-9"
      >
        Escolher arquivo
      </Button>
    </label>
  );
}
