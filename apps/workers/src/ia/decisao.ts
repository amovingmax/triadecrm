/**
 * O aviso de decisão (Imova, 25/11/2026), a parte do worker que vem antes do banco.
 *
 * A IA que atende (`atendente-imova@v10`) devolve `decisao` quando a resposta é da Imova:
 * proposta de valor ou pergunta que só os admins respondem. Antes de a fala sair e de a
 * decisão ir ao banco (`public.ia_atendente_pedir_decisao`), três conferências:
 *
 * - A FRASE: a decisão do dono é que a IA nunca diga que leva o caso "à equipe". Se a
 *   mensagem fala em equipe ou corretor (ou veio vazia), sai a frase segura
 *   (`FRASE_DA_DECISAO`).
 * - O VALOR: o botão diz "Aceitar os R$ 4 milhões", então o valor tem de ser o que o
 *   cliente escreveu. Valor que não aparece nas falas dele vira pergunta, sem sugestão (o
 *   admin escreve a resposta).
 * - AS SUGESTÕES: cada resposta sugerida passa pela rede de segurança das falas da decisão
 *   (`motivoParaNaoMandarDaDecisao`); a que não passa sai da lista.
 */
import {
  FRASE_DA_DECISAO,
  MAX_SUGESTOES,
  type DecisaoDoAtendente,
  type TipoDeDecisao,
  motivoParaNaoMandarDaDecisao,
} from '@komune/prompts';

export interface DecisaoPreparada {
  readonly tipo: TipoDeDecisao;
  readonly imovelCodigo: string | null;
  readonly valorProposto: number | null;
  readonly pergunta: string;
  readonly sugestoes: readonly { readonly rotulo: string; readonly resposta: string }[];
  /** O que a conferência mudou, para o log (sem texto do cliente). */
  readonly ajustes: readonly string[];
}

const MULTIPLICADOR: Readonly<Record<string, number>> = {
  milhao: 1_000_000,
  milhoes: 1_000_000,
  mi: 1_000_000,
  m: 1_000_000,
  kk: 1_000_000,
  mil: 1_000,
  k: 1_000,
};

const semAcento = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '');

/**
 * Os valores em reais que um texto diz: "4 milhões", "3,8 mi", "4M", "4kk", "450 mil",
 * "450k", "R$ 450.000", "450.000,00", "450000". Número pequeno solto (um "2" de "2
 * quartos") não conta: só com multiplicador ou a partir de 1.000.
 */
export function valoresDoTexto(texto: string): number[] {
  const t = semAcento(texto.toLowerCase());
  const valores: number[] = [];
  const padrao =
    /(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d+)?)\s*(milhoes|milhao|mil|mi|kk|k|m)?(?![a-z²])/g;
  for (const achado of t.matchAll(padrao)) {
    const numero = achado[1] ?? '';
    const unidade = achado[2];
    let valor: number;
    if (unidade !== undefined) {
      // "3,8 mi" e "3.8 mi": a vírgula ou o ponto são decimais.
      valor =
        Number(numero.replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.')) *
        (MULTIPLICADOR[unidade] ?? 1);
    } else if (/^\d{1,3}(?:\.\d{3})+/.test(numero)) {
      // "450.000" e "4.000.000,00": ponto de milhar, vírgula de centavos.
      valor = Number(numero.replace(/\./g, '').replace(/,\d{1,2}$/, ''));
    } else {
      valor = Number(numero.replace(',', '.'));
    }
    if (Number.isFinite(valor) && valor >= 1_000) valores.push(Math.round(valor));
  }
  return valores;
}

/** A fala que sai antes da decisão: a da IA, ou a frase segura quando ela fala em equipe. */
export function falaDaDecisao(
  texto: string,
  tipo: TipoDeDecisao,
): { texto: string; trocada: boolean } {
  const limpo = texto.trim();
  if (limpo === '' || /(?<!\p{L})(?:equipe|corretor(?:a|es|as)?)(?!\p{L})/iu.test(limpo)) {
    return { texto: FRASE_DA_DECISAO[tipo], trocada: true };
  }
  return { texto: limpo, trocada: false };
}

/**
 * Confere a decisão que o modelo devolveu. `limpar` reidrata e limpa um texto do modelo;
 * `falasDoCliente`, as mensagens dele na conversa (as últimas); `contexto`, tudo o que foi
 * dito na conversa (para os números das sugestões).
 */
export function prepararDecisao(
  decisao: DecisaoDoAtendente,
  opcoes: {
    readonly limpar: (texto: string) => string;
    readonly falasDoCliente: readonly string[];
    readonly contexto: readonly string[];
  },
): DecisaoPreparada {
  const ajustes: string[] = [];
  const ultimaDoCliente = [...opcoes.falasDoCliente].reverse().find((f) => f.trim() !== '') ?? '';
  let pergunta = opcoes.limpar(decisao.pergunta).slice(0, 300).trim();
  if (pergunta === '') {
    pergunta = ultimaDoCliente.slice(0, 300).trim() || 'O cliente quer uma resposta da Imova.';
    ajustes.push('pergunta_da_conversa');
  }

  let tipo: TipoDeDecisao = decisao.tipo;
  let valorProposto: number | null = null;
  if (tipo === 'proposta') {
    const ditos = new Set(opcoes.falasDoCliente.slice(-6).flatMap(valoresDoTexto));
    const valor = decisao.valorProposto;
    if (valor !== null && valor > 0 && ditos.has(valor)) {
      valorProposto = valor;
    } else {
      // O botão diria um valor que o cliente não escreveu: vira pergunta, e o admin escreve.
      tipo = 'pergunta';
      ajustes.push('valor_nao_conferido');
    }
  }

  const sugestoes: { rotulo: string; resposta: string }[] = [];
  if (tipo === 'pergunta' && decisao.tipo === 'pergunta') {
    for (const s of decisao.sugestoes.slice(0, MAX_SUGESTOES)) {
      const rotulo = opcoes.limpar(s.rotulo).slice(0, 80).trim();
      const resposta = opcoes.limpar(s.resposta).trim();
      if (rotulo === '' || motivoParaNaoMandarDaDecisao(resposta, opcoes.contexto) !== null) {
        ajustes.push('sugestao_descartada');
        continue;
      }
      if (sugestoes.some((x) => x.resposta.toLowerCase() === resposta.toLowerCase())) continue;
      sugestoes.push({ rotulo, resposta });
    }
  }

  const codigo = decisao.imovelCodigo?.trim() ?? '';
  return {
    tipo,
    imovelCodigo: codigo === '' ? null : codigo.slice(0, 60),
    valorProposto,
    pergunta,
    sugestoes,
    ajustes,
  };
}
