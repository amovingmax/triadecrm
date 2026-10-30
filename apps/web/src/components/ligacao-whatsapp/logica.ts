/**
 * A regra da tela da ligação pelo WhatsApp, sem React nem rede.
 *
 * Quem barra de verdade são as funções do banco (`wa_permissao_pedir`,
 * `wa_chamada_abrir`). Aqui só se decide o que o botão diz, para a pessoa não clicar em
 * algo que já se sabe que vai ser recusado.
 */

export type PermissaoDoCliente = 'sem_permissao' | 'pedida' | 'aceita' | 'recusada' | 'venceu';

export type EstadoNaConversa =
  | { ligada: false }
  | {
      ligada: true;
      permissao: PermissaoDoCliente;
      permanente: boolean;
      expira_em: string | null;
      nao_atendidas_seguidas: number;
      proximo_pedido_em: string | null;
      janela_aberta: boolean;
      suprimida: boolean;
      horario: { aberta: boolean };
      ligacao_viva: string | null;
      ultima: {
        direcao: 'recebida' | 'feita';
        estado: EstadoDaChamada;
        tocou_em: string;
        duracao_seg: number | null;
        por: string | null;
      } | null;
    };

export type EstadoDaChamada =
  | 'discando'
  | 'tocando'
  | 'atendendo'
  | 'em_curso'
  | 'encerrada'
  | 'perdida'
  | 'recusada'
  | 'falhou';

export const ESTADOS_VIVOS: readonly EstadoDaChamada[] = ['discando', 'tocando', 'atendendo', 'em_curso'];

export function chamadaViva(estado: EstadoDaChamada): boolean {
  return ESTADOS_VIVOS.includes(estado);
}

/** A Meta dá de 30 a 60 s para atender; passado isso, o toque não vale mais. */
export const TOQUE_VALE_MS = 65_000;

export function aindaTocando(tocouEm: string, agora: Date): boolean {
  return agora.getTime() - new Date(tocouEm).getTime() < TOQUE_VALE_MS;
}

export type BotaoDaConversa =
  | { tipo: 'nenhum' }
  | { tipo: 'pedir'; desligado: boolean; nota: string | null }
  | { tipo: 'ligar'; desligado: boolean; nota: string | null };

const hora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Fortaleza',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** "06/11 10:21", no fuso de Fortaleza. */
export function dataCurta(iso: string): string {
  return hora.format(new Date(iso)).replace(',', '');
}

/** O que o botão da conversa faz agora. `ocupado`: esta pessoa já está numa ligação. */
export function botaoDaConversa(e: EstadoNaConversa, ocupado: boolean): BotaoDaConversa {
  if (!e.ligada) return { tipo: 'nenhum' };
  if (e.suprimida) return { tipo: 'nenhum' };

  if (e.permissao === 'aceita') {
    if (ocupado || e.ligacao_viva !== null) {
      return { tipo: 'ligar', desligado: true, nota: 'Já há uma ligação em andamento.' };
    }
    if (!e.horario.aberta) {
      return { tipo: 'ligar', desligado: true, nota: 'Fora do horário de ligar.' };
    }
    return { tipo: 'ligar', desligado: false, nota: null };
  }

  if (e.proximo_pedido_em !== null) {
    return {
      tipo: 'pedir',
      desligado: true,
      nota: `A Meta só deixa pedir de novo a partir de ${dataCurta(e.proximo_pedido_em)}.`,
    };
  }
  if (!e.janela_aberta) {
    return {
      tipo: 'pedir',
      desligado: true,
      nota: 'Só dá para pedir dentro das 24 h depois da última mensagem do cliente.',
    };
  }
  return { tipo: 'pedir', desligado: false, nota: null };
}

/** A frase da faixa da conversa, ou null quando não há nada a dizer. */
export function fraseDaFaixa(e: EstadoNaConversa): string | null {
  if (!e.ligada || e.suprimida) return null;
  if (e.permissao === 'aceita' && e.nao_atendidas_seguidas >= 2) {
    return `${e.nao_atendidas_seguidas} ligações seguidas sem resposta. Com 4, a Meta tira a permissão: mande uma mensagem antes de tentar de novo.`;
  }
  if (e.permissao === 'aceita') {
    return e.permanente || e.expira_em === null
      ? 'O cliente permitiu ligações pelo WhatsApp, sem prazo.'
      : `O cliente permitiu ligações pelo WhatsApp até ${dataCurta(e.expira_em)}.`;
  }
  if (e.permissao === 'pedida') return 'Pedido de ligação enviado. Falta o cliente responder.';
  if (e.permissao === 'recusada') return 'O cliente recusou ligações pelo WhatsApp. Continue por mensagem.';
  if (e.permissao === 'venceu') return 'A permissão para ligar venceu. Peça de novo para ligar.';
  if (e.ultima?.estado === 'perdida' && e.ultima.direcao === 'recebida') {
    return `O cliente ligou em ${dataCurta(e.ultima.tocou_em)} e ninguém atendeu.`;
  }
  return null;
}

export const ROTULO_DA_CHAMADA: Record<EstadoDaChamada, string> = {
  discando: 'Chamando no WhatsApp...',
  tocando: 'Tocando no WhatsApp do cliente...',
  atendendo: 'Conectando...',
  em_curso: 'Em ligação',
  encerrada: 'Ligação encerrada',
  perdida: 'Sem resposta',
  recusada: 'O cliente recusou',
  falhou: 'A ligação não completou',
};

/** O que o banco e a Meta dizem, em frase para a tela. */
const FRASES: Record<string, string> = {
  sem_permissao: 'Seu perfil não faz ligações pelo CRM.',
  ligacao_desligada: 'A ligação pelo WhatsApp está desligada.',
  conversa_desconhecida: 'Esta conversa não existe mais.',
  contato_suprimido: 'Este cliente pediu para não ser contatado.',
  conversa_bloqueada: 'Esta conversa está bloqueada.',
  fora_da_janela: 'Só dá para pedir dentro das 24 h depois da última mensagem do cliente.',
  ja_permitida: 'O cliente já permitiu ligações, sem prazo.',
  limite_de_pedidos: 'A Meta só deixa pedir uma vez por dia e duas por semana.',
  texto_invalido: 'Escreva a mensagem do pedido, com até 1.024 letras.',
  fora_do_horario: 'Fora do horário de ligar.',
  sem_permissao_do_cliente: 'O cliente ainda não permitiu ligações. Peça a permissão na conversa.',
  ligacao_em_curso: 'Já há uma ligação em andamento nesta conversa.',
  voce_ja_esta_em_ligacao: 'Você já está em outra ligação.',
  ja_atendida: 'Outra pessoa já atendeu esta ligação.',
};

export function fraseDoMotivo(motivo: string | undefined): string {
  return (motivo ? FRASES[motivo] : undefined) ?? 'Não deu certo agora. Tente de novo.';
}

/** O microfone recusado ou ausente, como o navegador diz. */
export function fraseDoMicrofone(nome: string | undefined): string {
  if (nome === 'NotAllowedError' || nome === 'SecurityError') {
    return 'O navegador não liberou o microfone. Libere nas permissões do site e tente de novo.';
  }
  if (nome === 'NotFoundError') return 'Não encontrei um microfone neste computador.';
  if (nome === 'NotReadableError') return 'Outro programa está usando o microfone.';
  return 'Não consegui abrir o microfone.';
}

/**
 * O pedido que já vem escrito. Só o texto é nosso: o botão e as opções são do WhatsApp,
 * por isso ele não cita o nome de nenhuma opção. A pessoa pode editar antes de enviar.
 */
export function textoPadraoDoPedido(empresa: string): string {
  return `Posso te ligar pelo WhatsApp? Aqui é da ${empresa}. Se permitir sem prazo, não precisamos pedir de novo, e você pode mudar isso quando quiser.`;
}
