/**
 * O que a folha "Trazer os anúncios do sistema atual" pede ao banco e ao
 * servidor (05/11/2026), só na Imova.
 *
 * Ler o arquivo: pelo endereço, o servidor busca (`/api/anuncios/importar`);
 * pelo arquivo escolhido no computador, o navegador lê com o mesmo
 * `lerArquivoVrsync`. Trazer: uma chamada a `public.anuncio_importar` por
 * anúncio (cria o rascunho com o MESMO código, ou atualiza o que já tem o
 * código) e, depois, as fotos pela rota `/api/anuncios/importar/fotos`.
 */
import { createClient } from '@/lib/supabase/client';

import {
  lerArquivoVrsync,
  textoDoArquivo,
  type ArquivoLido,
  type DadosParaImportar,
} from './arquivo-vrsync';

export type Leitura =
  | (Extract<ArquivoLido, { ok: true }> & { guardado?: boolean })
  | { ok: false; motivo: string; linha?: number };

async function pedirLeitura(corpo: Record<string, unknown>): Promise<Leitura> {
  let resposta: Response;
  try {
    resposta = await fetch('/api/anuncios/importar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
  } catch {
    return { ok: false, motivo: 'rede' };
  }
  const dados = (await resposta.json().catch(() => null)) as Leitura | null;
  return dados ?? { ok: false, motivo: resposta.ok ? 'falhou' : `status_${resposta.status}` };
}

/** O arquivo do endereço, lido pelo servidor. Com `guardar`, o endereço fica no CRM. */
export function lerPeloEndereco(url: string, guardar = false): Promise<Leitura> {
  return pedirLeitura({ url, guardar });
}

/** O arquivo do endereço guardado no CRM; o navegador não vê o endereço (06/11/2026). */
export function lerDoEnderecoGuardado(): Promise<Leitura> {
  return pedirLeitura({ guardado: true });
}

/**
 * Depois de ler o arquivo inteiro: os códigos que estão nele e, de volta,
 * quantos estavam e saíram (`public.sistema_atual_leitura_registrar`).
 */
export async function registrarLeitura(
  codigos: string[],
): Promise<{ ok: true; sairam: number } | { ok: false; motivo: string }> {
  const { data, error } = await createClient().rpc('sistema_atual_leitura_registrar', {
    p_codigos: codigos,
  });
  if (error) return { ok: false, motivo: 'falhou' };
  const r = (data ?? {}) as { ok?: boolean; motivo?: string; sairam?: number };
  return r.ok ? { ok: true, sairam: r.sairam ?? 0 } : { ok: false, motivo: r.motivo ?? 'falhou' };
}

/** O arquivo escolhido no computador, lido aqui mesmo. */
export async function lerDoComputador(arquivo: File): Promise<Leitura> {
  if (arquivo.size > 30 * 1024 * 1024) return { ok: false, motivo: 'grande_demais' };
  return lerArquivoVrsync(textoDoArquivo(new Uint8Array(await arquivo.arrayBuffer())));
}

export type NoCrm = Map<
  string,
  { id: string; excluido: boolean; fotos: number; pendencias: string[] | null }
>;

/**
 * Os códigos do arquivo que já existem no CRM (inclusive os excluídos), com as
 * fotos e o que falta para ir ao ar.
 */
export async function codigosNoCrm(codigos: string[]): Promise<NoCrm> {
  const mapa: NoCrm = new Map();
  const supabase = createClient();
  // Em lotes: o filtro `in` vai na URL.
  for (let i = 0; i < codigos.length; i += 100) {
    const { data, error } = await supabase
      .from('anuncios_na_lista')
      .select('id, codigo, excluido_em, fotos, pendencias')
      .in('codigo', codigos.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const a of data ?? []) {
      if (!a.id || !a.codigo) continue;
      mapa.set(a.codigo, {
        id: a.id,
        excluido: a.excluido_em !== null,
        fotos: a.fotos ?? 0,
        pendencias: (a.pendencias as string[] | null) ?? null,
      });
    }
  }
  return mapa;
}

export type AnuncioImportado =
  | { ok: true; id: string; codigo: string; novo: boolean; fotos: number; pendencias: string[] }
  | { ok: false; motivo: string; pendencias?: string[] };

export async function importarAnuncio(dados: DadosParaImportar): Promise<AnuncioImportado> {
  const { data, error } = await createClient().rpc('anuncio_importar', { p_dados: dados });
  if (error) return { ok: false, motivo: error.message };
  const r = (data ?? {}) as {
    ok?: boolean;
    motivo?: string;
    id?: string;
    codigo?: string;
    novo?: boolean;
    fotos?: number;
    pendencias?: string[] | null;
  };
  if (!r.ok || !r.id) {
    return { ok: false, motivo: r.motivo ?? 'falhou', pendencias: r.pendencias ?? undefined };
  }
  return {
    ok: true,
    id: r.id,
    codigo: r.codigo ?? dados.codigo,
    novo: r.novo ?? false,
    fotos: r.fotos ?? 0,
    pendencias: r.pendencias ?? [],
  };
}

export type FotoTrazida = { url: string; ok: boolean; motivo: string | null };

export type FotosTrazidas =
  | { ok: true; fotos: FotoTrazida[] }
  | { ok: true; pulado: 'ja_tem_fotos'; fotos: number }
  | { ok: false; motivo: string };

export async function trazerFotos(anuncioId: string, urls: string[]): Promise<FotosTrazidas> {
  let resposta: Response;
  try {
    resposta = await fetch('/api/anuncios/importar/fotos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anuncio_id: anuncioId, urls }),
    });
  } catch {
    return { ok: false, motivo: 'rede' };
  }
  const dados = (await resposta.json().catch(() => null)) as FotosTrazidas | null;
  return dados ?? { ok: false, motivo: resposta.ok ? 'falhou' : `status_${resposta.status}` };
}

/** O que cada recusa da leitura, da importação e das fotos quer dizer para quem clicou. */
const FRASES: Record<string, string> = {
  // Ler o arquivo
  sem_endereco: 'O CRM ainda não tem o endereço do arquivo. Cole o endereço abaixo.',
  arquivo_vazio: 'O arquivo veio sem anúncios: nada mudou no CRM.',
  url_invalida: 'Esse endereço não parece um link. Copie o endereço inteiro, com https://.',
  url_bloqueada:
    'O CRM não busca esse endereço (rede interna, porta fora do padrão ou usuário e senha no link). Baixe o arquivo e escolha-o no computador.',
  nao_respondeu:
    'O endereço não respondeu a tempo. Confira o link, ou baixe o arquivo e escolha-o no computador.',
  status_401:
    'O endereço pediu senha. Baixe o arquivo pelo sistema atual e escolha-o no computador.',
  status_403:
    'O endereço só abre para o robô do Grupo OLX. Peça o arquivo ao sistema atual (ou baixe pelo navegador) e escolha-o no computador.',
  status_404: 'Esse endereço não existe mais. Confira o link no Canal Pro.',
  grande_demais: 'O arquivo passa de 30 MB. Peça ao sistema atual um arquivo só com os ativos.',
  redirecionamentos_demais:
    'O endereço manda para outro, e para outro... O CRM desistiu. Baixe o arquivo e escolha-o no computador.',
  nao_e_vrsync:
    'Isso não é um arquivo de anúncios do Grupo OLX (VRSync). Confira se é o endereço que está no Canal Pro, em Integração de anúncios.',
  xml_invalido:
    'O arquivo está quebrado (o XML não fecha). Baixe de novo; se continuar, fale com o sistema atual.',
  vazio: 'O arquivo não tem nenhum anúncio.',
  sem_modulo: 'Anúncios não estão ligados nesta empresa.',
  sem_sessao: 'Sua sessão acabou. Entre de novo e repita.',
  rede: 'Sem conexão com o servidor. Confira a internet e tente de novo.',
  // Trazer o anúncio
  sem_permissao: 'Só admin e gestor trazem anúncios do sistema atual.',
  codigo_invalido: 'O código tem caracteres que o portal não aceita.',
  codigo_em_uso: 'Outra importação criou este código agora mesmo. Leia o arquivo de novo.',
  tipo_invalido: 'O tipo do imóvel não existe no CRM.',
  excluido:
    'No CRM, o anúncio com este código foi excluído. Restaure-o em Anúncios > Excluídos e traga de novo.',
  no_ar_com_pendencias:
    'No CRM, o anúncio com este código está no ar e ficaria incompleto. Tire-o do ar antes de trazer de novo.',
  proprietario_invalido: 'O proprietário ligado ao anúncio não está mais na base.',
  dados_invalidos:
    'Algum valor do arquivo não cabe no anúncio. Confira o anúncio no sistema atual.',
  nao_configurado: 'O servidor não está configurado para guardar fotos. Avise quem cuida do CRM.',
};

/** Por que uma foto não veio, em poucas palavras (a tela junta as iguais e conta). */
const FRASES_DA_FOTO: Record<string, string> = {
  formato_nao_aceito: 'não é JPG, PNG nem WebP',
  foto_quebrada: 'o arquivo da foto não abre',
  grande_demais: 'grande demais (mais de 7 MB ou resolução alta demais)',
  nao_respondeu: 'o sistema atual não respondeu',
  url_invalida: 'endereço quebrado',
  url_bloqueada: 'endereço que o CRM não busca',
  redirecionamentos_demais: 'o endereço manda para outro sem parar',
  status_403: 'o sistema atual não deixou baixar',
  status_404: 'não existe mais no sistema atual',
  sem_tempo: 'o tempo acabou antes',
  balde_recusou: 'o armazenamento recusou',
  arquivo_nao_chegou: 'não chegou ao armazenamento',
  fotos_demais: 'passou de 40 fotos',
  so_gestao_mexe_no_ar: 'o anúncio está no ar',
};

export function fraseDaFoto(motivo: string | null | undefined): string {
  if (!motivo) return 'não veio';
  if (FRASES_DA_FOTO[motivo]) return FRASES_DA_FOTO[motivo];
  if (/^status_\d+$/.test(motivo)) return `o sistema atual recusou, erro ${motivo.slice(7)}`;
  return 'não veio';
}

export function fraseDaImportacao(motivo: string | null | undefined): string {
  if (!motivo) return 'Não deu certo. Tente de novo.';
  if (FRASES[motivo]) return FRASES[motivo];
  if (/^status_5\d\d$/.test(motivo))
    return 'O servidor do sistema atual deu erro. Tente de novo daqui a pouco.';
  if (/^status_\d+$/.test(motivo))
    return `O endereço recusou (erro ${motivo.slice(7)}). Baixe o arquivo e escolha-o no computador.`;
  return 'Não deu certo. Tente de novo.';
}
