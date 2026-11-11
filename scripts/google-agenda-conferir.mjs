#!/usr/bin/env node
/**
 * Confere, antes de ligar o espelho, se a conta de serviço do Google consegue gravar na agenda
 * "CRM Imova - ocupado" que o Calendly confere (11/11/2026). O espelho é o que tira do Calendly o
 * horário que a equipe ocupa no CRM; sem ele, o cliente escolhe o horário, recebe "confirmado" e,
 * segundos depois, "cancelado". Passo a passo em docs/operacao/calendly.md.
 *
 *   node scripts/google-agenda-conferir.mjs ~/Downloads/crm-imova-agenda-XXXX.json
 *   node scripts/google-agenda-conferir.mjs ~/Downloads/crm-imova-agenda-XXXX.json --sub voce@imovaimobiliaria.com.br
 *   GOOGLE_AGENDA_CREDENCIAL=<base64> node scripts/google-agenda-conferir.mjs
 *
 * Confere, nesta ordem, e para no primeiro que falhar, dizendo o que fazer:
 *   1. a credencial é lida (o JSON da conta de serviço, cru ou em base64);
 *   2. o token sai (com --sub, em nome desse usuário: o plano B, delegação em todo o domínio);
 *   3. a agenda abre, e a conta pode mudar eventos nela (não só ler);
 *   4. dá para gravar: cria um evento de teste daqui a dez anos, de madrugada, e apaga.
 *
 * O CONTEÚDO DA CREDENCIAL NUNCA APARECE: nem a chave privada, nem o token. Só o e-mail da conta de
 * serviço e o client ID, que são públicos e são o que o compartilhamento e a delegação pedem.
 * Nada é gravado em disco. Opções: --agenda <id> (outra agenda), --sub <e-mail>, --credencial
 * <arquivo> (o mesmo que passar o arquivo solto).
 */
import { createSign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** A agenda "CRM Imova - ocupado" e a conta de serviço do guia (não são segredo). */
export const AGENDA_DA_IMOVA =
  'c_f19a6b93d8540370fd77d78a27ee3ee0c4c6d5453aa7107ab30cce60aace2e85@group.calendar.google.com';
export const CONTA_DA_IMOVA = 'crm-imova-agenda@crm-imova-agenda.iam.gserviceaccount.com';
export const ESCOPO = 'https://www.googleapis.com/auth/calendar.events';
const TOKEN_URI_PADRAO = 'https://oauth2.googleapis.com/token';
const API_PADRAO = 'https://www.googleapis.com/calendar/v3';
const TITULO_DO_TESTE = 'Conferência do CRM — pode apagar';
/** Os fusos de -03:00 no Brasil: o feriado de dia inteiro vale no fuso da agenda. */
const FUSOS_DE_NATAL = new Set([
  'America/Fortaleza',
  'America/Sao_Paulo',
  'America/Recife',
  'America/Bahia',
  'America/Belem',
  'America/Maceio',
  'America/Araguaina',
  'America/Santarem',
]);

// ---------------------------------------------------------------------------
// 1. A credencial
// ---------------------------------------------------------------------------
/**
 * Lê o JSON da conta de serviço, cru ou em base64. Devolve só o que a conferência usa, ou
 * `{ erro }` com a frase. Nunca devolve o texto cru nem o põe na frase.
 */
export function lerCredencial(cru) {
  const texto = String(cru ?? '').trim();
  if (!texto) return { erro: 'A credencial está vazia.' };
  let valor;
  try {
    valor = JSON.parse(
      texto.startsWith('{') ? texto : Buffer.from(texto, 'base64').toString('utf8'),
    );
  } catch {
    return {
      erro:
        'Isto não é o JSON da conta de serviço (nem em base64). Use o arquivo que o Google Cloud ' +
        'baixou em IAM e administrador → Contas de serviço → crm-imova-agenda → Chaves.',
    };
  }
  if (
    !valor ||
    typeof valor.client_email !== 'string' ||
    typeof valor.private_key !== 'string' ||
    !valor.private_key.includes('PRIVATE KEY')
  ) {
    return {
      erro:
        'O JSON não é a chave de uma conta de serviço: falta client_email ou private_key. Baixe a ' +
        'chave em IAM e administrador → Contas de serviço → crm-imova-agenda → Chaves → Adicionar ' +
        'chave → JSON.',
    };
  }
  return {
    credencial: {
      client_email: valor.client_email,
      client_id: typeof valor.client_id === 'string' ? valor.client_id : null,
      private_key: valor.private_key,
      token_uri: typeof valor.token_uri === 'string' ? valor.token_uri : TOKEN_URI_PADRAO,
    },
  };
}

/** O JWT da conta de serviço (RFC 7523), o mesmo do worker (`apps/workers/src/agenda/google-agenda.ts`). */
export function jwtDaContaDeServico(credencial, agoraSegundos, sub) {
  const b64 = (dados) => Buffer.from(dados).toString('base64url');
  const emNomeDe = typeof sub === 'string' ? sub.trim() : '';
  const cabecalho = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const corpo = b64(
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

// ---------------------------------------------------------------------------
// Os diagnósticos: a resposta do Google em português claro
// ---------------------------------------------------------------------------
function compartilhar(quem) {
  return (
    'No Google Agenda (com a conta dona da agenda): Configurações da agenda "CRM Imova - ocupado" → ' +
    `Compartilhar com pessoas específicas → adicione ${quem} com "Fazer alterações nos eventos".`
  );
}

function delegacao(clientId) {
  return (
    'No Admin do Google (admin.google.com), com uma conta de administrador do Workspace: ' +
    'Segurança → Controles de API → Delegação em todo o domínio → Adicionar novo, com o client ID ' +
    `${clientId ?? '(o client_id do JSON da conta de serviço)'} e o escopo ${ESCOPO}. ` +
    'Pode levar alguns minutos para valer.'
  );
}

/** Por que o token não saiu. `corpo` é a resposta do endpoint de token. */
export function diagnosticoDoToken(status, corpo, { sub, clientId } = {}) {
  const codigo = String(corpo?.error ?? '');
  const detalhe = String(corpo?.error_description ?? corpo?.error ?? '');
  if (/signature/i.test(detalhe)) {
    return (
      'O Google não reconhece esta chave: ela foi apagada ou trocada no Google Cloud. Baixe uma ' +
      'chave nova da conta de serviço (IAM e administrador → Contas de serviço → crm-imova-agenda ' +
      '→ Chaves → Adicionar chave → JSON) e troque também GOOGLE_AGENDA_CREDENCIAL no Fly.'
    );
  }
  if (/short-lived|timeframe|\biat\b|\bexp\b/i.test(detalhe)) {
    return (
      'O relógio deste computador está fora da hora certa, e o Google recusa o pedido. Acerte a ' +
      'data e a hora (Ajustes do Sistema → Geral → Data e Hora → automático) e rode de novo.'
    );
  }
  if (sub && /invalid email or user id/i.test(detalhe)) {
    return `O e-mail do --sub (${sub}) não é um usuário do Google Workspace da Imova. Confira o endereço.`;
  }
  if (codigo === 'unauthorized_client') {
    return sub
      ? `A delegação em todo o domínio não está ligada para este escopo. ${delegacao(clientId)}`
      : `O Google recusou a conta de serviço para este pedido (unauthorized_client): ${detalhe}.`;
  }
  if (/disabled/i.test(detalhe)) {
    return (
      'A conta de serviço está desativada no Google Cloud: ative-a em IAM e administrador → ' +
      'Contas de serviço.'
    );
  }
  if (codigo === 'invalid_client' || /not found|account not found|deleted/i.test(detalhe)) {
    return (
      'A conta de serviço não existe mais no Google Cloud (ou o projeto foi apagado). Confira em ' +
      'IAM e administrador → Contas de serviço, e baixe uma chave nova.'
    );
  }
  return `O Google não deu o token (${status}): ${detalhe || 'sem detalhe'}.`;
}

function erroDaApi(corpo) {
  const e = corpo?.error ?? {};
  const motivos = [
    ...(Array.isArray(e.errors) ? e.errors.map((x) => x?.reason) : []),
    ...(Array.isArray(e.details) ? e.details.map((x) => x?.reason) : []),
    e.status,
  ].filter(Boolean);
  return { mensagem: String(e.message ?? ''), motivos: motivos.map(String) };
}

function apiDesligada(mensagem, motivos) {
  return (
    motivos.some((m) => /accessNotConfigured|SERVICE_DISABLED/i.test(m)) ||
    /has not been used|is disabled/i.test(mensagem)
  );
}

const API_DESLIGADA =
  'A API do Google Agenda não está ativada no projeto do Google Cloud da conta de serviço: APIs e ' +
  'serviços → Biblioteca → Google Calendar API → Ativar. Depois de ativar, espere uns minutos.';

function soLeitura(quem, papel = 'reader') {
  const comeco =
    papel === 'freeBusyReader' ? 'A conta vê só livre/ocupado' : 'A conta tem só leitura';
  return (
    `${comeco}: falta "Fazer alterações nos eventos". ${compartilhar(quem)} ` +
    '(Se ela já está lá, troque a permissão dela.)'
  );
}

/** Por que a agenda não abriu (a lista de eventos). */
export function diagnosticoDaAgenda(status, corpo, { sub, conta, clientId } = {}) {
  const { mensagem, motivos } = erroDaApi(corpo);
  if (status === 404) {
    return sub
      ? `A agenda não abre para ${sub}: o id está errado, ou ${sub} não tem acesso a ela. ` +
          `Compartilhe a agenda com ${sub} ("Fazer alterações nos eventos"), ou use no --sub o ` +
          'e-mail da conta dona da agenda.'
      : 'A agenda não foi compartilhada com a conta de serviço (ou o id está errado). ' +
          `${compartilhar(conta)} Se você acabou de compartilhar, espere alguns minutos e rode de ` +
          'novo. Se não pegar (em 10/11 não tinha pegado), use o plano B: a delegação em todo o ' +
          'domínio, com --sub.';
  }
  if (status === 403 && apiDesligada(mensagem, motivos)) return API_DESLIGADA;
  if (
    status === 403 &&
    (motivos.some((m) => /insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(m)) ||
      /insufficient authentication scopes/i.test(mensagem))
  ) {
    return sub
      ? `A delegação está ligada, mas não para o escopo de eventos. ${delegacao(clientId)}`
      : `O token saiu sem o escopo de eventos (${ESCOPO}). Rode de novo; se repetir, baixe uma chave nova.`;
  }
  if (status === 403) {
    return `A agenda recusou a conta (403): ${mensagem || 'sem detalhe'}. ${compartilhar(sub ?? conta)}`;
  }
  if (status === 401) {
    return `O Google recusou o token na agenda (401): ${mensagem || 'sem detalhe'}. Rode de novo; se repetir, baixe uma chave nova.`;
  }
  return `A agenda respondeu ${status}: ${mensagem || 'sem detalhe'}.`;
}

/** Por que não deu para gravar o evento de teste. */
export function diagnosticoDaGravacao(status, corpo, { sub, conta } = {}) {
  const { mensagem, motivos } = erroDaApi(corpo);
  if (
    status === 403 &&
    (motivos.some((m) => /requiredAccessLevel/i.test(m)) || /writer access/i.test(mensagem))
  ) {
    return soLeitura(sub ?? conta);
  }
  if (status === 403 && apiDesligada(mensagem, motivos)) return API_DESLIGADA;
  if (status === 403) return `A agenda recusou a gravação (403): ${mensagem || 'sem detalhe'}.`;
  return `O Google não gravou o evento de teste (${status}): ${mensagem || 'sem detalhe'}.`;
}

// ---------------------------------------------------------------------------
// A conferência
// ---------------------------------------------------------------------------
async function json(resposta) {
  return resposta.json().catch(() => ({}));
}

/** Um id de evento válido para o Google (base32hex: 0-9 e a-v), único a cada rodada. */
function idDoTeste(agoraMs) {
  return `conferencia${Math.floor(agoraMs).toString(32)}`;
}

/**
 * A conferência inteira. Não imprime nada: devolve os passos, cada um com `ok`, a frase e, às
 * vezes, um aviso. Para no primeiro que falhar (os seguintes dependem dele).
 *
 * @param {object} o
 * @param {string|null} o.credencialCrua  o JSON (ou base64) da conta de serviço
 * @param {string} [o.agenda]             o id da agenda (padrão: a da Imova)
 * @param {string} [o.sub]                plano B: o usuário do Workspace em nome de quem testar
 * @param {typeof fetch} [o.buscar]
 * @param {() => number} [o.agora]        milissegundos desde 1970
 */
export async function conferir({
  credencialCrua,
  agenda = AGENDA_DA_IMOVA,
  sub,
  buscar = fetch,
  agora = () => Date.now(),
  api = API_PADRAO,
}) {
  const passos = [];
  const resultado = { ok: false, passos, conta: null, clientId: null, agenda, sub: sub || null };
  const falhou = (nome, frase) => {
    passos.push({ nome, ok: false, frase });
    return resultado;
  };

  // 1. A credencial
  const lida = lerCredencial(credencialCrua);
  if (lida.erro) return falhou('Credencial', lida.erro);
  const { credencial } = lida;
  try {
    createSign('RSA-SHA256').update('x').sign(credencial.private_key);
  } catch {
    return falhou(
      'Credencial',
      'A chave privada do JSON está corrompida (o arquivo foi editado ou cortado). Baixe uma chave nova.',
    );
  }
  resultado.conta = credencial.client_email;
  resultado.clientId = credencial.client_id;
  passos.push({
    nome: 'Credencial',
    ok: true,
    frase: `conta de serviço ${credencial.client_email}${
      credencial.client_id ? ` (client ID ${credencial.client_id})` : ''
    }`,
    aviso:
      credencial.client_email === CONTA_DA_IMOVA
        ? undefined
        : `Esta chave é da conta ${credencial.client_email}, e não da ${CONTA_DA_IMOVA} do guia: ` +
          `o compartilhamento tem de ser com ${credencial.client_email}.`,
  });
  const contexto = { sub, conta: credencial.client_email, clientId: credencial.client_id };

  // 2. O token
  let token;
  try {
    const resposta = await buscar(credencial.token_uri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwtDaContaDeServico(credencial, Math.floor(agora() / 1000), sub),
      }).toString(),
    });
    const corpo = await json(resposta);
    if (!resposta.ok || typeof corpo.access_token !== 'string') {
      return falhou('Token', diagnosticoDoToken(resposta.status, corpo, contexto));
    }
    token = corpo.access_token;
  } catch (e) {
    return falhou(
      'Token',
      `Não deu para falar com o Google (${new URL(credencial.token_uri).host}): confira a internet e rode de novo. (${e.message})`,
    );
  }
  passos.push({
    nome: 'Token',
    ok: true,
    frase: sub ? `saiu em nome de ${sub} (delegação em todo o domínio)` : 'saiu',
  });

  const cabecalhos = { Authorization: `Bearer ${token}` };
  const eventos = `${api}/calendars/${encodeURIComponent(agenda)}/events`;

  // 3. A agenda abre, e a conta pode mudar eventos nela
  try {
    const busca = new URLSearchParams({
      maxResults: '1',
      singleEvents: 'true',
      timeMin: new Date(agora()).toISOString(),
    });
    const resposta = await buscar(`${eventos}?${busca}`, { method: 'GET', headers: cabecalhos });
    const corpo = await json(resposta);
    if (!resposta.ok)
      return falhou('Agenda', diagnosticoDaAgenda(resposta.status, corpo, contexto));
    const papel = String(corpo.accessRole ?? '');
    if (papel === 'reader' || papel === 'freeBusyReader') {
      return falhou('Agenda', soLeitura(sub ?? credencial.client_email, papel));
    }
    const fuso = typeof corpo.timeZone === 'string' ? corpo.timeZone : null;
    passos.push({
      nome: 'Agenda',
      ok: true,
      frase: `"${corpo.summary ?? agenda}" abre${fuso ? `, no fuso ${fuso}` : ''}, e a conta pode mudar eventos (${
        papel === 'owner' ? 'dona' : 'editora'
      })`,
      aviso:
        fuso && !FUSOS_DE_NATAL.has(fuso)
          ? `A agenda está no fuso ${fuso}: o feriado de dia inteiro vale no fuso da agenda. Em ` +
            'Configurações da agenda, troque o fuso para (GMT-03:00) Fortaleza ou Brasília.'
          : undefined,
    });
  } catch (e) {
    return falhou(
      'Agenda',
      `Não deu para falar com o Google Agenda: confira a internet e rode de novo. (${e.message})`,
    );
  }

  // 4. Gravar e apagar um evento de teste, de madrugada, daqui a dez anos
  const ano = new Date(agora()).getUTCFullYear() + 10;
  const quando = `04/01/${ano}, às 3h`;
  const id = idDoTeste(agora());
  try {
    const gravado = await buscar(`${eventos}?sendUpdates=none`, {
      method: 'POST',
      headers: { ...cabecalhos, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        summary: TITULO_DO_TESTE,
        start: { dateTime: `${ano}-01-04T03:00:00-03:00` },
        end: { dateTime: `${ano}-01-04T03:15:00-03:00` },
        transparency: 'transparent',
        visibility: 'private',
        reminders: { useDefault: false, overrides: [] },
        extendedProperties: { private: { origem: 'triade-crm', tipo: 'conferencia' } },
      }),
    });
    const corpo = await json(gravado);
    if (!gravado.ok) {
      return falhou('Gravar e apagar', diagnosticoDaGravacao(gravado.status, corpo, contexto));
    }
    const apagado = await buscar(`${eventos}/${encodeURIComponent(id)}?sendUpdates=none`, {
      method: 'DELETE',
      headers: cabecalhos,
    });
    if (!apagado.ok && apagado.status !== 404 && apagado.status !== 410) {
      const { mensagem } = erroDaApi(await json(apagado));
      return falhou(
        'Gravar e apagar',
        `Gravou, mas não apagou o evento de teste (${apagado.status}${mensagem ? `: ${mensagem}` : ''}). ` +
          `O espelho precisa das duas coisas. Apague à mão "${TITULO_DO_TESTE}", em ${quando}, e ` +
          'confira se a conta pode "Fazer alterações nos eventos".',
      );
    }
  } catch (e) {
    return falhou(
      'Gravar e apagar',
      `Não deu para falar com o Google Agenda: confira a internet e rode de novo. (${e.message})`,
    );
  }
  passos.push({
    nome: 'Gravar e apagar',
    ok: true,
    frase: `criou e apagou um evento de teste em ${quando}`,
  });

  resultado.ok = true;
  return resultado;
}

// ---------------------------------------------------------------------------
// O que vem depois, e a saída na tela
// ---------------------------------------------------------------------------
/** O SQL que liga o espelho no banco da Imova, sem mexer no resto de app_settings['calendly']. */
export function sqlDoGoogleAgendaId(agenda) {
  const valor = JSON.stringify({ google_agenda_id: agenda }).replaceAll("'", "''");
  return [
    'insert into public.app_settings (key, value)',
    `values ('calendly', '${valor}')`,
    'on conflict (key) do update',
    '  set value = public.app_settings.value || excluded.value, updated_at = now();',
  ].join('\n');
}

function recuar(texto, espacos) {
  return texto
    .split('\n')
    .map((l) => ' '.repeat(espacos) + l)
    .join('\n');
}

/** O texto da tela. Puro: os testes conferem que nele não há chave nem token. */
export function textoDoResultado(r) {
  const linhas = ['', 'Conferência do espelho no Google (agenda do Calendly da Imova)', ''];
  r.passos.forEach((p, i) => {
    const rotulo = `${i + 1}. ${p.nome} `.padEnd(22, '.');
    linhas.push(`${rotulo} ${p.ok ? `ok · ${p.frase}` : 'FALHOU'}`);
    if (!p.ok) linhas.push(recuar(p.frase, 3));
    if (p.aviso) linhas.push(recuar(`Atenção: ${p.aviso}`, 3));
  });
  linhas.push('');
  if (!r.ok) {
    linhas.push('Resolva o passo que falhou e rode de novo. Guia: docs/operacao/calendly.md.', '');
    return linhas.join('\n');
  }
  linhas.push(
    'Tudo certo: a conta grava e apaga na agenda. Os próximos passos (docs/operacao/calendly.md):',
    '',
    '  a. Grave o id da agenda no banco da Imova (SQL Editor do Supabase do projeto da Imova):',
    '',
    recuar(sqlDoGoogleAgendaId(r.agenda), 5),
    '',
  );
  let letra = 'b';
  if (r.sub) {
    linhas.push(
      `  ${letra}. Plano B: ponha o usuário no worker (o valor não é segredo):`,
      `     fly secrets set --app imova-worker-wa GOOGLE_AGENDA_SUB=${r.sub}`,
      '',
    );
    letra = 'c';
  }
  linhas.push(
    `  ${letra}. Publique o worker (da raiz, de uma cópia limpa) e faça o teste 9.2 do guia:`,
    '     fly deploy . --config infra/nuvem/fly.imova-worker-wa.toml --dockerfile apps/workers/Dockerfile',
    '',
  );
  return linhas.join('\n');
}

/** Os argumentos da linha de comando. Puro. */
export function lerArgumentos(argv, ambiente = {}) {
  const r = {
    arquivo: null,
    agenda: AGENDA_DA_IMOVA,
    sub: ambiente.GOOGLE_AGENDA_SUB?.trim() || null,
    ajuda: false,
    erro: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const valor = () => {
      const v = argv[i + 1];
      i += 1;
      if (!v || v.startsWith('--')) r.erro = `Falta o valor de ${a}.`;
      return v?.trim() ?? null;
    };
    if (a === '--ajuda' || a === '-h' || a === '--help') r.ajuda = true;
    else if (a === '--agenda') r.agenda = valor();
    else if (a === '--sub') r.sub = valor();
    else if (a === '--credencial') r.arquivo = valor();
    else if (a.startsWith('--')) r.erro = `Não conheço a opção ${a}.`;
    else r.arquivo = a;
  }
  return r;
}

const USO =
  'Uso: node scripts/google-agenda-conferir.mjs <arquivo JSON da conta de serviço> [--sub <e-mail>] [--agenda <id>]\n' +
  '     (ou GOOGLE_AGENDA_CREDENCIAL=<JSON ou base64> no ambiente, no lugar do arquivo)';

async function principal() {
  const args = lerArgumentos(process.argv.slice(2), process.env);
  if (args.ajuda) {
    console.log(USO);
    return 0;
  }
  if (args.erro) {
    console.error(`\n${args.erro}\n${USO}\n`);
    return 1;
  }
  let credencialCrua;
  if (args.arquivo) {
    const caminho = resolve(args.arquivo.replace(/^~(?=\/|$)/, homedir()));
    if (!existsSync(caminho)) {
      console.error(`\nO arquivo ${caminho} não existe.\n${USO}\n`);
      return 1;
    }
    credencialCrua = readFileSync(caminho, 'utf8');
  } else if (process.env.GOOGLE_AGENDA_CREDENCIAL) {
    credencialCrua = process.env.GOOGLE_AGENDA_CREDENCIAL;
  } else {
    console.error(`\nFalta a credencial.\n${USO}\n`);
    return 1;
  }
  const r = await conferir({ credencialCrua, agenda: args.agenda, sub: args.sub ?? undefined });
  console.log(textoDoResultado(r));
  return r.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  principal().then(
    (codigo) => process.exit(codigo),
    (e) => {
      // Nunca o objeto inteiro: ele poderia carregar o pedido com a chave.
      console.error(`\nA conferência parou: ${e?.message ?? 'erro sem descrição'}\n`);
      process.exit(1);
    },
  );
}
