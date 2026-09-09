/**
 * As barras de aba da Admin agora são as do produto inteiro.
 *
 * Este arquivo ficou como porta: os cinco módulos que tinham desenho próprio
 * passaram a usar `@/components/ui/abas`, e a Admin — que era a dona do
 * desenho escolhido — continua importando daqui para não espalhar a mudança
 * por dez arquivos de uma vez.
 */
export { ChipsDeSecao, SeletorDeAba } from '@/components/ui/abas';
