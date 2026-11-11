/**
 * O que a tela de Anúncios pede ao banco e ao servidor (04/11/2026).
 *
 * Toda escrita é uma função do Postgres (`public.anuncio_*`, `public.canal_pro_*`),
 * que confere quem pode e devolve `{ ok, motivo }`; aqui só se chama e se repassa.
 * As fotos sobem direto do navegador para o balde público `anuncios`, com a
 * autorização de uso único que `/api/anuncios/fotos` emite (a Vercel não deixa
 * passar arquivo acima de 4,5 MB pela função).
 */
import { createClient } from '@/lib/supabase/client';
import { supabaseUrl } from '@/lib/env';

import type { EstadoDoCaminho } from './passos-do-caminho';
import { ocupaVagaPeloRelatorio } from './regras-do-cartao';
import type { AnuncioDoRelatorio } from './relatorio-canal-pro';
import type {
  Anuncio,
  AnuncioNaLista,
  AnuncioNoCanalPro,
  DadosDoAnuncio,
  Destaque,
  FotoDoAnuncio,
  SituacaoDoCanalPro,
  TagDoCodigo,
} from './tipos';

export const CHAVE_DOS_ANUNCIOS = ['anuncios'] as const;
export const CHAVE_DO_CANAL_PRO = ['anuncios', 'canal-pro'] as const;

export type Resultado<T = Record<string, never>> =
  ({ ok: true } & T) | { ok: false; motivo: string; pendencias?: string[] };

/** A URL pública da foto, a mesma que vai no arquivo do Canal Pro. */
export function urlDaFoto(caminho: string): string {
  return `${supabaseUrl()}/storage/v1/object/public/anuncios/${caminho}`;
}

function resultado<T>(data: unknown, error: { message: string } | null): Resultado<T> {
  if (error) return { ok: false, motivo: error.message };
  const r = (data ?? {}) as { ok?: boolean; motivo?: string; pendencias?: string[] };
  if (!r.ok) return { ok: false, motivo: r.motivo ?? 'falhou', pendencias: r.pendencias };
  return r as Resultado<T>;
}

export async function carregarAnuncios(excluidos: boolean): Promise<AnuncioNaLista[]> {
  const consulta = createClient().from('anuncios_na_lista').select('*');
  const { data, error } = await (excluidos
    ? consulta.not('excluido_em', 'is', null).order('excluido_em', { ascending: false })
    : consulta.is('excluido_em', null).order('updated_at', { ascending: false }));
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as AnuncioNaLista[];
}

export async function carregarAnuncio(id: string): Promise<{
  anuncio: Anuncio;
  fotos: FotoDoAnuncio[];
  pendencias: string[];
  /** O último relatório do Canal Pro já o conta como vaga (11/11/2026). */
  ocupaVagaPeloRelatorio: boolean;
} | null> {
  const supabase = createClient();
  const [anuncio, fotos, lista] = await Promise.all([
    supabase.from('anuncios').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('anuncio_fotos')
      .select('id, caminho, posicao')
      .eq('anuncio_id', id)
      .order('posicao'),
    supabase
      .from('anuncios_na_lista')
      .select(
        'pendencias, proprietario_nome, codigo_no_canal_pro, no_canal_pro_situacao, no_canal_pro_visto_em',
      )
      .eq('id', id)
      .maybeSingle(),
  ]);
  if (anuncio.error) throw new Error(anuncio.error.message);
  if (fotos.error) throw new Error(fotos.error.message);
  if (!anuncio.data) return null;
  return {
    anuncio: {
      ...(anuncio.data as unknown as Anuncio),
      proprietario_nome: lista.data?.proprietario_nome ?? null,
      codigo_no_canal_pro: lista.data?.codigo_no_canal_pro ?? null,
    },
    fotos: (fotos.data ?? []) as FotoDoAnuncio[],
    pendencias: (lista.data?.pendencias as string[] | null) ?? [],
    ocupaVagaPeloRelatorio: ocupaVagaPeloRelatorio({
      situacao: (anuncio.data as unknown as Anuncio).situacao,
      no_canal_pro_situacao: lista.data?.no_canal_pro_situacao ?? null,
      no_canal_pro_visto_em: lista.data?.no_canal_pro_visto_em ?? null,
    }),
  };
}

export async function salvarAnuncio(
  id: string | null,
  dados: DadosDoAnuncio,
): Promise<Resultado<{ id: string; codigo: string; pendencias: string[] }>> {
  const { data, error } = await createClient().rpc('anuncio_salvar', {
    p_dados: dados,
    ...(id ? { p_id: id } : {}),
  });
  return resultado(data, error);
}

/**
 * O próximo código de cada tag ({ TE: 'TE0006', ... }), para o formulário mostrar
 * antes de salvar. É prévia: quem dá o código é o salvar (20261110100000).
 */
export async function carregarProximosCodigos(): Promise<Partial<Record<TagDoCodigo, string>>> {
  const { data, error } = await createClient().rpc('anuncio_proximos_codigos');
  if (error) throw new Error(error.message);
  const r = (data ?? {}) as { ok?: boolean; codigos?: Partial<Record<TagDoCodigo, string>> };
  return r.ok ? (r.codigos ?? {}) : {};
}

export async function publicarAnuncio(id: string): Promise<Resultado> {
  const { data, error } = await createClient().rpc('anuncio_publicar', { p_id: id });
  return resultado(data, error);
}

export async function tirarDoAr(id: string): Promise<Resultado> {
  const { data, error } = await createClient().rpc('anuncio_tirar_do_ar', { p_id: id });
  return resultado(data, error);
}

export async function escolherDestaque(id: string, destaque: Destaque): Promise<Resultado> {
  const { data, error } = await createClient().rpc('anuncio_destaque', {
    p_id: id,
    p_destaque: destaque,
  });
  return resultado(data, error);
}

export async function excluirAnuncio(id: string, motivo: string): Promise<Resultado> {
  const { data, error } = await createClient().rpc('anuncio_excluir', {
    p_id: id,
    p_motivo: motivo,
  });
  return resultado(data, error);
}

export async function restaurarAnuncio(id: string): Promise<Resultado> {
  const { data, error } = await createClient().rpc('anuncio_restaurar', { p_id: id });
  return resultado(data, error);
}

export async function ordenarFotos(anuncioId: string, ordem: string[]): Promise<Resultado> {
  const { data, error } = await createClient().rpc('anuncio_fotos_ordenar', {
    p_anuncio: anuncioId,
    p_ordem: ordem,
  });
  return resultado(data, error);
}

/** Um proprietário da base, para ligar ao anúncio. */
export async function procurarProprietarios(
  busca: string,
): Promise<{ id: string; nome: string }[]> {
  const termo = busca.trim();
  if (termo.length < 2) return [];
  const { data, error } = await createClient()
    .from('organizations_view')
    .select('id, name')
    .is('deleted_at', null)
    .eq('kind', 'fornecedor')
    .ilike('name', `%${termo.replace(/[%_]/g, '')}%`)
    .order('name')
    .limit(8);
  if (error) throw new Error(error.message);
  return (data ?? []).flatMap((o) => (o.id && o.name ? [{ id: o.id, nome: o.name }] : []));
}

export async function carregarCanalPro(): Promise<SituacaoDoCanalPro> {
  const { data, error } = await createClient().rpc('canal_pro_situacao');
  if (error) throw new Error(error.message);
  const r = (data ?? {}) as {
    ok?: boolean;
    chave?: string | null;
    nome?: string | null;
    email?: string | null;
    telefone?: string | null;
    site?: string | null;
    ultima_leitura?: { em: string; anuncios: number } | null;
    leituras_7_dias?: number;
    importado_em?: string | null;
    importados?: number | null;
    plano?: {
      anuncios: number | null;
      destaques: number | null;
      anuncios_em_uso: number;
      destaques_em_uso: number;
    };
    sistema_atual?: { tem_endereco: boolean; lido_em: string | null };
  };
  if (!r.ok) throw new Error('sem_permissao');
  return {
    chave: r.chave ?? null,
    nome: r.nome ?? null,
    email: r.email ?? null,
    telefone: r.telefone ?? null,
    site: r.site ?? null,
    ultimaLeitura: r.ultima_leitura ?? null,
    leiturasSeteDias: r.leituras_7_dias ?? 0,
    importadoEm: r.importado_em ?? null,
    importados: r.importados ?? null,
    plano: {
      anuncios: r.plano?.anuncios ?? null,
      destaques: r.plano?.destaques ?? null,
      anunciosEmUso: r.plano?.anuncios_em_uso ?? 0,
      destaquesEmUso: r.plano?.destaques_em_uso ?? 0,
    },
    sistemaAtual: {
      temEndereco: r.sistema_atual?.tem_endereco ?? false,
      lidoEm: r.sistema_atual?.lido_em ?? null,
    },
  };
}

/** Quantos anúncios e destaques o plano do Canal Pro tem; null = o CRM não confere. */
export async function ajustarPlanoDoCanalPro(p: {
  anuncios: number | null;
  destaques: number | null;
}): Promise<Resultado> {
  const { data, error } = await createClient().rpc('canal_pro_ajustar_plano', {
    // O banco aceita null ("não confere"); o gerador de tipos não sabe disso.
    p_anuncios: p.anuncios as number,
    p_destaques: p.destaques as number,
  });
  return resultado(data, error);
}

export async function ajustarCanalPro(c: {
  nome: string;
  email: string;
  telefone: string;
  site: string;
}): Promise<Resultado> {
  const { data, error } = await createClient().rpc('canal_pro_ajustar', {
    p_nome: c.nome,
    p_email: c.email,
    p_telefone: c.telefone,
    p_site: c.site,
  });
  return resultado(data, error);
}

export async function trocarChaveDoCanalPro(): Promise<Resultado<{ chave: string }>> {
  const { data, error } = await createClient().rpc('canal_pro_trocar_chave');
  return resultado(data, error);
}

// ---------------------------------------------------------------------------
// O caminho até o primeiro lead (11/11/2026)
// ---------------------------------------------------------------------------

export const CHAVE_DO_CAMINHO = ['anuncios', 'caminho-do-lead'] as const;

type Cru = Record<string, unknown>;
const lista = <T>(v: unknown, f: (x: Cru) => T): T[] =>
  Array.isArray(v) ? v.map((x) => f(x as Cru)) : [];
const texto = (v: unknown): string => (typeof v === 'string' ? v : '');
const textoOuNulo = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const numero = (v: unknown): number => (typeof v === 'number' ? v : 0);

/**
 * O estado do caminho numa chamada (`public.anuncios_caminho_do_lead`, migração
 * 20261111203000). Só admin e gestor: para os outros o banco devolve
 * `sem_permissao`, e aqui vira erro.
 */
export async function carregarCaminhoDoLead(): Promise<EstadoDoCaminho> {
  const { data, error } = await createClient().rpc('anuncios_caminho_do_lead');
  if (error) throw new Error(error.message);
  const r = (data ?? {}) as Cru;
  if (r.ok !== true) throw new Error(texto(r.motivo) || 'sem_permissao');
  const arquivo = (r.arquivo ?? {}) as Cru;
  const plano = (r.plano ?? {}) as Cru;
  const anuncios = (r.anuncios ?? {}) as Cru;
  const relatorio = (r.relatorio ?? {}) as Cru;
  const leads = (r.leads ?? {}) as Cru;
  const robo = arquivo.leitura_do_robo as Cru | null;
  const outra = arquivo.outra_leitura as Cru | null;
  const ultimo = leads.ultimo as Cru | null;
  const doCaminho = (x: Cru) => ({
    id: texto(x.id),
    codigo: texto(x.codigo),
    titulo: texto(x.titulo),
  });
  const comPendencia = (x: Cru) => ({
    ...doCaminho(x),
    pendencias: lista(x.pendencias, (p) => String(p)),
  });
  return {
    arquivo: {
      leituraDoRobo: robo ? { em: texto(robo.em), anuncios: numero(robo.anuncios) } : null,
      leiturasDoRobo7Dias: numero(arquivo.leituras_do_robo_7_dias),
      outraLeitura: outra ? { em: texto(outra.em), quem: texto(outra.quem) } : null,
    },
    plano: {
      anuncios: typeof plano.anuncios === 'number' ? plano.anuncios : null,
      destaques: typeof plano.destaques === 'number' ? plano.destaques : null,
      anunciosEmUso: numero(plano.anuncios_em_uso),
      destaquesEmUso: numero(plano.destaques_em_uso),
    },
    anuncios: {
      noAr: numero(anuncios.no_ar),
      noArquivo: numero(anuncios.no_arquivo),
      foraDoArquivo: lista(anuncios.fora_do_arquivo, comPendencia),
      prontos: lista(anuncios.prontos, (x) => ({
        ...doCaminho(x),
        ocupaVaga: x.ocupa_vaga === true,
      })),
      comPendencia: lista(anuncios.com_pendencia, comPendencia),
    },
    relatorio: {
      importadoEm: textoOuNulo(relatorio.importado_em),
      repetidosAtivos: lista(relatorio.repetidos_ativos, (x) => ({
        id: texto(x.id),
        codigo: texto(x.codigo),
        titulo: textoOuNulo(x.titulo),
        situacao: textoOuNulo(x.situacao),
        copiaDe: texto(x.copia_de),
        marcadoExcluidoEm: textoOuNulo(x.marcado_excluido_em),
      })),
      repetidosInativos: numero(relatorio.repetidos_inativos),
    },
    leads: {
      ultimo: ultimo
        ? {
            id: texto(ultimo.id),
            em: texto(ultimo.em),
            tipos: lista(ultimo.tipos, (t) => String(t)),
            anuncio: textoOuNulo(ultimo.anuncio),
          }
        : null,
      total: numero(leads.total),
    },
  };
}

/** A URL que se cola no Canal Pro. */
export function urlDoArquivo(chave: string): string {
  return `${supabaseUrl()}/functions/v1/canal-pro-feed?chave=${chave}`;
}

// ---------------------------------------------------------------------------
// Os anúncios cadastrados à mão no Canal Pro
// ---------------------------------------------------------------------------

export const CHAVE_DOS_MANUAIS = ['anuncios', 'no-canal-pro'] as const;

/** Os que estavam no último relatório importado e ninguém marcou como excluídos. */
export async function carregarManuais(): Promise<AnuncioNoCanalPro[]> {
  const { data, error } = await createClient()
    .from('anuncios_no_canal_pro')
    .select(
      'id, codigo, titulo, tipo, tipo_crm, negocio, preco_venda, preco_aluguel, bairro, cidade, area, quartos, destaque, situacao, link, anuncio_id, visto_em, marcado_excluido_em, parece_com:canal_pro_parece_com',
    )
    .eq('no_relatorio', true)
    .is('excluido_em', null)
    .order('codigo');
  if (error) throw new Error(error.message);
  return (data ?? []) as AnuncioNoCanalPro[];
}

export async function importarRelatorio(
  anuncios: AnuncioDoRelatorio[],
): Promise<Resultado<{ anuncios: number; novos: number; sairam: number; trazidos: number }>> {
  const { data, error } = await createClient().rpc('canal_pro_importar', { p_anuncios: anuncios });
  return resultado(data, error);
}

export async function marcarExcluidoNoCanalPro(id: string, excluido: boolean): Promise<Resultado> {
  const { data, error } = await createClient().rpc('canal_pro_marcar_excluido', {
    p_id: id,
    p_excluido: excluido,
  });
  return resultado(data, error);
}

export async function trazerParaOCrm(
  id: string,
): Promise<Resultado<{ anuncio_id: string; codigo: string; ja_existia: boolean }>> {
  const { data, error } = await createClient().rpc('canal_pro_trazer', { p_id: id });
  return resultado(data, error);
}

// ---------------------------------------------------------------------------
// Fotos
// ---------------------------------------------------------------------------

/** O maior lado da foto no portal. Acima disso o arquivo só pesa mais. */
const LADO_MAXIMO = 2560;
/** O limite do VRSync é 7 MB por imagem; o balde recusa acima disso. */
const TETO_DA_FOTO = 7 * 1024 * 1024;

export class ErroDaFoto extends Error {
  constructor(readonly motivo: string) {
    super(motivo);
    this.name = 'ErroDaFoto';
  }
}

function paraJpeg(canvas: HTMLCanvasElement, qualidade: number): Promise<Blob | null> {
  return new Promise((resolva) => canvas.toBlob(resolva, 'image/jpeg', qualidade));
}

/**
 * Toda foto vira JPEG (o portal só importa JPG), com o maior lado em até 2.560
 * px e sem os metadados da câmera — inclusive a localização de onde foi tirada.
 */
export async function prepararFotoDoAnuncio(arquivo: File): Promise<Blob> {
  let imagem: ImageBitmap;
  try {
    // `from-image` desvira a foto que a câmera gravou deitada (EXIF).
    imagem = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
  } catch {
    throw new ErroDaFoto('foto_ilegivel');
  }
  try {
    const escala = Math.min(1, LADO_MAXIMO / Math.max(imagem.width, imagem.height));
    const largura = Math.round(imagem.width * escala);
    const altura = Math.round(imagem.height * escala);
    const canvas = document.createElement('canvas');
    canvas.width = largura;
    canvas.height = altura;
    const pincel = canvas.getContext('2d');
    if (!pincel) throw new ErroDaFoto('foto_ilegivel');
    pincel.fillStyle = '#ffffff';
    pincel.fillRect(0, 0, largura, altura);
    pincel.drawImage(imagem, 0, 0, largura, altura);
    for (const qualidade of [0.86, 0.75, 0.6]) {
      const jpeg = await paraJpeg(canvas, qualidade);
      if (jpeg && jpeg.size <= TETO_DA_FOTO) return jpeg;
    }
    throw new ErroDaFoto('foto_grande_demais');
  } finally {
    imagem.close();
  }
}

async function chamarRota<T>(url: string, init: RequestInit): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(url, init);
  } catch {
    throw new ErroDaFoto('rede');
  }
  const dados = (await resposta.json().catch(() => ({}))) as { ok?: boolean; motivo?: string };
  if (!resposta.ok || !dados.ok) throw new ErroDaFoto(dados.motivo ?? 'falhou');
  return dados as T;
}

/** Uma foto, do arquivo escolhido ao anúncio: prepara, pede a autorização, sobe e registra. */
export async function subirFoto(anuncioId: string, arquivo: File): Promise<void> {
  const jpeg = await prepararFotoDoAnuncio(arquivo);
  const autorizacao = await chamarRota<{ caminho: string; token: string }>('/api/anuncios/fotos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ anuncio_id: anuncioId, tamanho: jpeg.size }),
  });
  const supabase = createClient();
  const { error } = await supabase.storage
    .from('anuncios')
    .uploadToSignedUrl(autorizacao.caminho, autorizacao.token, jpeg, { contentType: 'image/jpeg' });
  if (error) throw new ErroDaFoto('arquivo_nao_chegou');
  const registro = resultado(
    ...(await supabase
      .rpc('anuncio_foto_adicionar', { p_anuncio: anuncioId, p_caminho: autorizacao.caminho })
      .then((r) => [r.data, r.error] as const)),
  );
  if (!registro.ok) throw new ErroDaFoto(registro.motivo);
}

/** Tira a foto do anúncio; o servidor apaga o arquivo do balde. */
export async function removerFoto(fotoId: string): Promise<void> {
  await chamarRota<{ ok: true }>(`/api/anuncios/fotos?foto=${encodeURIComponent(fotoId)}`, {
    method: 'DELETE',
  });
}
