/**
 * Fontes proibidas: a decisão do dono na entrevista de 18/11/2026 (ZERO
 * associação com Canal Pro, ZAP, VivaReal, OLX/Grupo OLX ou portais
 * parecidos) e o veredito PROIBIDA da auditoria de fontes.
 *
 * Esta lista é a SEGUNDA porta. A primeira é o banco: `mercado_fontes` só deixa
 * coletar fonte liberada e não PROIBIDA, e `public.mercado_anuncios_registrar`
 * recusa o item que tenha link ou domínio bloqueado em qualquer texto (régua
 * `fontes_bloqueadas`). Aqui o worker se recusa a sequer MANDAR o pedido para um
 * desses domínios, e a não mandar ao banco um item que já se sabe proibido.
 *
 * O índice FipeZAP vem de downloads.fipe.org.br: "fipe" não é rótulo bloqueado.
 */

/** Domínios que nunca recebem pedido nosso (o host ou qualquer subdomínio). */
export const DOMINIOS_PROIBIDOS: readonly string[] = [
  // Grupo OLX e parecidos (regra do dono)
  'zapimoveis.com.br',
  'vivareal.com.br',
  'olx.com.br',
  'canalpro.grupozap.com',
  'grupozap.com',
  'grupoolx.com.br',
  'datazap.com.br',
  'mercadolivre.com.br',
  'imovelweb.com.br',
  'wimoveis.com.br',
  'quintoandar.com.br',
  'casamineira.com.br',
  'loft.com.br',
  'netimoveis.com',
  'imovelguide.com.br',
  'dfimoveis.com.br',
  'nestoria.com.br',
  'trovit.com.br',
  'redecasas.com.br',
  // auditoria de 18/11 (termos ou robots proíbem)
  'deztop.com',
  'apto.vc',
  'pereseperes.com.br',
  'imobiliariareismagos.com.br',
  'viverimoveisrn.com.br',
  'gorettimobiliaria.com',
  'sinergyimoveis.com.br',
  'heloisacorreiaimoveis.com.br',
  'marizaldaimoveis.com.br',
  'jjassessoriaimobiliaria.com.br',
  // temporada (termos proíbem robôs)
  'airbnb.com.br',
  'airbnb.com',
  'booking.com',
  'airroi.com',
  'airdna.co',
  'airbtics.com',
];

/** O host (sem porta e sem "www.") de um endereço; vazio se não houver. */
export function hostDe(url: string | null | undefined): string {
  const m = String(url ?? '').match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i);
  return (m?.[1] ?? '')
    .toLowerCase()
    .replace(/:\d+$/, '')
    .replace(/^www\./, '');
}

/**
 * O host é de domínio proibido? Confere a lista acima e, rótulo a rótulo, a
 * régua do banco (`fontes_bloqueadas`, igual a `app.mercado_url_bloqueada`).
 */
export function hostBloqueado(host: string, rotulos: readonly string[] = []): boolean {
  const h = host
    .toLowerCase()
    .replace(/:\d+$/, '')
    .replace(/^www\./, '');
  if (!h) return false;
  if (DOMINIOS_PROIBIDOS.some((d) => h === d || h.endsWith(`.${d}`))) return true;
  const partes = h.split('.');
  return rotulos.some((r) => partes.includes(r.replace(/\s+/g, '').toLowerCase()));
}

export const urlBloqueada = (
  url: string | null | undefined,
  rotulos: readonly string[] = [],
): boolean => hostBloqueado(hostDe(url), rotulos);

/** Algum texto do objeto (em qualquer nível) traz link de domínio proibido? */
export function temLinkBloqueado(
  valor: unknown,
  rotulos: readonly string[] = [],
  nivel = 0,
): boolean {
  if (nivel > 6 || valor === null || valor === undefined) return false;
  if (typeof valor === 'string') {
    for (const m of valor.matchAll(/((https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}[^\s"'<>]*)/gi)) {
      const achado = m[1] ?? '';
      const comEsquema = /^https?:\/\//i.test(achado) ? achado : `http://${achado}`;
      if (urlBloqueada(comEsquema, rotulos)) return true;
    }
    return false;
  }
  if (Array.isArray(valor)) return valor.some((v) => temLinkBloqueado(v, rotulos, nivel + 1));
  if (typeof valor === 'object') {
    return Object.values(valor as Record<string, unknown>).some((v) =>
      temLinkBloqueado(v, rotulos, nivel + 1),
    );
  }
  return false;
}
