/**
 * Anúncios de imobiliárias que AUTORIZAREM, por escrito, o uso do feed XML
 * delas (formato VRSync, o que elas já geram para os portais). Fonte
 * `feeds-imobiliarias`, PERMITIDA na auditoria de 18/11/2026. Porte de
 * `coletar/anuncios/feeds-imobiliarias.mjs`.
 *
 * Só entra feed da lista abaixo, com a data da autorização. Hoje a lista está
 * vazia: o coletor roda, não pede nada e diz isso. Pôr um feed aqui é mudança
 * de código, revisada: a autorização (e-mail) fica guardada fora do código.
 *
 * O feed traz o contato do corretor (<ContactInfo>): ele é apagado antes de
 * qualquer leitura e nunca é guardado.
 */
import { anuncioDeSite, type Recusa } from '../anuncio';
import { Impressao, LoteDeAnuncios } from '../lote';
import { hostDe } from '../bloqueio';
import { slug } from '../texto';
import type { Coletor, ContextoDoColetor, ItemAnuncio, ResultadoDoColetor } from '../tipos';
import type { Regioes } from '../regioes';

export interface FeedAutorizado {
  /** Nome curto da imobiliária (vira prefixo do id externo). */
  imobiliaria: string;
  url: string;
  /** AAAA-MM-DD da autorização escrita. */
  autorizadoEm: string;
}

/** As imobiliárias que autorizaram. Vazia em 18/11/2026. */
export const FEEDS_AUTORIZADOS: readonly FeedAutorizado[] = [];

const tag = (xml: string, nome: string): string | null => {
  const m = xml.match(new RegExp(`<${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</${nome}>`, 'i'));
  return m?.[1] ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : null;
};
const atributo = (xml: string, nome: string, a: string): string | null =>
  xml.match(new RegExp(`<${nome}\\s[^>]*${a}="([^"]*)"`, 'i'))?.[1] ?? null;
const numero = (v: string | null): number | null => {
  if (v === null || v === '') return null;
  const n = Number(
    String(v)
      .replace(/[^\d.,-]/g, '')
      .replace(/\.(?=\d{3}(\D|$))/g, '')
      .replace(',', '.'),
  );
  return Number.isFinite(n) && n > 0 ? n : null;
};
const coordenada = (v: string | null): number | null => {
  if (v === null || v.trim() === '') return null;
  const n = Number(v.trim().replace(',', '.'));
  return Number.isFinite(n) && n !== 0 ? n : null;
};
const TIPO_VRSYNC: Array<[RegExp, string]> = [
  [/land lot|lote|terreno/i, 'terreno'],
  [/industrial|galp/i, 'galpão'],
  [/office|sala|conjunto/i, 'sala'],
  [/business|loja|store|ponto/i, 'loja'],
  [/building|edif|pr[eé]dio/i, 'prédio'],
  [/condo/i, 'casa em condomínio'],
  [/farm|ranch|ch[aá]cara|s[ií]tio/i, 'chácara'],
  [/home|sobrado|village|house/i, 'casa'],
  [/apartment|penthouse|flat|kitnet|studio|loft/i, 'apartamento'],
];

/** Lê um feed VRSync e devolve os itens das regiões do estudo. */
export function lerVrsync(
  xml: string,
  o: { imobiliaria: string; dia: string; regioes: Regioes; hash: string | null },
): Array<ItemAnuncio | Recusa> {
  const out: Array<ItemAnuncio | Recusa> = [];
  for (const m of String(xml).matchAll(/<Listing>([\s\S]*?)<\/Listing>/gi)) {
    const l = (m[1] ?? '').replace(/<ContactInfo>[\s\S]*?<\/ContactInfo>/gi, '');
    const det = tag(l, 'Details') ?? '';
    const loc = tag(l, 'Location') ?? '';
    const tipoXml = tag(det, 'PropertyType') ?? '';
    const tipoTexto = TIPO_VRSYNC.find(([re]) => re.test(tipoXml))?.[1] ?? tipoXml;
    const idExt = tag(l, 'ListingID');
    if (!idExt) continue;
    const trans = (tag(l, 'TransactionType') ?? '').toLowerCase();
    const venda = numero(tag(det, 'ListPrice'));
    const aluguel = numero(tag(det, 'RentalPrice'));
    const unidade = (atributo(det, 'LivingArea', 'unit') ?? '').toLowerCase();
    const util =
      unidade && unidade !== 'square metres' && unidade !== 'm2'
        ? null
        : numero(tag(det, 'LivingArea'));
    const modos: Array<['venda' | 'aluguel', number]> = [];
    if ((/sale/.test(trans) || !trans) && venda) modos.push(['venda', venda]);
    if (/rent/.test(trans) && aluguel) modos.push(['aluguel', aluguel]);
    for (const [modo, preco] of modos) {
      out.push(
        anuncioDeSite(
          {
            id_externo: `${slug(o.imobiliaria)}:${idExt}${modos.length > 1 ? `-${modo}` : ''}`,
            modo,
            tipoTexto,
            titulo: tag(l, 'Title'),
            preco,
            area_util: util,
            area_total: numero(tag(det, 'LotArea')),
            quartos: numero(tag(det, 'Bedrooms')),
            suites: numero(tag(det, 'Suites')),
            banheiros: numero(tag(det, 'Bathrooms')),
            vagas: numero(tag(det, 'Garage')),
            condominio: numero(tag(det, 'PropertyAdministrationFee')),
            bairro: tag(loc, 'Neighborhood'),
            cidade: tag(loc, 'City'),
            logradouro: tag(loc, 'Address'),
            lat: coordenada(tag(loc, 'Latitude')),
            lng: coordenada(tag(loc, 'Longitude')),
            url: tag(l, 'DetailViewUrl'),
            hash_bruto: o.hash,
            data_dado: o.dia,
            consulta_id: `feed-${slug(o.imobiliaria)}`,
            bruto: {
              id: idExt,
              tipo: tipoXml,
              preco,
              area_util: util,
              cidade: tag(loc, 'City'),
              bairro: tag(loc, 'Neighborhood'),
            },
          },
          o.regioes,
        ),
      );
    }
  }
  return out;
}

export const coletorFeeds: Coletor = {
  chave: 'anuncios/feeds',
  maxPedidosPadrao: 20,
  hostsExtras: FEEDS_AUTORIZADOS.map((f) => hostDe(f.url)).filter(Boolean),
  async coletar(ctx: ContextoDoColetor): Promise<ResultadoDoColetor> {
    const lote = new LoteDeAnuncios(ctx.gravador);
    const impressao = new Impressao();
    const erros: string[] = [];
    const consultasCompletas: string[] = [];
    for (const f of FEEDS_AUTORIZADOS) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.autorizadoEm)) {
        erros.push(`${f.imobiliaria}: sem data de autorização`);
        continue;
      }
      const r = await ctx.navegador.pagina(f.url, {
        aceitar: 'application/xml,text/xml;q=0.9,*/*;q=0.5',
      });
      if (!r?.texto) {
        erros.push(
          `${f.imobiliaria}: ${r ? `HTTP ${r.status}` : (ctx.navegador.parada ?? 'robots fecha')}`,
        );
        continue;
      }
      const semContato = r.texto.replace(/<ContactInfo>[\s\S]*?<\/ContactInfo>/gi, '');
      impressao.somar(semContato);
      const consulta = `feed-${slug(f.imobiliaria)}`;
      // O feed traz a carteira inteira da imobiliária: o que não veio, saiu do ar.
      await lote.consulta(
        lerVrsync(semContato, {
          imobiliaria: f.imobiliaria,
          dia: ctx.dia,
          regioes: ctx.regioes,
          hash: r.sha256,
        }),
        true,
      );
      consultasCompletas.push(consulta);
    }
    await lote.esvaziar();
    return {
      completa: erros.length === 0,
      consultasCompletas,
      hashBruto: impressao.fechar(),
      detalhes: {
        feeds_autorizados: FEEDS_AUTORIZADOS.length,
        aviso:
          FEEDS_AUTORIZADOS.length === 0
            ? 'nenhum feed autorizado por escrito: nada foi pedido'
            : undefined,
        enviados: lote.ids.size,
        banco: lote.resumo,
        recusas: lote.recusas,
      },
      erros,
    };
  },
};
