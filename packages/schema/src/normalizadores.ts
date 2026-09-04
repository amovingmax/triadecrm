/**
 * Normalizadores — espelho fiel, em TypeScript, das funções SQL do schema `app`
 * (migração `20260904000100_base_extensoes_tipos_funcoes.sql`).
 *
 * O Postgres é o cérebro (ADR-03): quem decide o valor final é o trigger no banco.
 * Estas funções existem para a UI validar e mostrar o valor normalizado ANTES do
 * insert (RF-BAS-05, RF-BAS-15) e para os workers deduplicarem sem ida ao banco.
 *
 * Regra de ouro: quando SQL e TypeScript divergirem, o SQL é a verdade — corrija
 * este arquivo, nunca a migração. `normalizadores.paridade.test.ts` roda os mesmos
 * casos no Postgres local e falha se as duas implementações se afastarem.
 */

/**
 * `trim()` do Postgres remove apenas espaços (' '), não tabulação nem quebra de linha,
 * enquanto `String.prototype.trim()` remove todo espaço em branco. As funções SQL usam
 * `trim` puro, então a paridade exige a versão restrita.
 */
function trimSql(valor: string): string {
  return valor.replace(/^ +/, '').replace(/ +$/, '');
}

/** Só os dígitos, como `regexp_replace(x, '\D', '', 'g')`. */
function somenteDigitos(valor: string): string {
  return valor.replace(/\D/g, '');
}

// ---------------------------------------------------------------------------
// Telefone — app.normalize_phone_br(text)
// ---------------------------------------------------------------------------

/** DDD assumido quando o número vem sem DDD (Natal e Grande Natal). */
export const DDD_PADRAO = '84' as const;

/**
 * Telefone brasileiro em qualquer formato → E.164 (`+55DDDNÚMERO`); `null` se não
 * couber na regra (RF-BAS-05). Espelha `app.normalize_phone_br`:
 *
 * 1. só dígitos; 2. remove o DDI 55 e o 0 de operadora; 3. sem DDD (8 ou 9 dígitos)
 * assume 84; 4. celular antigo de 8 dígitos (começa em 6–9) ganha o nono dígito;
 * 5. valida DDD sem zero, celular com 11 dígitos começando em 9 e fixo com 10
 * dígitos começando em 2–5.
 */
export function normalizePhoneBr(entrada: string | null | undefined): string | null {
  let d = somenteDigitos(entrada ?? '');
  if (d === '') return null;

  // DDI 55 (+55 84 ..., 0055 84 ...). Só quando sobra um número completo com DDD,
  // para não confundir com o DDD 55 (RS) de um número já sem DDI.
  if (d.slice(0, 4) === '0055' && d.length >= 14) {
    d = d.slice(4);
  } else if (d.slice(0, 2) === '55' && d.length >= 12) {
    d = d.slice(2);
  }

  // 0 de operadora / discagem nacional (0 84 99999 9999, 021 84 ...).
  if (d.slice(0, 1) === '0' && (d.length === 11 || d.length === 12)) {
    d = d.slice(1);
  } else if (d.slice(0, 1) === '0' && (d.length === 13 || d.length === 14)) {
    d = d.slice(3);
  }

  // Sem DDD: número local de Natal/Grande Natal.
  if (d.length === 8 || d.length === 9) {
    d = DDD_PADRAO + d;
  }

  // Celular antigo de 8 dígitos (6xxx-xxxx a 9xxx-xxxx) recebe o nono dígito.
  if (d.length === 10 && d[2]! >= '6' && d[2]! <= '9') {
    d = d.slice(0, 2) + '9' + d.slice(2);
  }

  if (d.length !== 10 && d.length !== 11) return null;
  if (d[0] === '0' || d[1] === '0') return null;
  if (d.length === 11 && d[2] !== '9') return null;
  if (d.length === 10 && !(d[2]! >= '2' && d[2]! <= '5')) return null;

  return '+55' + d;
}

/** `true` se o texto vira um telefone E.164 válido (atalho de `normalizePhoneBr`). */
export function isPhoneBrValido(entrada: string | null | undefined): boolean {
  return normalizePhoneBr(entrada) !== null;
}

// ---------------------------------------------------------------------------
// CNPJ — app.normalize_cnpj(text) / app.cnpj_is_valid(text)
// ---------------------------------------------------------------------------

/**
 * CNPJ com 14 dígitos, sem máscara; `null` quando não há exatamente 14 dígitos.
 * Espelha `app.normalize_cnpj`. O CNPJ alfanumérico (Receita Federal, a partir de
 * 07/2026) não é aceito nesta versão — mesma decisão do banco.
 */
export function normalizeCnpj(entrada: string | null | undefined): string | null {
  const d = somenteDigitos(entrada ?? '');
  return d.length === 14 ? d : null;
}

/** Pesos do 1º e do 2º dígito verificador (módulo 11), iguais aos do SQL. */
const PESOS_DV1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const PESOS_DV2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;

/**
 * Valida os dígitos verificadores do CNPJ (módulo 11) e rejeita sequências
 * repetidas (`00000000000000`…). Espelha `app.cnpj_is_valid`.
 */
export function cnpjIsValid(entrada: string | null | undefined): boolean {
  const d = normalizeCnpj(entrada);
  if (d === null) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;

  const dv = (pesos: readonly number[]): number => {
    let soma = 0;
    for (let i = 0; i < pesos.length; i += 1) soma += Number(d[i]) * pesos[i]!;
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  return Number(d[12]) === dv(PESOS_DV1) && Number(d[13]) === dv(PESOS_DV2);
}

// ---------------------------------------------------------------------------
// @instagram — app.normalize_instagram(text)
// ---------------------------------------------------------------------------

/**
 * Rotas reservadas do Instagram: nenhuma é um perfil. Devolver 'p'/'reel'/'explore'
 * como handle colidiria no índice único `organizations_instagram_uq` (23505) e criaria
 * falso positivo de dedup entre empresas sem relação (RF-BAS-08). Lista idêntica à do SQL.
 */
export const ROTAS_RESERVADAS_INSTAGRAM = [
  'p',
  'reel',
  'reels',
  'tv',
  'stories',
  'story',
  'explore',
  'accounts',
  'direct',
  'about',
  'developer',
  'legal',
  'privacy',
  'terms',
  'api',
  'challenge',
  'emails',
  'session',
  'oauth',
  'graphql',
  'ajax',
  'static',
] as const;

/**
 * `@instagram` a partir de URL (inclusive `m.`/`mobile.instagram.com`) ou `@nome`:
 * minúsculo, sem `@`; `null` para link de post/reel/story, rota de sistema ou handle
 * fora de `^[a-z0-9._]{1,30}$`. Espelha `app.normalize_instagram`.
 */
export function normalizeInstagram(entrada: string | null | undefined): string | null {
  let v = trimSql(entrada ?? '').toLowerCase();
  if (v === '') return null;

  v = v.replace(/^(https?:\/\/)?(www\.|m\.|mobile\.)?instagram\.com\//, ''); // URL -> caminho
  v = v.replace(/^@+/, ''); // @ inicial
  v = v.replace(/[/?#][\s\S]*$/, ''); // barra final, query, âncora

  if (!/^[a-z0-9._]{1,30}$/.test(v)) return null;
  if ((ROTAS_RESERVADAS_INSTAGRAM as readonly string[]).includes(v)) return null;
  return v;
}

// ---------------------------------------------------------------------------
// Domínio do site — app.website_domain(text) / app.is_shared_web_host(text)
// ---------------------------------------------------------------------------

/**
 * Domínio do site (hostname validado), sem esquema, credenciais, `www.`, caminho ou
 * porta; `null` para texto livre ("sem site", "só instagram", "-"), que viraria chave
 * de dedup 0,90 casando todo mundo com todo mundo (RF-BAS-08).
 * Espelha `app.website_domain`.
 */
export function websiteDomain(entrada: string | null | undefined): string | null {
  let d = trimSql(entrada ?? '').toLowerCase();
  d = d.replace(/^([a-z][a-z0-9+.-]*:)?\/\//, ''); // esquema
  d = d.replace(/^[^@/]+@/, ''); // usuário:senha@
  d = d.replace(/[/?#][\s\S]*$/, ''); // caminho, query, âncora
  d = d.replace(/:\d+$/, ''); // porta

  const semPontoFinal = d.replace(/\.$/, ''); // ponto final de FQDN
  if (!/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(semPontoFinal)) return null;
  return semPontoFinal.replace(/^www\./, '');
}

/**
 * Hosts compartilhados (redes sociais, encurtadores, construtores de site): o domínio
 * NÃO identifica a empresa, então não entra na dedup por domínio.
 * Espelha `app.is_shared_web_host` — mesma lista, mesma ordem.
 */
export const HOSTS_COMPARTILHADOS = [
  'instagram.com',
  'facebook.com',
  'fb.com',
  'm.facebook.com',
  'linktr.ee',
  'linkr.bio',
  'beacons.ai',
  'wa.me',
  'api.whatsapp.com',
  'whatsapp.com',
  'bit.ly',
  'tinyurl.com',
  'linkedin.com',
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'x.com',
  'twitter.com',
  'sites.google.com',
  'google.com',
  'business.site',
  'wixsite.com',
  'blogspot.com',
  'wordpress.com',
  'gmail.com',
  'hotmail.com',
  'outlook.com',
  'yahoo.com',
] as const;

/** `true` para host compartilhado que não serve como chave de dedup por domínio. */
export function isSharedWebHost(dominio: string | null | undefined): boolean {
  const d = (dominio ?? '').trim().toLowerCase();
  return (HOSTS_COMPARTILHADOS as readonly string[]).includes(d);
}

// ---------------------------------------------------------------------------
// Nome de busca — app.search_name(text)
// ---------------------------------------------------------------------------

/**
 * Caracteres latinos que o `unaccent` do Postgres mapeia por regra própria e que a
 * decomposição Unicode (NFD) não resolve, porque não têm forma decomposta.
 */
const UNACCENT_EXTRA: Record<string, string> = {
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ł: 'l',
  ß: 'ss',
  ı: 'i',
};

/**
 * `lower(unaccent(nome))` com espaços colapsados, para trigram e busca por prefixo.
 * Espelha `app.search_name`; devolve `null` para vazio.
 *
 * Atenção: o `unaccent` do banco usa um dicionário; aqui a remoção de acento é feita
 * por NFD + tabela dos casos não decomponíveis acima. Cobre todo o alfabeto do
 * português e as línguas latinas que aparecem em nome de empresa; o teste de paridade
 * confere caso a caso contra o Postgres.
 */
export function searchName(entrada: string | null | undefined): string | null {
  const colapsado = trimSql((entrada ?? '').replace(/\s+/g, ' '));
  const semAcento = colapsado
    .replace(/[\u00c0-\u024f]/g, (c) => UNACCENT_EXTRA[c.toLowerCase()] ?? c)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const v = semAcento.toLowerCase();
  return v === '' ? null : v;
}

// ---------------------------------------------------------------------------
// Máscara de telefone — app.mask_phone(text)
// ---------------------------------------------------------------------------

/**
 * Máscara de telefone E.164 para os papéis que não leem PII na base (`sdr`,
 * `embaixador`) — RF-BAS-14. Mantém `+55`, o DDD e os 2 últimos dígitos.
 * Espelha `app.mask_phone`.
 */
export function maskPhone(telefone: string | null | undefined): string | null {
  if (telefone === null || telefone === undefined) return null;
  if (/^\+55\d{11}$/.test(telefone)) {
    return '+55 ' + telefone.slice(3, 5) + ' •••••-••' + telefone.slice(-2);
  }
  if (/^\+55\d{10}$/.test(telefone)) {
    return '+55 ' + telefone.slice(3, 5) + ' ••••-••' + telefone.slice(-2);
  }
  return '••••••';
}

/**
 * Telefone E.164 formatado para leitura humana: `+5584999991234` → `+55 84 99999-1234`.
 * Não tem equivalente no banco (é só apresentação); devolve a entrada quando não
 * reconhece o formato.
 */
export function formatPhoneBr(telefone: string | null | undefined): string | null {
  if (telefone === null || telefone === undefined) return null;
  if (/^\+55\d{11}$/.test(telefone)) {
    return `+55 ${telefone.slice(3, 5)} ${telefone.slice(5, 10)}-${telefone.slice(10)}`;
  }
  if (/^\+55\d{10}$/.test(telefone)) {
    return `+55 ${telefone.slice(3, 5)} ${telefone.slice(5, 9)}-${telefone.slice(9)}`;
  }
  return telefone;
}
