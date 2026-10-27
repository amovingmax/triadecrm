'use client';

import * as z from 'zod';
import type { Json, MsgType } from '@komune/schema';

import { createClient } from '@/lib/supabase/client';

import { fraseDaRecusaDoEnvio } from './mensagens';

/**
 * O que esta tela ESCREVE no banco: aprovar, descartar, responder, marcar lida.
 *
 * Regra da casa, a mesma de `components/registro/gravar.ts` e de
 * `components/ligacao/chamada-rpc.ts`: **nenhum texto do Postgres chega à tela.**
 * As recusas previstas do banco (`{ok:false, motivo}`) viram frase pronta; as
 * exceções viram uma frase que diz o que fazer, e o texto cru fica no console de
 * quem depura.
 *
 * ===========================================================================
 * O QUE APROVAR FAZ, E O QUE APROVAR NÃO FAZ
 * ===========================================================================
 * `public.aprovar_rascunho` põe o rascunho em `aprovado` e assina com
 * `auth.uid()`. Ela NÃO cria a mensagem — não pode: `messages_guard` exige que
 * uma mensagem de IA tenha `author_kind = 'bot_ai'`, e a política de insert de
 * `messages` só deixa `authenticated` escrever `human` ou `bot_fixed`. Quem cria
 * a linha enviada é o worker, com a chave de serviço, depois de falar com a Meta.
 *
 * Isso não é um contorno: é o ADR-05 desenhado de propósito nas duas pontas. A
 * pessoa aprova o TEXTO; a máquina entrega. O worker existe e já sabe entregar;
 * o que falta é o número e o token da Meta. Então aprovar hoje termina em
 * `aprovado` e para ali — e a tela diz isso na cara de quem clicou, em vez de
 * mostrar um "enviado" que não aconteceu.
 */

export class ErroDaConversa extends Error {
  readonly podeTentarDeNovo: boolean;

  constructor(mensagem: string, podeTentarDeNovo: boolean, causa?: unknown) {
    super(mensagem, { cause: causa });
    this.name = 'ErroDaConversa';
    this.podeTentarDeNovo = podeTentarDeNovo;
  }
}

/** Traduz o código do PostgREST numa frase que diz o que fazer. */
function levantar(codigo: string | null | undefined, causa: unknown): never {
  switch (codigo) {
    case '42501':
      throw new ErroDaConversa(
        'Seu perfil não pode aprovar nem enviar mensagem nesta conversa.',
        false,
        causa,
      );
    case 'PGRST301':
    case '401':
      throw new ErroDaConversa('Sua sessão expirou. Entre de novo para continuar.', false, causa);
    case 'PGRST202':
      throw new ErroDaConversa(
        'Esta versão da tela não conversa com o servidor. Recarregue a página.',
        false,
        causa,
      );
    case '23514':
      throw new ErroDaConversa(
        'O banco recusou este texto. Confira e tente de novo.',
        false,
        causa,
      );
    default:
      throw new ErroDaConversa(
        'Não deu para falar com o servidor. Verifique a conexão e tente de novo.',
        true,
        causa,
      );
  }
}

// ---------------------------------------------------------------------------
// Aprovar (com ou sem edição) — RF-CON-22, ADR-05
// ---------------------------------------------------------------------------

const aprovacaoSchema = z.union([
  z.object({
    ok: z.literal(true),
    draft_id: z.uuid(),
    foi_editado: z.boolean(),
    aprovado_em: z.string(),
  }),
  z.object({ ok: z.literal(false), motivo: z.string() }),
]);

export type ResultadoDaAprovacao = z.infer<typeof aprovacaoSchema>;

/** As recusas que a RPC devolve nomeadas, cada uma com a sua frase. */
export const MENSAGENS_DE_RECUSA: Record<string, string> = {
  rascunho_nao_estava_pendente:
    'Este rascunho já tinha sido aprovado ou descartado por alguém. Recarregue a conversa.',
};

/**
 * Aprova o rascunho, com o texto que a pessoa leu na tela.
 *
 * `texto` viaja SEMPRE, mesmo quando ninguém editou. A RPC aceita `null` e usa o
 * proposto, mas mandar o que estava na tela é o que garante que o aprovado é o
 * que a pessoa viu: se um worker tivesse regravado o rascunho entre o carregar e
 * o clicar, aprovar "o proposto" aprovaria um texto que ninguém leu. (O gatilho
 * torna isso impossível hoje — `proposed_body` é imutável —, e mesmo assim o
 * caminho certo é o que não depende disso.)
 */
export async function aprovarRascunho(
  rascunhoId: string,
  texto: string,
): Promise<ResultadoDaAprovacao> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('aprovar_rascunho', {
    p_draft_id: rascunhoId,
    p_texto_final: texto,
  });
  if (error) {
    // O motivo vem ANTES do código, pelo mesmo caminho de `responder()`.
    //
    // `message_drafts_guard` reconfere a supressão no instante do clique e
    // levanta 42501 — o MESMO código de "papel não aprova envio". Sem esta
    // tradução, quem tentasse aprovar um rascunho para quem acabou de pedir
    // para sair lia "seu perfil não pode aprovar": iria pedir permissão ao
    // admin, o admin veria o papel em ordem, e o fato de o parceiro ter pedido
    // para sair não chegaria a ninguém. Um guardrail que a tela conta errado
    // vira um chamado de suporte sobre permissão.
    const frase = fraseDaRecusaDoEnvio(error.message);
    if (frase) throw new ErroDaConversa(frase, false, error);
    levantar(error.code, error);
  }

  const lido = aprovacaoSchema.safeParse(data);
  if (!lido.success) {
    throw new ErroDaConversa(
      'O servidor respondeu de um jeito que esta versão da tela não entende. Recarregue a página.',
      false,
      lido.error,
    );
  }
  return lido.data;
}

// ---------------------------------------------------------------------------
// Descartar — o motivo é obrigatório, e é do banco que essa regra vem
// ---------------------------------------------------------------------------

const descarteSchema = z.object({ ok: z.boolean(), draft_id: z.string() });

/**
 * Joga o rascunho fora com o motivo por escrito.
 *
 * O motivo não é burocracia: `foi_editado` diz que o prompt errou o TOM, e o
 * motivo do descarte diz que ele errou a COISA. São os dois únicos sinais
 * baratos que existem para decidir se um prompt precisa de v2 (RF-CON-28), e
 * descarte mudo é o mesmo que o prompt não ter errado.
 */
export async function descartarRascunho(rascunhoId: string, motivo: string): Promise<boolean> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('descartar_rascunho', {
    p_draft_id: rascunhoId,
    p_motivo: motivo,
  });
  if (error) levantar(error.code, error);
  const lido = descarteSchema.safeParse(data);
  return lido.success ? lido.data.ok : false;
}

// ---------------------------------------------------------------------------
// Responder — a mensagem escrita por uma pessoa
// ---------------------------------------------------------------------------

export type Resposta = {
  fioId: string;
  texto: string;
  /** A mensagem citada (27/10/2026): o WhatsApp mostra a "seta" em cima. */
  respondeA?: string | null;
};

/**
 * Insere a resposta como `queued`. Ela NÃO sai — e a tela diz isso.
 *
 * `author_kind: 'human'` e `sent_by` são exigidos pela política de insert e pelo
 * gatilho: mensagem humana sem autor não é humana. `origin: 'crm'` também é da
 * política — eco e importação são coisas que o worker registra, não que alguém
 * digita.
 *
 * E repare no que este objeto NÃO tem, porque já foi a porta de um furo:
 * `optout_confirmation`. Era um booleano de `public.messages` que quem inseria
 * escrevia, e que fazia o gatilho sair da função antes da supressão, da janela
 * e da aprovação — bastava mandá-lo aqui junto para uma mensagem de texto
 * livre chegar ao celular de quem tinha acabado de pedir para sair. Desde a
 * migração 20260905000300 ele é DERIVADO pelo banco a partir do estado, a
 * policy `messages_insert` exige `not optout_confirmation`, e mandá-lo daqui
 * é recusado. A confirmação de opt-out não passa por esta tela: quem a
 * escreve é `public.wa_optout_registrar`, com o texto fixo do GEN-SYS-OPTOUT.
 */
export async function responder({ fioId, texto, respondeA = null }: Resposta): Promise<void> {
  const supabase = createClient();
  const { data: sessao } = await supabase.auth.getUser();
  const eu = sessao.user?.id;
  if (!eu) throw new ErroDaConversa('Sua sessão expirou. Entre de novo para continuar.', false);

  const { error } = await supabase.from('messages').insert({
    conversation_id: fioId,
    direction: 'out',
    // Modelo não sai por aqui: a policy recusa (migração 20260915130000). Quem manda
    // modelo é `public.wa_enviar_modelo`, pela caixa `EnviarModelo`.
    type: 'text',
    status: 'queued',
    body: texto,
    author_kind: 'human',
    sent_by: eu,
    origin: 'crm',
    responde_a: respondeA,
  });

  if (error) {
    const frase = fraseDaRecusaDoEnvio(error.message);
    if (frase) throw new ErroDaConversa(frase, false, error);
    levantar(error.code, error);
  }
}

// ---------------------------------------------------------------------------
// O que não é texto: localização, contato, botões, lista, figurinha (27/10/2026)
// ---------------------------------------------------------------------------

export type EnvioEspecial = {
  fioId: string;
  tipo: Extract<MsgType, 'location' | 'contacts' | 'interactive' | 'image'>;
  /** A pergunta dos botões e da lista; nulo para localização, contato e figurinha. */
  corpo?: string | null;
  conteudo?: Json | null;
  respondeA?: string | null;
  /** Só a figurinha reaproveitada: o arquivo que já está no balde. */
  figurinha?: { caminho: string } | null;
};

/**
 * Pela MESMA porta do texto: um insert em `messages`, com a sessão de quem
 * manda. Quem confere a forma (botão de até 20 letras, lista de até 10 opções,
 * latitude que existe) é `app.messages_forma`, e a recusa dele já vem em
 * português ("Envio recusado: …") — `fraseDaRecusaDoEnvio` a entrega inteira.
 * A janela de 24 h, a supressão e os tetos continuam com `messages_guard`.
 */
export async function enviarEspecial(envio: EnvioEspecial): Promise<void> {
  const supabase = createClient();
  const { data: sessao } = await supabase.auth.getUser();
  const eu = sessao.user?.id;
  if (!eu) throw new ErroDaConversa('Sua sessão expirou. Entre de novo para continuar.', false);

  const { error } = await supabase.from('messages').insert({
    conversation_id: envio.fioId,
    direction: 'out',
    type: envio.tipo,
    status: 'queued',
    body: envio.corpo?.trim() || null,
    conteudo: envio.conteudo ?? null,
    responde_a: envio.respondeA ?? null,
    ...(envio.figurinha
      ? { media_path: envio.figurinha.caminho, media_mime: 'image/webp', tipo_na_meta: 'sticker' }
      : {}),
    author_kind: 'human',
    sent_by: eu,
    origin: 'crm',
  });
  if (error) {
    const frase = fraseDaRecusaDoEnvio(error.message);
    if (frase) throw new ErroDaConversa(frase, false, error);
    levantar(error.code, error);
  }
}

// ---------------------------------------------------------------------------
// O que se faz COM uma mensagem e com a conversa (27/10/2026)
// ---------------------------------------------------------------------------

/**
 * As recusas nomeadas das RPCs do WhatsApp completo, cada uma com a frase.
 * As que chegam como `motivo: sqlerrm` (a porteira recusou dentro da RPC) são
 * traduzidas por `fraseDaRecusaDoEnvio`, como no envio.
 */
export const MOTIVOS_DAS_ACOES: Record<string, string> = {
  mensagem_inexistente: 'Esta mensagem não existe mais. Recarregue a conversa.',
  conversa_inexistente: 'Esta conversa não existe mais. Recarregue a página.',
  sem_permissao: 'Seu perfil não pode fazer isso nesta conversa.',
  texto_vazio: 'Escreva o texto certo antes de mandar a correção.',
  so_texto_do_time: 'Só se corrige texto que alguém do time escreveu.',
  nao_saiu: 'Esta mensagem não saiu, então não há o que corrigir: mande de novo.',
  mensagem_sem_id_na_meta:
    'Esta mensagem ainda não saiu pelo WhatsApp. Dá para reagir depois que sair.',
  de_1_a_5_conversas: 'Escolha de 1 a 5 conversas.',
  nao_se_encaminha: 'Esta mensagem não se encaminha.',
  arquivo_ausente: 'O arquivo desta mensagem não está no CRM, então não dá para encaminhar.',
  sem_texto: 'Esta mensagem não tem texto para encaminhar.',
  ja_tem_tres_fixadas: 'Já há 3 conversas fixadas. Desafixe uma para fixar esta.',
};

export function fraseDoMotivo(motivo: unknown): string {
  if (typeof motivo !== 'string' || motivo === '') return 'Não deu certo. Tente de novo.';
  return (
    MOTIVOS_DAS_ACOES[motivo] ?? fraseDaRecusaDoEnvio(motivo) ?? 'Não deu certo. Tente de novo.'
  );
}

type Retorno = Record<string, unknown>;

/** O mesmo caminho para toda RPC daqui: exceção vira frase, `{ok:false}` também. */
function conferir(data: unknown, error: { message: string; code?: string } | null): Retorno {
  if (error) {
    const frase = fraseDaRecusaDoEnvio(error.message);
    if (frase) throw new ErroDaConversa(frase, false, error);
    levantar(error.code, error);
  }
  const r = (data !== null && typeof data === 'object' ? data : {}) as Retorno;
  if (r.ok !== true) throw new ErroDaConversa(fraseDoMotivo(r.motivo), false);
  return r;
}

/**
 * Apagar. A Cloud API não apaga para todos: o que já saiu some do CRM e
 * continua no celular do contato. O que ainda estava na fila é cancelado de
 * verdade — `cancelada: true` —, e o contato não recebe nada.
 */
export async function apagarMensagem(mensagemId: string): Promise<{ cancelada: boolean }> {
  const { data, error } = await createClient().rpc('mensagem_apagar', {
    p_message_id: mensagemId,
  });
  return { cancelada: conferir(data, error).cancelada === true };
}

export async function restaurarMensagem(mensagemId: string): Promise<void> {
  const { data, error } = await createClient().rpc('mensagem_restaurar', {
    p_message_id: mensagemId,
  });
  conferir(data, error);
}

/**
 * Corrigir (o "editar" possível). Sai uma mensagem nova, "Correção: …",
 * respondendo à original; se a original ainda estava na fila, ela é cancelada e
 * a certa vai no lugar (`substituiu: true`).
 */
export async function corrigirMensagem(
  mensagemId: string,
  texto: string,
): Promise<{ substituiu: boolean }> {
  const { data, error } = await createClient().rpc('mensagem_corrigir', {
    p_message_id: mensagemId,
    p_texto: texto,
  });
  return { substituiu: conferir(data, error).substituiu === true };
}

/** Reagir; `null` tira a reação (a Meta pede emoji vazio). */
export async function reagirAMensagem(mensagemId: string, emoji: string | null): Promise<void> {
  const { data, error } = await createClient().rpc('mensagem_reagir', {
    p_message_id: mensagemId,
    // O tipo gerado diz `string`, mas a função aceita nulo: é como se tira a reação.
    p_emoji: emoji as string,
  });
  conferir(data, error);
}

export type ResultadoDoEncaminhamento = { conversaId: string; ok: boolean; frase: string | null };

const encaminhamentoSchema = z.array(
  z.object({ conversation_id: z.string(), ok: z.boolean(), motivo: z.string().nullish() }),
);

/** Encaminhar para até 5 conversas; cada destino passa pela porteira dele. */
export async function encaminharMensagem(
  mensagemId: string,
  conversas: readonly string[],
): Promise<ResultadoDoEncaminhamento[]> {
  const { data, error } = await createClient().rpc('mensagem_encaminhar', {
    p_message_id: mensagemId,
    p_conversas: [...conversas],
  });
  const r = conferir(data, error);
  const lido = encaminhamentoSchema.safeParse(r.resultados);
  if (!lido.success) return [];
  return lido.data.map((x) => ({
    conversaId: x.conversation_id,
    ok: x.ok,
    frase: x.ok ? null : fraseDoMotivo(x.motivo),
  }));
}

export async function favoritarMensagem(mensagemId: string, favorita: boolean): Promise<void> {
  const { data, error } = await createClient().rpc('mensagem_favoritar', {
    p_message_id: mensagemId,
    p_favorita: favorita,
  });
  conferir(data, error);
}

export async function fixarConversa(fioId: string, fixar: boolean): Promise<void> {
  const { data, error } = await createClient().rpc('conversa_fixar', {
    p_conversation_id: fioId,
    p_fixar: fixar,
  });
  conferir(data, error);
}

/** `ate` nulo tira o silêncio; `'infinity'` é para sempre. */
export async function silenciarConversa(fioId: string, ate: string | null): Promise<void> {
  const { data, error } = await createClient().rpc('conversa_silenciar', {
    p_conversation_id: fioId,
    // O tipo gerado diz `string`, mas a função aceita nulo: é como se reativa.
    p_ate: ate as string,
  });
  conferir(data, error);
}

export async function marcarComoNaoLida(fioId: string): Promise<void> {
  const { data, error } = await createClient().rpc('conversa_marcar_nao_lida', {
    p_conversation_id: fioId,
  });
  conferir(data, error);
}

/**
 * Bloquear: no CRM vale na hora (nada sai, a fila do número é cancelada) e o
 * pedido vai à Meta pelo worker. Não é opt-out: a supressão da LGPD é outra.
 */
export async function bloquearConversa(fioId: string, bloquear: boolean): Promise<void> {
  const { data, error } = await createClient().rpc('conversa_bloquear', {
    p_conversation_id: fioId,
    p_bloquear: bloquear,
  });
  conferir(data, error);
}

/**
 * "Digitando…" para o contato. Calado de propósito: se não der (janela fechada,
 * opção desligada, rede), quem escreve não tem nada a fazer com o aviso.
 */
export async function avisarDigitando(fioId: string): Promise<void> {
  try {
    await createClient().rpc('conversa_digitando', { p_conversation_id: fioId });
  } catch {
    // Sinal de cortesia: a falha não interessa a ninguém.
  }
}

// ---------------------------------------------------------------------------
// Marcar como lida
// ---------------------------------------------------------------------------

/**
 * Zera o contador de não lidas do fio. Devolve se o banco aceitou.
 *
 * QUANDO chamar é decisão de `leitura-do-fio.ts` (a pessoa escolheu a conversa
 * e a janela está na frente dela); aqui é só a porta.
 *
 * É uma RPC, e não mais um UPDATE direto, desde 06/10/2026. A política de
 * update de `conversations` só deixa escrever o gestor ou quem está atendendo;
 * para o resto do time o UPDATE casava zero linhas e voltava SEM erro — o "por
 * ler" ficava lá e a tela achava que tinha marcado. Quem decide se esta pessoa
 * pode é `public.conversa_marcar_lida`, com o recorte de `conversations_select`.
 */
export async function marcarComoLida(fioId: string): Promise<boolean> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('conversa_marcar_lida', {
    p_conversation_id: fioId,
  });
  if (error) levantar(error.code, error);
  return (data as { ok?: boolean } | null)?.ok === true;
}

/**
 * Tira a conversa da lista, ou traz de volta (29/09/2026).
 *
 * Rafael pediu "apagar o chat" e, perguntado entre sumir da lista e apagar do
 * banco, escolheu arquivar. Nada é destruído: o fio inteiro continua, e
 * mensagem nova do parceiro desarquiva sozinha (gatilho no banco). Quem decide
 * se esta pessoa PODE é a RPC, que repete o recorte de `conversations_select`.
 */
export async function arquivarConversa(fioId: string, arquivar: boolean): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('conversa_arquivar', {
    p_conversation_id: fioId,
    p_arquivar: arquivar,
  });
  if (error) levantar(error.code, error);
  const r = data as { ok?: boolean; motivo?: string } | null;
  if (!r?.ok) {
    throw new ErroDaConversa(
      r?.motivo === 'sem_permissao'
        ? 'Você não pode arquivar esta conversa.'
        : 'Não deu para arquivar a conversa.',
      false,
    );
  }
}

// ---------------------------------------------------------------------------
// O áudio recebido
// ---------------------------------------------------------------------------

/**
 * O balde privado onde o worker guarda a mídia baixada da Meta.
 *
 * Criado pela migração `20260905000201_wa_ponte_publica`, PRIVADO e **sem
 * política nenhuma em `storage.objects`**: quem lê e escreve é o worker, com a
 * chave de serviço. `media_path` é `<conversa>/<mensagem>.<ext>`, e quem o grava
 * é `public.wa_midia_registrar`.
 *
 * Consequência para esta tela, e ela é real: **o navegador não consegue assinar
 * a URL sozinho**, porque a `authenticated` não tem select no balde — e o
 * `apps/web` não tem (nem deve ter) a chave de serviço, por decisão registrada
 * no `.env.example`. Falta a peça do meio: um endereço no servidor que confira
 * pela RLS se a pessoa enxerga a mensagem e devolva a URL assinada.
 *
 * O caminho abaixo é o certo e já está escrito: no dia em que a permissão
 * existir, ele passa a funcionar sem mudar uma linha desta tela. Enquanto não
 * existe, `urlDaMidia` devolve `null` e o balão mostra o que é verdade — o
 * arquivo está guardado, esta tela não alcança —, com a transcrição ao lado.
 */
export const BUCKET_MIDIA = 'mensagens';

/**
 * URL assinada do áudio, pedida ao SERVIDOR.
 *
 * O balde `mensagens` é privado e não tem política para `authenticated`
 * (migração `20260905000201`): assinar daqui sempre devolveu `null`, e por isso
 * o balão vinha mostrando "falta o endereço no servidor que assina a URL". O
 * endereço existe desde 17/09/2026 — `POST /api/midia`.
 *
 * **O pedido é por `message_id`, nunca por caminho.** Caminho vindo do cliente é
 * caminho que o cliente escolhe: com ele, qualquer pessoa autenticada pediria o
 * áudio de qualquer conversa. Com o id, quem responde se aquela mensagem é
 * visível é a RLS da própria pessoa, do lado de lá.
 *
 * `null` continua sendo estado, não falha: mensagem sem arquivo guardado (o
 * worker estava parado quando ela chegou) e mensagem invisível respondem igual,
 * e o balão mostra a transcrição do mesmo jeito.
 */
export async function urlDaMidia(
  messageId: string,
  /** O documento para BAIXAR, com o nome que o contato vê (27/10/2026). */
  baixar = false,
): Promise<string | null> {
  try {
    const resposta = await fetch('/api/midia', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        baixar ? { message_id: messageId, baixar: true } : { message_id: messageId },
      ),
    });
    if (!resposta.ok) return null;
    const dados = (await resposta.json()) as { ok?: boolean; url?: string };
    return dados.ok && typeof dados.url === 'string' ? dados.url : null;
  } catch {
    return null;
  }
}
