/**
 * Procura o telefone de uma ficha no Google Places.
 *
 * O que sai daqui é para a TELA, não para o banco. Os Termos do Google proíbem
 * armazenar conteúdo do Places (exceto `place_id`), e o R03 §2.4 prescreve o uso
 * certo: gatilho de descoberta, com o dado definitivo vindo do fornecedor. Quem
 * grava telefone neste produto é `registrar_contato`, depois de uma ligação.
 *
 * Três recusas acontecem ANTES de gastar uma consulta paga:
 *
 *   `ficha_ja_tem_telefone`  não se procura o que já existe.
 *   `nao_contatar`           contato suprimido não vira alvo, em nenhum modo
 *                            (guardrail do CLAUDE.md). Procurar o telefone de
 *                            quem pediu para sumir é o oposto de respeitar o
 *                            pedido, mesmo sem guardar o número.
 *   `ficha_invisivel`        a RLS da pessoa respondeu que ela não vê a ficha.
 */
import { NextResponse, type NextRequest } from 'next/server';

import {
  montarConsulta,
  procurarLugar,
  RECADO_DO_PLACES,
  temChaveDoPlaces,
  type MotivoDoPlaces,
} from '@/lib/google/lugares';
import { registrarRecusa } from '@/lib/registro-do-servidor';
import { createClient } from '@/lib/supabase/server';
import { criarClienteAdmin, temChaveDeServico } from '@/lib/supabase/servidor-admin';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, motivo: 'sem_sessao' }, { status: 401 });

  if (!temChaveDeServico() || !temChaveDoPlaces()) {
    registrarRecusa('telefone/procurar', 'nao_configurado');
    return NextResponse.json(
      { ok: false, motivo: 'nao_configurado', recado: RECADO_DO_PLACES.nao_configurado },
      { status: 503 },
    );
  }

  const corpo = (await request.json().catch(() => ({}))) as { organization_id?: unknown };
  const orgId = typeof corpo.organization_id === 'string' ? corpo.organization_id : '';
  if (!orgId) {
    registrarRecusa('telefone/procurar', 'sem_ficha');
    return NextResponse.json({ ok: false, motivo: 'sem_ficha' }, { status: 400 });
  }

  // Acesso pela RLS da pessoa: se ela não enxerga a ficha, não procura o
  // telefone dela.
  const { data: visivel } = await supabase
    .from('organizations_view')
    .select('id')
    .eq('id', orgId)
    .maybeSingle();
  if (!visivel) {
    registrarRecusa('telefone/procurar', 'ficha_invisivel');
    return NextResponse.json({ ok: false, motivo: 'ficha_invisivel' }, { status: 404 });
  }

  const admin = criarClienteAdmin();
  const { data: fichaBruta } = await admin
    .schema('app')
    .rpc('ficha_para_busca_de_telefone', { p_organization_id: orgId });

  const ficha = fichaBruta as {
    nome?: string;
    bairro?: string | null;
    cidade?: string | null;
    uf?: string | null;
    categoria?: string | null;
    tem_telefone?: boolean;
    nao_contatar?: boolean;
  } | null;

  if (!ficha?.nome) {
    registrarRecusa('telefone/procurar', 'ficha_inexistente');
    return NextResponse.json({ ok: false, motivo: 'ficha_inexistente' }, { status: 404 });
  }
  if (ficha.nao_contatar) {
    registrarRecusa('telefone/procurar', 'nao_contatar');
    return NextResponse.json({ ok: false, motivo: 'nao_contatar' }, { status: 409 });
  }
  if (ficha.tem_telefone) {
    registrarRecusa('telefone/procurar', 'ficha_ja_tem_telefone');
    return NextResponse.json({ ok: false, motivo: 'ficha_ja_tem_telefone' }, { status: 409 });
  }

  const consulta = montarConsulta(ficha as Parameters<typeof montarConsulta>[0]);
  const r = await procurarLugar(consulta);

  if (!r.ok) {
    registrarRecusa('telefone/procurar', r.motivo, { detalhe: r.detalhe });
    return NextResponse.json(
      { ok: false, motivo: r.motivo, recado: RECADO_DO_PLACES[r.motivo as MotivoDoPlaces] },
      { status: 502 },
    );
  }

  // Guarda o `place_id` do primeiro resultado (único campo que os Termos
  // permitem) e audita. O número NÃO vai junto — nem para o audit_log.
  const primeiro = r.lugares[0];
  await admin.schema('app').rpc('registrar_busca_de_telefone', {
    p_organization_id: orgId,
    p_place_id: primeiro?.placeId ?? null,
    p_achou: r.lugares.some((l) => l.telefone !== null),
  });

  return NextResponse.json({
    ok: true,
    consulta,
    lugares: r.lugares,
  });
}
