/**
 * A ferramenta `buscar_perto_do_imovel` da IA que atende da Imova (`atendente-imova@v11`,
 * 27/11/2026).
 *
 * Pedido do dono: "A questão da escola e de outras referências a IA deve verificar via
 * maps." A IA pede { imovelCodigo, oQue }; este arquivo:
 *   1. acha o lugar do imóvel: o pino do anúncio, ou o aproximado pelo endereço (o mesmo
 *      de `buscar_no_mapa`, `imoveisComPino`);
 *   2. procura no OpenStreetMap, numa caixa em volta dele, o termo do que foi pedido
 *      ("escola", "supermercado"...), com o cache do mapa;
 *   3. fica só com o que é daquele tipo no mapa (amenity:school, shop:supermarket...), mede
 *      a distância em linha reta no CÓDIGO (haversine) e devolve os três mais perto, em
 *      faixas: "a menos de 500 metros", "a menos de 1 km", "a menos de 2 km", "a menos de 3
 *      km" (praia, até 5 km).
 * Pino aproximado (pelo bairro): sem distância, só "na região do imóvel". Sem lugar do
 * imóvel, mapa fora ou nada achado: a ferramenta diz isso numa frase e a IA segue (a
 * regra dela é dizer que vai verificar). Nunca lança.
 *
 * O texto que volta não tem coordenada nem número de casa: a auditoria da conversa o leria
 * como dado pessoal. Segurança e "região calma" não estão aqui: o mapa não diz isso.
 */
import { type OQueProcurarPerto, O_QUE_PROCURAR_PERTO, verificarSemPiiNaConversa } from '@komune/prompts';

import type { ClienteDoBanco } from '../fila/esteira';
import type { Logger } from '../lib/log';
import { distanciaKm, imoveisComPino } from './busca-no-mapa';
import type { FerramentaDoLaco } from './execucao';
import type { BuscaNoMapa, ImovelNoMapa, LugarNoMapa } from './mapa';

interface ComoProcurar {
  /** A palavra que vai ao mapa (o Nominatim entende o termo em português como tipo). */
  readonly termo: string;
  /** Como o tipo é dito ao modelo. */
  readonly nome: string;
  /** "categoria:tipo" que contam; o resto que vier com o termo no nome fica de fora. */
  readonly categorias: readonly string[];
  /** Até onde procurar, em km. */
  readonly raioKm: number;
}

export const COMO_PROCURAR: Readonly<Record<OQueProcurarPerto, ComoProcurar>> = {
  escola: {
    termo: 'escola',
    nome: 'escola',
    categorias: ['amenity:school', 'amenity:kindergarten'],
    raioKm: 3,
  },
  creche: { termo: 'creche', nome: 'creche', categorias: ['amenity:kindergarten', 'amenity:childcare'], raioKm: 3 },
  faculdade: {
    termo: 'faculdade',
    nome: 'faculdade',
    categorias: ['amenity:university', 'amenity:college'],
    raioKm: 3,
  },
  hospital: { termo: 'hospital', nome: 'hospital', categorias: ['amenity:hospital', 'amenity:clinic'], raioKm: 3 },
  posto_de_saude: {
    termo: 'posto de saúde',
    nome: 'posto de saúde',
    categorias: ['amenity:clinic', 'amenity:doctors', 'healthcare:centre'],
    raioKm: 3,
  },
  farmacia: { termo: 'farmácia', nome: 'farmácia', categorias: ['amenity:pharmacy', 'shop:chemist'], raioKm: 3 },
  supermercado: {
    termo: 'supermercado',
    nome: 'supermercado',
    categorias: ['shop:supermarket', 'shop:convenience', 'shop:wholesale'],
    raioKm: 3,
  },
  padaria: { termo: 'padaria', nome: 'padaria', categorias: ['shop:bakery'], raioKm: 3 },
  shopping: { termo: 'shopping', nome: 'shopping', categorias: ['shop:mall', 'shop:department_store'], raioKm: 3 },
  praia: { termo: 'praia', nome: 'praia', categorias: ['natural:beach'], raioKm: 5 },
  parque: {
    termo: 'parque',
    nome: 'parque ou praça',
    categorias: ['leisure:park', 'place:square', 'leisure:playground', 'leisure:nature_reserve'],
    raioKm: 3,
  },
  academia: { termo: 'academia', nome: 'academia', categorias: ['leisure:fitness_centre', 'leisure:sports_centre'], raioKm: 3 },
  restaurante: { termo: 'restaurante', nome: 'restaurante', categorias: ['amenity:restaurant'], raioKm: 3 },
  posto_de_combustivel: { termo: 'posto de combustível', nome: 'posto de combustível', categorias: ['amenity:fuel'], raioKm: 3 },
  igreja: { termo: 'igreja', nome: 'igreja', categorias: ['amenity:place_of_worship'], raioKm: 3 },
  ponto_de_onibus: {
    termo: 'ponto de ônibus',
    nome: 'ponto de ônibus',
    categorias: ['highway:bus_stop', 'amenity:bus_station', 'public_transport:platform'],
    raioKm: 3,
  },
};

/** A caixa "oeste,norte,leste,sul" com `raioKm` em volta do ponto. */
export function caixaEmVolta(p: { lat: number; lng: number }, raioKm: number): string {
  const dLat = raioKm / 111.32;
  const dLng = raioKm / (111.32 * Math.cos((p.lat * Math.PI) / 180));
  const f = (n: number) => n.toFixed(4);
  return `${f(p.lng - dLng)},${f(p.lat + dLat)},${f(p.lng + dLng)},${f(p.lat - dLat)}`;
}

/** "a menos de 500 metros", "a menos de 1 km"... (faixas: número pequeno, sem conta). */
export function faixaDaDistancia(km: number): string {
  if (km < 0.5) return 'a menos de 500 metros';
  if (km < 1) return 'a menos de 1 km';
  if (km < 2) return 'a menos de 2 km';
  if (km < 3) return 'a menos de 3 km';
  return 'a menos de 5 km';
}

export interface PertoAchado {
  readonly nome: string;
  readonly km: number;
}

/** Os lugares do tipo pedido, do mais perto ao mais longe, até `raioKm`, sem repetir nome. */
export function osMaisPerto(
  lugares: readonly LugarNoMapa[],
  centro: { lat: number; lng: number },
  como: ComoProcurar,
  quantos = 3,
): PertoAchado[] {
  const vistos = new Set<string>();
  return lugares
    .filter((l) => l.categoria === undefined || como.categorias.includes(l.categoria))
    .filter((l) => l.nome.trim() !== '' && !/^\d/.test(l.nome.trim()))
    .map((l) => ({ nome: l.nome.trim(), km: distanciaKm(centro, l) }))
    .filter((l) => l.km <= como.raioKm)
    .sort((a, b) => a.km - b.km)
    .filter((l) => {
      const k = l.nome.toLowerCase();
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    })
    .slice(0, quantos);
}

/** O texto que volta ao modelo. */
export function textoDoPerto(
  imovel: ImovelNoMapa,
  como: ComoProcurar,
  achados: readonly PertoAchado[],
): string {
  const aproximado = imovel.pino?.aproximado === true;
  if (achados.length === 0) {
    return (
      `Nenhum(a) ${como.nome} achado(a) no mapa perto de ${imovel.codigo}. O mapa pode não ter ` +
      'tudo: não diga que não existe; diga que vai verificar.'
    );
  }
  if (aproximado) {
    return (
      `Perto de ${imovel.codigo} (o imóvel não tem o lugar exato no mapa: a conta foi pelo bairro; ` +
      `diga só que fica na região, sem distância), ${como.nome}: ${achados.map((a) => a.nome).join('; ')}.`
    );
  }
  return (
    `Perto de ${imovel.codigo}, pelo mapa, em linha reta a partir do lugar do imóvel, ${como.nome}: ` +
    `${achados.map((a) => `${a.nome}, ${faixaDaDistancia(a.km)}`).join('; ')}.`
  );
}

export interface UsoDoPerto {
  buscas: number;
  readonly pedidos: string[];
}

/** A `buscar_perto_do_imovel` de UMA resposta (o teto vale por resposta). */
export function ferramentaBuscarPertoDoImovel(argumentos: {
  cliente: ClienteDoBanco;
  busca: BuscaNoMapa;
  logger: Logger;
  maxBuscas: number;
  uso?: UsoDoPerto;
  /** Só para os testes: os imóveis com pino, sem ir ao banco. */
  imoveis?: () => Promise<readonly ImovelNoMapa[]>;
}): FerramentaDoLaco {
  const { cliente, busca, logger, maxBuscas } = argumentos;
  const uso = argumentos.uso ?? { buscas: 0, pedidos: [] };
  const feitas = new Map<string, string>();
  const indisponivel = { texto: 'Busca indisponível agora: diga que vai verificar.', erro: true } as const;
  const lerImoveis = argumentos.imoveis ?? (() => imoveisComPino(cliente, busca, logger));

  return async (entrada) => {
    const pedido = (entrada ?? {}) as { imovelCodigo?: unknown; oQue?: unknown };
    const codigo = typeof pedido.imovelCodigo === 'string' ? pedido.imovelCodigo.trim() : '';
    const oQue = typeof pedido.oQue === 'string' ? pedido.oQue.trim() : '';
    if (codigo === '' || !(O_QUE_PROCURAR_PERTO as readonly string[]).includes(oQue)) {
      return {
        texto: `Pedido recusado: diga o código do imóvel como está na lista e o que procurar (${O_QUE_PROCURAR_PERTO.join(', ')}).`,
        erro: true,
      };
    }
    const como = COMO_PROCURAR[oQue as OQueProcurarPerto];
    const chave = `${codigo.toLowerCase()}|${oQue}`;
    const repetida = feitas.get(chave);
    if (repetida !== undefined) return { texto: repetida };
    if (uso.buscas >= maxBuscas) {
      return { texto: 'Acabaram as buscas perto do imóvel desta resposta: responda com o que já tem.', erro: true };
    }
    if (typeof busca.buscarNaCaixa !== 'function') return indisponivel;
    uso.buscas += 1;
    uso.pedidos.push(`${codigo} ${oQue}`);
    try {
      const imoveis = await lerImoveis();
      const imovel = imoveis.find((i) => i.codigo.toLowerCase() === codigo.toLowerCase());
      if (imovel === undefined) {
        return { texto: `Imóvel ${codigo} não está na lista: use o código como está em IMÓVEIS.`, erro: true };
      }
      if (imovel.pino === null) {
        const texto = `O imóvel ${imovel.codigo} não tem lugar no mapa: não dá para medir o que fica perto; diga que vai verificar.`;
        feitas.set(chave, texto);
        return { texto };
      }
      const raio = imovel.pino.aproximado ? Math.max(como.raioKm, 3) : como.raioKm;
      const { lugares } = await busca.buscarNaCaixa(como.termo, caixaEmVolta(imovel.pino, raio));
      const texto = textoDoPerto(imovel, { ...como, raioKm: raio }, osMaisPerto(lugares, imovel.pino, { ...como, raioKm: raio }));
      if (verificarSemPiiNaConversa(texto).length > 0) {
        logger.warn('o resultado da busca perto do imóvel parecia dado pessoal; não foi à IA', { codigo, oQue });
        return indisponivel;
      }
      feitas.set(chave, texto);
      return { texto };
    } catch (erro) {
      logger.warn('a busca perto do imóvel falhou; a IA segue sem ela', {
        codigo,
        oQue,
        erro: erro instanceof Error ? erro.message.slice(0, 200) : String(erro),
      });
      return indisponivel;
    }
  };
}
