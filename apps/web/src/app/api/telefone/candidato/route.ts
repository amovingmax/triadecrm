/**
 * Procurar o telefone de um CANDIDATO do Radar, antes de ele virar parceiro.
 *
 * ===========================================================================
 * O NÚMERO QUE OBRIGOU ESTA ROTA A EXISTIR
 * ===========================================================================
 * Em 17/09/2026 a fila de revisão tinha 277 candidatos e UM telefone. Não é
 * falha do coletor: o casamentos.com.br não publica número. E não há caminho
 * legal e barato de raspagem para conseguir — foi investigado no mesmo dia, com
 * o robots.txt de cada fonte na mão:
 *
 *   · telelistas.net  — o robots.txt não responde. Sem ele, o RF-RAD-01 proíbe.
 *   · guiamais.com.br — o robots libera, mas a listagem é montada por
 *     JavaScript: não há dado nenhum no HTML.
 *   · solutudo.com.br — o robots proíbe justamente `/empresas/busca/resultados`,
 *     que é o caminho da descoberta.
 *   · olx.com.br      — Cloudflare devolve 403 até para o robots.txt. Passar por
 *     cima disso é contornar um bloqueio, e não é o que a gente faz.
 *
 * Sobra o que o R03 §2.4 já tinha prescrito: **o Places é gatilho de
 * DESCOBERTA**. Ele mostra o número na tela; quem grava é a pessoa, depois de
 * confirmar com o fornecedor. É exatamente o que a ficha do parceiro já fazia —
 * esta rota leva isso para a fila, que é onde a decisão acontece.
 *
 * ===========================================================================
 * O QUE ESTA ROTA NÃO FAZ, E NÃO PODE FAZER
 * ===========================================================================
 * Não grava nada. Os Termos do Places proíbem armazenar o conteúdo devolvido
 * (só o `place_id`), e é por isso que a resposta vai para a tela e morre ali.
 * Um "salvar automático" aqui seria o botão proibido com outro nome.
 *
 * As guardas são as mesmas da rota irmã, e na mesma ordem: sessão, depois a RLS
 * de quem pediu (candidato invisível responde igual a inexistente), depois as
 * recusas de produto — quem já tem telefone e quem pediu para não ser contatado.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { montarConsulta, procurarLugar, RECADO_DO_PLACES, type MotivoDoPlaces } from '@/lib/google/lugares';
import { registrarRecusa } from '@/lib/registro-do-servidor';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, motivo: 'sem_sessao' }, { status: 401 });

  const corpo = (await request.json().catch(() => ({}))) as { candidato_id?: unknown };
  const id = typeof corpo.candidato_id === 'string' ? corpo.candidato_id.trim() : '';
  if (id === '') {
    return NextResponse.json({ ok: false, motivo: 'sem_candidato' }, { status: 400 });
  }

  // Com a sessão DELA: a RLS de `supplier_candidates` decide o que ela enxerga.
  const { data: candidato, error } = await supabase
    .from('supplier_candidates')
    .select('id, name, phone_e164, do_not_contact, neighborhood, city_id, category_id')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    registrarRecusa('telefone/candidato', 'consulta_falhou');
    return NextResponse.json({ ok: false, motivo: 'consulta_falhou' }, { status: 500 });
  }
  if (!candidato) {
    // Invisível e inexistente respondem igual: dizer "existe, mas não é seu" já
    // conta algo sobre o que a outra pessoa está trabalhando.
    return NextResponse.json({ ok: false, motivo: 'candidato_invisivel' }, { status: 404 });
  }
  if (candidato.do_not_contact) {
    registrarRecusa('telefone/candidato', 'nao_contatar');
    return NextResponse.json({ ok: false, motivo: 'nao_contatar' }, { status: 409 });
  }
  if (candidato.phone_e164) {
    return NextResponse.json({ ok: false, motivo: 'ja_tem_telefone' }, { status: 409 });
  }

  // Cidade e categoria em NOME, que é o que a busca entende. Duas leituras de
  // catálogo, ambas liberadas pela RLS a qualquer pessoa autenticada.
  const [cidade, categoria] = await Promise.all([
    candidato.city_id === null
      ? Promise.resolve(null)
      : supabase.from('cities').select('name').eq('id', candidato.city_id).maybeSingle(),
    candidato.category_id === null
      ? Promise.resolve(null)
      : supabase.from('categories').select('name').eq('id', candidato.category_id).maybeSingle(),
  ]);

  const consulta = montarConsulta({
    nome: candidato.name,
    categoria: categoria?.data?.name ?? null,
    bairro: candidato.neighborhood,
    cidade: cidade?.data?.name ?? null,
  });

  const r = await procurarLugar(consulta);
  if (!r.ok) {
    registrarRecusa('telefone/candidato', r.motivo);
    return NextResponse.json(
      { ok: false, motivo: r.motivo, recado: RECADO_DO_PLACES[r.motivo as MotivoDoPlaces] },
      { status: r.motivo === 'nao_configurado' ? 503 : 502 },
    );
  }

  return NextResponse.json({ ok: true, consulta, lugares: r.lugares });
}
