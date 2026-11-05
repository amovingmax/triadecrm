/**
 * Os downloads do site, dentro do app (05/11/2026).
 *
 * A WebView do iPhone ignora o download de arquivo gerado na página (as planilhas dos
 * relatórios, o CSV, a exportação do parceiro). No app, o site manda o arquivo inteiro
 * para a casca num recado (`apps/web/src/lib/entregar-arquivo.ts`), e a casca o grava
 * no aparelho e abre a folha de compartilhar: Salvar em Arquivos, WhatsApp, e-mail.
 *
 * Este arquivo só confere o recado, e não importa nada do React Native: roda igual na
 * casca e nos testes. O que vem da página é tratado como dado de fora: só passa nome
 * de arquivo simples, com um dos formatos que o site gera, e até um tamanho.
 */

/** O nome do recado, o mesmo de `RECADO_DE_ARQUIVO` no site. */
export const RECADO_DE_ARQUIVO = 'baixar-arquivo';

/** Os formatos que o site gera hoje, e o tipo que o Android pede para cada um. */
export const FORMATOS: Readonly<Record<string, string>> = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  json: 'application/json',
};

/** 20 MB de arquivo (o base64 é um terço maior). Planilha do Tríade passa longe disso. */
export const TETO_DO_ARQUIVO = 20 * 1024 * 1024;

export type ArquivoRecebido = { nome: string; base64: string; tipo: string };

export function arquivoDaMensagem(dados: string): ArquivoRecebido | null {
  let mensagem: unknown;
  try {
    mensagem = JSON.parse(dados);
  } catch {
    return null;
  }
  if (!mensagem || typeof mensagem !== 'object') return null;
  const { tipo, nome, base64 } = mensagem as { tipo?: unknown; nome?: unknown; base64?: unknown };
  if (tipo !== RECADO_DE_ARQUIVO || typeof nome !== 'string' || typeof base64 !== 'string') {
    return null;
  }
  const seguro = nomeSeguro(nome);
  if (!seguro) return null;
  if (base64.length === 0 || (base64.length * 3) / 4 > TETO_DO_ARQUIVO) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null;
  return { nome: seguro, base64, tipo: FORMATOS[extensao(seguro)]! };
}

/**
 * O nome como o aparelho vai mostrar: sem pasta, sem caractere de controle e com um
 * dos formatos conhecidos. Nome sem salvação é recusado, não "consertado" em silêncio.
 */
export function nomeSeguro(nome: string): string | null {
  // Barras, dois-pontos e caracteres de controle viram traço: nada de "../" nem de pasta.
  // eslint-disable-next-line no-control-regex
  const limpo = nome.replace(/[/\\:\u0000-\u001f\u007f]/g, '-').trim();
  if (!limpo || limpo.startsWith('.') || limpo.length > 120) return null;
  return extensao(limpo) in FORMATOS ? limpo : null;
}

function extensao(nome: string): string {
  const ponto = nome.lastIndexOf('.');
  return ponto < 0 ? '' : nome.slice(ponto + 1).toLowerCase();
}
