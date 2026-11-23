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
export function consultaDoMapa(referencia: unknown, cidade: unknown): string | null {
  const limpar = (v: unknown) =>
    typeof v === 'string'
      ? v
          .replace(/\[\[[A-Z_]+_\d+\]\]/g, ' ')
          .replace(/[<>{}[\]"]/g, ' ')
          .replace(/[,\s]+(n[º°o.]?\s*)?\d{1,6}[a-z]?\s*$/iu, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 120)
      : '';
  const ref = limpar(referencia);
  const cid = limpar(cidade);
  if (ref.length < 2) return null;
  const semAcento = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const partes = [ref];
  if (cid.length >= 2 && !semAcento(ref).includes(semAcento(cid))) partes.push(cid);
  const consulta = partes.join(', ');
  const final = /\b(rn|rio grande do norte)\s*$/i.test(consulta) ? consulta : `${consulta}, RN`;
  return verificarSemPii(final).length === 0 ? final : null;
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

/** O resultado de uma busca, como a IA lê. */
export function textoDoResultado(
  consulta: string,
  lugares: readonly LugarNoMapa[],
  imoveis: readonly ImovelNoMapa[],
): string {
  const eco = `"${semNumeros(consulta.replace(/,\s*RN$/i, ''))}"`;
  const lugar = lugares[0];
  if (lugar === undefined) {
    return `${eco}: não achado no mapa. Tente a referência mais geral que o cliente deu (avenida, praia, bairro ou cidade).`;
  }
  const onde = [lugar.bairro, lugar.cidade].filter(Boolean).map((t) => semNumeros(t as string)).join(', ');
  const nome = lugar.tipo === 'postcode' ? 'a área do CEP' : semNumeros(lugar.nome) || lugar.tipo;
  const escala = escalaDoLugar(lugar);

  if (escala === 'cidade') {
    const cidade = lugar.cidade ?? lugar.nome;
    const daCidade = imoveis.filter((i) => i.cidade !== null && semAcento(i.cidade) === semAcento(cidade));
    return `${eco}: achado no mapa como cidade inteira (${semNumeros(cidade)}), sem distância. ${
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
    `${eco}: achado no mapa: ${nome} (${escala})${onde === '' ? '' : `, em ${onde}`}.`,
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
 */
export function ferramentaBuscarNoMapa(argumentos: {
  cliente: ClienteDoBanco;
  busca: BuscaNoMapa;
  logger: Logger;
  maxBuscas: number;
  uso?: UsoDaBusca;
}): FerramentaDoLaco {
  const { cliente, busca, logger, maxBuscas } = argumentos;
  const uso = argumentos.uso ?? { buscas: 0, consultas: [] };
  const feitas = new Map<string, string>();

  return async (entrada) => {
    const pedido = (entrada ?? {}) as { referencia?: unknown; cidade?: unknown };
    const consulta = consultaDoMapa(pedido.referencia, pedido.cidade);
    if (consulta === null) {
      return { texto: 'Consulta recusada: escreva só o lugar (rua, bairro, praia, condomínio ou ponto) e a cidade.', erro: true };
    }
    const chave = semAcento(consulta);
    const repetida = feitas.get(chave);
    if (repetida !== undefined) return { texto: repetida };
    if (uso.buscas >= maxBuscas) {
      return { texto: 'Acabaram as buscas desta resposta: responda com o que já tem.', erro: true };
    }
    uso.buscas += 1;
    uso.consultas.push(consulta);
    try {
      const { lugares } = await busca.buscar(consulta);
      const imoveis = await imoveisComPino(cliente, busca, logger);
      const texto = textoDoResultado(consulta, lugares, imoveis);
      // O texto volta ao modelo: nada que a auditoria da conversa barre.
      if (verificarSemPiiNaConversa(texto).length > 0) {
        logger.warn('o resultado do mapa trazia algo que parece dado pessoal; não foi à IA', { consulta });
        return { texto: 'Busca indisponível agora: responda com o que já tem.', erro: true };
      }
      feitas.set(chave, texto);
      return { texto };
    } catch (erro) {
      logger.warn('a busca no mapa falhou; a IA segue sem ela', {
        consulta,
        erro: erro instanceof Error ? erro.message.slice(0, 200) : String(erro),
      });
      return { texto: 'Busca indisponível agora: responda com o que já tem.', erro: true };
    }
  };
}
