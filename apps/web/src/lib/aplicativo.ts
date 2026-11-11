/**
 * O que as páginas públicas do app de celular dizem sobre quem o faz
 * (`/aplicativo` e `/aplicativo/privacidade`). São os links que a ficha da App Store
 * pede (suporte e política de privacidade), e valem igual nas duas empresas: o app
 * é um só, da KOMUNE, e serve às duas equipes.
 *
 * Mudou o que a política promete, muda `versaoDaPolitica`.
 */
export const APLICATIVO = {
  nome: 'Tríade',
  desenvolvedora: 'KOMUNE LTDA',
  email: 'contato@komune.app.br',
  versaoDaPolitica: '11/11/2026',
  /** A política de cada empresa, que vale para os dados dos clientes que ela atende. */
  politicasDasEmpresas: [
    { empresa: 'KOMUNE', url: 'https://komune.app.br/privacidade' },
    { empresa: 'Imova Imobiliária', url: 'https://imova-crm.vercel.app/privacidade' },
  ],
} as const;
