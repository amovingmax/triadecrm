/**
 * Os coletores do worker de mercado, pelo nome que `mercado_fontes.coletor`
 * guarda. Uma fonte só roda se a linha dela na lista apontar para um destes E
 * puder ser coletada (`pode_coletar`): o banco decide o que pode, o worker só
 * sabe como.
 *
 * Temporada (aluguel por temporada) NÃO tem coletor: nenhuma fonte grátis
 * permite robô para o RN (auditoria de 18/11/2026). As anotações manuais
 * continuam fora do worker.
 */
import type { Coletor } from '../tipos';
import { coletorChavesNaMao } from './chavesnamao';
import { coletorFeeds } from './feeds';
import { coletorDomNatal, coletorObrasgov } from './obras';
import {
  coletorBcb,
  coletorCorrida,
  coletorFipezap,
  coletorGeomapas,
  coletorSiconfi,
} from './oficiais';
import { coletorProximidades } from './proximidades';
import {
  coletorAbreu,
  coletorCatalogue,
  coletorIbeda,
  coletorImobibrasil,
  coletorImobinova,
  coletorLopes,
} from './sites';

export const COLETORES: ReadonlyMap<string, Coletor> = new Map(
  [
    coletorChavesNaMao,
    coletorLopes,
    coletorCatalogue,
    coletorImobibrasil,
    coletorIbeda,
    coletorImobinova,
    coletorAbreu,
    coletorFeeds,
    coletorFipezap,
    coletorBcb,
    coletorSiconfi,
    coletorCorrida,
    coletorGeomapas,
    coletorDomNatal,
    coletorObrasgov,
    coletorProximidades,
  ].map((c) => [c.chave, c]),
);
