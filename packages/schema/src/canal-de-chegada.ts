/**
 * O canal de chegada do lead (só Imova, 06/11/2026): por qual meio a pessoa ficou
 * sabendo da Imova e chamou no WhatsApp. É a "etiqueta de prospecção" que a regra e a
 * IA põem sozinhas e que quem atende pode corrigir.
 *
 * Decisões do Rafael em 06/11/2026: os rótulos eram Placa, Anúncios, Redes sociais e
 * Indicação (mais o estado Não identificado). Em 09/11/2026 a Indicação deu lugar a
 * OUTROS: indicação, site, Google ou outro meio que o cliente contou. Não identificado
 * continua sendo só "sem pista nenhuma". A etiqueta mostra só o canal, e o
 * subcanal e a prova aparecem ao tocar e no relatório; foto de BANNER da Imova conta
 * como Placa e o relatório registra se veio foto da placa ou do banner.
 *
 * O banco é a verdade (`public.chegadas`, migração `…_o_canal_de_chegada`): estas
 * listas espelham os CHECKs de lá, e o pgTAP 137 confere os mesmos valores.
 */

export const CANAIS_DE_CHEGADA = [
  'placa',
  'anuncios',
  'redes_sociais',
  'outros',
  'nao_identificado',
] as const;
export type CanalDeChegada = (typeof CANAIS_DE_CHEGADA)[number];

/** Subcanal por canal. O banco recusa par que não esteja aqui (`app.canal_subcanal_valido`). */
export const SUBCANAIS_POR_CANAL = {
  placa: ['foto_da_placa', 'foto_do_banner', 'texto_da_placa'],
  anuncios: ['meta_anuncio', 'canal_pro', 'portal_zap', 'portal_vivareal', 'portal_olx', 'anuncio_outro'],
  redes_sociais: ['instagram', 'facebook', 'tiktok', 'youtube', 'meta_post', 'rede_outra'],
  outros: ['indicacao', 'site', 'google', 'outro_meio'],
  nao_identificado: ['desconhecido'],
} as const satisfies Record<CanalDeChegada, readonly string[]>;

export type SubcanalDeChegada = (typeof SUBCANAIS_POR_CANAL)[CanalDeChegada][number];

export const SUBCANAIS_DE_CHEGADA: readonly SubcanalDeChegada[] = Object.values(
  SUBCANAIS_POR_CANAL,
).flat() as SubcanalDeChegada[];

export const ROTULO_DO_CANAL: Readonly<Record<CanalDeChegada, string>> = {
  placa: 'Placa',
  anuncios: 'Anúncios',
  redes_sociais: 'Redes sociais',
  outros: 'Outros',
  nao_identificado: 'Não identificado',
};

export const ROTULO_DO_SUBCANAL: Readonly<Record<SubcanalDeChegada, string>> = {
  foto_da_placa: 'Foto da placa',
  foto_do_banner: 'Foto do banner',
  texto_da_placa: 'Falou da placa',
  meta_anuncio: 'Anúncio no Instagram/Facebook',
  canal_pro: 'Canal Pro',
  portal_zap: 'ZAP Imóveis',
  portal_vivareal: 'Viva Real',
  portal_olx: 'OLX',
  anuncio_outro: 'Outro anúncio',
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  meta_post: 'Publicação com botão do WhatsApp',
  rede_outra: 'Outra rede',
  indicacao: 'Indicação',
  site: 'Site da Imova',
  google: 'Google',
  outro_meio: 'Outro meio',
  desconhecido: 'Sem sinal',
};

/** Quem decidiu o canal que vale: a correção de gente sempre vence. */
export type DecididoPor = 'regra' | 'ia' | 'gente';

export function subcanalValido(canal: string, subcanal: string): boolean {
  const lista = (SUBCANAIS_POR_CANAL as Record<string, readonly string[]>)[canal];
  return Array.isArray(lista) && lista.includes(subcanal);
}
