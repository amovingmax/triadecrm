/**
 * A pergunta que o servidor de uma empresa faz ao da outra: "este e-mail entra aí?".
 *
 * É o que faz o botão de trocar de empresa aparecer sozinho para quem tem acesso às
 * duas (decisão do usuário, 22/10/2026). Cada empresa só consulta o PRÓPRIO banco
 * (`public.email_entra_no_crm`); o que atravessa de um site ao outro é esta pergunta,
 * e a resposta é só sim ou não.
 *
 * A pergunta vai assinada (HMAC-SHA256) com `SEGREDO_ENTRE_EMPRESAS`, que só os
 * servidores das duas empresas têm. Sem a assinatura certa, a rota não diz nada:
 * ninguém de fora descobre quem trabalha em cada empresa. Ela vale 5 minutos e diz
 * para qual empresa foi feita, para não ser reaproveitada depois nem em outro site.
 *
 * Sem `server-only` de propósito: aqui não há segredo nenhum, só a conta, e os testes
 * precisam importar o arquivo. O segredo é lido pelos dois lados que o usam
 * (`lib/outras-empresas.ts` e `app/api/empresas/acesso/route.ts`), ambos de servidor.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { EMPRESAS, type EmpresaSlug } from '@komune/schema/empresas';
import * as z from 'zod';

/** Por quanto tempo uma pergunta assinada vale, para cada lado, contando relógios fora de acerto. */
export const VALIDADE_DA_PERGUNTA_S = 300;

/**
 * Para que a pergunta serve. `seletor` é a de sempre ("este e-mail entra aí?", só sim ou
 * não). `entrada` (06/11/2026) pede o código de uso único da troca de empresa sem novo
 * login (`app/api/empresas/entrada`): vale menos tempo e é assinada com outro prefixo,
 * então uma pergunta do seletor nunca serve como pedido de entrada, nem o contrário.
 */
export type Finalidade = 'seletor' | 'entrada' | 'aparelho';

/** Quanto vale um pedido de entrada: o servidor de uma empresa chama o da outra na hora. */
export const VALIDADE_DA_ENTRADA_S = 60;

const VALIDADE: Record<Finalidade, number> = {
  seletor: VALIDADE_DA_PERGUNTA_S,
  entrada: VALIDADE_DA_ENTRADA_S,
  // O aparelho do app levado à outra empresa (avisos no celular, 06/11/2026).
  aparelho: VALIDADE_DA_ENTRADA_S,
};

export interface Pergunta {
  /** Quem pergunta. */
  de: EmpresaSlug;
  /** A quem: a empresa que responde confere que é ela. */
  para: EmpresaSlug;
  email: string;
  /** Quando foi feita, em segundos desde 1970. */
  em: number;
  /**
   * O que mais o pedido leva, assinado junto (só fora do seletor): no `aparelho`, a
   * ação e o endereço de push. Sem ele, ninguém troca o aparelho de um pedido no caminho.
   */
  extra?: string;
}

export interface PerguntaAssinada extends Pergunta {
  assinatura: string;
}

export type RecusaDaPergunta = 'malformada' | 'outro_destino' | 'vencida' | 'assinatura';

const slug = z.enum(Object.keys(EMPRESAS) as [EmpresaSlug, ...EmpresaSlug[]]);

const perguntaSchema = z.object({
  de: slug,
  para: slug,
  email: z.string().min(3).max(320),
  em: z.number().int(),
  extra: z.string().max(400).optional(),
  assinatura: z.string().regex(/^[0-9a-f]{64}$/),
});

const respostaSchema = z.object({ empresa: z.string(), entra: z.boolean() });

function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

// O texto do seletor é o mesmo desde 22/10/2026: as versões no ar se entendem com as novas.
function textoAssinado(p: Pergunta, finalidade: Finalidade): string {
  const partes = [`triade-${finalidade}`, 'v1', p.de, p.para, p.email, String(p.em)];
  if (p.extra !== undefined) partes.push(p.extra);
  return partes.join('\n');
}

function hmac(segredo: string, p: Pergunta, finalidade: Finalidade): string {
  return createHmac('sha256', segredo).update(textoAssinado(p, finalidade)).digest('hex');
}

export function assinarPergunta(
  segredo: string,
  pergunta: Pergunta,
  finalidade: Finalidade = 'seletor',
): PerguntaAssinada {
  const p = { ...pergunta, email: normalizarEmail(pergunta.email) };
  return { ...p, assinatura: hmac(segredo, p, finalidade) };
}

/**
 * O lado de quem responde: a pergunta é para esta empresa, está no prazo e foi
 * assinada com o segredo? A ordem das recusas não revela nada além do que o próprio
 * corpo já diz; a assinatura é comparada em tempo constante.
 */
export function conferirPergunta(
  segredo: string,
  corpo: unknown,
  esta: EmpresaSlug,
  agoraS: number,
  finalidade: Finalidade = 'seletor',
): { ok: true; pergunta: Pergunta } | { ok: false; motivo: RecusaDaPergunta } {
  const lida = perguntaSchema.safeParse(corpo);
  if (!lida.success || lida.data.de === lida.data.para) return { ok: false, motivo: 'malformada' };
  const { assinatura, ...pergunta } = lida.data;
  if (pergunta.para !== esta) return { ok: false, motivo: 'outro_destino' };
  if (Math.abs(agoraS - pergunta.em) > VALIDADE[finalidade])
    return { ok: false, motivo: 'vencida' };
  const esperada = Buffer.from(
    hmac(segredo, { ...pergunta, email: normalizarEmail(pergunta.email) }, finalidade),
    'hex',
  );
  const recebida = Buffer.from(assinatura, 'hex');
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) {
    return { ok: false, motivo: 'assinatura' };
  }
  return { ok: true, pergunta: { ...pergunta, email: normalizarEmail(pergunta.email) } };
}

/**
 * O lado de quem perguntou: só vale "entra" se a resposta veio da empresa a quem se
 * perguntou. Um link trocado (o endereço da Imova apontando para outro site) responde
 * "não", em vez de mostrar um botão para o lugar errado.
 */
export function lerResposta(corpo: unknown, perguntadaA: EmpresaSlug): boolean {
  const lida = respostaSchema.safeParse(corpo);
  return lida.success && lida.data.empresa === perguntadaA && lida.data.entra;
}
