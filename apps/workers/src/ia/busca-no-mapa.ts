/**
 * A ferramenta `buscar_no_mapa` da IA que atende da Imova (`atendente-imova@v7`,
 * 23/11/2026).
 *
 * Pedido do usuário, depois da Alinne: "devemos passar a instrução para IA sempre buscar
 * no mapa de acordo com a referência que o cliente passou para que possamos ver se as
 * informações batem." Só OpenStreetMap.
 *
 * A IA pede { referencia, cidade? }; este arquivo:
 *   1. limpa a consulta (sem marcador de pseudônimo, sem número de casa) e a passa na
 *      verificação de PII: telefone, e-mail ou @ não vão ao mapa;
 *   2. procura no OpenStreetMap, com cache (`mapa.ts`);
 *   3. mede, no CÓDIGO (haversine), a distância do lugar achado até cada imóvel com pino
 *      (o do anúncio, ou um aproximado pelo endereço) e devolve faixas: "bem perto" (até
 *      1,5 km), "na mesma região" (até 5 km) ou nenhum perto. Lugar de nível cidade (ou
 *      CEP da cidade inteira): os imóveis nossos nessa cidade.
 *
 * As palavras do resultado são as da nota "14. BUSCA NO MAPA" do caderno (aprovada pelo
 * usuário em 23/11): "bem perto", "na mesma região", "nenhum imóvel nosso perto" e "não
 * achado". O texto que volta não tem coordenada, distância em número, CEP nem número de
 * casa: a auditoria da conversa o confundiria com telefone. Falha do mapa, teto de buscas ou
 * consulta recusada: a ferramenta diz isso em uma frase e a IA segue. Nunca lança.
 *
 * ## Os consertos de 24/11/2026 (item 3 da entrevista, aprovados pelo usuário)
 *
 * A bateria da v8 mostrou duas falhas do mapa: a IA pôs "Natal" na Rotatória do
 * Golfinho (que fica em Nísia Floresta), não achou, cortou o nome para "Golfinho" e caiu
 * num estabelecimento de Pipa; e "Rua Professor Etelvino Cunha" não existe no mapa, que
 * a tem como Avenida. Agora, numa busca só (sem gastar as três da resposta):
 *   1. **Repetir sem a cidade:** a consulta com a cidade não achou nada, o sistema repete
 *      sem ela antes de a IA tentar algo mais geral.
 *   2. **Trocar Rua e Avenida:** "Rua X" não achada vira "Avenida X" e só "X" (e o
 *      contrário; "R." e "Av." também). "Só X" exige duas palavras e a cidade: "Golfinho"
 *      sozinho acha outro lugar.
 *   3. **Nunca outra cidade:** se o cliente escreveu a cidade ou o bairro (o do pedido, ou
 *      uma cidade ou bairro dos nossos imóveis, nas falas recentes dele), o lugar achado
 *      tem de estar nessa cidade ou a até 5 km desse bairro; senão a ferramenta diz "não
 *      use" e manda perguntar o bairro, a rua e o CEP. A cidade que a IA deduziu sozinha
 *      não conta: foi o palpite "Natal" que derrubou a Rotatória do Golfinho.
 * As variações vão ao OpenStreetMap no máximo `MAX_IDAS_AO_MAPA_POR_BUSCA` vezes por busca
 * (o cache não conta); a região do cliente, uma vez por resposta.
 */
import { verificarSemPii, verificarSemPiiNaConversa } from '@komune/prompts';

import type { FerramentaDoLaco } from './execucao';
import { type BuscaNoMapa, type ImovelNoMapa, type LugarNoMapa, completarPinos, imoveisDoBanco } from './mapa';

import type { ClienteDoBanco } from '../fila/esteira';
import type { Logger } from '../lib/log';

// ---------------------------------------------------------------- a distância

const RAIO_DA_TERRA_KM = 6371;

/** Distância em km entre dois pontos (haversine). */
export function distanciaKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RAIO_DA_TERRA_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const FAIXA_BEM_PERTO_KM = 1.5;
export const FAIXA_MESMA_REGIAO_KM = 5;
export type Faixa = 'bem perto' | 'na mesma região' | 'longe';

export function faixaDaDistancia(km: number): Faixa {
  if (km <= FAIXA_BEM_PERTO_KM) return 'bem perto';
  if (km <= FAIXA_MESMA_REGIAO_KM) return 'na mesma região';
  return 'longe';
}

// ---------------------------------------------------------------- os textos

const TIPOS_DE_RUA = new Set([
  'road',
  'street',
  'highway',
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'service',
  'living_street',
  'pedestrian',
  'track',
]);
const TIPOS_DE_BAIRRO = new Set([
  'suburb',
  'neighbourhood',
  'quarter',
  'village',
  'hamlet',
  'city_district',
  'borough',
  'locality',
  'isolated_dwelling',
]);

/** Para a IA saber de que tamanho é o lugar achado. */
export function escalaDoLugar(l: LugarNoMapa): 'rua' | 'bairro' | 'cidade' | 'lugar' {
  if (l.nivel === 'cidade') return 'cidade';
  if (TIPOS_DE_RUA.has(l.tipo)) return 'rua';
  if (TIPOS_DE_BAIRRO.has(l.tipo)) return 'bairro';
  return 'lugar';
}

/** Sem marcador de pseudônimo, sem CEP e sem número comprido: o eco não leva algarismo. */
export function semNumeros(texto: string): string {
  return texto
    .replace(/\[\[[A-Z_]+_\d+\]\]/g, '')
    .replace(/\b\d{5}-?\d{3}\b/g, 'CEP')
    .replace(/\d{3,}/g, '')
    .replace(/\s+([,.;])/g, '$1')
    .replace(/[,\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A consulta que vai ao mapa: a referência (e a cidade, se veio e não está nela), sem
 * marcador, sem número de casa, com "RN" no fim. Null quando não sobra lugar ou quando
 * há telefone, e-mail ou @ (nada disso sai para o OpenStreetMap).
 */
function limpar(v: unknown): string {
  return typeof v === 'string'
    ? v
        .replace(/\[\[[A-Z_]+_\d+\]\]/g, ' ')
        .replace(/[<>{}[\]"]/g, ' ')
        .replace(/[,\s]+(n[º°o.]?\s*)?\d{1,6}[a-z]?\s*$/iu, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120)
    : '';
}

export function consultaDoMapa(referencia: unknown, cidade: unknown): string | null {
  // "X, RN" com a cidade à parte virava "X, RN, Natal, RN" (24/11/2026).
  const ref = limpar(referencia).replace(/[,\s]+(rn|rio grande do norte)\s*$/i, '');
  const cid = limpar(cidade);
  if (ref.length < 2) return null;
  const semAcento = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const partes = [ref];
  if (cid.length >= 2 && !semAcento(ref).includes(semAcento(cid))) partes.push(cid);
  const consulta = partes.join(', ');
  const final = /\b(rn|rio grande do norte)\s*$/i.test(consulta) ? consulta : `${consulta}, RN`;
  return verificarSemPii(final).length === 0 ? final : null;
}

// ---------------------------------------------------------------- as variações (24/11/2026)

/**
 * Cada busca vai ao OpenStreetMap no máximo isto com as variações (o cache não conta): as
 * cinco cabem. A conferência da região fica fora da conta, para nunca ser pulada.
 */
export const MAX_IDAS_AO_MAPA_POR_BUSCA = 5;

/** Até onde o lugar achado pode ficar do bairro que o cliente disse (a faixa "na mesma região"). */
export const RAIO_DA_REGIAO_KM = FAIXA_MESMA_REGIAO_KM;

/** Sem cidade no lugar achado, até onde ele pode ficar do centro da cidade que o cliente disse. */
export const RAIO_DA_CIDADE_KM = 15;

/** Como o lugar foi achado: a consulta da IA ou uma variação do sistema. */
export type ComoAchou = 'pedida' | 'outro tipo' | 'sem o tipo' | 'sem a cidade' | 'sem a cidade, outro tipo';

export interface VariacaoDaBusca {
  readonly consulta: string;
  readonly como: ComoAchou;
}

const TIPO_DE_RUA = /^(rua|r\.|avenida|av\.?)\s+(.+)$/iu;

/** "Rua X" → "Avenida X", "Av. X" → "Rua X". Null quando não começa por Rua ou Avenida. */
export function lugarComOTipoTrocado(lugar: string): string | null {
  const m = TIPO_DE_RUA.exec(lugar.trim());
  if (m === null) return null;
  const tipo = (m[1] ?? '').toLowerCase();
  return `${tipo.startsWith('r') ? 'Avenida' : 'Rua'} ${m[2]}`;
}

/**
 * "Rua Professor Etelvino Cunha" → "Professor Etelvino Cunha". Null quando não começa por
 * Rua ou Avenida, ou quando sobra uma palavra só ("Rua do Golfinho" → nada): um nome de
 * uma palavra acha qualquer coisa ("golfinho" é um estabelecimento de Pipa).
 */
export function lugarSemTipo(lugar: string): string | null {
  const m = TIPO_DE_RUA.exec(lugar.trim());
  if (m === null) return null;
  const nome = (m[2] ?? '').replace(/^(da|de|do|das|dos)\s+/iu, '').trim();
  return nome.split(/\s+/).length >= 2 ? nome : null;
}

const SO_O_ESTADO = /^(rn|rio grande do norte|brasil)$/;

/**
 * As consultas de uma busca, na ordem: a da IA; com Rua e Avenida trocadas; sem o tipo
 * (com a cidade); sem a cidade; sem a cidade e com o tipo trocado. E as regiões que vieram
 * no pedido (a `cidade` e o que vem depois da primeira vírgula da referência), para a
 * conferência de "nunca outra cidade".
 */
export function variacoesDaBusca(
  referencia: unknown,
  cidade: unknown,
): { variacoes: VariacaoDaBusca[]; regioes: string[] } {
  const pedida = consultaDoMapa(referencia, cidade);
  if (pedida === null) return { variacoes: [], regioes: [] };
  const partes = limpar(referencia)
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length >= 2 && !SO_O_ESTADO.test(semAcento(p)));
  const lugar = partes[0] ?? '';
  const resto = partes.slice(1);
  const regioes: string[] = [];
  for (const r of [...resto, limpar(cidade)]) {
    if (r.length < 2 || semAcento(lugar).includes(semAcento(r))) continue;
    if (!regioes.some((x) => semAcento(x) === semAcento(r))) regioes.push(r);
  }

  const trocado = lugarComOTipoTrocado(lugar);
  const semTipo = lugarSemTipo(lugar);
  const comRegiao = regioes.length > 0;
  const candidatas: [ComoAchou, string | null][] = [
    ['pedida', pedida],
    ['outro tipo', trocado === null ? null : consultaDoMapa([trocado, ...resto].join(', '), cidade)],
    ['sem o tipo', semTipo === null || !comRegiao ? null : consultaDoMapa([semTipo, ...resto].join(', '), cidade)],
    ['sem a cidade', comRegiao ? consultaDoMapa(lugar, null) : null],
    ['sem a cidade, outro tipo', comRegiao && trocado !== null ? consultaDoMapa(trocado, null) : null],
  ];
  const variacoes: VariacaoDaBusca[] = [];
  for (const [como, consulta] of candidatas) {
    if (consulta === null || variacoes.some((v) => semAcento(v.consulta) === semAcento(consulta))) continue;
    variacoes.push({ consulta, como });
  }
  return { variacoes, regioes };
}

/**
 * As regiões do pedido que o CLIENTE escreveu (palavra inteira, sem acento). A cidade
 * que a IA deduziu sozinha não entra: foi o palpite "Natal" que derrubou a Rotatória do
 * Golfinho (bateria da v8, 24/11/2026).
 */
export function regioesDoCliente(regioes: readonly string[], falasDoCliente: readonly string[]): string[] {
  // "Feliz Natal" não é a cidade.
  const falas = falasDoCliente.map((f) =>
    semAcento(f).replace(/\b(feliz|bom|boas festas( de)?|otimo|excelente)\s+natal\b/g, ' '),
  );
  return regioes.filter((r) => {
    const alvo = semAcento(r).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const palavra = new RegExp(`(^|[^a-z0-9])${alvo}($|[^a-z0-9])`);
    return falas.some((f) => palavra.test(f));
  });
}

/** As falas do cliente que contam: as mais recentes (conversa antiga pode falar de outro imóvel). */
export const MAX_FALAS_DO_CLIENTE = 6;

/** Bairro que é palavra comum ("no centro da cidade") não conta como região dita. */
const REGIOES_QUE_NAO_CONTAM = new Set(['centro']);

/**
 * As cidades e os bairros dos nossos imóveis: se o cliente escreveu um deles, é região dele,
 * mesmo que a IA não o ponha na busca (bateria de 24/11/2026: o cliente disse "em Ponta
 * Negra" e a IA buscou a rotatória só com "Natal").
 */
export function regioesConhecidas(imoveis: readonly ImovelNoMapa[]): string[] {
  const vistas = new Map<string, string>();
  for (const i of imoveis) {
    for (const r of [i.cidade, i.bairro]) {
      if (r === null || r.trim().length < 3) continue;
      const k = semAcento(r);
      if (!REGIOES_QUE_NAO_CONTAM.has(k) && !vistas.has(k)) vistas.set(k, r.trim());
    }
  }
  return [...vistas.values()];
}

const TIPOS_DE_CIDADE_NA_REGIAO = new Set(['city', 'town', 'municipality']);

function mesmoNome(a: string | null, b: string): boolean {
  if (a === null) return false;
  const x = semAcento(a);
  const y = semAcento(b);
  return x === y || (y.length >= 4 && x.includes(y)) || (x.length >= 4 && y.includes(x));
}

/** A cidade, o bairro ou o nome do lugar achado já dizem a região (sem ir ao mapa). */
export function dentroPeloNome(lugar: LugarNoMapa, regiao: string): boolean {
  return [lugar.cidade, lugar.bairro, lugar.nome].some((t) => mesmoNome(t, regiao));
}

/**
 * O lugar achado está na região que o cliente disse? Pelo nome (cidade, bairro ou nome do
 * lugar); senão pelo mapa: região-cidade exige a mesma cidade, região-bairro exige até
 * `RAIO_DA_REGIAO_KM`. Região que o mapa não acha: não dá para julgar, e o lugar fica.
 */
export function dentroDaRegiao(lugar: LugarNoMapa, regiao: string, ondeFica: LugarNoMapa | null): boolean {
  if (dentroPeloNome(lugar, regiao)) return true;
  if (ondeFica === null) return true;
  const regiaoEhCidade = ondeFica.nivel === 'cidade' || TIPOS_DE_CIDADE_NA_REGIAO.has(ondeFica.tipo);
  if (regiaoEhCidade || lugar.nivel === 'cidade') {
    const cidadeDaRegiao = ondeFica.cidade ?? ondeFica.nome;
    if (lugar.cidade !== null || lugar.nivel === 'cidade') return mesmoNome(lugar.cidade ?? lugar.nome, cidadeDaRegiao);
    return distanciaKm(lugar, ondeFica) <= RAIO_DA_CIDADE_KM;
  }
  return distanciaKm(lugar, ondeFica) <= RAIO_DA_REGIAO_KM;
}

function imovelPorExtenso(i: ImovelNoMapa): string {
  const partes = [i.tipo, i.bairro].filter(Boolean).join(', ');
  const aproximado = i.pino?.aproximado === true ? ', pino aproximado' : '';
  return partes === '' && aproximado === '' ? i.codigo : `${i.codigo} (${partes}${aproximado})`;
}

function semAcento(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** O que o sistema tentou e como achou (os consertos de 24/11/2026). */
export interface ComoFoiABusca {
  readonly como: ComoAchou;
  /** As regiões do pedido (para dizer "não achado em Natal"). */
  readonly regioes: readonly string[];
  /** As variações que foram tentadas, achando ou não. */
  readonly tentadas?: readonly ComoAchou[];
}

function juntar(itens: readonly string[]): string {
  return itens.length <= 1 ? (itens[0] ?? '') : `${itens.slice(0, -1).join(', ')} e ${itens.at(-1)}`;
}

function oQueOSistemaTentou(tentadas: readonly ComoAchou[]): string {
  const feitas = [
    tentadas.some((t) => t === 'outro tipo' || t === 'sem a cidade, outro tipo') ? 'trocando Rua e Avenida' : null,
    tentadas.includes('sem o tipo') ? 'só com o nome' : null,
    tentadas.some((t) => t.startsWith('sem a cidade')) ? 'sem a cidade' : null,
  ].filter((t): t is string => t !== null);
  return feitas.length === 0 ? '' : ` (o sistema já tentou ${juntar(feitas)})`;
}

const eco = (consulta: string) => `"${semNumeros(consulta.replace(/,\s*RN$/i, ''))}"`;

/**
 * O lugar só foi achado longe do que o cliente disse (conserto 3, "nunca outra cidade"):
 * a IA não usa, e pergunta o bairro, a rua e o CEP. Não diz que lugar foi, nem onde.
 */
export function textoDeLonge(consulta: string, regioes: readonly string[]): string {
  const onde = juntar(regioes.map(semNumeros));
  return `${eco(consulta)}: o mapa só achou esse lugar longe de ${onde}, que o cliente disse: não use. Pergunte o bairro, a rua e o CEP (nota 7 a).`;
}

/** O resultado de uma busca, como a IA lê. */
export function textoDoResultado(
  consulta: string,
  lugares: readonly LugarNoMapa[],
  imoveis: readonly ImovelNoMapa[],
  busca?: ComoFoiABusca,
): string {
  const lugar = lugares[0];
  if (lugar === undefined) {
    return `${eco(consulta)}: não achado no mapa${oQueOSistemaTentou(busca?.tentadas ?? [])}. Tente a referência mais geral que o cliente deu (avenida, praia, bairro ou cidade), nunca um pedaço do nome que ele não disse sozinho.`;
  }
  const como = busca?.como ?? 'pedida';
  const cabeca =
    como === 'pedida'
      ? `${eco(consulta)}: achado no mapa`
      : como === 'outro tipo' || como === 'sem o tipo'
        ? `${eco(consulta)}: achado no mapa com outro nome`
        : `${eco(consulta)}: não achado em ${juntar((busca?.regioes ?? []).map(semNumeros))}; sem a cidade, achado no mapa`;
  const onde = [lugar.bairro, lugar.cidade].filter(Boolean).map((t) => semNumeros(t as string)).join(', ');
  const nome = lugar.tipo === 'postcode' ? 'a área do CEP' : semNumeros(lugar.nome) || lugar.tipo;
  const escala = escalaDoLugar(lugar);

  if (escala === 'cidade') {
    const cidade = lugar.cidade ?? lugar.nome;
    const daCidade = imoveis.filter((i) => i.cidade !== null && semAcento(i.cidade) === semAcento(cidade));
    return `${cabeca} como cidade inteira (${semNumeros(cidade)}), sem distância. ${
      daCidade.length === 0
        ? 'Resultado: nenhum imóvel nosso perto (nenhum nesta cidade).'
        : `Imóveis nossos nesta cidade: ${daCidade.map(imovelPorExtenso).join('; ')}.`
    }`;
  }

  const medidos = imoveis
    .filter((i) => i.pino !== null)
    .map((i) => ({ imovel: i, faixa: faixaDaDistancia(distanciaKm(lugar, i.pino!)), km: distanciaKm(lugar, i.pino!) }))
    .sort((a, b) => a.km - b.km);
  const bemPerto = medidos.filter((m) => m.faixa === 'bem perto').map((m) => imovelPorExtenso(m.imovel));
  const mesmaRegiao = medidos.filter((m) => m.faixa === 'na mesma região').map((m) => imovelPorExtenso(m.imovel));
  const partes = [
    `${cabeca}: ${nome} (${escala})${onde === '' ? '' : `, em ${onde}`}.`,
    bemPerto.length > 0 ? `Imóveis nossos bem perto: ${bemPerto.join('; ')}.` : null,
    mesmaRegiao.length > 0 ? `Imóveis nossos na mesma região: ${mesmaRegiao.join('; ')}.` : null,
    bemPerto.length === 0 && mesmaRegiao.length === 0 ? 'Resultado: nenhum imóvel nosso perto.' : null,
  ];
  const semPino = imoveis.filter((i) => i.pino === null).map((i) => i.codigo);
  if (semPino.length > 0) partes.push(`Sem lugar no mapa, fora da conta: ${semPino.join(', ')}.`);
  return partes.filter((p): p is string => p !== null).join(' ');
}

// ---------------------------------------------------------------- a ferramenta

/** Os imóveis com pino, guardados por alguns minutos (o pino aproximado custa busca). */
let memoria: { quando: number; imoveis: readonly ImovelNoMapa[] } | null = null;
const MEMORIA_MS = 10 * 60 * 1000;

/** Só os testes: esquece os imóveis guardados. */
export function esquecerImoveisDoMapa(): void {
  memoria = null;
}

async function imoveisComPino(cliente: ClienteDoBanco, busca: BuscaNoMapa, logger: Logger): Promise<readonly ImovelNoMapa[]> {
  if (memoria !== null && Date.now() - memoria.quando < MEMORIA_MS) return memoria.imoveis;
  const imoveis = await completarPinos(await imoveisDoBanco(cliente), busca, logger);
  memoria = { quando: Date.now(), imoveis };
  return imoveis;
}

export interface UsoDaBusca {
  buscas: number;
  readonly consultas: string[];
}

/**
 * A `buscar_no_mapa` de UMA resposta: o teto de buscas vale por resposta, e busca
 * repetida devolve o mesmo texto sem contar.
 *
 * Desde 24/11/2026, uma busca tenta as variações (`variacoesDaBusca`) até achar um lugar
 * que sirva, e confere a região que o cliente escreveu (`falasDoCliente`). As variações
 * não gastam as buscas da resposta; o OpenStreetMap é chamado no máximo
 * `MAX_IDAS_AO_MAPA_POR_BUSCA` vezes por busca.
 */
export function ferramentaBuscarNoMapa(argumentos: {
  cliente: ClienteDoBanco;
  busca: BuscaNoMapa;
  logger: Logger;
  maxBuscas: number;
  uso?: UsoDaBusca;
  /**
   * O que o cliente escreveu na conversa (fica no worker, não vai a lugar nenhum): diz
   * quais regiões do pedido são dele. Sem isto, nenhuma região é conferida.
   */
  falasDoCliente?: readonly string[];
}): FerramentaDoLaco {
  const { cliente, busca, logger, maxBuscas } = argumentos;
  const uso = argumentos.uso ?? { buscas: 0, consultas: [] };
  const feitas = new Map<string, string>();
  /** Onde fica cada região que o cliente disse (uma ida ao mapa por região, por resposta). */
  const regioesNoMapa = new Map<string, LugarNoMapa | null>();
  const indisponivel = { texto: 'Busca indisponível agora: responda com o que já tem.', erro: true } as const;

  return async (entrada) => {
    const pedido = (entrada ?? {}) as { referencia?: unknown; cidade?: unknown };
    const { variacoes, regioes } = variacoesDaBusca(pedido.referencia, pedido.cidade);
    const primeira = variacoes[0];
    if (primeira === undefined) {
      return { texto: 'Consulta recusada: escreva só o lugar (rua, bairro, praia, condomínio ou ponto) e a cidade.', erro: true };
    }
    const consulta = primeira.consulta;
    const chave = semAcento(consulta);
    const repetida = feitas.get(chave);
    if (repetida !== undefined) return { texto: repetida };
    if (uso.buscas >= maxBuscas) {
      return { texto: 'Acabaram as buscas desta resposta: responda com o que já tem.', erro: true };
    }
    uso.buscas += 1;
    uso.consultas.push(consulta);

    let idas = 0;
    const procurar = async (q: string): Promise<readonly LugarNoMapa[]> => {
      const r = await busca.buscar(q);
      if (!r.doCache) idas += 1;
      return r.lugares;
    };
    const falhou = (o_que: string, q: string, erro: unknown) =>
      logger.warn(`${o_que} no mapa falhou; a busca segue com o que tem`, {
        consulta: q,
        erro: erro instanceof Error ? erro.message.slice(0, 200) : String(erro),
      });

    const falas = (argumentos.falasDoCliente ?? []).slice(-MAX_FALAS_DO_CLIENTE);
    let doCliente: string[] = [];
    const ondeFica = async (regiao: string): Promise<LugarNoMapa | null> => {
      const k = semAcento(regiao);
      if (regioesNoMapa.has(k)) return regioesNoMapa.get(k) ?? null;
      const q = consultaDoMapa(regiao, null);
      if (q === null) return null;
      try {
        // Fora do teto das variações: a conferência nunca é pulada.
        const achado = (await busca.buscar(q)).lugares[0] ?? null;
        regioesNoMapa.set(k, achado);
        return achado;
      } catch (erro) {
        falhou('a região', q, erro);
        return null;
      }
    };
    const serve = async (lugar: LugarNoMapa): Promise<boolean> => {
      if (doCliente.length === 0) return true;
      for (const regiao of doCliente) {
        if (dentroPeloNome(lugar, regiao)) return true;
        if (dentroDaRegiao(lugar, regiao, await ondeFica(regiao))) return true;
      }
      return false;
    };

    try {
      const imoveis = await imoveisComPino(cliente, busca, logger);
      const candidatas = [...regioes];
      for (const r of regioesConhecidas(imoveis)) {
        if (!candidatas.some((c) => semAcento(c) === semAcento(r))) candidatas.push(r);
      }
      doCliente = regioesDoCliente(candidatas, falas);
      let lugares = await procurar(consulta);
      const tentadas: ComoAchou[] = [];
      let achado: { lugar: LugarNoMapa; como: ComoAchou } | null = null;
      let longe = false;
      for (const [indice, variacao] of variacoes.entries()) {
        if (indice > 0) {
          if (idas >= MAX_IDAS_AO_MAPA_POR_BUSCA) break;
          try {
            lugares = await procurar(variacao.consulta);
          } catch (erro) {
            falhou('a variação', variacao.consulta, erro);
            break;
          }
        }
        tentadas.push(variacao.como);
        for (const lugar of lugares) {
          if (await serve(lugar)) {
            achado = { lugar, como: variacao.como };
            break;
          }
          longe = true;
        }
        if (achado !== null) break;
      }
      if (achado !== null && achado.como !== 'pedida') {
        logger.info('o mapa achou o lugar por uma variação', { consulta, como: achado.como });
      }

      const texto =
        achado !== null
          ? textoDoResultado(consulta, [achado.lugar], imoveis, { como: achado.como, regioes, tentadas })
          : longe
            ? textoDeLonge(consulta, doCliente)
            : textoDoResultado(consulta, [], imoveis, { como: 'pedida', regioes, tentadas });
      // O texto volta ao modelo: nada que a auditoria da conversa barre.
      if (verificarSemPiiNaConversa(texto).length > 0) {
        logger.warn('o resultado do mapa trazia algo que parece dado pessoal; não foi à IA', { consulta });
        return indisponivel;
      }
      feitas.set(chave, texto);
      return { texto };
    } catch (erro) {
      logger.warn('a busca no mapa falhou; a IA segue sem ela', {
        consulta,
        erro: erro instanceof Error ? erro.message.slice(0, 200) : String(erro),
      });
      return indisponivel;
    }
  };
}
