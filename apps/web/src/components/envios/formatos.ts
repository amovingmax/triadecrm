import {
  CAMPOS_DA_FICHA,
  type AcaoDoBotao,
  type CampoDaFicha,
  type Contagem,
  type FiltroDoPublico,
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
 * A regra que a tela sugere para uma variável: puxa da ficha, com uma reserva
 * que ainda lê bem quando a ficha não tem o dado — sem reserva, a pessoa
 * seria pulada no envio. O teste no navegador ensinou as duas escolhas:
 * "Oi, tudo bem. Aqui é a Komune" soa estranho ("pessoal" não), e metade das
 * fichas não tem categoria ("fornecedores fundadores de eventos" lê bem).
 * Variável que não é campo da ficha vira texto fixo, a preencher.
 */
const RESERVAS: Record<string, string> = { nome: 'pessoal', categoria: 'eventos', cidade: 'Natal' };

export function regraSugerida(variavel: string): RegraDaVariavel {
  if (ehCampo(variavel)) return { campo: variavel, reserva: RESERVAS[variavel] ?? '' };
  return { fixo: '' };
}

/** As regras para um corpo novo, mantendo as que a pessoa já tinha escrito. */
export function regrasPara(
  corpo: string,
  anteriores: Record<string, RegraDaVariavel>,
): Record<string, RegraDaVariavel> {
  const regras: Record<string, RegraDaVariavel> = {};
  for (const v of variaveisComRegra(corpo)) regras[v] = anteriores[v] ?? regraSugerida(v);
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
  sem_permissao: 'Só admin e gestor montam e controlam campanhas.',
  nome_invalido: 'Dê um nome à campanha (até 120 letras).',
  tipo_invalido: 'Escolha entre modelo aprovado e texto livre.',
  modelo_inexistente: 'Este modelo não existe mais. Escolha outro.',
  modelo_nao_aprovado_na_meta: 'A Meta ainda não aprovou este modelo.',
  texto_invalido: 'O texto precisa ter entre 1 e 1.000 letras.',
  variavel_sem_regra: 'Uma variável ficou sem regra.',
  variavel_longa_demais: 'O texto de uma variável ficou longo demais.',
  publico_vazio: 'Ninguém marcado para receber.',
  publico_grande_demais: 'No máximo 2.000 pessoas por campanha.',
  ritmo_invalido: 'O ritmo vai de 1 a 60 mensagens por hora.',
  inicio_distante_demais: 'Agende para no máximo 30 dias à frente.',
  assinatura_invalida: 'Escolha quem assina.',
  atendente_invalido: 'Um dos atendentes escolhidos não está ativo ou não pode enviar.',
  envio_inexistente: 'Esta campanha não existe mais. Atualize a tela.',
  modelo_tem_atendente:
    'Este modelo diz "aqui é {{atendente}}". Em nome da Komune, escolha um modelo sem nome de atendente.',
  acoes_invalidas: 'Confira o que acontece em cada botão: o link precisa de texto e de rótulo.',
  destino_invalido: 'O destino do link precisa começar com https://.',
  nome_invalido_modelo: 'Dê ao modelo um nome de 3 a 80 letras.',
  categoria_invalida: 'Escolha marketing ou utilidade.',
  corpo_vazio: 'Escreva a mensagem.',
  corpo_longo_demais: 'A mensagem passou de 1.024 letras.',
  variavel_fora_do_formato: 'Variável fora do formato: use letras minúsculas, como {{nome}}.',
  variavel_na_borda: 'A mensagem não pode começar nem terminar com uma variável: a Meta recusa.',
  variaveis_coladas: 'Há duas variáveis coladas: ponha texto entre elas.',
  botoes_invalidos: 'Até 3 botões de até 25 letras, no máximo 1 de link, sem textos repetidos.',
  acao_invalida_no_estado: 'A campanha mudou de estado. Atualize a tela.',
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

/**
 * O que a tela sugere para cada botão de resposta: "Agora não" e parecidos
 * encerram o contato; o resto manda o link — é a ação que o envio quer.
 */
export function acaoSugerida(textoDoBotao: string): AcaoDoBotao {
  if (/agora n[aã]o|n[aã]o quero|sair|parar|sem interesse/i.test(textoDoBotao)) return { acao: 'sair' };
  return {
    acao: 'link',
    texto: 'Que bom! O cadastro leva 5 minutos e é grátis. É só tocar no botão abaixo.',
    botao: 'Criar meu perfil',
  };
}

/** As ações dos botões de resposta de um modelo, mantendo as que já foram editadas. */
export function acoesPara(
  botoes: readonly { tipo: string; texto: string }[],
  anteriores: Record<string, AcaoDoBotao>,
): Record<string, AcaoDoBotao> {
  const acoes: Record<string, AcaoDoBotao> = {};
  for (const b of botoes) {
    if (b.tipo !== 'resposta') continue;
    acoes[b.texto] = anteriores[b.texto] ?? acaoSugerida(b.texto);
  }
  return acoes;
}

// ---------------------------------------------------------------------------
// A tela única da campanha (Fase 5)
// ---------------------------------------------------------------------------

/**
 * O nome que a campanha ganha sozinha: a mensagem e o dia. Quem monta uma por
 * semana não precisa inventar nome; quem quer outro, escreve por cima.
 */
export function nomeSugerido(mensagem: string | null, agora: Date = new Date()): string {
  const base = mensagem?.trim() ?? '';
  if (base === '') return '';
  const dia = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Fortaleza',
    day: '2-digit',
    month: '2-digit',
  }).format(agora);
  return `${base.slice(0, 100)} — ${dia}`;
}

/**
 * O que a Meta cobra por mensagem de modelo no Brasil, em reais: os mesmos
 * valores que a folha de criar modelo mostra. Marketing é cobrado sempre;
 * utilidade é grátis para quem está com a janela de 24 h aberta.
 */
export const PRECO_POR_MENSAGEM = { marketing: 0.34, utility: 0.035 } as const;

/** Estimativa do custo na Meta; `null` quando a categoria do modelo não diz. */
export function custoEstimado(
  categoria: string | null,
  quantidade: number,
  comJanela: number,
): number | null {
  if (categoria === 'marketing') return quantidade * PRECO_POR_MENSAGEM.marketing;
  if (categoria === 'utility') {
    return Math.max(quantidade - comJanela, 0) * PRECO_POR_MENSAGEM.utility;
  }
  return null;
}

export function formatarReais(valor: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
}

/**
 * Quantos filtros estão ligados dentro de "Mais filtros". O botão mostra o
 * número: filtro escondido e esquecido é público menor sem ninguém saber por quê.
 */
export function filtrosEscondidos(f: FiltroDoPublico): number {
  const listas = [f.tipos, f.etapas, f.categorias, f.cidades, f.responsaveis, f.temperaturas];
  return (
    listas.filter((l) => (l?.length ?? 0) > 0).length +
    ((f.busca ?? '').trim() !== '' ? 1 : 0) +
    (f.sem_contato_ha_dias === null || f.sem_contato_ha_dias === undefined ? 0 : 1)
  );
}
