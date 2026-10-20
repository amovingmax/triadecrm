/**
 * Os ritmos do eco do banco (`eco-do-banco.ts`), num arquivo sem dependência
 * nenhuma. O aviso de resposta (`components/avisos/provedor-avisos.tsx`) usa os
 * mesmos números e vive na casca do app, em toda página: importados de
 * `eco-do-banco.ts`, eles levavam junto a camada de dados inteira de Conversas
 * (20/10/2026). `eco-do-banco.ts` os reexporta.
 */

/** Quanto tempo juntar eventos antes de buscar. Rajada vira uma busca só. */
export const ESPERA_DA_RAJADA_MS = 400;

/** Ritmo da sondagem quando não há eco. Barata o bastante para ser frequente. */
export const RITMO_SEM_ECO_MS = 20_000;

/**
 * Ritmo da MESMA sondagem enquanto o eco está de pé.
 *
 * Ela não some quando o socket sobe, e a razão é um modo de falha real: "ao
 * vivo" quer dizer que o canal assinou, não que os eventos estão chegando. Se a
 * publicação sumir numa migração futura, ou se o socket ficar aberto e surdo, a
 * tela diria "ao vivo" e estaria morta — em silêncio, que é a pior forma.
 *
 * A noventa segundos ela custa duas consultas minúsculas por minuto e meio, e é
 * o que garante que o atraso máximo da tela seja um minuto e meio em vez de
 * infinito.
 */
export const RITMO_VIGIANDO_MS = 90_000;
