/**
 * A outra empresa pede um código de entrada para a troca sem novo login (passo 2 de
 * `lib/troca-de-empresa.ts`).
 *
 * Quem chama é o SERVIDOR da outra empresa, sem sessão nem cookie: a rota é pública no
 * proxy (`ehRotaPublica`), e quem a protege é a assinatura com `SEGREDO_ENTRE_EMPRESAS`
 * para a finalidade `entrada`, que vale um minuto (`lib/pergunta-entre-empresas.ts`).
 *
 * O código só sai para quem entra NESTA empresa pela regra do próprio banco
 * (`public.email_entra_no_crm`, a mesma do login). É o link mágico do Supabase gerado
 * pelo servidor (`generateLink`): nenhum e-mail é enviado, vale uma vez só, e vira sessão
 * em `/auth/empresa/entrar`, no navegador da pessoa.
 *
 *   404  este site não tem o segredo: a troca sem login está desligada aqui.
 *   400  corpo que não é um pedido.
 *   401  pedido para outra empresa, vencido, com assinatura errada ou de quem não conhecemos.
 *   403  o e-mail não entra nesta empresa.
 *   503  sem a chave de serviço, ou o banco não respondeu: quem pediu cai no login de sempre.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { EMPRESA, OUTRAS_EMPRESAS_DO_SELETOR } from '@/lib/empresa';
import { conferirPergunta } from '@/lib/pergunta-entre-empresas';
import { criarClienteAdmin, rpcDoServidor, temChaveDeServico } from '@/lib/supabase/servidor-admin';

const ROTA = '/api/empresas/entrada';
const SEM_CACHE = { 'Cache-Control': 'no-store' };

function recusa(status: number, motivo: string) {
  return NextResponse.json({ ok: false, motivo }, { status, headers: SEM_CACHE });
}

export async function POST(request: NextRequest) {
  const segredo = process.env.SEGREDO_ENTRE_EMPRESAS;
  if (!segredo) return recusa(404, 'desligada');

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return recusa(400, 'malformada');
  }

  const agora = Math.floor(Date.now() / 1000);
  const conferida = conferirPergunta(segredo, corpo, EMPRESA.slug, agora, 'entrada');
  if (!conferida.ok) {
    console.warn(`[recusa] ${ROTA} motivo=${conferida.motivo}`);
    return recusa(conferida.motivo === 'malformada' ? 400 : 401, conferida.motivo);
  }
  const { de, email } = conferida.pergunta;
  if (!OUTRAS_EMPRESAS_DO_SELETOR.some((d) => d.slug === de)) {
    console.warn(`[recusa] ${ROTA} motivo=empresa_desconhecida de=${de}`);
    return recusa(401, 'empresa_desconhecida');
  }

  if (!temChaveDeServico()) return recusa(503, 'nao_configurado');
  const admin = criarClienteAdmin();
  const entra = await rpcDoServidor<boolean>(admin, ROTA, 'email_entra_no_crm', { p_email: email });
  if (entra === null) return recusa(503, 'banco');
  if (!entra) return recusa(403, 'sem_acesso');

  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const codigo = data?.properties?.hashed_token;
  if (error || !codigo) {
    console.error(`[erro] ${ROTA} generateLink: ${error?.message ?? 'sem código'}`);
    return recusa(503, 'codigo');
  }
  console.info(`[troca] ${ROTA} código de entrada emitido, vindo de ${de}`);
  return NextResponse.json({ empresa: EMPRESA.slug, codigo }, { headers: SEM_CACHE });
}
