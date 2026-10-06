/**
 * O que a ligação pelo navegador DECIDE, sem React, sem rede e sem SDK.
 *
 * É o mesmo corte de `chamada-maquina.ts`: o que dá para testar sem um navegador mora
 * aqui. O adaptador (`voz-softphone.ts`) fala com o SDK do provedor, o provedor de
 * contexto (`voz-provedor.tsx`) guarda o estado, e as perguntas que os dois fazem —
 * a linha está viva? o que digo quando deu errado? qual resultado sugiro? — têm
 * resposta aqui.
 */
import { type ResultadoTecnico } from './tipos';

// ---------------------------------------------------------------------------
// 1. O estado da linha — espelho de `app.voice_call_status`
// ---------------------------------------------------------------------------

export const ESTADOS_DA_LINHA = [
  'preparando',
  'chamando',
  'tocando',
  'em_ligacao',
  'finalizada',
  'nao_atendida',
  'ocupado',
  'falha',
  'cancelada',
] as const;

export type EstadoDaLinha = (typeof ESTADOS_DA_LINHA)[number];

export const ROTULO_DA_LINHA: Record<EstadoDaLinha, string> = {
  preparando: 'Preparando chamada',
  chamando: 'Chamando',
  tocando: 'Tocando',
  em_ligacao: 'Em ligação',
  finalizada: 'Finalizada',
  nao_atendida: 'Não atendida',
  ocupado: 'Ocupado',
  falha: 'Falha',
  cancelada: 'Cancelada',
};

const VIVOS: readonly EstadoDaLinha[] = ['preparando', 'chamando', 'tocando', 'em_ligacao'];

/** Enquanto a linha está viva, ninguém começa outra ligação. */
export function linhaViva(estado: EstadoDaLinha): boolean {
  return VIVOS.includes(estado);
}

export function ehEstadoDaLinha(valor: unknown): valor is EstadoDaLinha {
  return typeof valor === 'string' && (ESTADOS_DA_LINHA as readonly string[]).includes(valor);
}

/**
 * O estado que a tela mostra, juntando o que o banco sabe com o que o navegador sabe.
 *
 * O banco é quem sabe se TOCOU e se ATENDEU (quem conta é o provedor, pelo aviso de
 * estado). O navegador é quem sabe primeiro que ACABOU. Então: o estado nunca volta —
 * uma leitura atrasada do banco não desfaz o que a tela já mostrou — e, depois que o
 * navegador desligou, só um estado final do banco substitui o da tela.
 */
export function juntarEstados(naTela: EstadoDaLinha, doBanco: EstadoDaLinha): EstadoDaLinha {
  if (!linhaViva(doBanco)) return doBanco;
  if (!linhaViva(naTela)) return naTela;
  return ESTADOS_DA_LINHA.indexOf(doBanco) > ESTADOS_DA_LINHA.indexOf(naTela) ? doBanco : naTela;
}

/**
 * Como a tela dá a chamada por encerrada quando o navegador desliga antes de o banco
 * saber do fim. Mesma regra de `public.voz_encerrar_ligacao`.
 */
export function estadoAoDesligar(naTela: EstadoDaLinha, falhou: boolean): EstadoDaLinha {
  if (!linhaViva(naTela)) return naTela;
  if (falhou) return 'falha';
  return naTela === 'em_ligacao' ? 'finalizada' : 'cancelada';
}

// ---------------------------------------------------------------------------
// 2. Da linha para a tabulação
// ---------------------------------------------------------------------------

/**
 * O resultado técnico que a linha SUGERE. É sugestão: "finalizada" quer dizer que
 * alguém ou alguma coisa atendeu, e caixa postal também atende — quem sabe a
 * diferença é quem ouviu. `falha` não sugere nada: pode ser número que não existe ou
 * a internet de quem ligou, e adivinhar seria marcar número bom como errado.
 */
export function resultadoSugerido(estado: EstadoDaLinha): ResultadoTecnico | null {
  switch (estado) {
    case 'finalizada':
      return 'atendida_humano';
    case 'nao_atendida':
    case 'cancelada':
      return 'nao_atendeu';
    case 'ocupado':
      return 'ocupado';
    default:
      return null;
  }
}

/** Houve conversa possível? Só então os desfechos comerciais fazem sentido. */
export function linhaFoiAtendida(estado: EstadoDaLinha, atendidaEm: string | null): boolean {
  return estado === 'em_ligacao' || estado === 'finalizada' || atendidaEm !== null;
}

// ---------------------------------------------------------------------------
// 3. O relógio
// ---------------------------------------------------------------------------

/** `00:03:27`. Relógio de parede, como em `chamada-maquina.ts`: aba que dormiu não atrasa. */
export function relogioDaLigacao(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  const doisDigitos = (n: number) => String(n).padStart(2, '0');
  return `${doisDigitos(Math.floor(s / 3600))}:${doisDigitos(Math.floor((s % 3600) / 60))}:${doisDigitos(s % 60)}`;
}

/** Segundos de conversa: do atendimento até agora (ou até o fim, quando já acabou). */
export function segundosDeConversa(
  atendidaEm: string | null,
  encerradaEm: string | null,
  agora: Date,
): number {
  if (!atendidaEm) return 0;
  const inicio = Date.parse(atendidaEm);
  const fim = encerradaEm ? Date.parse(encerradaEm) : agora.getTime();
  if (!Number.isFinite(inicio) || !Number.isFinite(fim)) return 0;
  return Math.max(0, Math.round((fim - inicio) / 1000));
}

/** `04m 18s`, para o histórico. `null` quando não houve conversa. */
export function duracaoLegivel(segundos: number | null): string | null {
  if (!segundos || segundos <= 0) return null;
  const doisDigitos = (n: number) => String(n).padStart(2, '0');
  return `${doisDigitos(Math.floor(segundos / 60))}m ${doisDigitos(segundos % 60)}s`;
}

// ---------------------------------------------------------------------------
// 4. O que dizer quando deu errado
// ---------------------------------------------------------------------------

/**
 * Regra da casa: nenhum código técnico chega à tela. O código vai para
 * `voice_calls.error_code` (diagnóstico); a pessoa lê uma frase que diz o que fazer.
 */
export type FalhaDeVoz =
  | 'microfone_bloqueado'
  | 'sem_microfone'
  | 'numero_invalido'
  | 'sem_conexao'
  | 'credencial'
  | 'falha_na_telefonia';

export const FRASE_DA_FALHA: Record<FalhaDeVoz, string> = {
  microfone_bloqueado:
    'Não foi possível acessar seu microfone. Autorize o acesso nas configurações do navegador.',
  sem_microfone: 'Nenhum microfone encontrado. Conecte um fone ou microfone e tente de novo.',
  numero_invalido: 'O telefone cadastrado não parece ser válido. Confira o número antes de ligar.',
  sem_conexao: 'A conexão com o serviço de telefonia foi interrompida.',
  credencial: 'Não deu para preparar o telefone. Recarregue a página e tente de novo.',
  falha_na_telefonia: 'Não foi possível completar esta ligação. Tente novamente.',
};

/** O que `voz_abrir_ligacao` recusa, em frase. */
export const FRASE_DA_RECUSA: Record<string, string> = {
  sem_permissao: 'Seu perfil não faz ligações pelo CRM.',
  telefonia_desligada:
    'A ligação pelo navegador está desligada. Use o telefone e registre o contato.',
  ja_em_ligacao: 'Você já tem uma ligação em andamento. Encerre-a antes de começar outra.',
  chamada_ja_encerrada: 'Esta chamada já foi encerrada. Puxe o próximo da fila.',
  parceiro_inexistente: 'Parceiro não encontrado.',
  sem_telefone: 'Este parceiro não tem telefone cadastrado.',
  numero_invalido: FRASE_DA_FALHA.numero_invalido,
  fora_da_janela: 'Fora do horário permitido para ligações. Volte na próxima janela.',
  contato_suprimido: 'Este contato pediu para não ser procurado.',
  integracao_nao_configurada:
    'A telefonia ainda não está configurada. Avise quem administra o CRM.',
};

export function fraseDaRecusa(motivo: string | null | undefined): string {
  return (motivo && FRASE_DA_RECUSA[motivo]) || FRASE_DA_FALHA.falha_na_telefonia;
}

/**
 * Classifica o que o navegador ou o SDK lançou.
 *
 * `nome` é o `name` do erro (os de `getUserMedia` são `NotAllowedError`,
 * `NotFoundError`...); `codigo` é o código numérico do SDK de voz, quando há. As
 * faixas são as documentadas pelo provedor: 204xx credencial, 31005/31009/53xxx
 * sinalização e transporte, 314xx mídia e permissão, 13224/21211/21214 número.
 */
export function classificarFalha(erro: {
  nome?: string | null;
  codigo?: number | null;
}): FalhaDeVoz {
  const nome = erro.nome ?? '';
  const codigo = erro.codigo ?? 0;
  if (
    nome === 'NotAllowedError' ||
    nome === 'SecurityError' ||
    codigo === 31401 ||
    codigo === 31208
  ) {
    return 'microfone_bloqueado';
  }
  if (
    nome === 'NotFoundError' ||
    nome === 'NotReadableError' ||
    nome === 'OverconstrainedError' ||
    codigo === 31402 ||
    codigo === 31201
  ) {
    return 'sem_microfone';
  }
  if (codigo === 13224 || codigo === 21211 || codigo === 21214 || codigo === 31404) {
    return 'numero_invalido';
  }
  if ((codigo >= 20101 && codigo <= 20199) || codigo === 31202 || codigo === 31204) {
    return 'credencial';
  }
  if (
    codigo === 31000 ||
    codigo === 31003 ||
    codigo === 31005 ||
    codigo === 31009 ||
    (codigo >= 53000 && codigo <= 53999)
  ) {
    return 'sem_conexao';
  }
  return 'falha_na_telefonia';
}

/** O que vai para `voice_calls.error_code`: curto, sem dado de ninguém. */
export function codigoParaDiagnostico(erro: {
  nome?: string | null;
  codigo?: number | null;
}): string {
  if (erro.codigo) return `sdk_${erro.codigo}`;
  if (erro.nome) return `navegador_${erro.nome}`.slice(0, 80);
  return 'navegador_desconhecido';
}
