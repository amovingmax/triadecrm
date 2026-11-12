/**
 * `atendente-imova@v4` (12/11/2026): a v3 (a visita pelo link da agenda), com o imóvel
 * em RASCUNHO também recebendo o link da visita.
 *
 * Por quê: na Imova, quase todo imóvel da carteira está em "rascunho" no CRM, porque os
 * portais ainda leem o arquivo do sistema anterior (a Arbo) e o anúncio do CRM só vai
 * "no ar" quando o Canal Pro passar a ler o CRM. Com a regra da v3 ("rascunho" ou
 * "pausado" vai para o corretor), a IA quase nunca mandava o link: no primeiro teste
 * depois da publicação (12/11/2026), 5 atendimentos, nenhum link, dois passados ao
 * corretor. Decisão do usuário (12/11/2026), entre três opções: "Manda o link" para
 * "no_ar" e "rascunho"; só o "pausado" (o anúncio parado no portal) continua com o
 * corretor.
 *
 * O resto é a v3 palavra por palavra: a entrada, a saída, a montagem da mensagem, os
 * exemplos e as regras. Só dois trechos do texto mudam, e a troca confere que cada
 * trecho existe na v3: se a v3 mudasse (não muda, é publicada), a v4 quebraria aqui, na
 * carga do módulo, e não calada no modelo.
 *
 * O banco já aceitava: `public.ia_atendente_enviar_link` manda o link de qualquer
 * anúncio não excluído e devolve `aviso: 'anuncio_nao_esta_no_ar'` quando ele não está
 * no ar (migração 20261112160000). Nada muda no banco nem no CRM.
 */
import { definirPrompt } from '../../nucleo/versionamento';
import { type BaseDoAtendenteV2, montarBaseV2 } from './v2';
import { type EntradaDoAtendenteV3, type SaidaDoAtendenteV3, atendenteImovaV3 as v3 } from './v3';

/** A regra da visita na v3 e na v4. */
const VISITA_NA_V3 = `  - Imóvel "rascunho" ou "pausado", ou mais de um imóvel para visitar: não mande o link;
    passe para o corretor (acao = passar_para_corretor), que confirma e combina.`;
const VISITA_NA_V4 = `  - Imóvel "no_ar" ou "rascunho": mande o link. "rascunho" é imóvel da carteira da Imova
    que ainda não foi publicado pelo CRM; está disponível para visita.
  - Imóvel "pausado", ou mais de um imóvel para visitar: não mande o link; passe para o
    corretor (acao = passar_para_corretor), que confirma e combina.`;

/** A regra de verdade 2 na v3 e na v4. */
const VERDADE_NA_V3 = `2. Imóvel "no_ar" está disponível. Imóvel "rascunho" ou "pausado": pode falar dele, mas
   diga que vai confirmar a disponibilidade com o corretor antes de qualquer visita.`;
const VERDADE_NA_V4 = `2. Imóvel "no_ar" ou "rascunho" está disponível. Imóvel "pausado": pode falar dele, mas
   diga que vai confirmar a disponibilidade com o corretor antes de qualquer visita.`;

/** Troca um trecho que tem de existir uma vez só. */
export function trocarUmaVez(texto: string, de: string, para: string): string {
  const vezes = texto.split(de).length - 1;
  if (vezes !== 1) {
    throw new Error(`atendente-imova@v4: o trecho da v3 aparece ${vezes} vez(es), e não uma.`);
  }
  return texto.replace(de, para);
}

const sistema = trocarUmaVez(
  trocarUmaVez(v3.sistema, VISITA_NA_V3, VISITA_NA_V4),
  VERDADE_NA_V3,
  VERDADE_NA_V4,
);

/** O bloco de sistema de uma chamada da v4: as regras, mais a base da Imova (a da v2). */
export function sistemaComBaseV4(base: BaseDoAtendenteV2): string {
  return `${sistema}\n\n${montarBaseV2(base)}`;
}

export const atendenteImovaV4 = definirPrompt<EntradaDoAtendenteV3, SaidaDoAtendenteV3>({
  id: 'atendente-imova',
  versao: 4,
  modelo: v3.modelo,
  proposito: v3.proposito,
  entrada: v3.entrada,
  saida: v3.saida,
  sistema,
  camposDeTexto: v3.camposDeTexto,
  camposDoTriade: v3.camposDoTriade,
  escala: v3.escala,
  maxTokens: v3.maxTokens,
  montarMensagem: v3.montarMensagem,
  exemplos: v3.exemplos,
});
