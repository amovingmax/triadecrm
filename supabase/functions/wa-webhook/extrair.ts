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
// O resto do webhook da Meta (`account_update`, `phone_number_quality_update`,
// `template_status_update`) é reconhecido e IGNORADO com nome: um campo que
// ninguém trata precisa aparecer no log como "ignorado", nunca sumir calado —
// é assim que se descobre que a Meta começou a mandar algo novo.
//
// Nada aqui decide nada. Opt-out, supressão, janela e teto são do banco e do
// worker; o adaptador não sabe o que é um opt-out.
// =============================================================================

/** Um item já traduzido para o vocabulário do Tríade, pronto para a fila. */
export type ItemDaMeta =
  | {
      tipo: 'mensagem';
      chave: string;
      wamid: string;
      de: string;
      numero_da_empresa: string;
      phone_number_id: string | null;
      tipo_da_mensagem: string;
      texto: string | null;
      media_id: string | null;
      media_mime: string | null;
      ocorrido_em: string;
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
      tipo: 'recibo';
      chave: string;
      wamid: string;
      estado: string;
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
} {
  const tipo = texto(m.type) ?? 'text';
  const midia = objeto(m[tipo]);

  let corpo: string | null = null;
  if (tipo === 'text') corpo = texto(objeto(m.text)?.body);
  else if (tipo === 'button') corpo = texto(objeto(m.button)?.text);
  else if (tipo === 'interactive') {
    const i = objeto(m.interactive);
    corpo =
      texto(objeto(i?.button_reply)?.title) ??
      texto(objeto(i?.list_reply)?.title) ??
      texto(objeto(i?.nfm_reply)?.body);
  } else if (tipo === 'reaction') corpo = texto(objeto(m.reaction)?.emoji);
  else if (tipo === 'location') {
    const l = objeto(m.location);
    corpo = texto(l?.name) ?? texto(l?.address);
  } else if (tipo === 'contacts') corpo = null;
  else corpo = texto(midia?.caption);

  return {
    tipo,
    texto: corpo,
    media_id: texto(midia?.id),
    media_mime: texto(midia?.mime_type),
  };
}

/** Campos de `changes[].field` que este adaptador reconhece como "nossos". */
const CAMPO_DE_MENSAGENS = 'messages';

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

    for (const mudancaBruta of lista(entrada.changes)) {
      const mudanca = objeto(mudancaBruta);
      if (!mudanca) continue;
      const campo = texto(mudanca.field) ?? '';
      if (campo !== CAMPO_DE_MENSAGENS) {
        // `phone_number_quality_update`, `template_status_update`,
        // `account_update`: reconhecidos, não tratados, nomeados no log.
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
        const de = e164(m.from);
        if (wamid === null || de === null || numeroDaEmpresa === null) {
          ignorados.push('mensagem_sem_id_ou_numero');
          continue;
        }
        const c = conteudo(m);
        itens.push({
          tipo: 'mensagem',
          chave: wamid,
          wamid,
          de,
          numero_da_empresa: numeroDaEmpresa,
          phone_number_id: phoneNumberId,
          tipo_da_mensagem: c.tipo,
          texto: c.texto,
          media_id: c.media_id,
          media_mime: c.media_mime,
          ocorrido_em: instante(m.timestamp),
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
