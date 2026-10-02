import { estadoDaJanela, JANELA_APERTADA_MIN } from '@/components/conversas/mensagens';

import { diasDeDiferenca } from './formatos';

/**
 * O que o cabeçalho da ficha do parceiro diz, calculado em funções puras.
 *
 * ===========================================================================
 * A FICHA NOVA (02/10/2026)
 * ===========================================================================
 * A ficha estava correta e diluída: a situação do parceiro em letra pequena, a
 * mesma informação em dois lugares, um cartão de contato quase todo "Não
 * informado" e o pré-cadastro ocupando metade da tela sem ter começado. Janio
 * pediu "algo mais premium, mais profissional e mais direto".
 *
 * O cabeçalho passou a responder, sozinho, as quatro perguntas de quem abre a
 * ficha antes de falar com alguém: em que pé está (a régua do funil), o que
 * vem agora (a próxima ação), quando foi a última vez (o último contato) e se
 * dá para escrever agora (o estado do WhatsApp).
 *
 * As regras ficam aqui, sem tela e sem banco, para caberem em teste: é texto
 * que decide o que alguém faz em seguida, e texto errado em silêncio é o pior
 * defeito que uma ficha pode ter.
 */

// ---------------------------------------------------------------------------
// A régua do funil
// ---------------------------------------------------------------------------

/**
 * As etapas de trabalho ficam em 1..N; nutrição, perdido e opt-out moram em 90,
 * 98 e 99 (seed de `stages`). É a mesma fronteira de `funis/etapa.tsx`.
 */
export const PRIMEIRA_POSICAO_DE_SAIDA = 90;

export type EtapaDoFunil = { id: number; nome: string; posicao: number };

export type PassoDaRegua = {
  id: number;
  nome: string;
  estado: 'feito' | 'atual' | 'a_fazer';
};

export type Regua = {
  passos: PassoDaRegua[];
  /** A etapa atual entre as de trabalho, contando de 1. `null` fora da régua. */
  posicao: number | null;
  total: number;
  /** O nome da etapa seguinte; `null` na última ou fora da régua. */
  proxima: string | null;
  /**
   * O parceiro saiu do caminho: "Nutrição / dormente", "Perdido", "Opt-out". A
   * régua fica toda apagada — não se sabe até onde ele chegou antes de sair, e
   * pintar metade dela afirmaria um progresso que ninguém mediu.
   */
  fora: string | null;
};

/** `null` quando o funil não tem etapa de trabalho nenhuma, ou a etapa não é dele. */
export function montarRegua(etapas: readonly EtapaDoFunil[], etapaAtualId: number): Regua | null {
  const atual = etapas.find((e) => e.id === etapaAtualId);
  const deTrabalho = etapas
    .filter((e) => e.posicao < PRIMEIRA_POSICAO_DE_SAIDA)
    .sort((a, b) => a.posicao - b.posicao);
  if (!atual || deTrabalho.length === 0) return null;

  const indice = deTrabalho.findIndex((e) => e.id === etapaAtualId);
  if (indice === -1) {
    return {
      passos: deTrabalho.map((e) => ({ id: e.id, nome: e.nome, estado: 'a_fazer' })),
      posicao: null,
      total: deTrabalho.length,
      proxima: null,
      fora: atual.nome,
    };
  }

  return {
    passos: deTrabalho.map((e, i) => ({
      id: e.id,
      nome: e.nome,
      estado: i < indice ? 'feito' : i === indice ? 'atual' : 'a_fazer',
    })),
    posicao: indice + 1,
    total: deTrabalho.length,
    proxima: deTrabalho[indice + 1]?.nome ?? null,
    fora: null,
  };
}

// ---------------------------------------------------------------------------
// O último contato
// ---------------------------------------------------------------------------

/**
 * "Hoje", "Ontem", "Há 5 dias". A ficha dizia "último contato há 0 dias", que é
 * a conta certa escrita do jeito que ninguém fala. Dias de calendário no fuso
 * de Natal (`diasDeDiferenca`), não blocos de 24 horas.
 */
export function ultimoContatoPorExtenso(
  iso: string | null | undefined,
  agora: Date = new Date(),
): { texto: string; numero: string | null } {
  if (!iso) return { texto: 'Sem registro', numero: null };
  const dias = Math.max(0, diasDeDiferenca(new Date(iso), agora));
  if (dias === 0) return { texto: 'Hoje', numero: null };
  if (dias === 1) return { texto: 'Ontem', numero: null };
  return { texto: `Há ${dias} dias`, numero: String(dias) };
}

/**
 * Quando foi, de fato, o último contato: o mais recente entre o do negócio
 * (`deals.last_activity_at`), a última mensagem que o parceiro mandou e o
 * último contato que a atividade da ficha mostra.
 *
 * O negócio só anota o contato quando nasce uma ATIVIDADE — a primeira resposta
 * do parceiro, uma ligação registrada. As mensagens seguintes da mesma conversa
 * não mexem nele, e a ficha dizia "Ontem" para quem tinha escrito há dez minutos.
 *
 * `conversations.last_message_at` NÃO entra, de propósito: ele sobe em toda
 * mensagem de saída inserida, inclusive a que a Meta recusa depois. Usá-lo
 * faria de um envio que falhou o "último contato" de quem não recebeu nada. A
 * saída que de fato saiu vem da atividade, que sabe qual falhou.
 */
export function ultimoContatoDaFicha(datas: readonly (string | null | undefined)[]): string | null {
  const validas = datas.filter((iso): iso is string => !!iso && !Number.isNaN(Date.parse(iso)));
  if (validas.length === 0) return null;
  return validas.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a));
}

// ---------------------------------------------------------------------------
// O estado do WhatsApp
// ---------------------------------------------------------------------------

/** O que a ficha leu da conversa mais recente do parceiro. `null` = não há conversa. */
export type ConversaDaFicha = {
  /** `conversations.window_expires_at`: quando fecha a janela de 24 h. */
  janelaExpiraEm: string | null;
  /** `conversations.unread_count`: mensagens por ler, do time inteiro. */
  porLer: number;
  /** Quem atende a conversa, pelo nome. */
  atendente: string | null;
  /** `conversations.last_inbound_at`: a última mensagem que o PARCEIRO mandou. */
  ultimaEntradaEm: string | null;
};

export type EstadoDoWhatsapp = {
  titulo: string;
  /** A linha de apoio, em pedaços: os dígitos vão no utilitário `numerico`. */
  apoio: { texto: string; numerico?: boolean }[];
};

/**
 * Dá para escrever agora, e de graça?
 *
 * A janela de 24 h decide se a resposta sai como texto livre, sem custo, ou só
 * por modelo aprovado e cobrado (R04 §2.1). Até aqui isso só aparecia dentro de
 * Conversas; quem abria a ficha antes de falar com o parceiro não sabia. A
 * ficha só LÊ o que a conversa já guarda: nada aqui fala com a Meta.
 *
 * O opt-out vem antes de tudo, como na caixa de resposta: para quem pediu para
 * sair, o estado da janela é irrelevante — nada sai.
 */
export function estadoDoWhatsapp(
  entrada: {
    naoContatar: boolean;
    conversa: ConversaDaFicha | null;
    /** A leitura da conversa deu erro: não se sabe se há conversa. */
    falhou?: boolean;
  },
  agora: Date = new Date(),
): EstadoDoWhatsapp {
  if (entrada.naoContatar) {
    return { titulo: 'Não contatar', apoio: [{ texto: 'pediu para não receber mensagens' }] };
  }
  // Erro de leitura não é "sem conversa": dizer que nada foi trocado, sem saber,
  // é a afirmação errada que faz alguém mandar um primeiro contato repetido.
  if (entrada.falhou) {
    return { titulo: 'Não carregou', apoio: [{ texto: 'recarregue para ver a janela' }] };
  }
  const conversa = entrada.conversa;
  if (!conversa) {
    return { titulo: 'Sem conversa', apoio: [{ texto: 'nenhuma mensagem trocada ainda' }] };
  }

  const porLer: EstadoDoWhatsapp['apoio'] =
    conversa.porLer > 0
      ? [
          { texto: ' · ' },
          { texto: String(conversa.porLer), numerico: true },
          { texto: ' por ler' },
        ]
      : [];

  const janela = estadoDaJanela(conversa.janelaExpiraEm, agora);
  if (janela.situacao === 'nunca') {
    // A conversa existe, mas o parceiro nunca escreveu: a janela nunca abriu.
    return { titulo: 'Sem resposta ainda', apoio: [{ texto: 'só modelo aprovado' }, ...porLer] };
  }
  if (janela.situacao === 'fechada') {
    return { titulo: 'Janela fechada', apoio: [{ texto: 'só modelo aprovado' }, ...porLer] };
  }

  if (janela.restanteMin <= JANELA_APERTADA_MIN) {
    return {
      titulo: 'Janela fechando',
      apoio: [
        { texto: 'faltam ' },
        { texto: String(janela.restanteMin), numerico: true },
        { texto: ' min' },
        ...porLer,
      ],
    };
  }
  return {
    titulo: 'Janela aberta',
    apoio: [
      { texto: 'por mais ' },
      { texto: String(Math.floor(janela.restanteMin / 60)), numerico: true },
      { texto: ' h' },
      ...porLer,
    ],
  };
}

// ---------------------------------------------------------------------------
// O que falta na ficha
// ---------------------------------------------------------------------------

/** Os campos da folha de edição que a ficha oferece completar. */
export type CampoQueFalta = 'instagram_handle' | 'website' | 'email' | 'cnpj' | 'address';

/**
 * O cartão de contato era quase todo "Não informado": cinco linhas vazias para
 * dizer que faltam cinco coisas. Agora ele mostra só o que existe, e o que falta
 * vira uma fila de botões "+ Instagram", "+ Site" — a mesma informação, sem
 * ocupar o lugar da que existe.
 *
 * Pessoa física não tem CNPJ a completar: a ficha já diz "MEI ou autônomo".
 */
export function camposQueFaltam(ficha: {
  instagram: string | null;
  site: string | null;
  email: string | null;
  cnpj: string | null;
  endereco: string | null;
  pessoaFisica: boolean;
}): { campo: CampoQueFalta; rotulo: string }[] {
  const faltam: { campo: CampoQueFalta; rotulo: string }[] = [];
  const vazio = (v: string | null) => v === null || v.trim() === '';
  if (vazio(ficha.instagram)) faltam.push({ campo: 'instagram_handle', rotulo: 'Instagram' });
  if (vazio(ficha.site)) faltam.push({ campo: 'website', rotulo: 'Site' });
  if (vazio(ficha.email)) faltam.push({ campo: 'email', rotulo: 'E-mail' });
  if (vazio(ficha.cnpj) && !ficha.pessoaFisica) faltam.push({ campo: 'cnpj', rotulo: 'CNPJ' });
  if (vazio(ficha.endereco)) faltam.push({ campo: 'address', rotulo: 'Endereço' });
  return faltam;
}

// ---------------------------------------------------------------------------
// A presença pública
// ---------------------------------------------------------------------------

/**
 * A nota e o número de avaliações que a coleta trouxe (Google). "4,8", com
 * vírgula. Nota sem avaliações, ou avaliação sem nota, mostra o que tem; sem
 * nenhuma das duas, a linha não aparece.
 */
export function presencaPublica(ficha: { nota: number | null; avaliacoes: number | null }): {
  nota: string | null;
  avaliacoes: number | null;
} | null {
  const nota =
    ficha.nota !== null && Number.isFinite(ficha.nota) && ficha.nota > 0
      ? ficha.nota.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
      : null;
  const avaliacoes = ficha.avaliacoes !== null && ficha.avaliacoes > 0 ? ficha.avaliacoes : null;
  if (nota === null && avaliacoes === null) return null;
  return { nota, avaliacoes };
}
