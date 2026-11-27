/**
 * O mapa da IA que atende da Imova (busca no mapa, v7, 23/11/2026): o OpenStreetMap com cache no banco, e
 * onde ficam os imóveis que a IA conhece.
 *
 * Só OpenStreetMap (decisão do usuário, 23/11): o Nominatim público, com a política de
 * uso respeitada pelo cliente de `rotas/nominatim.ts` (1 req/s, User-Agent com contato,
 * cache). O cache é `public.ia_lugares_no_mapa` (migração 20261123150000): a mesma
 * pergunta não volta ao serviço enquanto a linha vale (180 dias; "não achado", 30).
 *
 * Os imóveis: o pino do anúncio quando há (`public.ia_imoveis_no_mapa`). Sem pino, o
 * worker procura "rua, bairro, cidade, RN" (sem número) e, não achando, "bairro,
 * cidade, RN", e marca o pino como APROXIMADO. Nada disso é gravado no anúncio.
 */
import { CAIXA_DO_RN, type ClienteDoNominatim, criarClienteDoNominatim } from '../rotas/nominatim';

import type { ClienteDoBanco } from '../fila/esteira';
import type { Logger } from '../lib/log';

export interface LugarNoMapa {
  readonly nome: string;
  /** `addresstype` do OpenStreetMap. */
  readonly tipo: string;
  /** "categoria:tipo" do OpenStreetMap (amenity:school...), quando veio (27/11/2026). */
  readonly categoria?: string;
  /** 'ponto' dá distância; 'cidade' (cidade inteira, CEP da cidade) só diz a cidade. */
  readonly nivel: 'ponto' | 'cidade';
  readonly bairro: string | null;
  readonly cidade: string | null;
  readonly lat: number;
  readonly lng: number;
}

export interface BuscaNoMapa {
  buscar(consulta: string): Promise<{ readonly lugares: readonly LugarNoMapa[]; readonly doCache: boolean }>;
  /**
   * O que fica numa caixa ("oeste,norte,leste,sul"), pelo termo do mapa ("escola"), com o
   * mesmo cache (chave `perto <termo> <caixa>`). Devolve até 10; quem chama escolhe os mais
   * perto. A busca perto do imóvel (27/11/2026).
   */
  buscarNaCaixa?(
    termo: string,
    caixa: string,
  ): Promise<{ readonly lugares: readonly LugarNoMapa[]; readonly doCache: boolean }>;
}

export interface ImovelNoMapa {
  readonly codigo: string;
  readonly tipo: string | null;
  readonly bairro: string | null;
  readonly cidade: string | null;
  /** A rua SEM número (é a que vai ao modelo). */
  readonly rua: string | null;
  readonly cep: string | null;
  readonly pino: { readonly lat: number; readonly lng: number; readonly aproximado: boolean } | null;
}

const TIPOS_DE_CIDADE = new Set([
  'city',
  'town',
  'municipality',
  'county',
  'state',
  'state_district',
  'region',
  'country',
]);

/** CEP terminado em 000 é o da cidade inteira (59164-000 = Nísia Floresta). */
export const CEP_DA_CIDADE = /\b\d{5}-?000\b/;

/** O nível de um lugar do mapa. Postcode só é ponto quando o CEP não é o da cidade. */
export function nivelDoLugar(tipo: string, nome: string): LugarNoMapa['nivel'] {
  if (TIPOS_DE_CIDADE.has(tipo)) return 'cidade';
  if (tipo === 'postcode') return CEP_DA_CIDADE.test(nome) ? 'cidade' : 'ponto';
  return 'ponto';
}

/** "Av Barra de Tabatinga, 2004 2004" → "Av Barra de Tabatinga". Número de casa não vai. */
export function ruaSemNumero(rua: string | null | undefined): string | null {
  if (rua === null || rua === undefined) return null;
  const limpa = rua
    .replace(/[,\s]+(n[º°o.]?\s*)?(\d{1,6}[a-z]?|s\/?n)(\s+\d{1,6})?\s*$/iu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return limpa === '' ? null : limpa;
}

function lugarDoCache(valor: unknown): LugarNoMapa | null {
  if (valor === null || typeof valor !== 'object') return null;
  const v = valor as Record<string, unknown>;
  if (typeof v.lat !== 'number' || typeof v.lng !== 'number' || typeof v.nome !== 'string') return null;
  const tipo = typeof v.tipo === 'string' ? v.tipo : 'lugar';
  return {
    nome: v.nome,
    tipo,
    ...(typeof v.categoria === 'string' ? { categoria: v.categoria } : {}),
    nivel: v.nivel === 'cidade' || v.nivel === 'ponto' ? v.nivel : nivelDoLugar(tipo, v.nome),
    bairro: typeof v.bairro === 'string' ? v.bairro : null,
    cidade: typeof v.cidade === 'string' ? v.cidade : null,
    lat: v.lat,
    lng: v.lng,
  };
}

/**
 * O mapa com cache. Erro do serviço sobe (quem chama decide o que dizer ao modelo); erro
 * do cache não derruba a busca, só deixa de economizar.
 */
export function criarBuscaNoMapa(argumentos: {
  cliente: ClienteDoBanco;
  nominatim: ClienteDoNominatim;
  logger: Logger;
}): BuscaNoMapa {
  const { cliente, nominatim, logger } = argumentos;
  return {
    async buscar(consulta) {
      const { data: guardado, error: erroDeLeitura } = await cliente.rpc('ia_lugar_no_mapa_ler', {
        p_consulta: consulta,
      });
      if (erroDeLeitura) logger.warn('o cache do mapa não respondeu', { erro: erroDeLeitura.message });
      if (Array.isArray(guardado)) {
        return {
          lugares: guardado.map(lugarDoCache).filter((l): l is LugarNoMapa => l !== null),
          doCache: true,
        };
      }
      const resposta = await nominatim.buscarVarios(consulta);
      const lugares = resposta.lugares.map(
        (l): LugarNoMapa => ({ ...l, nivel: nivelDoLugar(l.tipo, l.nome) }),
      );
      const { error: erroDeGravacao } = await cliente.rpc('ia_lugar_no_mapa_gravar', {
        p_consulta: consulta,
        p_resultados: lugares,
        p_licenca: resposta.licenca ?? 'Data © OpenStreetMap contributors, ODbL 1.0',
      });
      if (erroDeGravacao) logger.warn('o cache do mapa não gravou', { erro: erroDeGravacao.message });
      return { lugares, doCache: false };
    },
    async buscarNaCaixa(termo, caixa) {
      // O cache guarda até 3 lugares por chave; aqui vão os 10 da caixa em 4 chaves de 3,
      // para não ir ao mapa de novo (a ordem é a do OpenStreetMap; quem chama ordena).
      const chave = (i: number) => `perto ${termo} ${caixa} ${i}`;
      const guardados: LugarNoMapa[] = [];
      let completo = true;
      for (let i = 0; i < 4; i++) {
        const { data, error } = await cliente.rpc('ia_lugar_no_mapa_ler', { p_consulta: chave(i) });
        if (error || !Array.isArray(data)) {
          completo = false;
          break;
        }
        guardados.push(...data.map(lugarDoCache).filter((l): l is LugarNoMapa => l !== null));
        if (data.length < 3) break;
      }
      if (completo) return { lugares: guardados, doCache: true };
      const resposta = await nominatim.buscarVarios(termo, { viewbox: caixa, limite: 10 });
      const lugares = resposta.lugares.map(
        (l): LugarNoMapa => ({ ...l, nivel: nivelDoLugar(l.tipo, l.nome) }),
      );
      for (let i = 0; i < 4; i++) {
        const parte = lugares.slice(i * 3, i * 3 + 3);
        const { error } = await cliente.rpc('ia_lugar_no_mapa_gravar', {
          p_consulta: chave(i),
          p_resultados: parte,
          p_licenca: resposta.licenca ?? 'Data © OpenStreetMap contributors, ODbL 1.0',
        });
        if (error) {
          logger.warn('o cache do mapa não gravou', { erro: error.message });
          break;
        }
        if (parte.length < 3) break;
      }
      return { lugares, doCache: false };
    },
  };
}

/** O cliente do Nominatim da busca no mapa da IA: até 3 lugares, só no Rio Grande do Norte. */
export function nominatimDaIa(argumentos: {
  userAgent: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  dormir?: (ms: number) => Promise<void>;
  intervaloMs?: number;
}): ClienteDoNominatim {
  return criarClienteDoNominatim({ ...argumentos, limite: 3, viewbox: CAIXA_DO_RN });
}

interface LinhaDoImovel {
  readonly codigo: string;
  readonly tipo: string | null;
  readonly bairro: string | null;
  readonly cidade: string | null;
  readonly endereco: string | null;
  readonly cep: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
}

/** Os imóveis, ainda sem procurar pino: o que vai ao modelo sai daqui. */
export async function imoveisDoBanco(cliente: ClienteDoBanco): Promise<ImovelNoMapa[]> {
  const { data, error } = await cliente.rpc('ia_imoveis_no_mapa', {});
  if (error) throw new Error(`ia_imoveis_no_mapa: ${error.message}`);
  return (Array.isArray(data) ? (data as LinhaDoImovel[]) : []).map((l) => ({
    codigo: l.codigo,
    tipo: l.tipo,
    bairro: l.bairro,
    cidade: l.cidade,
    rua: ruaSemNumero(l.endereco),
    cep: l.cep,
    pino:
      typeof l.latitude === 'number' && typeof l.longitude === 'number'
        ? { lat: l.latitude, lng: l.longitude, aproximado: false }
        : null,
  }));
}

/**
 * O pino de cada imóvel sem pino, pelo mapa (com cache). Um por vez, na fila do
 * Nominatim; o primeiro uso custa ~1 s por imóvel sem pino, os seguintes vêm do cache.
 */
export async function completarPinos(
  imoveis: readonly ImovelNoMapa[],
  busca: BuscaNoMapa,
  logger: Logger,
): Promise<ImovelNoMapa[]> {
  const prontos: ImovelNoMapa[] = [];
  for (const imovel of imoveis) {
    if (imovel.pino !== null || imovel.cidade === null) {
      prontos.push(imovel);
      continue;
    }
    const tentativas = [
      imovel.rua === null ? null : [imovel.rua, imovel.bairro, imovel.cidade, 'RN'].filter(Boolean).join(', '),
      imovel.bairro === null ? null : `${imovel.bairro}, ${imovel.cidade}, RN`,
    ].filter((t): t is string => t !== null);
    let pino: ImovelNoMapa['pino'] = null;
    for (const consulta of tentativas) {
      try {
        const { lugares } = await busca.buscar(consulta);
        const ponto = lugares.find((l) => l.nivel === 'ponto');
        if (ponto !== undefined) {
          pino = { lat: ponto.lat, lng: ponto.lng, aproximado: true };
          break;
        }
      } catch (erro) {
        logger.warn('o pino aproximado do imóvel não saiu', {
          codigo: imovel.codigo,
          erro: erro instanceof Error ? erro.message.slice(0, 200) : String(erro),
        });
        break;
      }
    }
    prontos.push({ ...imovel, pino });
  }
  return prontos;
}
