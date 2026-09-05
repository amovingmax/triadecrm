/**
 * Adaptador do Casamentos.com.br (R03 §2.1) — a espinha dorsal da lista-alvo.
 *
 * A página de listagem categoria × cidade publica um `ItemList` em JSON-LD com
 * exatamente os fatos de negócio que a whitelist permite: nome, endereço, CEP,
 * cidade, faixa de preço, nota e número de avaliações. Ler o JSON-LD em vez de
 * seletores de CSS não é preciosismo: é o dado que o próprio site declara como
 * público e estruturado, e não quebra quando a fonte troca uma classe de layout.
 *
 * O que o JSON-LD também traz e este adaptador NUNCA copia: `image` (foto — direito
 * autoral, R06 SCR-02), `description` e qualquer texto de avaliação. Eles são lidos
 * do HTML porque vêm no mesmo objeto, e descartados no mesmo passo — não existe
 * caminho neste arquivo que os coloque em `bruto`.
 *
 * O perfil de cada fornecedor NÃO é visitado: telefone e site do Casamentos ficam
 * atrás de `emp-ShowTelefonoTrace.php` e `emp-ShowWebsiteTrace.php`, os dois em
 * `Disallow` no robots.txt. O telefone vem de outras fontes (CNPJ, Places) ou do
 * próprio fornecedor, depois da autorização.
 */
import * as cheerio from 'cheerio';

import type { Adaptador, ContextoDaPagina, RegistroExtraido, ResultadoDaPagina } from './adaptador';

/** `https://www.casamentos.com.br/cerimonialista/triunfal-cerimonial--e137503` → `e137503`. */
export function idExternoDaUrl(url: string): string | null {
  const casou = /--(e\d+)(?:[/?#]|$)/.exec(url);
  return casou?.[1] ?? null;
}

/**
 * `"R$4300-R$500000"` → `4300`. A faixa é publicada como "a partir de X até Y";
 * só o piso entra, e é ele que o CRM chama de `preco_a_partir_de`.
 */
export function precoMinimo(faixa: unknown): number | null {
  if (typeof faixa !== 'string') return null;
  const primeiro = faixa.split(/[-–—]/)[0] ?? '';
  const casou = /(\d[\d.,]*)/.exec(primeiro.replace(/\s/g, ''));
  if (!casou?.[1]) return null;

  let numero = casou[1];
  // Ponto como separador de milhar (1.500) vira nada; vírgula decimal vira ponto.
  numero = numero.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
  const valor = Number(numero);
  return Number.isFinite(valor) && valor >= 0 ? valor : null;
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : null;
}

function numero(valor: unknown): number | null {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (typeof valor === 'string') {
    const convertido = Number(valor.replace(',', '.'));
    return Number.isFinite(convertido) ? convertido : null;
  }
  return null;
}

function objeto(valor: unknown): Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};
}

/** Todos os blocos `application/ld+json` da página, já convertidos (bloco quebrado é ignorado). */
export function blocosJsonLd($: cheerio.CheerioAPI): unknown[] {
  const blocos: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, elemento) => {
    const conteudo = $(elemento).text();
    if (!conteudo.trim()) return;
    try {
      blocos.push(JSON.parse(conteudo) as unknown);
    } catch {
      // Bloco malformado não derruba a página: o resto do JSON-LD continua valendo.
    }
  });
  return blocos;
}

export const adaptadorCasamentos: Adaptador = {
  slug: 'casamentos_com_br',

  extrairListagem(html: string, contexto: ContextoDaPagina): ResultadoDaPagina {
    const $ = cheerio.load(html);
    const registros: RegistroExtraido[] = [];
    const vistos = new Set<string>();

    for (const bloco of blocosJsonLd($)) {
      const raiz = objeto(bloco);
      if (raiz['@type'] !== 'ItemList') continue;
      const itens = Array.isArray(raiz.itemListElement) ? raiz.itemListElement : [];

      for (const entrada of itens) {
        const item = objeto(objeto(entrada).item);
        const url = texto(item.url);
        const nome = texto(item.name);
        if (!url || !nome) continue;

        const externalId = idExternoDaUrl(url);
        if (!externalId || vistos.has(externalId)) continue;
        vistos.add(externalId);

        const endereco = objeto(item.address);
        const avaliacao = objeto(item.aggregateRating);

        registros.push({
          externalId,
          sourceUrl: url,
          // Só chaves da whitelist entram aqui. `image`, `description` e as
          // avaliações estão no mesmo objeto e ficam de fora — a nota e a
          // contagem entram porque são sinal numérico de tração (RF-RAD-12).
          bruto: {
            nome_comercial: nome,
            source_url: url,
            categoria_origem: contexto.categoriaOrigem,
            cidade: texto(endereco.addressLocality),
            endereco: texto(endereco.streetAddress),
            cep: texto(endereco.postalCode),
            nota: numero(avaliacao.ratingValue),
            avaliacoes_qtd: numero(avaliacao.reviewCount),
            preco_a_partir_de: precoMinimo(item.priceRange),
          },
        });
      }
    }

    // A paginação é a que a própria página declara. Montar `--2`, `--3` no código
    // produziria requisição para página inexistente — tráfego que a fonte não
    // pediu e que nós não devemos gerar.
    const proxima = $('link[rel="next"]').attr('href');
    return {
      registros,
      proximaUrl: proxima ? new URL(proxima, contexto.url).toString() : null,
    };
  },
};
