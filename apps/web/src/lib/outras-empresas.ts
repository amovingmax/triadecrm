import 'server-only';

import { cache } from 'react';

import { getSession } from '@/lib/auth/session';
import { type DestinoDoSeletor, EMPRESA, OUTRAS_EMPRESAS_DO_SELETOR } from '@/lib/empresa';
import { assinarPergunta, lerResposta } from '@/lib/pergunta-entre-empresas';

/**
 * A quais outras empresas a pessoa logada também tem acesso. É o que decide se ela vê
 * o botão de trocar de empresa (`destinosDaPessoa` em `lib/empresa.ts`).
 *
 * Desde 22/10/2026 ninguém marca nada: este servidor pergunta ao servidor de cada
 * outra empresa se o e-mail da pessoa entra lá (`/api/empresas/acesso`, pergunta
 * assinada com `SEGREDO_ENTRE_EMPRESAS`), e a outra responde pelo próprio banco. Antes
 * era a marcação "Também acessa" do admin, em cada empresa; marcada só de um lado, a
 * pessoa ia e não voltava.
 *
 * Na dúvida, o botão some: sem segredo, sem e-mail, outra empresa fora do ar, lenta
 * (mais de `ESPERA_MS`) ou respondendo em nome de outra. Ele só leva a outro endereço,
 * e quem decide se a pessoa entra lá é o login de lá.
 *
 * A resposta fica guardada neste servidor por um tempo (`LEMBRA_*`), para a troca de
 * tela e o F5 não perguntarem de novo. Quem ganha ou perde acesso na outra empresa vê
 * o botão mudar em até 10 minutos.
 */
const ESPERA_MS = 3_000;
const LEMBRA_SIM_MS = 10 * 60_000;
const LEMBRA_NAO_MS = 2 * 60_000;
const LEMBRA_FALHA_MS = 30_000;

const lembradas = new Map<string, { entra: boolean; ate: number }>();

export const lerMinhasOutrasEmpresas = cache(async (): Promise<string[]> => {
  const segredo = process.env.SEGREDO_ENTRE_EMPRESAS;
  if (OUTRAS_EMPRESAS_DO_SELETOR.length === 0 || !segredo) return [];
  const email = (await getSession())?.email;
  if (!email) return [];
  const respostas = await Promise.all(
    OUTRAS_EMPRESAS_DO_SELETOR.map((destino) => entraNaOutra(destino, email, segredo)),
  );
  return OUTRAS_EMPRESAS_DO_SELETOR.filter((_, i) => respostas[i]).map((d) => d.slug);
});

async function entraNaOutra(destino: DestinoDoSeletor, email: string, segredo: string): Promise<boolean> {
  const chave = `${destino.slug}|${email.toLowerCase()}`;
  const agora = Date.now();
  const lembrada = lembradas.get(chave);
  if (lembrada && lembrada.ate > agora) return lembrada.entra;

  const pergunta = assinarPergunta(segredo, {
    de: EMPRESA.slug,
    para: destino.slug,
    email,
    em: Math.floor(agora / 1000),
  });
  let entra = false;
  let lembrarPor = LEMBRA_FALHA_MS;
  try {
    const resposta = await fetch(`${destino.url}/api/empresas/acesso`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pergunta),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(ESPERA_MS),
    });
    if (resposta.ok) {
      entra = lerResposta(await resposta.json(), destino.slug);
      lembrarPor = entra ? LEMBRA_SIM_MS : LEMBRA_NAO_MS;
    } else {
      console.warn(`[empresas] ${destino.slug} respondeu ${resposta.status} à pergunta de acesso`);
    }
  } catch (erro) {
    console.warn(`[empresas] ${destino.slug} não respondeu à pergunta de acesso: ${(erro as Error).name}`);
  }
  lembradas.set(chave, { entra, ate: agora + lembrarPor });
  return entra;
}
