import { TIMEZONE } from '@komune/schema';

import { FORMATOS_REUNIAO } from '@/components/registro/tipos';

import type { ResultadoTecnico, VarianteRoteiro } from './tipos';

/**
 * A mensagem de WhatsApp que a ligação pede depois de gravada.
 *
 * O script do Rafael termina sempre num WhatsApp: a confirmação de quem marcou, o
 * resumo de quem pediu "me manda por lá", e o "tentei te ligar" de quem não atendeu.
 * O recibo oferece o botão; esta função decide QUAL modelo e com que valores, a partir
 * do que a ligação gravou — nunca de um palpite da tela.
 *
 * Os modelos são os da migração 20260915100000 (e o `GEN-FUP-LIG-V1`, que já existia).
 * `nome`, `empresa`, `origem` e `atendente` a caixa de envio preenche sozinha.
 */
export type MensagemDeDepois = {
  codigo: string;
  /** O texto do botão no recibo. */
  rotulo: string;
  valores: Record<string, string>;
};

export const MODELO_CONFIRMACAO = 'GEN-LIG-CONFIRMA';
export const MODELO_RESUMO_FORNECEDOR = 'GEN-LIG-RESUMO-FOR';
export const MODELO_RESUMO_PRODUTOR = 'GEN-LIG-RESUMO-PRO';
export const MODELO_TENTEI_LIGAR = 'GEN-FUP-LIG-V1';

/** Os fins do roteiro em que a pessoa pediu o material pelo WhatsApp. */
const FINS_COM_MATERIAL = ['fim_material', 'fim_agora_nao_material'];

const DATA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIMEZONE,
  day: '2-digit',
  month: '2-digit',
});
const HORA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
});

export function mensagemDeDepois(ligacao: {
  variante: VarianteRoteiro;
  resultado: ResultadoTecnico;
  desfechoSlug: string | null;
  caminho: readonly string[];
  reuniaoEm: string | null;
  reuniaoFormato: string | null;
}): MensagemDeDepois | null {
  const { variante, resultado, desfechoSlug, caminho, reuniaoEm, reuniaoFormato } = ligacao;

  if (resultado === 'nao_atendeu' || resultado === 'caixa_postal') {
    // O "tentei te ligar" fala a proposta do fornecedor ("você paga uma taxa quando
    // fecha"): para produtor ele diria o contrário do que é verdade, e para parceiro
    // da ativação seria pitch para quem já está dentro.
    return variante === 'fornecedor'
      ? { codigo: MODELO_TENTEI_LIGAR, rotulo: 'Mandar "tentei te ligar" no WhatsApp', valores: {} }
      : null;
  }
  if (resultado !== 'atendida_humano') return null;

  if (desfechoSlug === 'lig_reuniao_marcada' && reuniaoEm) {
    const quando = new Date(reuniaoEm);
    if (Number.isNaN(quando.getTime())) return null;
    return {
      codigo: MODELO_CONFIRMACAO,
      rotulo: 'Mandar a confirmação no WhatsApp',
      valores: {
        data: DATA.format(quando),
        hora: horaCurta(quando),
        formato: reuniaoFormato ? (FORMATOS_REUNIAO[reuniaoFormato] ?? reuniaoFormato) : '',
      },
    };
  }

  if (variante !== 'ativacao' && caminho.some((id) => FINS_COM_MATERIAL.includes(id))) {
    return {
      codigo: variante === 'produtor' ? MODELO_RESUMO_PRODUTOR : MODELO_RESUMO_FORNECEDOR,
      rotulo: 'Mandar o resumo no WhatsApp',
      valores: {},
    };
  }
  return null;
}

/** "10h" ou "14h30": como a hora aparece na mensagem. */
function horaCurta(quando: Date): string {
  const [h = '00', m = '00'] = HORA.format(quando).split(':');
  return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`;
}
