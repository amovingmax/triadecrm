/**
 * O relatório de anúncios que o Canal Pro exporta (04/11/2026, à noite).
 *
 * O Grupo OLX não tem API para ler os anúncios do Canal Pro. O que existe é o
 * botão "Exportar relatório" da busca de anúncios do próprio Canal Pro, que manda
 * um link por e-mail (ajuda.zapimoveis.com.br, "Como buscar anúncios no Canal
 * Pro"). A planilha é lida pelo leitor da importação (`importacao/planilha.ts`,
 * CSV e .xlsx) e este módulo reconhece as colunas.
 *
 * NENHUMA FONTE PUBLICADA DIZ QUAIS SÃO AS COLUNAS. O primeiro relatório de
 * verdade (05/11/2026, aba "Anúncios") tem: ID Interno, Código do Imóvel (o
 * ListingID que o sistema publica, ex. SA0012_IMOVA), Tipo do imóvel, Status do
 * anúncio, Motivo da Inativação, Tipo do anúncio (Padrão/Destaque), CEP,
 * Endereço, Bairro, Cidade, Estado, Quartos, Suítes, Banheiros, Vagas, Área útil,
 * Área total, Valor de Venda, Valor do aluguel, Período do aluguel, Condomínio/mês,
 * IPTU/ano, Benefícios do imóvel, Título do imóvel, Descrição, Número de fotos,
 * Total de visualizações, Total de contatos, Criação e Última atualização. Os
 * nomes abaixo cobrem esse arquivo e outros prováveis; o que não vira campo fica
 * na linha, que o banco lê (`canal_pro_trazer`, `anuncios_na_lista`). Só o
 * código é obrigatório: é a chave da importação.
 *
 * Módulo puro, testado em `relatorio-canal-pro.test.ts`.
 */
import { chave } from '@/components/importacao/mapeamento';
import type { PlanilhaLida } from '@/components/importacao/tipos';

import { lerInteiro, lerValor, type Negocio } from './tipos';

export type CampoDoRelatorio =
  | 'codigo'
  | 'titulo'
  | 'tipo'
  | 'negocio'
  | 'preco_venda'
  | 'preco_aluguel'
  | 'preco'
  | 'bairro'
  | 'cidade'
  | 'endereco'
  | 'area'
  | 'quartos'
  | 'destaque'
  | 'situacao'
  | 'link';

/**
 * Os nomes de cada coluna, já na forma de `chave()` (sem acento, minúsculo). A
 * ordem é a de preferência: no código, o do anúncio no Canal Pro vem antes do
 * código que a imobiliária deu ("código do anunciante").
 */
const NOMES: Record<CampoDoRelatorio, readonly string[]> = {
  codigo: [
    'codigo do anuncio',
    'cod do anuncio',
    'id do anuncio',
    'codigo anuncio',
    'id anuncio',
    'codigo',
    'cod',
    'id',
    'codigo do anunciante',
    'codigo do imovel',
    'cod imovel',
    'referencia',
    'ref',
    'listing id',
    'external id',
  ],
  titulo: ['titulo do anuncio', 'titulo do imovel', 'titulo', 'nome do anuncio', 'title'],
  tipo: [
    'tipo do imovel',
    'tipo de imovel',
    'tipo imovel',
    'tipo',
    'subtipo',
    'categoria',
    'property type',
  ],
  negocio: [
    'tipo de negocio',
    'negocio',
    'transacao',
    'tipo de transacao',
    'finalidade',
    'operacao',
    'transaction type',
  ],
  preco_venda: ['preco de venda', 'valor de venda', 'preco venda', 'valor venda', 'sale price'],
  preco_aluguel: [
    'preco de aluguel',
    'valor do aluguel',
    'valor de aluguel',
    'preco aluguel',
    'valor aluguel',
    'aluguel',
    'preco de locacao',
    'valor de locacao',
    'rental price',
  ],
  preco: ['preco', 'valor', 'price'],
  bairro: ['bairro', 'neighborhood'],
  cidade: ['cidade', 'municipio', 'city'],
  endereco: ['endereco', 'logradouro', 'rua', 'address'],
  area: ['area util', 'area', 'area total', 'metragem', 'm2', 'living area'],
  quartos: ['quartos', 'dormitorios', 'dorms', 'bedrooms'],
  destaque: [
    'tipo de destaque',
    // O relatório de verdade (05/11/2026): "Tipo do anúncio" = Padrão, Destaque.
    'tipo do anuncio',
    'destaque',
    'tipo de publicacao',
    'publicacao',
    'publication type',
    'plano',
  ],
  situacao: ['status do anuncio', 'situacao do anuncio', 'status', 'situacao', 'estado do anuncio'],
  link: ['link do anuncio', 'url do anuncio', 'link', 'url'],
};

export const ROTULO_DO_CAMPO: Record<CampoDoRelatorio, string> = {
  codigo: 'Código',
  titulo: 'Título',
  tipo: 'Tipo',
  negocio: 'Negócio',
  preco_venda: 'Preço de venda',
  preco_aluguel: 'Aluguel',
  preco: 'Preço',
  bairro: 'Bairro',
  cidade: 'Cidade',
  endereco: 'Endereço',
  area: 'Área',
  quartos: 'Quartos',
  destaque: 'Destaque',
  situacao: 'Situação',
  link: 'Link',
};

/** Uma linha do relatório, como `public.canal_pro_importar` recebe. */
export type AnuncioDoRelatorio = {
  codigo: string;
  titulo: string | null;
  tipo: string | null;
  tipo_crm: string | null;
  negocio: Negocio | null;
  preco_venda: number | null;
  preco_aluguel: number | null;
  bairro: string | null;
  cidade: string | null;
  endereco: string | null;
  area: number | null;
  quartos: number | null;
  destaque: string | null;
  situacao: string | null;
  link: string | null;
  /** A linha inteira, cabeçalho → valor: nada do relatório se perde. */
  linha: Record<string, string>;
};

export type RelatorioLido =
  | {
      ok: true;
      anuncios: AnuncioDoRelatorio[];
      /** Que coluna do arquivo virou cada campo. */
      colunas: Partial<Record<CampoDoRelatorio, string>>;
      /** Colunas do arquivo que o CRM não usa (ficam guardadas na linha). */
      naoUsadas: string[];
      /** Linhas sem código, que não entram. */
      semCodigo: number;
    }
  | { ok: false; motivo: 'sem_coluna_de_codigo' | 'sem_linhas'; cabecalho: string[] };

/** Para cada campo, a primeira coluna do arquivo que bate com um nome da lista, na ordem da lista. */
export function reconhecerColunas(cabecalho: string[]): Partial<Record<CampoDoRelatorio, number>> {
  const chaves = cabecalho.map(chave);
  const usadas = new Set<number>();
  const achadas: Partial<Record<CampoDoRelatorio, number>> = {};
  for (const campo of Object.keys(NOMES) as CampoDoRelatorio[]) {
    for (const nome of NOMES[campo]) {
      const i = chaves.findIndex((c, j) => c === nome && !usadas.has(j));
      if (i >= 0) {
        achadas[campo] = i;
        usadas.add(i);
        break;
      }
    }
  }
  return achadas;
}

/**
 * O tipo do CRM para o que o relatório escreve ("Apartamento", "Casa de
 * Condomínio", "Lote/Terreno", ou o PropertyType do VRSync). Sem palpite: o que
 * não reconhece fica sem tipo, e o rascunho trazido nasce como apartamento para
 * a pessoa trocar.
 */
export function tipoDoCrm(texto: string | null | undefined): string | null {
  const t = chave(texto ?? '');
  if (t === '') return null;
  const tem = (...palavras: string[]) => palavras.some((p) => new RegExp(`(^| )${p}( |$)`).test(t));
  if (tem('casa') && tem('condominio')) return 'casa_condominio';
  if (tem('casa') && tem('vila')) return 'casa_vila';
  if (tem('cobertura', 'penthouse')) return 'cobertura';
  if (tem('kitnet', 'kitinete', 'kitchenette', 'conjugado')) return 'kitnet';
  if (tem('studio', 'estudio')) return 'studio';
  if (tem('flat')) return 'flat';
  if (tem('loft')) return 'loft';
  if (tem('sobrado')) return 'sobrado';
  if (tem('apartamento', 'apto', 'apartment')) return 'apartamento';
  if (tem('terreno', 'lote', 'land') && tem('comercial', 'commercial')) return 'terreno_comercial';
  if (tem('terreno', 'lote', 'land')) return 'terreno';
  if (tem('chacara', 'ranch')) return 'chacara';
  if (tem('fazenda', 'sitio', 'agricultural')) return 'fazenda_sitio';
  if (tem('galpao', 'deposito', 'armazem', 'industrial')) return 'galpao';
  if (tem('consultorio')) return 'consultorio';
  if (tem('sala', 'conjunto', 'office')) return 'sala_comercial';
  if (tem('loja', 'ponto', 'box', 'business')) return 'loja';
  if (tem('andar', 'laje') && tem('corporativo', 'corporativa', 'corporate'))
    return 'andar_corporativo';
  if (tem('predio', 'edificio') && tem('residencial')) return 'predio_residencial';
  if (tem('predio', 'edificio')) return 'predio_comercial';
  if (tem('garagem', 'garage')) return 'garagem';
  if (tem('hotel', 'pousada')) return 'hotel';
  if (tem('casa', 'home')) return 'casa';
  if (tem('comercial', 'commercial')) return 'imovel_comercial';
  return null;
}

/** "Venda", "Aluguel", "Venda e Aluguel", "For Sale"... → o negócio do CRM. */
export function negocioDoCrm(texto: string | null | undefined): Negocio | null {
  const t = chave(texto ?? '');
  const venda = /(^| )(venda|vender|sale)( |$)/.test(t);
  const aluguel = /(^| )(aluguel|alugar|locacao|rent)( |$)/.test(t);
  if (venda && aluguel) return 'venda_aluguel';
  if (venda) return 'venda';
  if (aluguel) return 'aluguel';
  return null;
}

/**
 * O relatório diz que o anúncio está no ar no Canal Pro? "Ativo" sim (e a linha
 * sem situação, como antes do relatório de verdade); "Inativo", "Bloqueado" e o
 * resto não. A mesma regra de `app.canal_pro_ativo_no_relatorio`.
 */
export function ativoNoCanalPro(situacao: string | null | undefined): boolean {
  const t = chave(situacao ?? '');
  if (t === '') return true;
  return /^(ativo|ativa|publicado|publicada|no ar|em processamento)( |$)/.test(t);
}

/** Sem coluna de negócio: venda se só há preço de venda, aluguel se só há aluguel. */
export function negocioPelosPrecos(venda: number | null, aluguel: number | null): Negocio | null {
  const temVenda = venda !== null && venda > 0;
  const temAluguel = aluguel !== null && aluguel > 0;
  if (temVenda && temAluguel) return 'venda_aluguel';
  if (temVenda) return 'venda';
  if (temAluguel) return 'aluguel';
  return null;
}

const texto = (v: string | undefined) => {
  const limpo = (v ?? '').trim();
  return limpo === '' ? null : limpo;
};

export function lerRelatorioDoCanalPro(planilha: PlanilhaLida): RelatorioLido {
  const { cabecalho, linhas } = planilha;
  const colunas = reconhecerColunas(cabecalho);
  if (colunas.codigo === undefined) return { ok: false, motivo: 'sem_coluna_de_codigo', cabecalho };
  if (linhas.length === 0) return { ok: false, motivo: 'sem_linhas', cabecalho };

  const valor = (linha: string[], campo: CampoDoRelatorio) =>
    colunas[campo] === undefined ? null : texto(linha[colunas[campo]!]);

  const anuncios: AnuncioDoRelatorio[] = [];
  const vistos = new Set<string>();
  let semCodigo = 0;
  for (const linha of linhas) {
    const codigo = valor(linha, 'codigo');
    if (!codigo) {
      semCodigo += 1;
      continue;
    }
    // O mesmo código duas vezes no arquivo: vale a primeira.
    if (vistos.has(codigo)) continue;
    vistos.add(codigo);

    const negocioDaColuna = negocioDoCrm(valor(linha, 'negocio'));
    // Uma coluna só de preço: o negócio diz se é venda ou aluguel.
    const precoUnico = lerValor(valor(linha, 'preco') ?? '');
    const precoVenda =
      lerValor(valor(linha, 'preco_venda') ?? '') ??
      (negocioDaColuna !== 'aluguel' ? precoUnico : null);
    const precoAluguel =
      lerValor(valor(linha, 'preco_aluguel') ?? '') ??
      (negocioDaColuna === 'aluguel' ? precoUnico : null);
    // Sem coluna de negócio (o relatório do Canal Pro não tem): os preços dizem.
    const negocio = negocioDaColuna ?? negocioPelosPrecos(precoVenda, precoAluguel);

    anuncios.push({
      codigo,
      titulo: valor(linha, 'titulo'),
      tipo: valor(linha, 'tipo'),
      tipo_crm: tipoDoCrm(valor(linha, 'tipo')),
      negocio,
      preco_venda: precoVenda,
      preco_aluguel: precoAluguel,
      bairro: valor(linha, 'bairro'),
      cidade: valor(linha, 'cidade'),
      endereco: valor(linha, 'endereco'),
      area: lerValor(valor(linha, 'area') ?? ''),
      quartos: lerInteiro(valor(linha, 'quartos') ?? ''),
      destaque: valor(linha, 'destaque'),
      situacao: valor(linha, 'situacao'),
      link: valor(linha, 'link'),
      linha: Object.fromEntries(cabecalho.map((c, i) => [c, linha[i] ?? ''])),
    });
  }

  const usadas = new Set(Object.values(colunas));
  return {
    ok: true,
    anuncios,
    colunas: Object.fromEntries(
      Object.entries(colunas).map(([campo, i]) => [campo, cabecalho[i!]!]),
    ) as Partial<Record<CampoDoRelatorio, string>>,
    naoUsadas: cabecalho.filter((_, i) => !usadas.has(i)),
    semCodigo,
  };
}
