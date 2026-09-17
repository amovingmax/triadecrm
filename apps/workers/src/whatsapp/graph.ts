/**
 * A CLOUD API OFICIAL DA META (ADR-06, R04 §2.1 e §3 item 5).
 *
 * "WhatsApp: Cloud API oficial da Meta. Nunca Baileys, Evolution ou qualquer
 * automação não oficial." Desde 14/09 o número da empresa fica SÓ na Cloud API
 * (sem Coexistence), com conexão direta na Meta.
 *
 * O envio, a mídia, e uma porta genérica de GET/POST no Graph (`ler` e
 * `publicar`) para o que é da conta e não da conversa: modelos de mensagem,
 * registro do número e assinatura de webhooks. Sem SDK, sem dependência nova:
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

/**
 * Versão padrão da Graph API. Era v21.0, que a Meta desliga em 21/01/2027; a
 * v26.0 (29/07/2026) é a estável mais nova, e os changelogs da v22 à v26 não
 * mudam nada do que este cliente usa (envio, mídia, modelos, registro,
 * assinatura de webhooks). `META_WA_API_VERSION` sobrescreve.
 */
export const VERSAO_PADRAO = 'v26.0';

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

/**
 * Os parâmetros de um modelo, nas duas formas que a Meta aceita:
 *   · lista  → POSICIONAIS (`{{1}}`, `{{2}}`), os modelos antigos;
 *   · objeto → NOMEADOS (`{{nome}}`, `{{empresa}}`), `parameter_format: NAMED`.
 */
export type ParametrosDoModelo = readonly string[] | Readonly<Record<string, string>>;

export type Envio =
  | (Destino & { tipo: 'texto'; corpo: string })
  | (Destino & {
      tipo: 'template';
      nome: string;
      idioma: string;
      parametros: ParametrosDoModelo;
    })
  | (Destino & { tipo: 'audio'; mediaId?: string; link?: string });

/** A Graph API recusou, ou não respondeu. Mesma forma para envio e para conta. */
export interface FalhaDaGraph {
  ok: false;
  /** Código da Meta (131047, 190…) ou um nome nosso para falha de transporte. */
  codigo: string;
  mensagem: string;
  /** `true` = vale tentar de novo; `false` = repetir não muda nada. */
  retentar: boolean;
  httpStatus: number | null;
  /** `error_subcode` da Meta (ex.: 2388024, modelo já existe no idioma). */
  subcodigo?: number | null;
}

export type ResultadoDoEnvio = { ok: true; wamid: string } | FalhaDaGraph;

/** Resposta de uma chamada genérica ao Graph (`ler`/`publicar`). */
export type RespostaDaGraph =
  { ok: true; json: Record<string, unknown>; httpStatus: number } | FalhaDaGraph;

export interface OpcoesDoPost {
  /**
   * Manda o corpo como `application/x-www-form-urlencoded` em vez de JSON — é
   * como os endpoints de app (`/{app-id}/subscriptions`) recebem o token do app.
   */
  formulario?: boolean;
  /** Não manda o bearer do usuário de sistema (o token vai no próprio corpo). */
  semBearer?: boolean;
}

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

  /**
   * Tira do texto qualquer segredo conhecido antes de ele virar mensagem de
   * erro — e, portanto, linha de log e coluna no banco.
   */
  private semSegredos(texto: string, extras: readonly string[] = []): string {
    let limpo = texto;
    for (const segredo of [this.config.token, ...extras]) {
      if (segredo.length >= 6) limpo = limpo.split(segredo).join('***');
    }
    return limpo;
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
      case 'template': {
        const parametros = parametrosDoCorpo(envio.parametros);
        return {
          ...base,
          type: 'template',
          template: {
            name: envio.nome,
            language: { code: envio.idioma },
            components: parametros.length === 0 ? [] : [{ type: 'body', parameters: parametros }],
          },
        };
      }
      case 'audio':
        return {
          ...base,
          type: 'audio',
          audio: envio.mediaId ? { id: envio.mediaId } : { link: envio.link },
        };
    }
  }

  async enviar(envio: Envio): Promise<ResultadoDoEnvio> {
    const resposta = await this.publicar(
      `${this.config.phoneNumberId}/messages`,
      ClienteDaGraph.payloadDoEnvio(envio),
    );
    if (!resposta.ok) return resposta;

    const wamid = wamidDaResposta(resposta.json);
    if (wamid === null) {
      return {
        ok: false,
        codigo: 'resposta_sem_wamid',
        mensagem: `A Meta respondeu 200 sem id de mensagem: ${JSON.stringify(resposta.json).slice(0, 200)}`,
        retentar: true,
        httpStatus: resposta.httpStatus,
      };
    }
    return { ok: true, wamid };
  }

  /**
   * GET genérico no Graph, com o bearer do usuário de sistema. O token vai no
   * cabeçalho, nunca na URL: URL aparece em log de proxy, cabeçalho não.
   */
  async ler(
    caminho: string,
    consulta: Readonly<Record<string, string | number>> = {},
  ): Promise<RespostaDaGraph> {
    const url = new URL(this.url(caminho));
    for (const [chave, valor] of Object.entries(consulta)) {
      url.searchParams.set(chave, String(valor));
    }
    return this.chamar(url.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.config.token}` },
    });
  }

  /** POST genérico no Graph. Mesma tabela de erros do envio. */
  /**
   * Sobe um arquivo para a Meta e devolve o id dele.
   *
   * A Cloud API não manda áudio por valor: primeiro o arquivo vira um `media
   * id` (POST /media), e só depois a mensagem cita esse id. O id vale 30 dias e
   * é do nosso número — não dá para reaproveitar o de outra conta.
   *
   * É `multipart`, e por isso não passa por `publicar`: aquele monta corpo de
   * texto (JSON ou formulário), e aqui o corpo são bytes.
   */
  async subirMidia(arquivo: {
    bytes: Uint8Array;
    mime: string;
    nome: string;
  }): Promise<{ ok: true; mediaId: string } | { ok: false; motivo: string; retentar: boolean }> {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', arquivo.mime);
    form.append('file', new Blob([arquivo.bytes as unknown as BlobPart], { type: arquivo.mime }), arquivo.nome);

    let resposta: Response;
    try {
      resposta = await this.buscar(this.url(`${this.config.phoneNumberId}/media`), {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.token}` },
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (erro) {
      // Rede ou tempo esgotado: o mundo, não o arquivo. Vale tentar de novo.
      return { ok: false, motivo: this.semSegredos((erro as Error).message), retentar: true };
    }

    const texto = await resposta.text();
    if (!resposta.ok) {
      return {
        ok: false,
        motivo: this.semSegredos(`a Meta recusou o arquivo (${resposta.status}): ${texto.slice(0, 300)}`),
        // 5xx e 429 são dela; 4xx é do arquivo, e repetir dá o mesmo.
        retentar: resposta.status === 429 || resposta.status >= 500,
      };
    }

    let id: unknown;
    try {
      id = (JSON.parse(texto) as { id?: unknown }).id;
    } catch {
      return { ok: false, motivo: 'a Meta respondeu algo que não é JSON', retentar: true };
    }
    if (typeof id !== 'string' || id === '') {
      return { ok: false, motivo: 'a Meta aceitou o arquivo mas não devolveu id', retentar: true };
    }
    return { ok: true, mediaId: id };
  }

  async publicar(
    caminho: string,
    corpo: Readonly<Record<string, unknown>> = {},
    opcoes: OpcoesDoPost = {},
  ): Promise<RespostaDaGraph> {
    const headers: Record<string, string> = {};
    if (!opcoes.semBearer) headers.Authorization = `Bearer ${this.config.token}`;

    let body: string;
    const segredosDoCorpo: string[] = [];
    if (opcoes.formulario) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      const form = new URLSearchParams();
      for (const [chave, valor] of Object.entries(corpo)) {
        if (valor === undefined || valor === null) continue;
        const texto = typeof valor === 'string' ? valor : JSON.stringify(valor);
        if (chave === 'access_token') segredosDoCorpo.push(texto);
        form.set(chave, texto);
      }
      body = form.toString();
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(corpo);
    }

    return this.chamar(this.url(caminho), { method: 'POST', headers, body }, segredosDoCorpo);
  }

  private async chamar(
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
    segredosExtras: readonly string[] = [],
  ): Promise<RespostaDaGraph> {
    let resposta: Response;
    try {
      resposta = await this.buscar(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (erro) {
      // Rede, DNS, tempo esgotado: o mundo, não o pedido.
      return {
        ok: false,
        codigo: 'sem_resposta_da_meta',
        mensagem: this.semSegredos(
          erro instanceof Error ? erro.message : String(erro),
          segredosExtras,
        ),
        retentar: true,
        httpStatus: null,
      };
    }

    const texto = await resposta.text();
    const json = interpretarJson(texto);

    if (resposta.ok) {
      const objetoJson =
        typeof json === 'object' && json !== null && !Array.isArray(json)
          ? (json as Record<string, unknown>)
          : {};
      return { ok: true, json: objetoJson, httpStatus: resposta.status };
    }

    const falha = classificarErro(resposta.status, json, texto);
    return { ...falha, mensagem: this.semSegredos(falha.mensagem, segredosExtras) };
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

/**
 * O valor de um parâmetro como a Meta aceita. A Graph API recusa parâmetro com
 * quebra de linha, tab ou mais de 4 espaços seguidos (132012/131009); quem
 * colou um nome com espaço sobrando não errou nada. Troca todo espaço em
 * branco repetido por um espaço só — a mesma regra de
 * `app.modelo_parametro_limpo` no banco.
 */
export function valorDeParametroLimpo(valor: unknown): string {
  const texto =
    typeof valor === 'string' ? valor : valor === null || valor === undefined ? '' : String(valor);
  return texto.replace(/\s+/gu, ' ').trim();
}

/** A lista `parameters` do componente `body`: posicional ou nomeada. */
export function parametrosDoCorpo(parametros: ParametrosDoModelo): Record<string, string>[] {
  if (Array.isArray(parametros)) {
    return (parametros as readonly unknown[]).map((t) => ({
      type: 'text',
      text: valorDeParametroLimpo(t),
    }));
  }
  return Object.entries(parametros as Readonly<Record<string, unknown>>).map(([nome, valor]) => ({
    type: 'text',
    parameter_name: nome,
    text: valorDeParametroLimpo(valor),
  }));
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
export function classificarErro(httpStatus: number, json: unknown, textoCru = ''): FalhaDaGraph {
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
  // Na criação de modelo, o motivo que se lê vem em `error_user_msg`; em
  // `message` fica só "(#100) Invalid parameter".
  const paraOUsuario = typeof erro?.error_user_msg === 'string' ? erro.error_user_msg : null;
  const subcodigo = typeof erro?.error_subcode === 'number' ? erro.error_subcode : null;

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
    mensagem: [mensagemDaMeta, typeof detalhe === 'string' ? detalhe : null, paraOUsuario]
      .filter((p): p is string => typeof p === 'string' && p.trim() !== '')
      .filter((p, i, todas) => todas.indexOf(p) === i)
      .join(' — ')
      .slice(0, 2000),
    retentar,
    httpStatus,
    subcodigo,
  };
}
