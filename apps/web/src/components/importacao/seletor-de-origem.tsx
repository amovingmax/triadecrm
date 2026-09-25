'use client';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import type { OrigemDetectada } from './origem-detectada';
import type { OrigemDeArquivo } from './tipos';

/**
 * Que arquivo é este (RF-BAS-10; anexo R06).
 *
 * Até 24/09/2026 isto era um menu de dois itens que nascia em *Planilha*, e a
 * tela não dizia o que aquela escolha mudava. Custou caro, e é medido: o CSV do
 * Maps importado com o seletor errado não consulta o mapa de categorias da
 * fonte, e as 20 linhas dos fotógrafos viraram 0 fichas e 19 cartões de fila.
 *
 * Agora o CRM lê o cabeçalho e AFIRMA — e a afirmação vem com o porquê, para
 * poder ser contestada. O menu só reaparece no "não é?". A escolha manual vence
 * a detecção e é ela que fica gravada em `import_batches.source_id`, que é a
 * linha que se lê quando alguém pergunta de onde saiu o número dele.
 */
export function SeletorDeOrigem({
  origens,
  valor,
  aoMudar,
  temColunaDeOrigem,
  deteccao,
  aberto,
  aoAbrir,
}: {
  origens: readonly OrigemDeArquivo[];
  /** `sources.id` da fonte escolhida. */
  valor: number;
  aoMudar: (id: number) => void;
  /** O arquivo traz coluna de origem? Então ela manda em cada linha. */
  temColunaDeOrigem: boolean;
  /** O que o CRM leu no cabeçalho. Nulo antes de haver arquivo. */
  deteccao: OrigemDetectada | null;
  /** Fechado por padrão: a linha é um fato, e o menu só abre no "não é?". */
  aberto: boolean;
  aoAbrir: () => void;
}) {
  const escolhida = origens.find((o) => o.id === valor);
  // Sem leitura ainda não há fato a afirmar: aí o menu é o próprio conteúdo.
  const semLeitura = deteccao === null;
  const mostrarMenu = aberto || semLeitura;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-hairline p-3">
      {semLeitura ? null : (
        <p className="text-sm text-muted-foreground">
          <span className="text-foreground">{escolhida?.nome ?? 'A origem escolhida'}</span>
          {deteccao.porque.length > 0 ? (
            <> — reconheci por {deteccao.porque.join(', ')}</>
          ) : (
            <> — nenhuma coluna do Google Maps neste arquivo</>
          )}{' '}
          {mostrarMenu ? null : (
            <Button variant="link" className="toque h-auto p-0" onClick={aoAbrir}>
              não é?
            </Button>
          )}
        </p>
      )}

      {mostrarMenu ? (
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="origem-do-lote" className="font-medium">
            Que arquivo é este?
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
      ) : null}

      {mostrarMenu ? (
        <p className="max-w-prose text-sm text-muted-foreground">
          {temColunaDeOrigem ? (
            <>
              Este arquivo já diz, linha a linha, de onde veio cada nome. O CRM usa o que está no
              arquivo.
            </>
          ) : (
            <>
              É por aqui que o CRM traduz as categorias do arquivo — e é o que ele responde se
              alguém perguntar de onde saiu o número dele. Marcar errado manda a lista inteira para
              a fila.
            </>
          )}
        </p>
      ) : null}
    </div>
  );
}
