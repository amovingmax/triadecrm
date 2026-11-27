/**
 * O ensaio da nota da resposta contra o modelo (Imova, 27/11/2026):
 * `workers ai --ensaio=nota`.
 *
 * Doze respostas de admins no aviso de decisão (as três reais de 26 e 27/11 e nove
 * parecidas com as que chegam: visita combinada, "vou consultar", negociação, permuta,
 * IPTU, documentação do banco, pergunta sem imóvel, resposta incerta e o nome do cliente na
 * resposta) passam pelo `nota-da-resposta@v1` de verdade (Haiku 5.5) e pela mesma rede do
 * worker (`motivoParaNaoSugerirANota`). Para cada uma confere se vira nota quando deve, o
 * alcance e o fato. Não grava sugestão nem caderno: grava só `ai_runs`, sem conversa.
 */
import {
  type EntradaDaNotaDaResposta,
  type SaidaDaNotaDaResposta,
  motivoParaNaoSugerirANota,
  notaDaRespostaV1,
} from '@komune/prompts';

import { type ContextoDaIa, executar } from './execucao';

type Imovel = NonNullable<EntradaDaNotaDaResposta['imovel']>;

const SALA: Imovel = {
  frase: 'a sala em Ponta Negra',
  titulo: 'Sala comercial no Brisa Mall',
  tipo: 'sala_comercial',
  area: 19,
  bairro: 'Ponta Negra',
  cidade: 'Natal',
  negocio: 'aluguel',
};
const TABATINGA: Imovel = {
  frase: 'o terreno em Camurupim',
  titulo: 'Terreno frente-mar em Tabatinga',
  tipo: 'terreno',
  area: 810,
  bairro: 'Camurupim',
  cidade: 'Nísia Floresta',
  negocio: 'venda',
};
const PIPA: Imovel = {
  frase: 'o terreno em Pipa',
  titulo: 'Terreno de 1.338 m² vizinho ao Parque Mata da Pipa',
  tipo: 'terreno',
  area: 1338,
  bairro: 'Pipa',
  cidade: 'Tibau do Sul',
  negocio: 'venda',
};
const POTENGI: Imovel = {
  frase: 'a casa em Potengi',
  titulo: 'Casa de 3 quartos no Potengi',
  tipo: 'casa',
  area: 323,
  bairro: 'Potengi',
  cidade: 'Natal',
  negocio: 'venda',
};

interface CasoDaNota {
  readonly id: string;
  readonly descricao: string;
  readonly imovel: Imovel | null;
  readonly temFicha: boolean;
  readonly pergunta: string;
  readonly resposta: string;
  readonly vira: boolean;
  readonly alcance?: 'imovel' | 'geral';
  /** O fato que a nota do alcance esperado tem de ter. */
  readonly fato?: RegExp;
  /** O que nenhuma nota pode ter. */
  readonly nunca?: RegExp;
  /** As duas notas (este imóvel e todos), para o cartão dar a escolha. */
  readonly ambas?: boolean;
}

const CASOS: readonly CasoDaNota[] = [
  {
    id: 'A01',
    descricao: 'energia da sala (real, 27/11)',
    imovel: SALA,
    temFicha: false,
    pergunta: 'energia individualizada?',
    resposta:
      'Sim, a sala tem energia individualizada, ou seja, o consumo é medido e pago separadamente, à parte do condomínio.',
    vira: true,
    alcance: 'imovel',
    fato: /individualizad/i,
  },
  {
    id: 'A02',
    descricao: 'FGTS só deste terreno (real, 26/11 13h24)',
    imovel: TABATINGA,
    temFicha: true,
    pergunta: 'Dá pra usar o FGTS?',
    resposta:
      'Para este terreno não é possível usar o FGTS. Podemos conversar sobre outras formas de pagamento, se você quiser.',
    vira: true,
    alcance: 'imovel',
    fato: /FGTS/,
  },
  {
    id: 'A03',
    descricao: 'FGTS de terreno em geral (real, 26/11 14h14)',
    imovel: TABATINGA,
    temFicha: true,
    pergunta: 'Aceita FGTS?',
    resposta:
      'Para terreno, não conseguimos utilizar o FGTS na compra. Se quiser, posso verificar outras formas de pagamento para você.',
    vira: true,
    alcance: 'geral',
    fato: /FGTS/,
    ambas: true,
  },
  {
    id: 'A04',
    descricao: 'visita combinada com o cliente',
    imovel: POTENGI,
    temFicha: true,
    pergunta: 'Posso visitar amanhã de manhã?',
    resposta: 'Pode sim, amanhã às 10h.',
    vira: false,
  },
  {
    id: 'A05',
    descricao: '"vou consultar o proprietário"',
    imovel: PIPA,
    temFicha: true,
    pergunta: 'O proprietário divide o terreno em dois lotes?',
    resposta: 'Vou consultar o proprietário e te retorno.',
    vira: false,
  },
  {
    id: 'A06',
    descricao: 'negociação de preço',
    imovel: PIPA,
    temFicha: true,
    pergunta: 'Faz por 300 mil à vista?',
    resposta: 'Não, o mínimo que o proprietário aceita é 320 mil.',
    vira: false,
  },
  {
    id: 'A07',
    descricao: 'permuta aceita pelo proprietário',
    imovel: PIPA,
    temFicha: true,
    pergunta: 'Aceita permuta?',
    resposta: 'O proprietário aceita permuta por apartamento em Natal.',
    vira: true,
    alcance: 'imovel',
    fato: /permuta/i,
  },
  {
    id: 'A08',
    descricao: 'IPTU com valor',
    imovel: POTENGI,
    temFicha: true,
    pergunta: 'Quanto é o IPTU da casa?',
    resposta: 'O IPTU é R$ 1.200 por ano.',
    vira: true,
    alcance: 'imovel',
    fato: /1\.?200/,
  },
  {
    id: 'A09',
    descricao: 'documentação do banco (regra da Imova)',
    imovel: PIPA,
    temFicha: true,
    pergunta: 'Vou usar financiamento. Vocês ajudam com a documentação do banco?',
    resposta: 'ajudamos sim, com toda a parte do banco',
    vira: true,
    alcance: 'geral',
    fato: /banco/i,
  },
  {
    id: 'A10',
    descricao: 'pergunta sem imóvel',
    imovel: null,
    temFicha: false,
    pergunta: 'Vocês trabalham com aluguel por temporada?',
    resposta: 'Não, a Imova não trabalha com aluguel por temporada.',
    vira: true,
    alcance: 'geral',
    fato: /temporada/i,
  },
  {
    id: 'A11',
    descricao: 'resposta incerta',
    imovel: TABATINGA,
    temFicha: true,
    pergunta: 'Tem escritura?',
    resposta: 'Acho que sim, vou confirmar com o dono.',
    vira: false,
  },
  {
    id: 'A12',
    descricao: 'o nome do cliente na resposta não vai para a nota',
    imovel: POTENGI,
    temFicha: true,
    pergunta: 'Aceita animal de estimação?',
    resposta: 'Marcos, sim, o proprietário aceita animal de estimação.',
    vira: true,
    alcance: 'imovel',
    fato: /anima/i,
    nunca: /Marcos|\[\[/,
  },
];

export interface RespostaDoEnsaioDaNota {
  readonly caso: string;
  readonly descricao: string;
  readonly certo: boolean;
  readonly falha: string | null;
  readonly saida: SaidaDaNotaDaResposta | null;
  readonly erro?: string;
}

export interface ResultadoDoEnsaioDaNota {
  readonly promptVersion: string;
  readonly respostas: readonly RespostaDoEnsaioDaNota[];
  readonly custoUsd: number;
}

/** O que falhou no caso, pela régua e pela rede do worker; null quando acertou. */
export function falhaDaNota(caso: CasoDaNota, s: SaidaDaNotaDaResposta): string | null {
  if (s.viraNota !== caso.vira) {
    return caso.vira ? `não virou nota (${s.porque})` : `virou nota: "${s.textoDoImovel ?? s.textoGeral}"`;
  }
  if (!caso.vira) return null;
  const contexto = [caso.pergunta, caso.resposta, caso.imovel?.titulo, caso.imovel?.frase, caso.imovel?.area === undefined || caso.imovel?.area === null ? null : String(caso.imovel.area)];
  const passa = (t: string | null) => t !== null && motivoParaNaoSugerirANota(t, contexto) === null;
  const imovel = caso.imovel === null ? null : s.textoDoImovel;
  if (!passa(imovel) && !passa(s.textoGeral)) {
    const t = imovel ?? s.textoGeral ?? '';
    return `a rede segurou as notas (${motivoParaNaoSugerirANota(t, contexto) ?? 'vazia'})`;
  }
  const alcance = caso.imovel === null ? 'geral' : s.alcance;
  if (caso.alcance !== undefined && alcance !== caso.alcance) return `alcance ${alcance} (esperado ${caso.alcance})`;
  const daNota = caso.alcance === 'geral' ? s.textoGeral : (imovel ?? s.textoGeral);
  if (caso.fato !== undefined && !(daNota !== null && caso.fato.test(daNota))) {
    return `a nota não tem o fato: "${daNota ?? ''}"`;
  }
  if (caso.nunca !== undefined && [s.textoDoImovel, s.textoGeral].some((t) => t !== null && caso.nunca!.test(t))) {
    return 'a nota tem o que não pode';
  }
  if (caso.ambas === true && (s.textoDoImovel === null || s.textoGeral === null)) {
    return 'sem as duas notas (este imóvel e todos)';
  }
  if (caso.imovel !== null && !caso.temFicha && (s.tituloDaFicha ?? '').trim() === '') {
    return 'sem o nome da ficha nova';
  }
  return null;
}

export async function ensaiarNota(
  contexto: ContextoDaIa,
  opcoes: { repeticoes: number; tetoUsd: number },
): Promise<ResultadoDoEnsaioDaNota> {
  const respostas: RespostaDoEnsaioDaNota[] = [];
  let custo = 0;
  for (let rodada = 0; rodada < opcoes.repeticoes; rodada += 1) {
    for (const caso of CASOS) {
      if (custo >= opcoes.tetoUsd) break;
      const entrada: EntradaDaNotaDaResposta = {
        leadId: `ensaio-${caso.id}`,
        imovel: caso.imovel,
        temFicha: caso.temFicha,
        pergunta: caso.pergunta,
        respostaDaImova: caso.resposta,
      };
      try {
        const r = await executar<EntradaDaNotaDaResposta, SaidaDaNotaDaResposta>(
          contexto,
          notaDaRespostaV1,
          entrada,
          { leadId: entrada.leadId, nome: caso.id === 'A12' ? 'Marcos Lima' : null, empresa: null },
          {},
        );
        custo += r.custoUsd ?? 0;
        const falha = falhaDaNota(caso, r.saida);
        respostas.push({ caso: caso.id, descricao: caso.descricao, certo: falha === null, falha, saida: r.saida });
      } catch (erro) {
        respostas.push({
          caso: caso.id,
          descricao: caso.descricao,
          certo: false,
          falha: 'erro',
          saida: null,
          erro: erro instanceof Error ? erro.message : String(erro),
        });
      }
    }
  }
  return {
    promptVersion: `${notaDaRespostaV1.id}@v${notaDaRespostaV1.versao}`,
    respostas,
    custoUsd: Math.round(custo * 10_000) / 10_000,
  };
}

export function relatorioDaNota(r: ResultadoDoEnsaioDaNota): string {
  const certas = r.respostas.filter((x) => x.certo).length;
  const linhas = [
    `ENSAIO DA NOTA — ${r.promptVersion}: ${certas}/${r.respostas.length} certas, US$ ${r.custoUsd}`,
    '',
  ];
  for (const x of r.respostas) {
    const s = x.saida;
    linhas.push(`${x.certo ? 'OK ' : 'ERR'} ${x.caso} ${x.descricao}${x.falha ? ` — ${x.falha}` : ''}`);
    if (s !== null) {
      linhas.push(`    vira=${s.viraNota} alcance=${s.alcance} porque="${s.porque}"`);
      if (s.textoDoImovel) linhas.push(`    imóvel: ${s.textoDoImovel}`);
      if (s.textoGeral) linhas.push(`    geral:  ${s.textoGeral}`);
      if (s.tituloDaFicha) linhas.push(`    ficha:  ${s.tituloDaFicha}`);
    }
    if (x.erro) linhas.push(`    erro: ${x.erro.slice(0, 200)}`);
  }
  return `${linhas.join('\n')}\n`;
}
