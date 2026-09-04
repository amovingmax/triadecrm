'use client';

import { createClient } from '@/lib/supabase/client';

import {
  argumentosDaRpc,
  MENSAGENS_DE_RECUSA,
  registroContatoSchema,
  resultadoRegistroSchema,
  RPC_REGISTRAR_CONTATO,
  type AlvoDoRegistro,
  type ComQuem,
  type DesfechoCatalogo,
  type PrevisaoRegistro,
  type ProximaAcaoEditada,
  type RegistroContato,
  type ResultadoRegistro,
  type Superficie,
} from './tipos';

/**
 * A gravação: monta o pedido, manda numa chamada só e traduz o que voltar.
 *
 * Regra da casa: NENHUM texto do Postgres chega à tela. Recusa prevista já vem
 * nomeada pela RPC (`{registrado:false, motivo}`) e tem frase em
 * `MENSAGENS_DE_RECUSA`; exceção (rede, permissão, defeito) vira uma frase que diz
 * o que fazer, e o texto cru fica no console para quem estiver depurando.
 */

export type EntradaDoRegistro = {
  alvo: AlvoDoRegistro;
  desfecho: DesfechoCatalogo;
  superficie: Superficie;
  comQuem: ComQuem;
  ocorridoEm: Date;
  previsao: PrevisaoRegistro;
  observacao?: string | null;
  duracaoMin?: number | null;
  lostReasonId?: number | null;
  reuniaoEm?: string | null;
  reuniaoFormato?: string | null;
  autorizacaoEvidencia?: string | null;
  confirmouOptout?: boolean;
  /** Só quando a pessoa mexeu na próxima ação; senão vale a da previsão. */
  proximaAcao?: ProximaAcaoEditada | null;
  /** Injetável nos testes; em produção é `crypto.randomUUID()`. */
  clientKey?: string;
};

/**
 * A próxima ação SEMPRE viaja no pedido quando a previsão tem uma.
 *
 * Poderia não viajar: `public.registrar_contato` sabe recalculá-la a partir do
 * catálogo. Mas então a data do recibo (calculada aqui, em ~1 ms) e a data da tarefa
 * (calculada lá) seriam dois cálculos independentes da mesma régua, e bastaria um
 * feriado novo no banco para elas divergirem na cara da pessoa. Mandando o valor, a
 * régua do servidor vira rede de segurança para a fila offline e para quem chamar a
 * RPC por fora.
 */
function proximaAcaoDoPedido(e: EntradaDoRegistro): ProximaAcaoEditada | null {
  if (e.proximaAcao) return e.proximaAcao;
  const { proximaAcaoEm, proximaAcaoTitulo, proximaAcaoTipo } = e.previsao;
  if (!proximaAcaoEm || !proximaAcaoTitulo || !proximaAcaoTipo) return null;
  return { tipo: proximaAcaoTipo, titulo: proximaAcaoTitulo, em: proximaAcaoEm };
}

/** Monta e valida o pedido. Lança `ZodError` quando algum campo do ramo faltou. */
export function montarRegistro(e: EntradaDoRegistro): RegistroContato {
  return registroContatoSchema.parse({
    clientKey: e.clientKey ?? crypto.randomUUID(),
    organizationId: e.alvo.id,
    dealId: e.alvo.dealId,
    etapaEsperadaId: e.alvo.etapaId,
    outcomeId: e.desfecho.id,
    superficie: e.superficie,
    comQuem: e.comQuem,
    ocorridoEm: e.ocorridoEm.toISOString(),
    observacao: e.observacao ?? null,
    // Duração só existe em reunião; nas outras superfícies o campo nem aparece.
    duracaoMin: e.superficie === 'reuniao' ? (e.duracaoMin ?? null) : null,
    lostReasonId: e.lostReasonId ?? null,
    reuniaoEm: e.reuniaoEm ?? null,
    reuniaoFormato: e.reuniaoFormato ?? null,
    autorizacaoEvidencia: e.autorizacaoEvidencia ?? null,
    proximaAcao: proximaAcaoDoPedido(e),
    confirmouOptout: e.confirmouOptout ?? false,
    temperaturaPrevista: e.previsao.temperatura,
  });
}

/** Erro que já tem frase em português pronta para a tela. */
export class ErroDeRegistro extends Error {
  /** `true` quando reenviar mais tarde faz sentido (rede, servidor fora do ar). */
  readonly podeTentarDeNovo: boolean;

  constructor(mensagem: string, podeTentarDeNovo: boolean, causa?: unknown) {
    super(mensagem, { cause: causa });
    this.name = 'ErroDeRegistro';
    this.podeTentarDeNovo = podeTentarDeNovo;
  }
}

/**
 * Traduz o erro do PostgREST em uma frase que diz o que fazer.
 *
 * O código vem de `error.code`: `PGRST301`/`401` é sessão vencida, `42501` é RLS,
 * `23514`/`23503` é o gatilho do catálogo recusando o par (desfecho, superfície) —
 * caso em que a tela está desatualizada e recarregar resolve.
 */
export function mensagemDoErro(codigo: string | null | undefined): {
  frase: string;
  podeTentarDeNovo: boolean;
} {
  switch (codigo) {
    case '42501':
      return {
        frase: 'Seu perfil não pode registrar contato neste parceiro.',
        podeTentarDeNovo: false,
      };
    case 'PGRST301':
    case '401':
      return { frase: 'Sua sessão expirou. Entre de novo para gravar.', podeTentarDeNovo: false };
    case '23514':
    case '23503':
      return {
        frase: 'Esse resultado não vale mais para este canal. Recarregue a tela.',
        podeTentarDeNovo: false,
      };
    case '23505':
      return { frase: 'Este contato já foi registrado.', podeTentarDeNovo: false };
    default:
      return {
        frase: 'Não deu para falar com o servidor. Guardei aqui e mando quando a rede voltar.',
        podeTentarDeNovo: true,
      };
  }
}

/** Manda o pedido. Recusa prevista volta como valor; o resto vira `ErroDeRegistro`. */
export async function gravarRegistro(registro: RegistroContato): Promise<ResultadoRegistro> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc(RPC_REGISTRAR_CONTATO, argumentosDaRpc(registro));

  if (error) {
    const { frase, podeTentarDeNovo } = mensagemDoErro(error.code);
    throw new ErroDeRegistro(frase, podeTentarDeNovo, error);
  }

  const lido = resultadoRegistroSchema.safeParse(data);
  if (!lido.success) {
    throw new ErroDeRegistro(
      'O servidor respondeu de um jeito que esta versão da tela não entende. Recarregue a página.',
      false,
      lido.error,
    );
  }
  return lido.data;
}

/** A frase de uma recusa prevista, pronta para a tela. */
export function fraseDaRecusa(
  resultado: Extract<ResultadoRegistro, { registrado: false }>,
): string {
  return MENSAGENS_DE_RECUSA[resultado.motivo];
}
