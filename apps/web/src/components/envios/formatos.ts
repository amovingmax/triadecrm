import {
  CAMPOS_DA_FICHA,
  type CampoDaFicha,
  type Contagem,
  type RegraDaVariavel,
} from './tipos';

/**
 * As regras de texto dos envios em massa — puras, para serem testadas sem tela.
 */

/** Preenchidas pelo banco em todo envio; ninguém escolhe o valor delas. */
export const VARIAVEIS_AUTOMATICAS = ['atendente', 'saudacao'] as const;

/**
 * As variáveis de um corpo, na ordem da primeira aparição e sem repetir — o
 * mesmo que `app.modelo_variaveis` faz no banco.
 */
export function variaveisDoCorpo(corpo: string): string[] {
  const vistas: string[] = [];
  for (const m of corpo.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)) {
    const nome = m[1] ?? '';
    if (nome !== '' && !vistas.includes(nome)) vistas.push(nome);
  }
  return vistas;
}

/** As variáveis que PEDEM regra: todas menos as automáticas. */
export function variaveisComRegra(corpo: string): string[] {
  return variaveisDoCorpo(corpo).filter(
    (v) => !(VARIAVEIS_AUTOMATICAS as readonly string[]).includes(v),
  );
}

function ehCampo(v: string): v is CampoDaFicha {
  return CAMPOS_DA_FICHA.some((c) => c.valor === v);
}

/**
 * A regra que a tela sugere para uma variável. `{{nome}}` puxa o nome da
 * pessoa e, sem nome, diz "tudo bem" — "Oi, tudo bem!" lê melhor que "Oi, !".
 * Se o próprio modelo já pergunta "tudo bem?", a reserva vira "pessoal": o
 * teste no navegador mostrou "Oi, tudo bem, tudo bem?".
 * Variável que não é campo da ficha vira texto fixo, a preencher.
 */
export function regraSugerida(variavel: string, corpo = ''): RegraDaVariavel {
  if (ehCampo(variavel)) {
    const reservaDoNome = /tudo bem/i.test(corpo) ? 'pessoal' : 'tudo bem';
    return { campo: variavel, reserva: variavel === 'nome' ? reservaDoNome : '' };
  }
  return { fixo: '' };
}

/** As regras para um corpo novo, mantendo as que a pessoa já tinha escrito. */
export function regrasPara(
  corpo: string,
  anteriores: Record<string, RegraDaVariavel>,
): Record<string, RegraDaVariavel> {
  const regras: Record<string, RegraDaVariavel> = {};
  for (const v of variaveisComRegra(corpo)) regras[v] = anteriores[v] ?? regraSugerida(v, corpo);
  return regras;
}

/** Variáveis cuja regra ainda não dá para usar (texto fixo vazio). */
export function regrasIncompletas(regras: Record<string, RegraDaVariavel>): string[] {
  return Object.entries(regras)
    .filter(([, r]) => 'fixo' in r && r.fixo.trim() === '')
    .map(([v]) => v);
}

// ---------------------------------------------------------------------------
// Motivos, em português
// ---------------------------------------------------------------------------

const MOTIVOS_DO_ITEM: Record<string, string> = {
  contato_suprimido: 'Pediu para não receber mensagens.',
  do_not_contact: 'Pediu para não receber mensagens.',
  sem_whatsapp: 'A ficha não tem WhatsApp.',
  ficha_sem_whatsapp: 'A ficha não tem WhatsApp.',
  mensagem_recente_sem_resposta:
    'Recebeu mensagem nossa há menos de 72 h e não respondeu. Mandar outra seguida é o que faz bloquear.',
  sem_janela_24h:
    'Não falou com a gente nas últimas 24 h. Texto livre não chega: para essa pessoa, só modelo aprovado.',
  sem_valor: 'Faltou valor para uma variável, e não havia reserva.',
  variavel_sem_regra: 'Uma variável ficou sem regra.',
  assinante_sem_permissao: 'Quem assinaria não está mais ativo ou não pode enviar.',
  modelo_nao_aprovado_na_meta: 'A Meta não aceita mais este modelo.',
  erro: 'Erro inesperado no envio.',
};

export function fraseDoMotivo(motivo: string | null | undefined): string {
  if (!motivo) return '';
  return MOTIVOS_DO_ITEM[motivo] ?? `Recusado: ${motivo}.`;
}

const RECUSAS_DO_LOTE: Record<string, string> = {
  sem_permissao: 'Só admin e gestor montam e controlam envios em massa.',
  nome_invalido: 'Dê um nome ao envio (até 120 letras).',
  tipo_invalido: 'Escolha entre modelo aprovado e texto livre.',
  modelo_inexistente: 'Este modelo não existe mais. Escolha outro.',
  modelo_nao_aprovado_na_meta: 'A Meta ainda não aprovou este modelo.',
  texto_invalido: 'O texto precisa ter entre 1 e 1.000 letras.',
  variavel_sem_regra: 'Uma variável ficou sem regra.',
  variavel_longa_demais: 'O texto de uma variável ficou longo demais.',
  publico_vazio: 'Ninguém marcado para receber.',
  publico_grande_demais: 'No máximo 2.000 pessoas por envio.',
  ritmo_invalido: 'O ritmo vai de 1 a 60 mensagens por hora.',
  inicio_distante_demais: 'Agende para no máximo 30 dias à frente.',
  assinatura_invalida: 'Escolha quem assina.',
  atendente_invalido: 'Um dos atendentes escolhidos não está ativo ou não pode enviar.',
  envio_inexistente: 'Este envio não existe mais. Atualize a tela.',
  acao_invalida_no_estado: 'O envio mudou de estado. Atualize a tela.',
};

export function fraseDaRecusa(motivo: string | undefined, variavel?: string): string {
  const base = RECUSAS_DO_LOTE[motivo ?? ''] ?? `O banco recusou: ${motivo ?? 'sem motivo'}.`;
  return variavel ? `${base} ({{${variavel}}})` : base;
}

// ---------------------------------------------------------------------------
// Tempo e progresso
// ---------------------------------------------------------------------------

/** 8h às 17h45: 9 h 45 min de envio por dia útil. */
export const HORAS_DE_ENVIO_POR_DIA = 9.75;

/**
 * Quanto tempo o lote leva, contando o ritmo e o teto de primeiros contatos.
 * É estimativa, e a tela diz isso: pulos adiantam, espera por teto atrasa.
 */
export function duracaoEstimada(
  quantidade: number,
  porHora: number,
  tetoDiario: number | null,
): string {
  if (quantidade <= 0 || porHora <= 0) return '—';
  const horas = quantidade / porHora;
  const diasPeloRitmo = Math.ceil(horas / HORAS_DE_ENVIO_POR_DIA);
  const diasPeloTeto = tetoDiario && tetoDiario > 0 ? Math.ceil(quantidade / tetoDiario) : 1;
  const dias = Math.max(diasPeloRitmo, diasPeloTeto);
  if (dias > 1) return `cerca de ${dias} dias úteis`;
  if (horas < 1) return `cerca de ${Math.max(1, Math.round(horas * 60))} min`;
  return `cerca de ${Math.round(horas * 10) / 10} h`.replace('.', ',');
}

/** Fração do lote já decidida (enviada, pulada ou cancelada), de 0 a 1. */
export function progresso(c: Contagem): number {
  if (c.total === 0) return 0;
  return (c.enviadas + c.puladas + c.canceladas) / c.total;
}

/** Porcentagem inteira, sem casas: "12%". */
export function porcento(parte: number, todo: number): string {
  if (todo <= 0) return '0%';
  return `${Math.round((parte / todo) * 100)}%`;
}
