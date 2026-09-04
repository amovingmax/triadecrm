import type { Periodo } from './periodo';
import type { Coluna } from './tipos';

/**
 * Exportação em CSV do que está na tela (RF-REL-09: dados brutos junto do resumo).
 *
 * O arquivo sai das MESMAS definições de coluna que desenham a tabela, então não há
 * como a planilha discordar da tela. Formato escolhido para o Excel em português:
 * ponto e vírgula como separador, vírgula decimal (que já vem assim de `formatos.ts`)
 * e BOM no começo, sem o qual "Fotografia e vídeo" abre como "Fotografia e vÃ­deo".
 */

const SEPARADOR = ';';
const BOM = '\uFEFF';

function campo(valor: string): string {
  if (valor === '') return '';
  return /[";\r\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor;
}

export function montarCsv<L>(colunas: readonly Coluna<L>[], linhas: readonly L[]): string {
  const cabecalho = colunas.map((coluna) => campo(coluna.rotulo)).join(SEPARADOR);
  const corpo = linhas.map((linha) =>
    colunas.map((coluna) => campo(coluna.texto(linha))).join(SEPARADOR),
  );
  return BOM + [cabecalho, ...corpo].join('\r\n') + '\r\n';
}

/** `triade-funil-2026-08-06-a-2026-09-04.csv` */
export function nomeDoArquivo(painel: string, periodo: Periodo): string {
  return `triade-${painel}-${periodo.de}-a-${periodo.ate}.csv`;
}

/** Entrega o arquivo ao navegador. Só roda no cliente, a partir de um clique. */
export function baixarCsv(nome: string, conteudo: string): void {
  const blob = new Blob([conteudo], { type: 'text/csv;charset=utf-8' });
  const endereco = URL.createObjectURL(blob);
  const ancora = document.createElement('a');
  ancora.href = endereco;
  ancora.download = nome;
  document.body.append(ancora);
  ancora.click();
  ancora.remove();
  URL.revokeObjectURL(endereco);
}
