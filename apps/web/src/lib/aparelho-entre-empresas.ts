import 'server-only';

import { EMPRESA, OUTRAS_EMPRESAS_DO_SELETOR } from '@/lib/empresa';
import { assinarPergunta } from '@/lib/pergunta-entre-empresas';

/**
 * Leva o aparelho do app às outras empresas (avisos no celular, 06/11/2026).
 *
 * "Essas mensagens devem estar chegando para o App do Tríade, independente do ambiente":
 * quem tem acesso às duas empresas recebe os avisos das duas, mesmo que só abra uma no
 * app. Quando o app registra o aparelho aqui, este servidor pede a cada outra empresa,
 * assinado (finalidade `aparelho`, com a ação e o endereço de push dentro da assinatura),
 * que registre também. A outra confere no próprio banco se o e-mail entra lá. Ao sair
 * da conta, o mesmo caminho desliga o aparelho em todas.
 *
 * Melhor esforço: outra empresa fora do ar não atrasa nem impede nada aqui.
 */

export const PEDIDO_DE_APARELHO = '/api/empresas/aparelho';
const ESPERA_MS = 3_000;

export type AcaoDoAparelho = 'registrar' | 'remover';

/** O que vai assinado junto: `registrar|ios|ExponentPushToken[…]`. */
export function extraDoAparelho(acao: AcaoDoAparelho, plataforma: string, token: string): string {
  return `${acao}|${plataforma}|${token}`;
}

export function lerExtraDoAparelho(
  extra: string | undefined,
): { acao: AcaoDoAparelho; plataforma: string; token: string } | null {
  const [acao, plataforma, token, ...resto] = (extra ?? '').split('|');
  if (resto.length || (acao !== 'registrar' && acao !== 'remover') || !plataforma || !token) {
    return null;
  }
  return { acao, plataforma, token };
}

export async function levarAparelhoAsOutrasEmpresas(
  email: string,
  acao: AcaoDoAparelho,
  token: string,
  plataforma: string,
): Promise<void> {
  const segredo = process.env.SEGREDO_ENTRE_EMPRESAS;
  if (!segredo || OUTRAS_EMPRESAS_DO_SELETOR.length === 0) return;
  const em = Math.floor(Date.now() / 1000);
  await Promise.all(
    OUTRAS_EMPRESAS_DO_SELETOR.map(async (destino) => {
      const pedido = assinarPergunta(
        segredo,
        {
          de: EMPRESA.slug,
          para: destino.slug,
          email,
          em,
          extra: extraDoAparelho(acao, plataforma, token),
        },
        'aparelho',
      );
      try {
        const resposta = await fetch(`${destino.url}${PEDIDO_DE_APARELHO}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pedido),
          cache: 'no-store',
          redirect: 'error',
          signal: AbortSignal.timeout(ESPERA_MS),
        });
        if (!resposta.ok) {
          console.warn(
            `[avisos] ${destino.slug} respondeu ${resposta.status} ao aparelho (${acao})`,
          );
        }
      } catch (erro) {
        console.warn(
          `[avisos] ${destino.slug} não recebeu o aparelho (${acao}): ${(erro as Error).name}`,
        );
      }
    }),
  );
}
