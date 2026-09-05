import { describe, expect, it } from 'vitest';

import { adaptadorCasamentos, idExternoDaUrl, precoMinimo } from './casamentos';
import { filtrarPelaWhitelist } from './whitelist';

/**
 * Recorte fiel de uma listagem real (cerimonialista × Natal, 05/09/2026): o mesmo
 * `ItemList` em JSON-LD que a página publica, com `image` e `description` no lugar
 * onde eles de fato aparecem — é justamente isso que o adaptador tem de deixar cair.
 */
const HTML = `<!doctype html><html><head>
<link rel="canonical" href="https://www.casamentos.com.br/cerimonialista/rio-grande-do-norte/natal">
<link rel="next" href="https://www.casamentos.com.br/cerimonialista/rio-grande-do-norte/natal--2">
<script type="application/ld+json">{"@context":"http://schema.org","@type":"BreadcrumbList","itemListElement":[]}</script>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"ItemList","itemListElement":[
 {"@type":"ListItem","position":1,"item":{"@type":"ProfessionalService",
   "name":"Triunfal Cerimonial",
   "image":["https://cdn0.casamentos.com.br/vendor/7503/3_2/960/jpg/img-7379.webp"],
   "description":"Descrição longa escrita pelo fornecedor.",
   "url":"https://www.casamentos.com.br/cerimonialista/triunfal-cerimonial--e137503",
   "address":{"@type":"PostalAddress","streetAddress":"Avenida Antoine de Saint Exupéry, 03",
     "postalCode":"59066-842","addressLocality":"Natal","addressRegion":"Rio Grande do Norte"},
   "priceRange":"R$4300-R$500000",
   "aggregateRating":{"@type":"AggregateRating","reviewCount":89,"ratingValue":"4.9"}}},
 {"@type":"ListItem","position":2,"item":{"@type":"ProfessionalService",
   "name":"Motta's",
   "url":"https://www.casamentos.com.br/cerimonialista/mottas--e107378",
   "address":{"@type":"PostalAddress","streetAddress":"Avenida General Gustavo Cordeiro de Farias, 360",
     "postalCode":"59012-570","addressLocality":"Natal"}}},
 {"@type":"ListItem","position":3,"item":{"@type":"ProfessionalService",
   "name":"Repetido","url":"https://www.casamentos.com.br/cerimonialista/triunfal-cerimonial--e137503"}},
 {"@type":"ListItem","position":4,"item":{"@type":"ProfessionalService",
   "name":"Sem perfil","url":"https://www.casamentos.com.br/cerimonialista/sem-id"}}
]}
</script>
<script type="application/ld+json">{ isto não é json }</script>
</head><body></body></html>`;

const CONTEXTO = {
  url: 'https://www.casamentos.com.br/cerimonialista/rio-grande-do-norte/natal',
  categoriaOrigem: 'cerimonialista',
};

describe('idExternoDaUrl', () => {
  it('lê o id do perfil, que é a identidade do fornecedor na fonte', () => {
    expect(idExternoDaUrl('https://www.casamentos.com.br/cerimonialista/x--e137503')).toBe('e137503');
    expect(idExternoDaUrl('https://www.casamentos.com.br/cerimonialista/x--e137503?utm=1')).toBe(
      'e137503',
    );
    expect(idExternoDaUrl('https://www.casamentos.com.br/cerimonialista/sem-id')).toBeNull();
  });
});

describe('precoMinimo', () => {
  it('pega só o piso da faixa', () => {
    expect(precoMinimo('R$4300-R$500000')).toBe(4300);
    expect(precoMinimo('R$ 1.500 - R$ 9.000')).toBe(1500);
    expect(precoMinimo('R$ 90,50')).toBe(90.5);
  });

  it('devolve nulo quando não há faixa', () => {
    expect(precoMinimo(undefined)).toBeNull();
    expect(precoMinimo('sob consulta')).toBeNull();
    expect(precoMinimo(4300)).toBeNull();
  });
});

describe('adaptadorCasamentos.extrairListagem', () => {
  const resultado = adaptadorCasamentos.extrairListagem(HTML, CONTEXTO);

  it('lê os fornecedores do ItemList e ignora o BreadcrumbList', () => {
    expect(resultado.registros.map((r) => r.externalId)).toEqual(['e137503', 'e107378']);
  });

  it('não copia foto nem descrição — a whitelist é lei', () => {
    const primeiro = resultado.registros[0];
    expect(primeiro).toBeDefined();
    expect(Object.keys(primeiro?.bruto ?? {})).not.toContain('image');
    expect(Object.keys(primeiro?.bruto ?? {})).not.toContain('description');
    expect(JSON.stringify(resultado.registros)).not.toContain('cdn0.casamentos.com.br');
    expect(JSON.stringify(resultado.registros)).not.toContain('Descrição longa');
  });

  it('traz os fatos de negócio que o R03 §2.1 autoriza', () => {
    expect(resultado.registros[0]?.bruto).toEqual({
      nome_comercial: 'Triunfal Cerimonial',
      source_url: 'https://www.casamentos.com.br/cerimonialista/triunfal-cerimonial--e137503',
      categoria_origem: 'cerimonialista',
      cidade: 'Natal',
      endereco: 'Avenida Antoine de Saint Exupéry, 03',
      cep: '59066-842',
      nota: 4.9,
      avaliacoes_qtd: 89,
      preco_a_partir_de: 4300,
    });
  });

  it('sobrevive a perfil sem nota, sem preço e a bloco JSON quebrado', () => {
    expect(resultado.registros[1]?.bruto).toMatchObject({
      nome_comercial: "Motta's",
      nota: null,
      preco_a_partir_de: null,
    });
  });

  it('não repete o mesmo fornecedor nem aceita URL sem id', () => {
    expect(resultado.registros).toHaveLength(2);
  });

  it('segue a paginação que a própria página declara', () => {
    expect(resultado.proximaUrl).toBe(
      'https://www.casamentos.com.br/cerimonialista/rio-grande-do-norte/natal--2',
    );
    const semProxima = adaptadorCasamentos.extrairListagem('<html><head></head></html>', CONTEXTO);
    expect(semProxima.proximaUrl).toBeNull();
    expect(semProxima.registros).toEqual([]);
  });

  it('o que sai daqui atravessa a whitelist sem perder nada', () => {
    const primeiro = resultado.registros[0];
    const { payload, descartados } = filtrarPelaWhitelist(primeiro?.bruto ?? {});
    expect(descartados).toEqual([]);
    expect(payload.nome_comercial).toBe('Triunfal Cerimonial');
  });
});
