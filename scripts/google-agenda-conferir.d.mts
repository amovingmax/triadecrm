/**
 * Os tipos de `google-agenda-conferir.mjs`, para o teste dos workers
 * (`apps/workers/src/agenda/conferir.test.ts`) importar o script com o typecheck ligado.
 */
export declare const AGENDA_DA_IMOVA: string;
export declare const CONTA_DA_IMOVA: string;
export declare const ESCOPO: string;

export interface CredencialLida {
  client_email: string;
  client_id: string | null;
  private_key: string;
  token_uri: string;
}

export declare function lerCredencial(
  cru: string | null | undefined,
): { credencial: CredencialLida; erro?: undefined } | { erro: string; credencial?: undefined };

export declare function jwtDaContaDeServico(
  credencial: { client_email: string; private_key: string; token_uri?: string },
  agoraSegundos: number,
  sub?: string,
): string;

export interface ContextoDoDiagnostico {
  sub?: string | null;
  conta?: string;
  clientId?: string | null;
}

export declare function diagnosticoDoToken(
  status: number,
  corpo: unknown,
  contexto?: ContextoDoDiagnostico,
): string;
export declare function diagnosticoDaAgenda(
  status: number,
  corpo: unknown,
  contexto?: ContextoDoDiagnostico,
): string;
export declare function diagnosticoDaGravacao(
  status: number,
  corpo: unknown,
  contexto?: ContextoDoDiagnostico,
): string;

export interface PassoDaConferencia {
  nome: 'Credencial' | 'Token' | 'Agenda' | 'Gravar e apagar';
  ok: boolean;
  frase: string;
  aviso?: string;
}

export interface ResultadoDaConferencia {
  ok: boolean;
  passos: PassoDaConferencia[];
  conta: string | null;
  clientId: string | null;
  agenda: string;
  sub: string | null;
}

export declare function conferir(opcoes: {
  credencialCrua: string | null;
  agenda?: string;
  sub?: string;
  buscar?: typeof fetch;
  agora?: () => number;
  api?: string;
}): Promise<ResultadoDaConferencia>;

export declare function sqlDoGoogleAgendaId(agenda: string): string;
export declare function textoDoResultado(r: ResultadoDaConferencia): string;
export declare function lerArgumentos(
  argv: string[],
  ambiente?: Record<string, string | undefined>,
): {
  arquivo: string | null;
  agenda: string | null;
  sub: string | null;
  ajuda: boolean;
  erro: string | null;
};
