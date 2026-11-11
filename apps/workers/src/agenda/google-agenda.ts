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
 * PLANO B: DELEGAÇÃO EM TODO O DOMÍNIO (11/11/2026)
 * ---------------------------------------------------------------------------
 * Se o compartilhamento com a conta de serviço não pegar (em 10/11 ele não
 * tinha propagado), o admin do Google Workspace da Imova autoriza a conta de
 * serviço a agir em nome de um usuário do domínio, só no escopo de eventos
 * (Segurança → Controles de API → Delegação em todo o domínio). Com
 * `GOOGLE_AGENDA_SUB` (o e-mail desse usuário), o JWT leva `sub` e o token sai
 * em nome dele: a agenda vale pelo acesso que ELE tem. Sem a variável, tudo
 * segue como antes. Passo a passo em docs/operacao/calendly.md.
 *
 * OS FERIADOS (11/11/2026)
 * ---------------------------------------------------------------------------
 * O Calendly só sabe "seg. a sex." e oferecia os feriados da Imova. O banco
 * manda cada feriado dos próximos 12 meses como um bloco de dia inteiro
 * ("Ocupado — feriado"), opaco: é o "Ocupado" que o Calendly respeita.
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
/** O título do bloco de dia inteiro de cada feriado da Imova. */
export const TITULO_DO_FERIADO = 'Ocupado — feriado';

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

/**
 * O JWT que troca por um token de acesso (RFC 7523), válido por uma hora.
 * Com `sub` (o plano B), o token sai em nome desse usuário do Workspace.
 */
export function jwtDaContaDeServico(
  credencial: CredencialDoGoogle,
  agoraSegundos: number,
  sub?: string,
): string {
  const cabecalho = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const emNomeDe = sub?.trim();
  const corpo = base64url(
    JSON.stringify({
      iss: credencial.client_email,
      ...(emNomeDe ? { sub: emNomeDe } : {}),
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

/**
 * O feriado: dia inteiro (`date`, com o fim exclusivo: o dia seguinte),
 * opaco — o Google deixa o dia inteiro como "Livre" por padrão, e aí o
 * Calendly não o veria —, privado, sem lembrete e sem convidado.
 */
export function corpoDoFeriado(dia: string, ate: string): Record<string, unknown> {
  return {
    summary: TITULO_DO_FERIADO,
    start: { date: dia },
    end: { date: ate },
    transparency: 'opaque',
    visibility: 'private',
    status: 'confirmed',
    reminders: { useDefault: false, overrides: [] },
    extendedProperties: { private: { origem: 'triade-crm', tipo: 'feriado' } },
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
      /** O usuário do Workspace em nome de quem o token sai (plano B). */
      sub?: string;
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
        assertion: jwtDaContaDeServico(this.opcoes.credencial, this.agora(), this.opcoes.sub),
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
    return this.gravarCorpo(calendario, eventoId, corpoDoBloco(inicio, fim), 'PATCH');
  }

  /**
   * Grava ou atualiza o bloco de dia inteiro de um feriado (`dia` e `ate` em
   * AAAA-MM-DD; `ate` é o dia seguinte). O evento que já existe é SUBSTITUÍDO
   * (PUT), e não remendado: um PATCH com `date` por cima de um evento com
   * `dateTime` (o bloco das 0h às 24h que o worker anterior gravaria) deixaria
   * os dois campos juntos, e o Google recusa.
   */
  async gravarFeriado(
    calendario: string,
    eventoId: string,
    dia: string,
    ate: string,
  ): Promise<ResultadoNoGoogle> {
    return this.gravarCorpo(calendario, eventoId, corpoDoFeriado(dia, ate), 'PUT');
  }

  private async gravarCorpo(
    calendario: string,
    eventoId: string,
    corpo: Record<string, unknown>,
    atualizarCom: 'PATCH' | 'PUT',
  ): Promise<ResultadoNoGoogle> {
    try {
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
        atualizarCom,
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
