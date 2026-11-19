/**
 * Trazer as fotos de um anúncio de fora (05/11/2026), só na Imova: do sistema
 * atual e, desde 09/11/2026, da página do anúncio no Canal Pro (o favorito
 * "Levar fotos para o CRM", `fotos-de-fora.ts`).
 *
 * POST { anuncio_id, urls: (string | string[])[] (até 60, capa primeiro), modo? }
 *   cada item é uma foto; uma lista são versões da mesma foto, tentadas em ordem
 *   (a maior primeiro; a última é a que a página mostrou).
 *   modo: 'se_vazio' (o padrão: só para anúncio sem foto), 'juntar' (no fim das
 *   que o anúncio tem) ou 'trocar' (ficam só as que chegaram, na ordem).
 *   → { ok: true, fotos: [{ url, ok, motivo }], removidas?: <quantas saíram> }
 *   → { ok: true, pulado: 'ja_tem_fotos', fotos: <quantas tem> }
 *   → { ok: false, motivo }
 *
 * As fotos estão no servidor do sistema atual; o navegador não as baixa (outro
 * domínio, sem CORS). Este servidor baixa cada uma, converte para JPEG (o único
 * formato do balde e do portal; a Arbo entrega WebP; `foto-em-jpeg.ts`), sobe
 * para o balde `anuncios` no mesmo caminho
 * que a rota `api/anuncios/fotos` usa (`<anuncio_id>/<uuid>.jpg`) e registra com
 * `public.anuncio_foto_adicionar` — pela SESSÃO de quem pediu, que confere de
 * novo quem pode mexer no anúncio. A chave de serviço só sobe o arquivo.
 *
 * No modo padrão, só para anúncio SEM foto: trazer de novo um anúncio que já
 * tem fotos as duplicaria. 'juntar' e 'trocar' vêm de quem conferiu as fotos na
 * tela e escolheu. Em 'trocar', as novas sobem e entram primeiro; só depois o
 * banco tira as antigas (`anuncio_fotos_trocar`), numa transação: o anúncio no
 * ar nunca fica sem foto, e se nenhuma nova chegar as antigas ficam. A ordem
 * pedida é a ordem do anúncio: baixa até 4 de cada vez, registra na ordem.
 *
 * Depois da troca (19/11/2026), o anúncio NO AR não recebe fotos por aqui, em
 * modo nenhum: o robô do Grupo OLX já leu o arquivo do CRM, o Canal Pro só
 * espelha o CRM, e trocar as fotos muda as URLs (o portal as trata como fotos
 * novas). A conferência do favorito já não as pede (`conferir`, `crmEhAFonte`);
 * esta é a trava do servidor → { ok: false, motivo: 'crm_publica' } (409). Ela é
 * conferida no começo e de novo logo antes de gravar: o download pode levar até
 * 240 s, e a troca (ou o "Pôr no ar") pode acontecer no meio; aí nada é gravado
 * e os arquivos que subiram saem do balde. A trava fica aqui, e não nas funções
 * do banco: `anuncio_foto_adicionar` também serve ao editor, que continua
 * mudando as fotos do anúncio no ar. As fotos do anúncio no ar mudam no editor
 * (`api/anuncios/fotos`).
 */
import { NextResponse, type NextRequest } from 'next/server';

import { FOTOS_POR_ANUNCIO } from '@/components/anuncios/arquivo-vrsync';
import { getSession } from '@/lib/auth/session';
import { EMPRESA } from '@/lib/empresa';
import { registrarAviso, registrarRecusa } from '@/lib/registro-do-servidor';
import { createClient } from '@/lib/supabase/server';
import { criarClienteAdmin, temChaveDeServico } from '@/lib/supabase/servidor-admin';

import { buscarDeFora } from '../buscar-de-fora';
import { fotoEmJpeg } from './foto-em-jpeg';

export const runtime = 'nodejs';
// 60 fotos, cada versão em até 30 s, 4 de cada vez; o prazo interno corta antes.
export const maxDuration = 300;

const BALDE = 'anuncios';
/** O limite do balde e do VRSync por imagem. */
const TETO = 7 * 1024 * 1024;
const AO_MESMO_TEMPO = 4;
/** Depois disso, as fotos que faltam voltam como 'sem_tempo' (a função morre em 300 s). */
const PRAZO_MS = 240_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** O sinal da troca vale 90 dias, como em `app.canal_pro_crm_publica()`. */
const DIAS_DO_SINAL_DA_TROCA = 90;

type FotoTrazida = { url: string; ok: boolean; motivo: string | null };
type Modo = 'se_vazio' | 'juntar' | 'trocar';
const MODOS: readonly Modo[] = ['se_vazio', 'juntar', 'trocar'];
/** Versões da mesma foto que a rota tenta, no máximo. */
const VERSOES_POR_FOTO = 4;

function recusa(motivo: string, status: number) {
  return NextResponse.json({ ok: false, motivo }, { status });
}

export async function POST(request: NextRequest) {
  if (!EMPRESA.modulos.anuncios) return recusa('sem_modulo', 404);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return recusa('sem_sessao', 401);
  const papel = (await getSession())?.papel;
  if (papel !== 'admin' && papel !== 'gestor') return recusa('sem_permissao', 403);
  if (!temChaveDeServico()) {
    registrarRecusa('anuncios/importar/fotos', 'nao_configurado');
    return recusa('nao_configurado', 503);
  }

  const pedido = (await request.json().catch(() => null)) as {
    anuncio_id?: unknown;
    urls?: unknown;
    modo?: unknown;
  } | null;
  const anuncioId = typeof pedido?.anuncio_id === 'string' ? pedido.anuncio_id.trim() : '';
  const modo: Modo | null =
    pedido?.modo === undefined
      ? 'se_vazio'
      : MODOS.includes(pedido.modo as Modo)
        ? (pedido.modo as Modo)
        : null;
  // Cada foto vira a lista das suas versões (uma URL solta é uma versão só).
  const fotosPedidas = Array.isArray(pedido?.urls)
    ? pedido.urls
        .map((item) =>
          (Array.isArray(item) ? item : [item])
            .filter((u): u is string => typeof u === 'string' && u.trim() !== '')
            .slice(0, VERSOES_POR_FOTO),
        )
        .filter((versoes) => versoes.length > 0)
    : null;
  if (!UUID.test(anuncioId) || !fotosPedidas || !modo) return recusa('pedido_incompleto', 400);
  if (fotosPedidas.length > FOTOS_POR_ANUNCIO) return recusa('fotos_demais', 400);

  // O anúncio precisa ser visível E editável pela sessão de quem pede.
  const { data: anuncio, error } = await supabase
    .from('anuncios')
    .select('id, excluido_em, situacao')
    .eq('id', anuncioId)
    .maybeSingle();
  if (error) {
    registrarRecusa('anuncios/importar/fotos', 'consulta_falhou');
    return recusa('consulta_falhou', 500);
  }
  if (!anuncio) return recusa('nao_encontrado', 404);
  if (anuncio.excluido_em) return recusa('excluido', 409);

  /**
   * No ar, depois da troca, quem manda nas fotos é o CRM (a mesma regra de
   * `app.canal_pro_crm_publica`: o robô do Grupo OLX leu o arquivo do CRM nos
   * últimos 90 dias). Lê a situação de novo a cada vez: ela pode ter mudado
   * durante o download.
   */
  async function travadoPelaTroca(): Promise<'sim' | 'nao' | 'erro'> {
    const { data: agora, error: erroDoAnuncio } = await supabase
      .from('anuncios')
      .select('situacao')
      .eq('id', anuncioId)
      .maybeSingle();
    if (erroDoAnuncio) return 'erro';
    if (agora?.situacao !== 'no_ar') return 'nao';
    const desde = new Date(Date.now() - DIAS_DO_SINAL_DA_TROCA * 86_400_000).toISOString();
    const { count: leituras, error: erroDaLeitura } = await supabase
      .from('canal_pro_leituras')
      .select('id', { count: 'exact', head: true })
      .eq('do_grupo_olx', true)
      .gt('em', desde);
    if (erroDaLeitura) return 'erro';
    return (leituras ?? 0) > 0 ? 'sim' : 'nao';
  }

  const antes = await travadoPelaTroca();
  if (antes === 'erro') {
    registrarRecusa('anuncios/importar/fotos', 'consulta_falhou');
    return recusa('consulta_falhou', 500);
  }
  if (antes === 'sim') return recusa('crm_publica', 409);

  const { count, error: erroDaContagem } = await supabase
    .from('anuncio_fotos')
    .select('id', { count: 'exact', head: true })
    .eq('anuncio_id', anuncioId);
  if (erroDaContagem) {
    registrarRecusa('anuncios/importar/fotos', 'consulta_falhou');
    return recusa('consulta_falhou', 500);
  }
  const jaTem = count ?? 0;
  if (modo === 'se_vazio' && jaTem > 0) {
    return NextResponse.json({ ok: true, pulado: 'ja_tem_fotos', fotos: jaTem });
  }
  // Em 'trocar' as novas entram antes de as antigas saírem: as duas cabem juntas.
  if (modo !== 'se_vazio' && jaTem + fotosPedidas.length > FOTOS_POR_ANUNCIO) {
    return recusa(modo === 'trocar' ? 'fotos_demais_para_trocar' : 'fotos_demais', 400);
  }

  // Em 'trocar', as que o anúncio tem agora, na ordem: se a troca não puder ser
  // inteira, o anúncio volta a ficar só com elas (18/11/2026).
  let antigas: string[] = [];
  if (modo === 'trocar' && jaTem > 0) {
    const { data: atuais, error: erroDasAtuais } = await supabase
      .from('anuncio_fotos')
      .select('id')
      .eq('anuncio_id', anuncioId)
      .order('posicao');
    if (erroDasAtuais) {
      registrarRecusa('anuncios/importar/fotos', 'consulta_falhou');
      return recusa('consulta_falhou', 500);
    }
    antigas = (atuais ?? []).map((f) => f.id as string);
  }

  const admin = criarClienteAdmin();
  const permitirLocal = process.env.NODE_ENV !== 'production';
  const inicio = Date.now();

  /** Tenta as versões de uma foto, a maior primeiro; devolve a primeira que subiu. */
  async function subirAlguma(versoes: string[]): Promise<{ caminho: string } | { motivo: string }> {
    let ultima: { caminho: string } | { motivo: string } = { motivo: 'falhou' };
    for (const url of versoes) {
      ultima = await subir(url);
      if ('caminho' in ultima || ultima.motivo === 'sem_tempo') return ultima;
    }
    return ultima;
  }

  /** Baixa, converte e sobe uma versão; devolve o caminho no balde. */
  async function subir(url: string): Promise<{ caminho: string } | { motivo: string }> {
    if (Date.now() - inicio > PRAZO_MS) return { motivo: 'sem_tempo' };
    const busca = await buscarDeFora(url, {
      tempoMs: 30_000,
      teto: TETO,
      permitirLocal,
      aceitar: 'image/jpeg, image/webp;q=0.9, image/png;q=0.9, image/*;q=0.8',
    });
    if (!busca.ok) return { motivo: busca.motivo };
    const foto = await fotoEmJpeg(busca.bytes, TETO);
    if (!foto.ok) return { motivo: foto.motivo };
    const caminho = `${anuncioId}/${crypto.randomUUID()}.jpg`;
    const { error: erroDoBalde } = await admin.storage
      .from(BALDE)
      .upload(caminho, foto.jpeg, { contentType: 'image/jpeg', upsert: false });
    if (erroDoBalde) return { motivo: 'balde_recusou' };
    return { caminho };
  }

  // Baixa e sobe até 4 de cada vez, guardando cada resultado no lugar da sua foto.
  const subidas: ({ caminho: string } | { motivo: string })[] = new Array(fotosPedidas.length);
  let proxima = 0;
  await Promise.all(
    Array.from({ length: Math.min(AO_MESMO_TEMPO, fotosPedidas.length) }, async () => {
      while (proxima < fotosPedidas.length) {
        const i = proxima++;
        subidas[i] = await subirAlguma(fotosPedidas[i]!).catch(() => ({ motivo: 'falhou' }));
      }
    }),
  );

  // A trava de novo, logo antes de gravar: se a troca aconteceu durante o
  // download (ou o anúncio foi ao ar), nada é gravado e os arquivos saem do balde.
  const depois = await travadoPelaTroca();
  if (depois !== 'nao') {
    const subiram = subidas.flatMap((x) => ('caminho' in x ? [x.caminho] : []));
    if (subiram.length) await admin.storage.from(BALDE).remove(subiram);
    registrarRecusa(
      'anuncios/importar/fotos',
      depois === 'sim' ? 'crm_publica_no_meio' : 'consulta_falhou',
    );
    return depois === 'sim' ? recusa('crm_publica', 409) : recusa('consulta_falhou', 500);
  }

  // Registra na ordem pedida: a primeira que chegou é a capa (em 'juntar', vão
  // para o fim da fila).
  const fotos: FotoTrazida[] = [];
  const novas: string[] = [];
  for (const [i, versoes] of fotosPedidas.entries()) {
    // A foto é contada pela versão que a página mostrou (a última).
    const url = versoes[versoes.length - 1]!;
    const subida = subidas[i]!;
    if ('motivo' in subida) {
      fotos.push({ url, ok: false, motivo: subida.motivo });
      continue;
    }
    const { data, error: erroDoRegistro } = await supabase.rpc('anuncio_foto_adicionar', {
      p_anuncio: anuncioId,
      p_caminho: subida.caminho,
    });
    const r = (data ?? {}) as { ok?: boolean; motivo?: string; id?: string | null };
    if (erroDoRegistro || !r.ok) {
      // A linha não entrou: o arquivo sai do balde para não ficar órfão.
      await admin.storage.from(BALDE).remove([subida.caminho]);
      fotos.push({ url, ok: false, motivo: erroDoRegistro ? 'falhou' : (r.motivo ?? 'falhou') });
      continue;
    }
    if (r.id) novas.push(r.id);
    fotos.push({ url, ok: true, motivo: null });
  }

  // Trocar: só quando TODAS as pedidas chegaram. Com alguma faltando (o Canal
  // Pro recusou, o tempo acabou), o anúncio volta a ficar só com as antigas: uma
  // troca pela metade deixaria o anúncio no ar com menos fotos do que tinha
  // (achado da revisão de 18/11/2026). A volta é a mesma função, com as antigas.
  let removidas: number | undefined;
  if (modo === 'trocar' && novas.length > 0) {
    const inteira = novas.length === fotosPedidas.length;
    const voltar = !inteira && antigas.length > 0;
    if (inteira || voltar) {
      const { data, error: erroDaTroca } = await supabase.rpc('anuncio_fotos_trocar', {
        p_anuncio: anuncioId,
        p_novas: inteira ? novas : antigas,
      });
      const t = (data ?? {}) as { ok?: boolean; motivo?: string; removidas?: string[] };
      if (erroDaTroca || !t.ok) {
        registrarRecusa('anuncios/importar/fotos', t.motivo ?? 'troca_falhou');
        return NextResponse.json({ ok: false, motivo: 'troca_falhou', fotos });
      }
      // As linhas já saíram; os arquivos saem do balde (se falhar, sobra só o arquivo).
      if (t.removidas?.length) await admin.storage.from(BALDE).remove(t.removidas);
      if (voltar) {
        registrarAviso('anuncios/importar/fotos', 'troca_incompleta', {
          pedidas: fotosPedidas.length,
          chegaram: novas.length,
        });
        return NextResponse.json({ ok: false, motivo: 'troca_incompleta', fotos });
      }
      removidas = t.removidas?.length ?? 0;
    }
  }

  const falharam = fotos.filter((f) => !f.ok);
  if (falharam.length) {
    registrarAviso('anuncios/importar/fotos', 'fotos_que_falharam', {
      total: fotos.length,
      falharam: falharam.length,
      motivos: [...new Set(falharam.map((f) => f.motivo))].join(','),
    });
  }
  return NextResponse.json({ ok: true, fotos, ...(removidas !== undefined ? { removidas } : {}) });
}
