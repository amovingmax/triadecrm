/**
 * A empresa deste site e as outras para onde o seletor leva.
 *
 * Cada empresa tem o SEU deploy (projeto na Vercel, banco no Supabase, endereço). O
 * deploy diz quem é por `NEXT_PUBLIC_EMPRESA`; sem a variável é a KOMUNE, para o que
 * já está no ar não precisar de nada novo. O Next só substitui `process.env.NEXT_PUBLIC_*`
 * no navegador quando o acesso é literal, por isso a leitura fica aqui, uma vez.
 *
 * O seletor lê `NEXT_PUBLIC_EMPRESAS_LINKS` ("komune=https://…;imova=https://…").
 * Com menos de duas empresas nela, não aparece: a KOMUNE fica igual até a Imova existir.
 * Trocar de empresa é ABRIR o endereço da outra — nunca trocar de banco por dentro —,
 * para cada aba ficar presa à sua empresa.
 */
import {
  EMPRESAS,
  type Empresa,
  type EmpresaSlug,
  empresaPorSlug,
  type TipoDeParceiro,
} from '@komune/schema/empresas';

export const EMPRESA: Empresa = empresaPorSlug(process.env.NEXT_PUBLIC_EMPRESA);

/**
 * Os tipos de parceiro que esta empresa usa, na ordem de sempre, com o rótulo dela
 * ("Fornecedor"; na Imova, "Proprietário"). Tipo com rótulo `null` fica de fora das
 * listas de escolha e dos filtros.
 */
export const TIPOS_EM_USO: { id: TipoDeParceiro; rotulo: string }[] = (
  ['fornecedor', 'produtor', 'cerimonialista'] as const
).flatMap((id) => {
  const rotulo = EMPRESA.tipos[id];
  return rotulo ? [{ id, rotulo }] : [];
});

/** "fornecedor, produtor ou cerimonialista": os tipos em uso, em minúscula, no meio da frase. */
export const TIPOS_POR_EXTENSO: string = (() => {
  const nomes = TIPOS_EM_USO.map((t) => t.rotulo.toLowerCase());
  return nomes.length > 1 ? `${nomes.slice(0, -1).join(', ')} ou ${nomes[nomes.length - 1]}` : (nomes[0] ?? '');
})();

/**
 * Os admins da empresa têm nome ("Rafael, Luiz ou Matheus") ou ela usa a frase
 * genérica ("um administrador")? Nome próprio começa em maiúscula; a frase, não.
 * Serve às frases que só se leem com nomes, como "três: Rafael, Luiz e Matheus".
 */
export const ADMINS_TEM_NOME: boolean = /^\p{Lu}/u.test(EMPRESA.admins.ou);

/**
 * "um admin (Rafael, Luiz ou Matheus)" quando os admins têm nome, e só a frase
 * genérica quando não têm: "um admin (um administrador)" não se lê.
 */
export const UM_ADMIN: string = ADMINS_TEM_NOME ? `um admin (${EMPRESA.admins.ou})` : EMPRESA.admins.ou;

export interface DestinoDoSeletor {
  slug: EmpresaSlug;
  nome: string;
  url: string;
  atual: boolean;
}

/** "komune=https://a;imova=https://b" → empresas conhecidas, na ordem escrita. Lixo é ignorado. */
export function lerLinksDasEmpresas(bruto: string | undefined, atual: EmpresaSlug): DestinoDoSeletor[] {
  if (!bruto) return [];
  const destinos: DestinoDoSeletor[] = [];
  for (const par of bruto.split(';')) {
    const [slug, url] = par.split('=').map((s) => s?.trim());
    if (!slug || !url || !(slug in EMPRESAS) || !/^https?:\/\//.test(url)) continue;
    if (destinos.some((d) => d.slug === slug)) continue;
    destinos.push({ slug: slug as EmpresaSlug, nome: EMPRESAS[slug as EmpresaSlug].nome, url: url.replace(/\/$/, ''), atual: slug === atual });
  }
  return destinos.length >= 2 && destinos.some((d) => d.atual) ? destinos : [];
}

/** As empresas do seletor; vazia quando só existe esta. */
export const DESTINOS_DO_SELETOR: DestinoDoSeletor[] = lerLinksDasEmpresas(
  process.env.NEXT_PUBLIC_EMPRESAS_LINKS,
  EMPRESA.slug,
);
