'use client';

import { z } from 'zod';

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
      throw new ErroDaConversa('O banco recusou este texto. Confira e tente de novo.', false, causa);
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
  if (error) levantar(error.code, error);

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
  /** Preenchido quando a janela está fechada: fora dela só modelo aprovado sai. */
  modeloId?: number | null;
};

/**
 * Insere a resposta como `queued`. Ela NÃO sai — e a tela diz isso.
 *
 * `author_kind: 'human'` e `sent_by` são exigidos pela política de insert e pelo
 * gatilho: mensagem humana sem autor não é humana. `origin: 'crm'` também é da
 * política — eco e importação são coisas que o worker registra, não que alguém
 * digita.
 */
export async function responder({ fioId, texto, modeloId = null }: Resposta): Promise<void> {
  const supabase = createClient();
  const { data: sessao } = await supabase.auth.getUser();
  const eu = sessao.user?.id;
  if (!eu) throw new ErroDaConversa('Sua sessão expirou. Entre de novo para continuar.', false);

  const { error } = await supabase.from('messages').insert({
    conversation_id: fioId,
    direction: 'out',
    type: modeloId ? 'template' : 'text',
    status: 'queued',
    body: texto,
    template_id: modeloId,
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
// Marcar como lida
// ---------------------------------------------------------------------------

/**
 * Zera o contador de não lidas do fio.
 *
 * Chamada só quando a pessoa ESCOLHEU a conversa, nunca na abertura automática
 * do desktop (que mostra a primeira da lista sem ninguém pedir). Zerar ali
 * apagaria o "por ler" de uma conversa que ninguém olhou — e "por ler" que some
 * sozinho é pior do que não existir.
 */
export async function marcarComoLida(fioId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('conversations')
    .update({ unread_count: 0 })
    .eq('id', fioId)
    .gt('unread_count', 0);
  if (error) levantar(error.code, error);
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

/** Quanto tempo a URL assinada vale. Curta de propósito (PRD §10, R05). */
const SEGUNDOS_DA_URL = 300;

/**
 * URL assinada do arquivo, ou `null` quando esta tela não consegue assiná-la.
 *
 * `null` não é erro nem defeito: hoje é o resultado esperado, porque o balde
 * `mensagens` não tem política de leitura para `authenticated` (veja
 * `BUCKET_MIDIA`). Quem chama trata como estado, não como falha — e o balão
 * mostra a transcrição do mesmo jeito.
 */
export async function urlDaMidia(caminho: string): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET_MIDIA)
    .createSignedUrl(caminho, SEGUNDOS_DA_URL);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
