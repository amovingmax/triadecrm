/**
 * A outra empresa traz o aparelho do app (avisos no celular, 06/11/2026; ver
 * `lib/aparelho-entre-empresas.ts`).
 *
 * Quem chama é o SERVIDOR da outra empresa, sem sessão: a rota é pública no proxy
 * (`ehRotaPublica`) e protegida pela assinatura com `SEGREDO_ENTRE_EMPRESAS`, finalidade
 * `aparelho`, que vale um minuto e leva a ação e o endereço de push dentro dela.
 *
 * Registrar só vale para quem entra NESTA empresa pela regra do próprio banco
 * (`public.aparelho_registrar_por_email` confere `email_entra_no_crm`). O nome que vai
 * nos avisos é o desta empresa.
 *
 *   200  feito ({ registrado } no registrar).
 *   404  este site não tem o segredo.
 *   400  pedido malformado.  401  vencido, para outra empresa ou com assinatura errada.
 *   503  sem chave de serviço ou o banco recusou.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { lerExtraDoAparelho } from '@/lib/aparelho-entre-empresas';
import { plataformaValida, tokenValido } from '@/lib/avisos-no-celular';
import { EMPRESA, OUTRAS_EMPRESAS_DO_SELETOR } from '@/lib/empresa';
import { conferirPergunta } from '@/lib/pergunta-entre-empresas';
import { criarClienteAdmin, rpcDoServidor, temChaveDeServico } from '@/lib/supabase/servidor-admin';

const ROTA = '/api/empresas/aparelho';
const SEM_CACHE = { 'Cache-Control': 'no-store' };

function recusa(status: number, motivo: string) {
  return NextResponse.json({ ok: false, motivo }, { status, headers: SEM_CACHE });
}

export async function POST(request: NextRequest) {
  const segredo = process.env.SEGREDO_ENTRE_EMPRESAS;
  if (!segredo) return recusa(404, 'desligada');

  const corpo: unknown = await request.json().catch(() => null);
  const conferida = conferirPergunta(
    segredo,
    corpo,
    EMPRESA.slug,
    Math.floor(Date.now() / 1000),
    'aparelho',
  );
  if (!conferida.ok) {
    console.warn(`[recusa] ${ROTA} motivo=${conferida.motivo}`);
    return recusa(conferida.motivo === 'malformada' ? 400 : 401, conferida.motivo);
  }
  const { de, email, extra } = conferida.pergunta;
  if (!OUTRAS_EMPRESAS_DO_SELETOR.some((d) => d.slug === de)) {
    return recusa(401, 'empresa_desconhecida');
  }
  const pedido = lerExtraDoAparelho(extra);
  if (!pedido || !tokenValido(pedido.token) || !plataformaValida(pedido.plataforma)) {
    return recusa(400, 'malformada');
  }

  if (!temChaveDeServico()) return recusa(503, 'nao_configurado');
  const admin = criarClienteAdmin();
  if (pedido.acao === 'remover') {
    const { error } = await admin.rpc(
      'aparelho_remover_por_email' as never,
      {
        p_email: email,
        p_token: pedido.token,
      } as never,
    );
    if (error) {
      console.error(`[erro] ${ROTA} rpc=aparelho_remover_por_email ${error.message}`);
      return recusa(503, 'banco');
    }
    return NextResponse.json({ ok: true }, { headers: SEM_CACHE });
  }
  const registrado = await rpcDoServidor<boolean>(admin, ROTA, 'aparelho_registrar_por_email', {
    p_email: email,
    p_token: pedido.token,
    p_plataforma: pedido.plataforma,
    p_empresa: EMPRESA.slug,
    p_empresa_nome: EMPRESA.nome,
  });
  if (registrado === null) return recusa(503, 'banco');
  return NextResponse.json({ ok: true, registrado }, { headers: SEM_CACHE });
}
