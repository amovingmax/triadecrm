/**
 * Tabela de casos da normalização — a MESMA de `supabase/tests/02_normalizacao.sql`,
 * caso a caso, na mesma ordem.
 *
 * Ela é usada duas vezes: por `normalizadores.test.ts` (as funções TypeScript) e por
 * `normalizadores.paridade.test.ts` (as funções SQL no Postgres local, via docker exec).
 * Assim, uma regra que mudar de um lado e não do outro derruba o teste de paridade.
 *
 * Não é exportada pelo `index.ts`: é material de teste, não API do pacote.
 */

/** Um caso: entrada, resultado esperado e a descrição usada no pgTAP. */
export interface CasoTexto {
  entrada: string | null;
  esperado: string | null;
  descricao: string;
}

export interface CasoBooleano {
  entrada: string | null;
  esperado: boolean;
  descricao: string;
}

/** app.normalize_phone_br — 20 casos (RF-BAS-05). */
export const CASOS_TELEFONE: readonly CasoTexto[] = [
  {
    entrada: '(84) 99999-1234',
    esperado: '+5584999991234',
    descricao: 'celular com DDD entre parênteses',
  },
  { entrada: '84 99999 1234', esperado: '+5584999991234', descricao: 'celular com espaços' },
  { entrada: '+55 84 99999-1234', esperado: '+5584999991234', descricao: 'já com +55' },
  { entrada: '0055 84 99999 1234', esperado: '+5584999991234', descricao: 'DDI 0055 removido' },
  {
    entrada: '0 84 99999-1234',
    esperado: '+5584999991234',
    descricao: 'zero de discagem nacional removido',
  },
  {
    entrada: '021 84 99999-1234',
    esperado: '+5584999991234',
    descricao: 'zero + código de operadora removidos',
  },
  { entrada: '99999-1234', esperado: '+5584999991234', descricao: 'sem DDD assume 84' },
  {
    entrada: '9999-1234',
    esperado: '+5584999991234',
    descricao: '8 dígitos sem DDD ganha 84 e o nono dígito',
  },
  {
    entrada: '84 9999-1234',
    esperado: '+5584999991234',
    descricao: 'celular antigo (8 dígitos) ganha o nono dígito',
  },
  {
    entrada: '(84) 3206-4212',
    esperado: '+558432064212',
    descricao: 'fixo com DDD fica com 10 dígitos',
  },
  { entrada: '3206-4212', esperado: '+558432064212', descricao: 'fixo sem DDD assume 84' },
  {
    entrada: '+55 (11) 91234-5678',
    esperado: '+5511912345678',
    descricao: 'outro DDD é preservado',
  },
  {
    entrada: '55 84 3206 4212',
    esperado: '+558432064212',
    descricao: 'DDI 55 sem sinal de + removido',
  },
  { entrada: '84 89999-1234', esperado: null, descricao: '11 dígitos sem o 9 é inválido' },
  { entrada: '84 1234-5678', esperado: null, descricao: 'fixo começando em 1 é inválido' },
  { entrada: '+55 04 3206-4212', esperado: null, descricao: 'DDD com zero é inválido' },
  { entrada: '123', esperado: null, descricao: 'poucos dígitos' },
  { entrada: '', esperado: null, descricao: 'vazio -> NULL' },
  { entrada: null, esperado: null, descricao: 'NULL -> NULL' },
  { entrada: 'abc', esperado: null, descricao: 'sem dígitos -> NULL' },
];

/** app.normalize_cnpj — 3 casos. */
export const CASOS_CNPJ_NORMALIZE: readonly CasoTexto[] = [
  { entrada: '12.345.678/0001-95', esperado: '12345678000195', descricao: 'máscara removida' },
  { entrada: '123', esperado: null, descricao: 'menos de 14 dígitos -> NULL' },
  { entrada: null, esperado: null, descricao: 'NULL -> NULL' },
];

/** app.cnpj_is_valid — 5 casos. */
export const CASOS_CNPJ_VALIDO: readonly CasoBooleano[] = [
  { entrada: '12.345.678/0001-95', esperado: true, descricao: 'dígitos verificadores válidos' },
  { entrada: '11.222.333/0001-81', esperado: true, descricao: 'segundo exemplo válido' },
  { entrada: '12345678000196', esperado: false, descricao: 'DV errado' },
  { entrada: '11.111.111/1111-11', esperado: false, descricao: 'sequência repetida rejeitada' },
  { entrada: '123', esperado: false, descricao: 'curto é inválido' },
];

/** app.normalize_instagram — 17 casos (RF-BAS-08). */
export const CASOS_INSTAGRAM: readonly CasoTexto[] = [
  { entrada: '@Buffet.Natal', esperado: 'buffet.natal', descricao: '@ removido e minúsculo' },
  {
    entrada: 'https://www.instagram.com/buffet_natal/?hl=pt',
    esperado: 'buffet_natal',
    descricao: 'URL completa vira handle',
  },
  {
    entrada: 'instagram.com/buffet_natal/',
    esperado: 'buffet_natal',
    descricao: 'URL sem protocolo',
  },
  { entrada: '@@buffet', esperado: 'buffet', descricao: 'arrobas repetidos' },
  { entrada: 'nome com espaço', esperado: null, descricao: 'espaço é inválido' },
  { entrada: 'buffet-natal', esperado: null, descricao: 'hífen é inválido' },
  { entrada: 'a'.repeat(31), esperado: null, descricao: 'mais de 30 caracteres' },
  { entrada: '', esperado: null, descricao: 'vazio -> NULL' },
  {
    entrada: 'https://www.instagram.com/p/CxYz123/',
    esperado: null,
    descricao: 'link de post não vira handle',
  },
  {
    entrada: 'https://instagram.com/reel/AbC/',
    esperado: null,
    descricao: 'link de reel não vira handle',
  },
  {
    entrada: 'instagram.com/explore/tags/buffet/',
    esperado: null,
    descricao: 'página de explorar não vira handle',
  },
  {
    entrada: 'https://www.instagram.com/accounts/login/',
    esperado: null,
    descricao: 'página de sistema não vira handle',
  },
  {
    entrada: 'https://m.instagram.com/buffet.natal',
    esperado: 'buffet.natal',
    descricao: 'URL móvel (m.instagram.com) com protocolo',
  },
  {
    entrada: 'm.instagram.com/buffet.natal',
    esperado: 'buffet.natal',
    descricao: 'URL móvel sem protocolo',
  },
  {
    entrada: 'https://www.instagram.com/buffet.natal/reel/AbC/',
    esperado: 'buffet.natal',
    descricao: 'reel dentro do perfil devolve o perfil',
  },
  {
    entrada: 'https://www.instagram.com/stories/buffet.natal/3211/',
    esperado: null,
    descricao: 'link de story não vira handle',
  },
  {
    entrada: 'https://www.instagram.com/tv/AbC123/',
    esperado: null,
    descricao: 'link de IGTV não vira handle',
  },
];

/** app.website_domain — 11 casos (RF-BAS-08). */
export const CASOS_DOMINIO: readonly CasoTexto[] = [
  {
    entrada: 'https://www.buffetnatal.com.br/contato?x=1',
    esperado: 'buffetnatal.com.br',
    descricao: 'protocolo, www, caminho e query removidos',
  },
  {
    entrada: 'HTTP://BuffetNatal.com.br:8080/',
    esperado: 'buffetnatal.com.br',
    descricao: 'porta removida e minúsculo',
  },
  {
    entrada: 'buffetnatal.com.br',
    esperado: 'buffetnatal.com.br',
    descricao: 'já limpo permanece',
  },
  { entrada: '', esperado: null, descricao: 'vazio -> NULL' },
  { entrada: null, esperado: null, descricao: 'NULL -> NULL' },
  { entrada: 'sem site', esperado: null, descricao: 'texto livre não é hostname' },
  { entrada: 'só instagram', esperado: null, descricao: 'texto livre com acento não é hostname' },
  { entrada: '-', esperado: null, descricao: 'traço não é hostname' },
  {
    entrada: 'ftp://exemplo.com.br/pasta',
    esperado: 'exemplo.com.br',
    descricao: 'qualquer esquema é removido',
  },
  {
    entrada: 'https://user:senha@exemplo.com.br/',
    esperado: 'exemplo.com.br',
    descricao: 'credenciais na URL são descartadas',
  },
  {
    entrada: 'exemplo.com.br.',
    esperado: 'exemplo.com.br',
    descricao: 'ponto final de FQDN cai (casa com a forma sem ponto)',
  },
];

/** app.is_shared_web_host — 4 casos. */
export const CASOS_HOST_COMPARTILHADO: readonly CasoBooleano[] = [
  { entrada: 'instagram.com', esperado: true, descricao: 'instagram.com é host compartilhado' },
  {
    entrada: 'buffetnatal.com.br',
    esperado: false,
    descricao: 'site próprio não é host compartilhado',
  },
  {
    entrada: 'wa.me',
    esperado: true,
    descricao: 'wa.me é host compartilhado (link de conversa não identifica empresa)',
  },
  { entrada: 'linktr.ee', esperado: true, descricao: 'linktr.ee é host compartilhado' },
];

/**
 * app.search_name — os 2 casos do pgTAP mais nomes reais de Natal com acento e cedilha,
 * que é onde a remoção de acento em TypeScript (NFD) poderia se afastar do `unaccent`.
 */
export const CASOS_SEARCH_NAME: readonly CasoTexto[] = [
  {
    entrada: '  Buffet   São  João ',
    esperado: 'buffet sao joao',
    descricao: 'sem acento, minúsculo, espaços colapsados',
  },
  { entrada: '', esperado: null, descricao: 'vazio -> NULL' },
  { entrada: 'Espaço Ponta Negra', esperado: 'espaco ponta negra', descricao: 'cedilha vira c' },
  {
    entrada: 'Cerimonial Açaí & Cia',
    esperado: 'cerimonial acai & cia',
    descricao: 'til e cedilha na mesma palavra',
  },
  {
    entrada: 'Bufê Três Irmãos',
    esperado: 'bufe tres irmaos',
    descricao: 'circunflexo, agudo e til',
  },
  { entrada: 'DJ Müller', esperado: 'dj muller', descricao: 'trema' },
];

/** app.mask_phone — 4 casos (RF-BAS-14). */
export const CASOS_MASCARA: readonly CasoTexto[] = [
  {
    entrada: '+5584999991234',
    esperado: '+55 84 •••••-••34',
    descricao: 'celular mantém DDD e 2 últimos dígitos',
  },
  { entrada: '+558432064212', esperado: '+55 84 ••••-••12', descricao: 'fixo' },
  { entrada: 'abc', esperado: '••••••', descricao: 'valor fora do padrão é totalmente oculto' },
  { entrada: null, esperado: null, descricao: 'NULL -> NULL' },
];
