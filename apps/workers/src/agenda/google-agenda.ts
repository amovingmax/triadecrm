/**
 * O Google Agenda que o Calendly confere, visto pelo CRM (10/11/2026).
 *
 * POR QUE ISTO EXISTE
 * ---------------------------------------------------------------------------
 * O Calendly não enxerga a agenda do CRM. Para ele esconder do cliente o
 * horário que a equipe ou a IA já ocuparam, o CRM grava cada compromisso como
 * "Ocupado" num Google Agenda ligado ao Calendly (decisão do usuário,
 * 10/11/2026). Só início e fim: nenhum nome, telefone ou endereço vai ao Google.
 *
 * SEM LOGIN DE PESSOA
 * ---------------------------------------------------------------------------
 * A agenda saiu do Google em 30/09 (ADR-15) porque dependia do OAuth de cada
 * pessoa, com refresh token que vence. Aqui é uma CONTA DE SERVIÇO do Google
 * Cloud: uma chave (JSON) no segredo do worker, e o Google Agenda compartilhado
 * com o e-mail dela ("Fazer alterações nos eventos"). O token de uma hora sai
 * de um JWT assinado com a chave (RFC 7523), sem ninguém clicar em nada.
 *
 * GRAVAR DUAS VEZES NÃO DUPLICA
 * ---------------------------------------------------------------------------
 * O id do evento é o id do compromisso no CRM sem hífens (o banco manda pronto):
 * base32hex válido para o Google. Inserir um id que já existe responde 409, e
 * aí o evento é atualizado no lugar — inclusive o que tinha sido apagado, que o
 * Google guarda como "cancelled" e volta a "confirmed".
 */
import { createSign } from 'node:crypto';

const ESCOPO = 'https://www.googleapis.com/auth/calendar.events';
const TOKEN_URI_PADRAO = 'https://oauth2.googleapis.com/token';
const API_PADRAO = 'https://www.googleapis.com/calendar/v3';

/** O título dos blocos no Google Agenda. É por ele que se acham e se apagam à mão. */
export const TITULO_DO_BLOCO = 'Ocupado — CRM Imova';

export interface CredencialDoGoogle {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export type ResultadoNoGoogle = { ok: true } | { ok: false; transitorio: boolean; erro: string };

/** A chave da conta de serviço: o JSON que o Google Cloud baixa, cru ou em base64. */
export function lerCredencial(cru: string): CredencialDoGoogle {
  const texto = cru.trim();
  const json = texto.startsWith('{') ? texto : Buffer.from(texto, 'base64').toString('utf8');
  let valor: unknown;
  try {
    valor = JSON.parse(json);
  } catch {
    throw new Error('GOOGLE_AGENDA_CREDENCIAL não é o JSON da conta de serviço (nem em base64)');
  }
  const c = valor as Partial<CredencialDoGoogle>;
  if (typeof c.client_email !== 'string' || typeof c.private_key !== 'string') {
    throw new Error('GOOGLE_AGENDA_CREDENCIAL não tem client_email e private_key');
  }
  return { client_email: c.client_email, private_key: c.private_key, token_uri: c.token_uri };
}

function base64url(dados: string | Buffer): string {
  return Buffer.from(dados).toString('base64url');
}

/** O JWT que troca por um token de acesso (RFC 7523), válido por uma hora. */
export function jwtDaContaDeServico(credencial: CredencialDoGoogle, agoraSegundos: number): string {
  const cabecalho = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const corpo = base64url(
    JSON.stringify({
      iss: credencial.client_email,
      scope: ESCOPO,
      aud: credencial.token_uri ?? TOKEN_URI_PADRAO,
      iat: agoraSegundos,
      exp: agoraSegundos + 3600,
    }),
  );
  const assinador = createSign('RSA-SHA256');
  assinador.update(`${cabecalho}.${corpo}`);
  return `${cabecalho}.${corpo}.${assinador.sign(credencial.private_key).toString('base64url')}`;
}

/** O evento "Ocupado": opaco (conta como ocupado), privado, sem lembrete e sem convidado. */
export function corpoDoBloco(inicio: string, fim: string): Record<string, unknown> {
  return {
    summary: TITULO_DO_BLOCO,
    start: { dateTime: inicio },
    end: { dateTime: fim },
    transparency: 'opaque',
    visibility: 'private',
    status: 'confirmed',
    reminders: { useDefault: false, overrides: [] },
    extendedProperties: { private: { origem: 'triade-crm' } },
  };
}

function transitorio(status: number): boolean {
  return status === 401 || status === 408 || status === 429 || status >= 500;
}

export class ClienteDoGoogleAgenda {
  private tokenAtual: string | null = null;
  private validoAte = 0;

  constructor(
    private readonly opcoes: {
      credencial: CredencialDoGoogle;
      buscar?: typeof fetch;
      /** Segundos desde 1970. Substituível nos testes. */
      agora?: () => number;
      api?: string;
    },
  ) {}

  private get buscar(): typeof fetch {
    return this.opcoes.buscar ?? fetch;
  }

  private agora(): number {
    return this.opcoes.agora?.() ?? Math.floor(Date.now() / 1000);
  }

  private async token(): Promise<string> {
    // Um minuto de folga: o token não vence no meio de uma chamada.
    if (this.tokenAtual && this.agora() < this.validoAte - 60) return this.tokenAtual;
    const resposta = await this.buscar(this.opcoes.credencial.token_uri ?? TOKEN_URI_PADRAO, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwtDaContaDeServico(this.opcoes.credencial, this.agora()),
      }).toString(),
    });
    const corpo = (await resposta.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error_description?: string;
      error?: string;
    };
    if (!resposta.ok || !corpo.access_token) {
      throw new Error(
        `o Google não deu o token (${resposta.status}): ${corpo.error_description ?? corpo.error ?? 'sem detalhe'}`,
      );
    }
    this.tokenAtual = corpo.access_token;
    this.validoAte = this.agora() + (corpo.expires_in ?? 3600);
    return this.tokenAtual;
  }

  private async chamar(
    metodo: string,
    caminho: string,
    corpo?: Record<string, unknown>,
  ): Promise<{ status: number; erro: string }> {
    const resposta = await this.buscar(`${this.opcoes.api ?? API_PADRAO}${caminho}`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        ...(corpo ? { 'Content-Type': 'application/json' } : {}),
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    if (resposta.status === 401) {
      // Token recusado: o próximo pedido busca outro.
      this.tokenAtual = null;
    }
    let erro = '';
    if (!resposta.ok) {
      const json = (await resposta.json().catch(() => ({}))) as { error?: { message?: string } };
      erro = json.error?.message ?? resposta.statusText ?? '';
    } else {
      await resposta.body?.cancel().catch(() => undefined);
    }
    return { status: resposta.status, erro };
  }

  private caminhoDosEventos(calendario: string): string {
    return `/calendars/${encodeURIComponent(calendario)}/events`;
  }

  /** Grava ou atualiza o bloco do compromisso. */
  async gravar(
    calendario: string,
    eventoId: string,
    inicio: string,
    fim: string,
  ): Promise<ResultadoNoGoogle> {
    try {
      const corpo = corpoDoBloco(inicio, fim);
      const base = this.caminhoDosEventos(calendario);
      const inserido = await this.chamar('POST', `${base}?sendUpdates=none`, {
        id: eventoId,
        ...corpo,
      });
      if (inserido.status >= 200 && inserido.status < 300) return { ok: true };
      if (inserido.status !== 409) {
        return {
          ok: false,
          transitorio: transitorio(inserido.status),
          erro: `Google ${inserido.status}: ${inserido.erro}`,
        };
      }
      // Já existe (ou existiu): atualiza no lugar.
      const mudado = await this.chamar(
        'PATCH',
        `${base}/${encodeURIComponent(eventoId)}?sendUpdates=none`,
        corpo,
      );
      if (mudado.status >= 200 && mudado.status < 300) return { ok: true };
      return {
        ok: false,
        transitorio: transitorio(mudado.status),
        erro: `Google ${mudado.status}: ${mudado.erro}`,
      };
    } catch (e) {
      return { ok: false, transitorio: true, erro: (e as Error).message };
    }
  }

  /** Apaga o bloco. O que já não existe conta como apagado. */
  async apagar(calendario: string, eventoId: string): Promise<ResultadoNoGoogle> {
    try {
      const r = await this.chamar(
        'DELETE',
        `${this.caminhoDosEventos(calendario)}/${encodeURIComponent(eventoId)}?sendUpdates=none`,
      );
      if ((r.status >= 200 && r.status < 300) || r.status === 404 || r.status === 410)
        return { ok: true };
      return {
        ok: false,
        transitorio: transitorio(r.status),
        erro: `Google ${r.status}: ${r.erro}`,
      };
    } catch (e) {
      return { ok: false, transitorio: true, erro: (e as Error).message };
    }
  }
}
