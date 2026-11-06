/**
 * Começa a troca de empresa sem novo login (passo 1 de `lib/troca-de-empresa.ts`).
 *
 * Roda NA EMPRESA ATUAL, com a sessão de quem tocou no botão. O e-mail sai da sessão,
 * no servidor: ninguém pede código para o e-mail de outra pessoa. A outra empresa decide
 * se emite o código; aqui só se encaminha. Sem código, vale o caminho de antes: a tela
 * da outra empresa, que pede o login se precisar.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { codigoValido } from '@/lib/auth/entrada-pelo-app';
import { getSession } from '@/lib/auth/session';
import { EMPRESA, OUTRAS_EMPRESAS_DO_SELETOR } from '@/lib/empresa';
import { origemDaRequisicao } from '@/lib/http';
import { assinarPergunta } from '@/lib/pergunta-entre-empresas';
import { ROTA_INICIAL, destinoSeguro } from '@/lib/supabase/middleware';
import { ENTRAR_PELA_TROCA, PEDIDO_DE_ENTRADA } from '@/lib/troca-de-empresa';

const ROTA = '/auth/empresa/ir';
/** A outra empresa responde na hora; mais que isto e a pessoa espera à toa. */
const ESPERA_MS = 5_000;

export async function GET(request: NextRequest) {
  const base = origemDaRequisicao(request);
  const params = request.nextUrl.searchParams;
  const destino = OUTRAS_EMPRESAS_DO_SELETOR.find((d) => d.slug === params.get('para'));
  if (!destino) return NextResponse.redirect(`${base}${ROTA_INICIAL}`);

  const next = destinoSeguro(params.get('next'));
  const comoAntes = () => NextResponse.redirect(`${destino.url}${next}`);

  const email = (await getSession())?.email;
  const segredo = process.env.SEGREDO_ENTRE_EMPRESAS;
  if (!email || !segredo) return comoAntes();

  const pedido = assinarPergunta(
    segredo,
    { de: EMPRESA.slug, para: destino.slug, email, em: Math.floor(Date.now() / 1000) },
    'entrada',
  );
  try {
    const resposta = await fetch(`${destino.url}${PEDIDO_DE_ENTRADA}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pedido),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(ESPERA_MS),
    });
    const corpo = (await resposta.json().catch(() => null)) as {
      empresa?: unknown;
      codigo?: unknown;
    } | null;
    const codigo = typeof corpo?.codigo === 'string' ? corpo.codigo : null;
    if (resposta.ok && corpo?.empresa === destino.slug && codigoValido(codigo)) {
      const alvo = new URL(ENTRAR_PELA_TROCA, destino.url);
      alvo.searchParams.set('codigo', codigo);
      alvo.searchParams.set('next', next);
      return NextResponse.redirect(alvo.toString());
    }
    console.warn(`[troca] ${ROTA} ${destino.slug} não deu o código: ${resposta.status}`);
  } catch (erro) {
    console.warn(`[troca] ${ROTA} ${destino.slug} não respondeu: ${(erro as Error).name}`);
  }
  return comoAntes();
}
