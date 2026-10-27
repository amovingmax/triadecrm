// =============================================================================
// TRIADE — o adaptador do formato da Meta
//
// Esta é a ÚNICA parte do Tríade que conhece `entry[].changes[].value`. Daqui
// para dentro tudo é vocabulário nosso: `mensagem`, `recibo`, `eco`, com uma
// `chave` de idempotência cada um. Quando a Meta mudar a versão da Graph API,
// é este arquivo que muda — e só ele.
//
// Por que a extração é aqui e não no Postgres: o formato é deles e muda com a
// versão da API. Um parser do JSON da Meta escrito em PL/pgSQL seria a peça
// mais frágil do sistema no lugar mais caro de mexer.
//
// O QUE ENTRA E O QUE NÃO ENTRA
// -----------------------------------------------------------------------------
//   value.messages[]        → mensagem recebida do fornecedor          (in)
//   value.statuses[]        → recibo de entrega do que mandamos        (out)
//   value.message_echoes[]  → o que a Heloísa mandou pelo celular      (out, eco)
//
// E, desde a Fase 3 do pivô, três campos que falam do NÚMERO e não de uma
// conversa (`field` em vez de `value.messages`):
//
//   phone_number_quality_update → nota caindo (FLAGGED) e tier novo
//   account_update              → restrição, violação e banimento da WABA
//   business_capability_update  → tier de conversas por dia
//
// Eles saem daqui como `tipo:'saude'` e vão para `public.wa_saude_registrar`.
// Antes eram ignorados com nome, e o CRM só descobria que a Meta tinha cortado
// o número quando as mensagens começavam a falhar. Com uma pessoa enviando,
// ela via; com o robô, ninguém vê.
//
// O resto (`template_status_update`, `template_category_update`, …) continua
// reconhecido e IGNORADO com nome: um campo que ninguém trata precisa aparecer
// no log como "ignorado", nunca sumir calado — é assim que se descobre que a
// Meta começou a mandar algo novo.
//
// Nada aqui decide nada. Opt-out, supressão, janela e teto são do banco e do
// worker; o adaptador não sabe o que é um opt-out.
//
// O WHATSAPP COMPLETO (27/10/2026)
// -----------------------------------------------------------------------------
// Pedido do Rafael: "quero todas as funcionalidades do wpp no nosso CRM". A
// mensagem passa a levar, em `extra`, o que antes era jogado fora: a mensagem
// citada (`context.id`), se veio encaminhada, o alvo da reação, a latitude e a
// longitude, o cartão de contato, o id do botão escolhido, o nome do documento,
// o anúncio de onde a pessoa veio e o erro da Meta. Vai inteiro para
// `app.wa_entrada_completar`.
//
// E três coisas novas saem daqui:
//   * `evento` — o contato apagou ou editou a mensagem dele (`revoke`, `edit`;
//     formato do Coexistence). Não é mensagem nova: muda a original.
//   * mensagem de GRUPO — a mesma `mensagem`, com `grupo` preenchido
//     (`messages[].group_id`); o worker a manda para a aba Grupos.
//   * `grupo` — os quatro webhooks da API de grupos (`group_lifecycle_update`,
//     `group_participants_update`, `group_settings_update`,
//     `group_status_update`), um item por grupo, já no vocabulário de
//     `public.wa_grupo_evento_registrar`.
//
// O BSUID (nomes de usuário do WhatsApp, 2026)
// -----------------------------------------------------------------------------
// Desde abril de 2026 a Meta manda, em todo webhook de `messages`, o
// "business-scoped user ID": `messages[].from_user_id`, `statuses[].
// recipient_user_id` e `contacts[].user_id` (formato `BR.<alfanumérico>`).
// Quem adota nome de usuário pode chegar SEM telefone (`from`/`wa_id`
// omitidos) quando não houve conversa com aquele número nos últimos 30 dias.
// Por isso a mensagem sai daqui com `de` possivelmente nulo e com
// `de_user_id`: descartar a mensagem de quem não mostrou o número seria
// perder exatamente o "SAIR" de alguém. Quem decide o que fazer com ela é o
// banco (`app.wa_registrar_entrada`, migração 20260915120000).
// https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids/
// =============================================================================

/**
 * O que a Meta disse além do corpo. Só as chaves que vieram: `{}` é "nada a
 * mais". O formato de `conteudo` é o mesmo que o CRM usa para mandar.
 */
export interface ExtraDaMensagem {
  responde_a_wamid?: string;
  reage_a_wamid?: string;
  encaminhada?: boolean;
  media_nome?: string;
  conteudo?: Record<string, unknown>;
}

/** Um item já traduzido para o vocabulário do Tríade, pronto para a fila. */
export type ItemDaMeta =
  | {
      tipo: 'mensagem';
      chave: string;
      wamid: string;
      /** E.164. Nulo quando a pessoa adotou nome de usuário e a Meta omitiu o número. */
      de: string | null;
      /** O BSUID (`from_user_id`). Nulo em webhook anterior a abril de 2026. */
      de_user_id: string | null;
      /**
       * O nome que a pessoa pôs no perfil do WhatsApp, que a Meta manda em
       * `value.contacts[].profile.name` em TODA mensagem recebida.
       *
       * Até 28/09/2026 ele era descartado, e por isso 193 conversas apareciam no
       * CRM como "Contato do WhatsApp (11) 5128-5383": o nome vinha junto e a
       * gente jogava fora. É nome PÚBLICO de perfil, escolhido pela própria
       * pessoa — não é dado que a gente foi buscar em lugar nenhum.
       */
      nome_do_perfil: string | null;
      numero_da_empresa: string;
      phone_number_id: string | null;
      tipo_da_mensagem: string;
      texto: string | null;
      media_id: string | null;
      media_mime: string | null;
      ocorrido_em: string;
      /** O id do grupo na Meta, quando a mensagem foi num grupo. */
      grupo: string | null;
      extra: ExtraDaMensagem;
    }
  | {
      /** O contato apagou (`revoke`) ou editou (`edit`) uma mensagem dele. */
      tipo: 'evento';
      chave: string;
      evento: 'revoke' | 'edit';
      /** O wamid da mensagem apagada ou editada. */
      alvo: string;
      /** O texto novo, na edição. */
      texto: string | null;
      ocorrido_em: string;
    }
  | {
      /** Um webhook da API de grupos, já no formato de `wa_grupo_evento_registrar`. */
      tipo: 'grupo';
      chave: string;
      campo: string;
      evento: Record<string, unknown>;
    }
  | {
      tipo: 'eco';
      chave: string;
      wamid: string;
      para: string;
      numero_da_empresa: string;
      phone_number_id: string | null;
      tipo_da_mensagem: string;
      texto: string | null;
      media_id: string | null;
      media_mime: string | null;
      ocorrido_em: string;
    }
  | {
      /**
       * O que a Meta diz sobre o NÚMERO, não sobre uma conversa. O `value`
       * inteiro viaja em `payload`: o que hoje não se lê pode ser a pergunta
       * de amanhã, e um webhook não volta.
       */
      tipo: 'saude';
      chave: string;
      /** E.164. Nulo em `account_update`, que é da WABA e não traz o número. */
      numero: string | null;
      campo: string;
      evento: string | null;
      /** Só `FLAGGED` vira `'RED'`. O webhook não manda a nota em si. */
      qualidade: string | null;
      limite_anterior: string | null;
      limite_atual: string | null;
      conversas_por_dia: number | null;
      restricoes: Record<string, unknown>[];
      banido: boolean;
      payload: Record<string, unknown>;
      ocorrido_em: string;
    }
  | {
      tipo: 'recibo';
      chave: string;
      wamid: string;
      estado: string;
      /** O BSUID de quem recebeu (`recipient_user_id`), para a conversa aprender. */
      para_user_id: string | null;
      ocorrido_em: string;
      codigo: string | null;
      detalhe: string | null;
    };

export interface Extracao {
  itens: ItemDaMeta[];
  /** Campos que a Meta mandou e que este adaptador não trata. Vão para o log. */
  ignorados: string[];
}

function objeto(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function lista(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function numero(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** O objeto sem as chaves nulas: o que não veio não vira `null` gravado. */
function semVazios(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));
}

function numeroComoTexto(v: unknown): string | null {
  return typeof v === 'number' && Number.isFinite(v) ? String(v) : null;
}

/** Segundos de época (a Meta manda como string) → ISO 8601. */
function instante(v: unknown): string {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n) || n <= 0) return new Date().toISOString();
  return new Date(n * 1000).toISOString();
}

/** "5584999880011" → "+5584999880011". A normalização de verdade é do Postgres. */
function e164(v: unknown): string | null {
  const t = texto(v);
  if (t === null) return null;
  const digitos = t.replace(/\D/g, '');
  return digitos === '' ? null : `+${digitos}`;
}

/**
 * O corpo e a mídia de uma mensagem, qualquer que seja o tipo.
 *
 * Texto, legenda de imagem, título de botão e id de lista são todos "o que a
 * pessoa disse" — e é por isso que a legenda de um áudio, quando existe, entra
 * como corpo: a regra de opt-out precisa enxergar a palavra "parar" venha ela
 * em mensagem de texto ou em legenda de foto.
 */
function conteudo(m: Record<string, unknown>): {
  tipo: string;
  texto: string | null;
  media_id: string | null;
  media_mime: string | null;
  extra: ExtraDaMensagem;
} {
  const tipo = texto(m.type) ?? 'text';
  const midia = objeto(m[tipo]);
  const extra: ExtraDaMensagem = {};
  const dados: Record<string, unknown> = {};

  let corpo: string | null = null;
  if (tipo === 'text') corpo = texto(objeto(m.text)?.body);
  else if (tipo === 'button') {
    const b = objeto(m.button);
    corpo = texto(b?.text);
    dados.resposta = semVazios({ titulo: corpo, payload: texto(b?.payload) });
  } else if (tipo === 'interactive') {
    const i = objeto(m.interactive);
    const botao = objeto(i?.button_reply);
    const item = objeto(i?.list_reply);
    const fluxo = objeto(i?.nfm_reply);
    corpo = texto(botao?.title) ?? texto(item?.title) ?? texto(fluxo?.body);
    if (botao) dados.resposta = semVazios({ id: texto(botao.id), titulo: texto(botao.title) });
    else if (item) {
      dados.resposta = semVazios({
        id: texto(item.id),
        titulo: texto(item.title),
        descricao: texto(item.description),
      });
    } else if (fluxo) {
      dados.fluxo = semVazios({ nome: texto(fluxo.name), resposta: texto(fluxo.response_json) });
    }
  } else if (tipo === 'reaction') {
    const r = objeto(m.reaction);
    // Sem emoji = a pessoa tirou a reação.
    corpo = texto(r?.emoji);
    const alvo = texto(r?.message_id);
    if (alvo !== null) extra.reage_a_wamid = alvo;
  } else if (tipo === 'location') {
    const l = objeto(m.location);
    corpo = texto(l?.name) ?? texto(l?.address);
    const latitude = numero(l?.latitude);
    const longitude = numero(l?.longitude);
    if (latitude !== null && longitude !== null) {
      Object.assign(
        dados,
        semVazios({ latitude, longitude, nome: texto(l?.name), endereco: texto(l?.address), url: texto(l?.url) }),
      );
    }
  } else if (tipo === 'contacts') {
    corpo = null;
    const contatos = lista(m.contacts).flatMap((bruto) => {
      const c = objeto(bruto);
      if (!c) return [];
      const nome = objeto(c.name);
      const telefones = lista(c.phones).flatMap((t) => {
        const o = objeto(t);
        const n = texto(o?.phone) ?? texto(o?.wa_id);
        return n ? [semVazios({ numero: n, tipo: texto(o?.type), wa_id: texto(o?.wa_id) })] : [];
      });
      const emails = lista(c.emails).flatMap((e) => {
        const t = texto(objeto(e)?.email);
        return t ? [t] : [];
      });
      return [
        semVazios({
          nome: texto(nome?.formatted_name) ?? texto(nome?.first_name) ?? 'Contato',
          telefones,
          emails: emails.length ? emails : null,
          empresa: texto(objeto(c.org)?.company),
        }),
      ];
    });
    if (contatos.length > 0) dados.contatos = contatos;
  } else corpo = texto(midia?.caption);

  if (tipo === 'document') {
    const nome = texto(midia?.filename);
    if (nome !== null) extra.media_nome = nome.slice(0, 240);
  }
  if (tipo === 'unsupported') {
    dados.nao_suportado = { tipo: texto(objeto(m.unsupported)?.type) ?? 'desconhecido' };
  }

  // Responder citando e "encaminhada". Na reação o alvo é o dela.
  const contexto = objeto(m.context);
  if (contexto) {
    const citada = texto(contexto.id);
    if (citada !== null && tipo !== 'reaction') extra.responde_a_wamid = citada;
    if (contexto.forwarded === true || contexto.frequently_forwarded === true) extra.encaminhada = true;
    if (contexto.frequently_forwarded === true) dados.muito_encaminhada = true;
  }

  // Veio de um anúncio de "clique para o WhatsApp".
  const anuncio = objeto(m.referral);
  if (anuncio) {
    dados.anuncio = semVazios({
      titulo: texto(anuncio.headline),
      corpo: texto(anuncio.body),
      url: texto(anuncio.source_url),
      tipo: texto(anuncio.source_type),
      id: texto(anuncio.source_id),
    });
  }

  const erro = objeto(lista(m.errors)[0]);
  if (erro) {
    dados.erro = semVazios({
      codigo: texto(erro.code) ?? numeroComoTexto(erro.code),
      titulo: texto(erro.title) ?? texto(erro.message),
      detalhe: texto(objeto(erro.error_data)?.details),
    });
  }

  if (Object.keys(dados).length > 0) extra.conteudo = dados;

  return {
    tipo,
    texto: corpo,
    media_id: texto(midia?.id),
    media_mime: texto(midia?.mime_type),
    extra,
  };
}

/**
 * O contato apagou ou editou: `revoke` e `edit` com a mensagem original. Sem
 * a original não há o que mudar, e a mensagem segue como sempre (vira aviso
 * de sistema no fio).
 */
function eventoDaMensagem(
  m: Record<string, unknown>,
): { evento: 'revoke' | 'edit'; alvo: string; texto: string | null } | null {
  const tipo = texto(m.type);
  if (tipo === 'revoke') {
    const alvo = texto(objeto(m.revoke)?.original_message_id);
    return alvo ? { evento: 'revoke', alvo, texto: null } : null;
  }
  if (tipo === 'edit') {
    const e = objeto(m.edit);
    const alvo = texto(e?.original_message_id);
    if (!alvo) return null;
    const nova = objeto(e?.message);
    const qual = texto(nova?.type) ?? 'text';
    const corpo =
      qual === 'text' ? texto(objeto(nova?.text)?.body) : texto(objeto(nova?.[qual])?.caption);
    return { evento: 'edit', alvo, texto: corpo };
  }
  return null;
}

/** Os campos da API de grupos. */
const CAMPOS_DE_GRUPO = new Set([
  'group_lifecycle_update',
  'group_participants_update',
  'group_settings_update',
  'group_status_update',
]);

function idsDe(v: unknown): string {
  return lista(v)
    .map((p) => texto(objeto(p)?.wa_id) ?? texto(objeto(p)?.input) ?? '')
    .join(',');
}

/** Um ajuste do grupo: `{text, update_successful}` → `{texto, ok}`. */
function ajuste(v: unknown): Record<string, unknown> | null {
  const o = objeto(v);
  if (!o) return null;
  return semVazios({
    texto: texto(o.text),
    ok: typeof o.update_successful === 'boolean' ? o.update_successful : null,
  });
}

/** Os grupos de um webhook de grupo, no formato de `wa_grupo_evento_registrar`. */
function eventosDeGrupo(campo: string, valor: Record<string, unknown>, numero: string | null): ItemDaMeta[] {
  return lista(valor.groups).flatMap((bruto, j) => {
    const g = objeto(bruto);
    if (!g) return [];
    const grupo = texto(g.group_id);
    const tipo = texto(g.type) ?? campo;
    const evento = semVazios({
      tipo,
      group_id: grupo,
      request_id: texto(g.request_id),
      subject: texto(g.subject),
      invite_link: texto(g.invite_link),
      join_approval_mode: texto(g.join_approval_mode),
      join_request_id: texto(g.join_request_id),
      wa_id: texto(g.wa_id),
      initiated_by: texto(g.initiated_by),
      added: lista(g.added_participants),
      removed: lista(g.removed_participants),
      failed: lista(g.failed_participants),
      errors: lista(g.errors),
      settings: semVazios({
        assunto: ajuste(g.group_subject),
        descricao: ajuste(g.group_description),
        foto: ajuste(g.profile_picture),
      }),
      numero,
      ocorrido_em: instante(g.timestamp),
    });
    return [
      {
        tipo: 'grupo' as const,
        // A reentrega traz o mesmo grupo, o mesmo tipo, o mesmo instante e as
        // mesmas pessoas: a mesma chave. O índice desempata dentro do lote.
        chave: [
          'grupo',
          campo,
          grupo ?? texto(g.request_id) ?? 'sem-id',
          tipo,
          String(g.timestamp ?? ''),
          texto(g.join_request_id) ?? '',
          texto(g.wa_id) ?? '',
          idsDe(g.added_participants),
          idsDe(g.removed_participants),
          String(j),
        ].join(':'),
        campo,
        evento,
      },
    ];
  });
}

/**
 * O telefone de um BSUID segundo `value.contacts[]`, quando a Meta o mandou lá
 * e não em `messages[].from`. Não inventa: sem `wa_id`, devolve nulo.
 */
function telefoneDoContato(contatos: unknown[], userId: string | null): string | null {
  if (userId === null) return null;
  for (const bruto of contatos) {
    const c = objeto(bruto);
    if (c && texto(c.user_id) === userId) return e164(c.wa_id);
  }
  return null;
}

/**
 * O nome de perfil de quem mandou, segundo `value.contacts[]`.
 *
 * A Meta casa o contato pelo `wa_id` (o telefone sem `+`) e, desde 2026, também
 * pelo `user_id` de quem adotou nome de usuário. Procura pelos dois, nessa
 * ordem, e NÃO inventa: contato ausente ou perfil sem nome devolve nulo.
 */
function nomeDoContato(contatos: unknown[], telefone: string | null, userId: string | null): string | null {
  for (const bruto of contatos) {
    const c = objeto(bruto);
    if (!c) continue;
    const casaPeloTelefone = telefone !== null && e164(c.wa_id) === telefone;
    const casaPeloUserId = userId !== null && texto(c.user_id) === userId;
    if (!casaPeloTelefone && !casaPeloUserId) continue;
    const nome = texto(objeto(c.profile)?.name);
    // Nome de perfil vem como a pessoa digitou: corta espaço em volta e recusa
    // o vazio, para não gravar " " como nome de ninguém.
    return nome === null ? null : (nome.trim() || null);
  }
  return null;
}

/** Campos de `changes[].field` que este adaptador reconhece como "nossos". */
const CAMPO_DE_MENSAGENS = 'messages';

/**
 * Campos de saúde do número que este adaptador traduz (Fase 3 do pivô).
 *
 * `messaging_limit_tier_update` NÃO está aqui porque não existe na referência
 * da Meta — quem carrega o tier é `business_capability_update`, e também o
 * `phone_number_quality_update`.
 */
const CAMPOS_DE_SAUDE = new Set([
  'phone_number_quality_update',
  'account_update',
  'business_capability_update',
]);

export function extrairDaMeta(payload: unknown): Extracao {
  const itens: ItemDaMeta[] = [];
  const ignorados: string[] = [];
  const raiz = objeto(payload);
  if (!raiz) return { itens, ignorados: ['corpo_nao_e_objeto'] };
  if (texto(raiz.object) !== 'whatsapp_business_account') {
    ignorados.push(`object:${texto(raiz.object) ?? 'ausente'}`);
  }

  for (const entradaBruta of lista(raiz.entry)) {
    const entrada = objeto(entradaBruta);
    if (!entrada) continue;

    for (const [indice, mudancaBruta] of lista(entrada.changes).entries()) {
      const mudanca = objeto(mudancaBruta);
      if (!mudanca) continue;
      const campo = texto(mudanca.field) ?? '';
      if (campo !== CAMPO_DE_MENSAGENS) {
        if (CAMPOS_DE_GRUPO.has(campo)) {
          const valor = objeto(mudanca.value) ?? {};
          itens.push(...eventosDeGrupo(campo, valor, e164(objeto(valor.metadata)?.display_phone_number)));
          continue;
        }
        if (CAMPOS_DE_SAUDE.has(campo)) {
          const valor = objeto(mudanca.value) ?? {};
          const ban = objeto(valor.ban_info) ?? {};
          const evento = texto(valor.event);
          // `max_daily_conversations_per_business` PRIMEIRO: `current_limit`,
          // `old_limit` e `max_daily_conversation_per_phone` (singular) foram
          // marcados para remoção em fevereiro de 2026 e só chegam de conta
          // antiga. Ler o obsoleto antes do vivo deixaria o tier novo
          // invisível no dia em que o velho sumir.
          const tier = valor.max_daily_conversations_per_business;
          const cru = valor.max_daily_conversation_per_phone;
          itens.push({
            tipo: 'saude',
            // `entry.time` pode faltar; o índice desempata dentro do lote. A
            // idempotência de ENTREGA já é de `public.wa_webhook_receber`.
            chave: `saude:${campo}:${texto(entrada.id) ?? 'sem-id'}:${String(entrada.time ?? '')}:${indice}`,
            numero: e164(valor.display_phone_number),
            campo,
            evento,
            // O webhook NÃO manda a nota. Manda `FLAGGED`, que é a nota
            // caindo: tratar como RED é o único aviso que chega antes da
            // leitura da Graph, que pode estar a 30 min de distância.
            // `UNFLAGGED` não vira GREEN — "deixou de estar em alerta" não é
            // "está bem", e inventar um verde apagaria um vermelho verdadeiro.
            qualidade: evento === 'FLAGGED' ? 'RED' : null,
            limite_anterior: texto(valor.old_limit),
            limite_atual: (typeof tier === 'string' ? tier : null) ?? texto(valor.current_limit),
            conversas_por_dia:
              typeof tier === 'number' ? tier : typeof cru === 'number' ? cru : null,
            restricoes: lista(valor.restriction_info).map((r) => objeto(r) ?? {}),
            // DISABLE (banido), REINSTATE (voltou), SCHEDULE_FOR_DISABLE (vai
            // cair). Só DISABLE fecha a porta hoje.
            banido: texto(ban.waba_ban_state) === 'DISABLE',
            payload: valor,
            ocorrido_em: instante(entrada.time),
          });
          continue;
        }
        // `template_status_update`, `template_category_update`, …:
        // reconhecidos, não tratados, nomeados no log.
        ignorados.push(`field:${campo || 'ausente'}`);
        continue;
      }
      const valor = objeto(mudanca.value);
      if (!valor) continue;

      const metadados = objeto(valor.metadata);
      const numeroDaEmpresa = e164(metadados?.display_phone_number);
      const phoneNumberId = texto(metadados?.phone_number_id);

      // ---- mensagens recebidas -------------------------------------------
      for (const bruta of lista(valor.messages)) {
        const m = objeto(bruta);
        if (!m) continue;
        const wamid = texto(m.id);
        const deUserId = texto(m.from_user_id);
        const de = e164(m.from) ?? telefoneDoContato(lista(valor.contacts), deUserId);
        // Sem telefone E sem BSUID não há de quem seja. Só com o BSUID, a
        // mensagem segue: o banco acha a conversa por ele ou a põe na
        // dead-letter com nome — nunca some aqui.
        if (wamid === null || (de === null && deUserId === null) || numeroDaEmpresa === null) {
          ignorados.push('mensagem_sem_id_ou_numero');
          continue;
        }
        const evento = eventoDaMensagem(m);
        if (evento !== null) {
          itens.push({ tipo: 'evento', chave: wamid, ...evento, ocorrido_em: instante(m.timestamp) });
          continue;
        }
        const c = conteudo(m);
        itens.push({
          tipo: 'mensagem',
          chave: wamid,
          wamid,
          de,
          de_user_id: deUserId,
          nome_do_perfil: nomeDoContato(lista(valor.contacts), de, deUserId),
          numero_da_empresa: numeroDaEmpresa,
          phone_number_id: phoneNumberId,
          tipo_da_mensagem: c.tipo,
          texto: c.texto,
          media_id: c.media_id,
          media_mime: c.media_mime,
          ocorrido_em: instante(m.timestamp),
          grupo: texto(m.group_id),
          extra: c.extra,
        });
      }

      // ---- ecos do Coexistence (R04 §2.1) --------------------------------
      for (const bruta of lista(valor.message_echoes)) {
        const m = objeto(bruta);
        if (!m) continue;
        const wamid = texto(m.id);
        // No eco, `to` é o fornecedor e `from` é o nosso número.
        const para = e164(m.to);
        const nosso = e164(m.from) ?? numeroDaEmpresa;
        if (wamid === null || para === null || nosso === null) {
          ignorados.push('eco_sem_id_ou_numero');
          continue;
        }
        const c = conteudo(m);
        itens.push({
          tipo: 'eco',
          chave: wamid,
          wamid,
          para,
          numero_da_empresa: nosso,
          phone_number_id: phoneNumberId,
          tipo_da_mensagem: c.tipo,
          texto: c.texto,
          media_id: c.media_id,
          media_mime: c.media_mime,
          ocorrido_em: instante(m.timestamp),
        });
      }

      // ---- recibos de entrega --------------------------------------------
      for (const bruta of lista(valor.statuses)) {
        const s = objeto(bruta);
        if (!s) continue;
        const wamid = texto(s.id);
        const estado = texto(s.status);
        if (wamid === null || estado === null) {
          ignorados.push('recibo_sem_id_ou_estado');
          continue;
        }
        const erro = objeto(lista(s.errors)[0]);
        itens.push({
          tipo: 'recibo',
          // A chave inclui o estado: `sent`, `delivered` e `read` do MESMO
          // wamid são três fatos distintos, e uma chave só por wamid faria o
          // segundo e o terceiro serem descartados como repetidos.
          chave: `status:${wamid}:${estado}`,
          wamid,
          estado,
          // O recibo é aplicado pelo wamid; o BSUID só ensina a conversa.
          para_user_id: texto(s.recipient_user_id),
          ocorrido_em: instante(s.timestamp),
          // A Meta manda `code` como número (131049) e às vezes como string.
          codigo: erro ? (texto(erro.code) ?? numeroComoTexto(erro.code)) : null,
          detalhe: erro
            ? (texto(erro.title) ?? texto(erro.message) ?? texto(objeto(erro.error_data)?.details))
            : null,
        });
      }
    }
  }

  return { itens, ignorados };
}
