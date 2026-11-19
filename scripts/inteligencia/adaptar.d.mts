/**
 * Os tipos de `adaptar.mjs`, para os testes do site
 * (`apps/web/src/app/(inteligencia)/inteligencia/*.test.ts`) importarem o script com o
 * typecheck ligado e conferirem a página pronta com as mesmas regras.
 */
export declare const ROTA_INICIAL_DO_CRM: string;
export declare const CHAVE_DO_TEMA_DO_CRM: string;
export declare const CAMINHO_DA_PAGINA_PRONTA_NO_SITE: string;
export declare const TAMANHO_PARA_AVISAR: number;
export declare const BIBLIOTECAS_CONHECIDAS: Readonly<Record<string, string>>;
export declare const PONTE_DO_CRM: string;

export declare class ErroDaCopia extends Error {}

export declare function foraDosScripts(html: string, fn: (parte: string) => string): string;
export declare function ligarOVoltar(
  html: string,
  rotaInicial?: string,
): { html: string; trocados: number };
export declare function seguirOTemaDoCrm(html: string): { html: string; trocado: boolean };
export declare function fixarBibliotecas(
  html: string,
  conhecidas?: Readonly<Record<string, string>>,
): { html: string; desconhecidas: string[] };
export declare function problemasDeIntegridade(
  html: string,
  conhecidas?: Readonly<Record<string, string>>,
): string[];
export declare function porAPonte(html: string): { html: string; posta: boolean };
export declare function dataDaPagina(quando: string): string;
export declare function porAFaixaDaData(
  html: string,
  quando: string,
): { html: string; posta: boolean };
export declare function mencoesLiberadas(html: string): number;
export declare function marcarOHead(html: string, opcoes?: { mencoesLiberadas?: number }): string;
export declare function carimbar(
  html: string,
  opcoes: { origem: string; quando: string; mencoesLiberadas?: number },
): string;
export declare function problemasDaPagina(html: string): string[];
export declare function rastrosDePortais(html: string): {
  bloqueios: string[];
  mencoes: number;
  exemplosDeMencao: string[];
};
export declare function adaptarParaOCrm(
  html: string,
  opcoes?: {
    origem?: string;
    quando?: string;
    rotaInicial?: string;
    permitirMencoesEmTexto?: boolean;
  },
): {
  html: string;
  avisos: string[];
  tamanho: number;
  voltarTrocados: number;
  mencoesLiberadas: number;
  atualizadaEm: string;
};
