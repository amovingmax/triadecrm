/**
 * A CLOUD API OFICIAL DA META (ADR-06, R04 §2.1 e §3 item 5).
 *
 * "WhatsApp: Cloud API oficial da Meta (direto ou via 360dialog), Coexistence
 * no número 'Heloísa · Komune'. Nunca Baileys, Evolution ou qualquer automação
 * não oficial."
 *
 * São dois endpoints e uma tabela de erros. Sem SDK, sem dependência nova:
 * `fetch` do Node 22 e mais nada. O R04 §3 recomenda exatamente isto —
 * "200 linhas próprias sobre o Graph API (menos peças)".
 *
 * O QUE ESTE ARQUIVO DECIDE, E É A ÚNICA COISA QUE ELE DECIDE
 * ---------------------------------------------------------------------------
 * Se vale a pena tentar de novo. Um erro da Graph API não é um erro: são dois
 * mundos diferentes com a mesma cara de HTTP 400.
 *
 *   · TRANSITÓRIO — limite de vazão, limite por par, indisponibilidade. A
 *     mensagem continua legítima e o mundo é que está ocupado. Volta para a
 *     fila com backoff (`app.wa_falha` cuida disso).
 *   · DEFINITIVO — número sem WhatsApp, template inexistente, fora da janela
 *     de 24 h. Repetir não muda nada, e repetir quatro vezes um envio para
 *     fora da janela é quatro registros de "empresa insistindo" na conta que a
 *     Meta usa para calcular o quality rating do número.
 *
 * Errar para o lado do "retentar" custa reputação do número; errar para o lado
 * do "desistir" custa uma mensagem. Por isso a lista de "retentar" é FECHADA:
 * o que não está nela é definitivo.
 *
 * TESTE SEM CREDENCIAL. Não existe token da Meta neste repositório e não é
 * para existir. `META_WA_GRAPH_URL` aponta para o dublê
 * (`supabase/functions/_dubles/meta-graph-duble.mjs`), que responde como a
 * Graph API responde, com os mesmos códigos de erro.
 */

/** Versão da Graph API contra a qual este cliente foi escrito. */
export const VERSAO_PADRAO = 'v21.0';

export interface ConfigDaGraph {
  /** Base da API. Produção: https://graph.facebook.com. Teste: o dublê. */
  baseUrl: string;
  versao: string;
  phoneNumberId: string;
  token: string;
  /** Injetável para teste; por padrão o `fetch` do Node. */
  buscar?: typeof fetch;
  /** Tempo máximo de uma chamada. A Meta responde em ~1 s; 30 s é folga. */
  timeoutMs?: number;
}

export type Destino = { para: string };

export type Envio =
  | (Destino & { tipo: 'texto'; corpo: string })
  | (Destino & {
      tipo: 'template';
      nome: string;
      idioma: string;
      parametros: readonly string[];
    })
  | (Destino & { tipo: 'audio'; mediaId?: string; link?: string });

export type ResultadoDoEnvio =
  | { ok: true; wamid: string }
  | {
      ok: false;
      /** Código da Meta (131047, 190…) ou um nome nosso para falha de transporte. */
      codigo: string;
      mensagem: string;
      /** `true` = vale tentar de novo; `false` = repetir não muda nada. */
      retentar: boolean;
      httpStatus: number | null;
    };

/**
 * Códigos da Meta que valem uma nova tentativa. Lista FECHADA: o que não está
 * aqui é definitivo. Fonte: R04 §2.1 e a documentação de erros da Cloud API.
 */
const RETENTAR: ReadonlySet<number> = new Set([
  1, // erro interno não identificado do lado deles
  2, // serviço temporariamente indisponível
  4, // limite de chamadas da aplicação
  80007, // limite de vazão da conta
  130429, // limite de vazão da Cloud API
  131000, // erro genérico do lado deles
  131016, // serviço indisponível
  131049, // limite de marketing por usuário: a Meta pede explicitamente para tentar depois
  131056, // limite do par (nosso número, número dele)
  133016, // conta em recuperação
  190, // token inválido ou expirado — ver nota
]);

// O que DELIBERADAMENTE não está na lista, com o motivo:
//
//   131026  o número não tem WhatsApp. Não passa a ter na segunda tentativa.
//   131047  fora da janela de 24 h. Insistir é exatamente o comportamento que
//           a Meta conta contra o quality rating do número (R04 §4) — e a
//           mensagem já deveria ter morrido antes, em wa_saida_proximos.
//   132000  quantidade de parâmetros do template não bate com o aprovado.
//   132001  template inexistente ou não aprovado no idioma.
//   132005  template pausado por qualidade.
//   131051  tipo de mensagem não suportado.
//   100     parâmetro inválido: é bug nosso, e bug não melhora com repetição.
//
// `190` (token) é a única entrada em que a causa é NOSSA e ainda assim vale
// retentar: o token expirou e alguém precisa trocá-lo. Marcar como definitivo
// mataria, uma a uma, todas as mensagens da fila enquanto ninguém percebe. Com
// backoff elas sobrevivem ao tempo de alguém trocar o token — e, se ninguém
// trocar, morrem depois de quatro tentativas com `token_meta_invalido` na
// linha, que é uma frase que se lê na tela.

export class ClienteDaGraph {
  private readonly buscar: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigDaGraph) {
    this.buscar = config.buscar ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  private url(caminho: string): string {
    const base = this.config.baseUrl.replace(/\/+$/, '');
    return `${base}/${this.config.versao}/${caminho}`;
  }

  /** O corpo do POST, no formato da Cloud API. */
  static payloadDoEnvio(envio: Envio): Record<string, unknown> {
    const base = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: envio.para,
    };
    switch (envio.tipo) {
      case 'texto':
        // `preview_url: false`: link no primeiro toque é sinal de spam (R04 §4),
        // e prévia de link é um convite a colocá-lo.
        return { ...base, type: 'text', text: { preview_url: false, body: envio.corpo } };
      case 'template':
        return {
          ...base,
          type: 'template',
          template: {
            name: envio.nome,
            language: { code: envio.idioma },
            components:
              envio.parametros.length === 0
                ? []
                : [
                    {
                      type: 'body',
                      parameters: envio.parametros.map((t) => ({ type: 'text', text: t })),
                    },
                  ],
          },
        };
      case 'audio':
        return {
          ...base,
          type: 'audio',
          audio: envio.mediaId ? { id: envio.mediaId } : { link: envio.link },
        };
    }
  }

  async enviar(envio: Envio): Promise<ResultadoDoEnvio> {
    const corpo = ClienteDaGraph.payloadDoEnvio(envio);
    let resposta: Response;
    try {
      resposta = await this.buscar(this.url(`${this.config.phoneNumberId}/messages`), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (erro) {
      // Rede, DNS, tempo esgotado: o mundo, não a mensagem.
      return {
        ok: false,
        codigo: 'sem_resposta_da_meta',
        mensagem: erro instanceof Error ? erro.message : String(erro),
        retentar: true,
        httpStatus: null,
      };
    }

    const texto = await resposta.text();
    const json = interpretarJson(texto);

    if (resposta.ok) {
      const wamid = wamidDaResposta(json);
      if (wamid === null) {
        return {
          ok: false,
          codigo: 'resposta_sem_wamid',
          mensagem: `A Meta respondeu 200 sem id de mensagem: ${texto.slice(0, 200)}`,
          retentar: true,
          httpStatus: resposta.status,
        };
      }
      return { ok: true, wamid };
    }

    return classificarErro(resposta.status, json, texto);
  }

  /**
   * Metadados da mídia recebida. A `url` que volta daqui vale ~5 minutos e só
   * abre com o mesmo bearer — é por isso que quem baixa é este worker, na
   * hora, e não o worker-ai depois.
   */
  async midia(
    mediaId: string,
  ): Promise<{ ok: true; url: string; mime: string } | { ok: false; motivo: string }> {
    try {
      const r = await this.buscar(this.url(mediaId), {
        headers: { Authorization: `Bearer ${this.config.token}` },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!r.ok) return { ok: false, motivo: `metadados da mídia: HTTP ${r.status}` };
      const corpo = (await r.json()) as { url?: unknown; mime_type?: unknown };
      const url = typeof corpo.url === 'string' ? corpo.url : null;
      if (url === null) return { ok: false, motivo: 'metadados da mídia sem url' };
      return {
        ok: true,
        url,
        mime: typeof corpo.mime_type === 'string' ? corpo.mime_type : 'application/octet-stream',
      };
    } catch (erro) {
      return { ok: false, motivo: erro instanceof Error ? erro.message : String(erro) };
    }
  }

  /** Os bytes da mídia. O bearer vai junto: a URL sozinha não abre. */
  async baixar(
    url: string,
  ): Promise<{ ok: true; bytes: Uint8Array; mime: string } | { ok: false; motivo: string }> {
    try {
      const r = await this.buscar(url, {
        headers: { Authorization: `Bearer ${this.config.token}` },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!r.ok) return { ok: false, motivo: `download da mídia: HTTP ${r.status}` };
      const buffer = new Uint8Array(await r.arrayBuffer());
      return {
        ok: true,
        bytes: buffer,
        mime: r.headers.get('content-type') ?? 'application/octet-stream',
      };
    } catch (erro) {
      return { ok: false, motivo: erro instanceof Error ? erro.message : String(erro) };
    }
  }
}

/** O corpo da resposta como JSON, ou `null` quando não for. */
function interpretarJson(texto: string): unknown {
  if (texto.length === 0) return null;
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

/** `{messages:[{id}]}` → o wamid. */
export function wamidDaResposta(json: unknown): string | null {
  if (typeof json !== 'object' || json === null) return null;
  const mensagens = (json as { messages?: unknown }).messages;
  if (!Array.isArray(mensagens) || mensagens.length === 0) return null;
  const primeira = mensagens[0];
  if (typeof primeira !== 'object' || primeira === null) return null;
  const id = (primeira as { id?: unknown }).id;
  return typeof id === 'string' && id.trim() !== '' ? id.trim() : null;
}

/**
 * O erro da Graph API traduzido para a decisão que o worker precisa tomar.
 * Exportada para o teste poder medir a tabela sem subir servidor nenhum.
 */
export function classificarErro(
  httpStatus: number,
  json: unknown,
  textoCru = '',
): Extract<ResultadoDoEnvio, { ok: false }> {
  const erro =
    typeof json === 'object' && json !== null
      ? ((json as { error?: unknown }).error as Record<string, unknown> | undefined)
      : undefined;

  const codigo = typeof erro?.code === 'number' ? erro.code : null;
  const mensagemDaMeta = typeof erro?.message === 'string' ? erro.message : textoCru.slice(0, 300);
  const detalhe =
    typeof erro?.error_data === 'object' && erro.error_data !== null
      ? ((erro.error_data as { details?: unknown }).details ?? null)
      : null;

  // 5xx e 429 são do transporte: o que a Meta diz no corpo não muda a decisão.
  const transporte = httpStatus >= 500 || httpStatus === 429;
  const retentar = transporte || (codigo !== null && RETENTAR.has(codigo));

  return {
    ok: false,
    codigo:
      codigo === 190
        ? 'token_meta_invalido'
        : codigo !== null
          ? String(codigo)
          : `http_${httpStatus}`,
    mensagem: [mensagemDaMeta, typeof detalhe === 'string' ? detalhe : null]
      .filter((p): p is string => typeof p === 'string' && p.trim() !== '')
      .join(' — ')
      .slice(0, 2000),
    retentar,
    httpStatus,
  };
}
