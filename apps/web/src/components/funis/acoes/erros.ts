/**
 * Tradução de falha em frase útil (RF-FUN-01/03/04).
 *
 * Regra desta pasta: **nada do Postgres chega à tela**. Nem `errcode`, nem
 * `PGRST202`, nem "function public.move_deal(...) does not exist". O que a Heloísa
 * lê é uma frase em pt-BR que diz o que aconteceu e o que fazer em seguida — ela
 * está na rua, com uma mão no celular, e "duplicate key value violates unique
 * constraint" não é uma instrução.
 *
 * Duas fontes de falha, tratadas separadamente porque pedem saídas diferentes:
 *
 *  1. **Recusa esperada** do `move_deal` (`{ok:false, reason}`) — não é erro: é o
 *     banco dizendo que falta alguma coisa. Os textos moram em
 *     `MENSAGENS_RECUSA_MOVER` (tipos.ts) e o formulário reabre no campo certo.
 *  2. **Falha técnica** (rede caiu, sessão expirou, RPC fora do ar). Aqui a pessoa
 *     não tem o que corrigir no formulário; o que ela precisa saber é se tenta de
 *     novo, se recarrega a página ou se avisa o time.
 */
import { MENSAGENS_RECUSA_MOVER, type MotivoRecusaMover } from '../tipos';

/** O que uma falha técnica vira na tela: o que houve + o que fazer. */
export type FalhaTraduzida = {
  /** Frase curta, para título de aviso. */
  titulo: string;
  /** O que fazer agora. */
  saida: string;
  /** `true` quando insistir tem chance de resolver (rede, servidor mudo). */
  vaiAdiantarTentarDeNovo: boolean;
};

/** Forma mínima de um erro do PostgREST, sem depender do tipo do supabase-js. */
type ErroDoBanco = { message?: unknown; code?: unknown; details?: unknown };

function comoErroDoBanco(erro: unknown): ErroDoBanco | null {
  return erro !== null && typeof erro === 'object' ? (erro as ErroDoBanco) : null;
}

function textoDoErro(erro: unknown): string {
  if (typeof erro === 'string') return erro;
  const bruto = comoErroDoBanco(erro);
  if (bruto && typeof bruto.message === 'string') return bruto.message;
  return '';
}

function codigoDoErro(erro: unknown): string {
  const bruto = comoErroDoBanco(erro);
  return bruto && typeof bruto.code === 'string' ? bruto.code : '';
}

/**
 * Traduz qualquer falha técnica em título + saída.
 *
 * A ordem importa: sessão expirada e permissão vêm antes de rede, porque o texto do
 * PostgREST para as duas coisas costuma trazer "fetch" no meio quando o proxy do
 * Next devolve 401.
 */
export function traduzirFalha(erro: unknown): FalhaTraduzida {
  const codigo = codigoDoErro(erro);
  const texto = textoDoErro(erro);

  // 42501: `raise ... using errcode = '42501'` das funções (sem auth.uid()) e também
  // o "permission denied" do próprio Postgres.
  if (codigo === '42501' || /não autenticado|jwt|expired|invalid token/i.test(texto)) {
    return {
      titulo: 'A sua sessão expirou.',
      saida: 'Recarregue a página e entre de novo com o Google.',
      vaiAdiantarTentarDeNovo: false,
    };
  }

  if (codigo === '42501' || /permission denied|row-level security|not authorized/i.test(texto)) {
    return {
      titulo: 'Seu perfil não tem acesso a este quadro.',
      saida: 'Fale com o gestor para ajustar o seu papel no CRM.',
      vaiAdiantarTentarDeNovo: false,
    };
  }

  // PGRST202: a função não existe no schema exposto — migração pendente no ambiente.
  if (codigo === 'PGRST202' || /could not find the function|does not exist/i.test(texto)) {
    return {
      titulo: 'Esta versão do CRM está à frente do banco.',
      saida: 'Recarregue a página; se continuar, avise no grupo do time.',
      vaiAdiantarTentarDeNovo: false,
    };
  }

  if (codigo === '23503' || /não existe|foreign key/i.test(texto)) {
    return {
      titulo: 'Este funil não existe mais.',
      saida: 'Volte para o funil de fornecedores e tente de novo.',
      vaiAdiantarTentarDeNovo: false,
    };
  }

  if (/failed to fetch|networkerror|network request failed|load failed/i.test(texto)) {
    return {
      titulo: 'O aplicativo não alcançou o servidor.',
      saida: 'Confira a conexão e toque em "Tentar de novo".',
      vaiAdiantarTentarDeNovo: true,
    };
  }

  if (/timeout|abort/i.test(texto)) {
    return {
      titulo: 'O servidor demorou demais para responder.',
      saida: 'Toque em "Tentar de novo"; se repetir, avise no grupo do time.',
      vaiAdiantarTentarDeNovo: true,
    };
  }

  return {
    titulo: 'Não deu para carregar o quadro.',
    saida: 'Toque em "Tentar de novo". Se continuar assim, avise no grupo do time.',
    vaiAdiantarTentarDeNovo: true,
  };
}

/** A falha técnica em uma frase só (aviso de brinde, título de `toast`). */
export function fraseDaFalha(erro: unknown): string {
  const { titulo, saida } = traduzirFalha(erro);
  return `${titulo} ${saida}`;
}

/** Recusa nomeada do `move_deal` → frase da tela. Nunca cai em texto cru. */
export function mensagemDaRecusa(motivo: MotivoRecusaMover): string {
  return MENSAGENS_RECUSA_MOVER[motivo] ?? 'Não deu para mover o cartão. Tente de novo.';
}

/**
 * A recusa vale um `toast` ou o formulário resolve sozinho?
 *
 * `campos_obrigatorios`, `motivo_de_perda_invalido`, `proxima_acao_obrigatoria` e
 * `proxima_acao_no_passado` acontecem DENTRO do formulário aberto: marcar o campo em
 * vermelho é mais claro do que um aviso que some em 4 segundos. As demais mudam o
 * mundo fora do formulário (o cartão sumiu, alguém moveu antes) e precisam de aviso.
 */
export function recusaEhDoFormulario(motivo: MotivoRecusaMover): boolean {
  return (
    motivo === 'campos_obrigatorios' ||
    motivo === 'motivo_de_perda_invalido' ||
    motivo === 'proxima_acao_obrigatoria' ||
    motivo === 'proxima_acao_no_passado'
  );
}
