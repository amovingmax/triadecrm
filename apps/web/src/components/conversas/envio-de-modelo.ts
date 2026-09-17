import { z } from 'zod';
import { TIMEZONE } from '@komune/schema';

/**
 * Mandar WhatsApp pelo CRM: a parte que não é desenho (RF-CON-05, RF-CON-08,
 * RF-CON-10, RF-CON-11; migração 20260914100000).
 *
 * A tela pergunta ao banco (`wa_preparar_envio`) o que pode e o que barra, e
 * manda por `wa_enviar_modelo`. O que mora aqui é o que a tela decide sozinha e
 * precisa de teste: ler a resposta do banco sem confiar nela, preencher a prévia
 * do jeito que o banco preenche e dizer em português por que não dá agora.
 */

// ---------------------------------------------------------------------------
// A prévia que o banco devolve
// ---------------------------------------------------------------------------

const modeloSchema = z.object({
  id: z.number(),
  codigo: z.string(),
  nome: z.string(),
  tipo: z.string().nullable(),
  variante: z.string().nullable(),
  segmento: z.string().nullable(),
  corpo: z.string(),
  variaveis: z.array(z.string()),
});

export const previaSchema = z.object({
  numero_configurado: z.boolean(),
  tem_whatsapp: z.boolean(),
  conversa_id: z.string().nullable(),
  janela_24h_aberta: z.boolean(),
  primeiro_contato: z.boolean(),
  /** A última mensagem nossa ainda sem resposta; `null` quando não há o que esperar. */
  sem_resposta_desde: z.string().nullable(),
  bloqueio: z.object({ motivo: z.string(), quando: z.string().nullable() }).nullable(),
  teto: z.object({ usados: z.number(), teto: z.number() }).nullable(),
  segmento: z.string().nullable(),
  valores: z.record(z.string(), z.string()),
  modelos: z.array(modeloSchema),
  modelos_esperando_meta: z.number(),
});

export type PreviaDoEnvio = z.infer<typeof previaSchema>;
export type ModeloParaEnviar = z.infer<typeof modeloSchema>;

export const resultadoDoEnvioSchema = z.object({
  ok: z.literal(true),
  conversation_id: z.string(),
  message_id: z.string(),
  primeiro_contato: z.boolean(),
  corpo: z.string(),
});

// ---------------------------------------------------------------------------
// Preencher o modelo — o MESMO jeito de `app.modelo_renderizar`
// ---------------------------------------------------------------------------

const VARIAVEL = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g;

/** Espelho de `app.modelo_parametro_limpo`: sem quebra de linha, tab ou espaço repetido. */
export function valorLimpo(valor: string | undefined): string {
  return (valor ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * O corpo como vai sair. Variável sem valor aparece como `[nome da variável]`,
 * para a prévia mostrar o buraco em vez de um `{{detalhe}}` que ninguém lê como
 * "falta preencher".
 */
export function preencher(corpo: string, valores: Record<string, string>): string {
  return corpo.replace(VARIAVEL, (_, nome: string) => {
    const v = valorLimpo(valores[nome]);
    return v === '' ? `[${rotuloDaVariavel(nome).toLowerCase()}]` : v;
  });
}

/** As variáveis que ainda estão vazias, na ordem do modelo. */
export function faltando(modelo: ModeloParaEnviar, valores: Record<string, string>): string[] {
  return modelo.variaveis.filter((v) => valorLimpo(valores[v]) === '');
}

/**
 * A variável que o banco preenche sozinho com o primeiro nome de quem clicou
 * (`wa_enviar_modelo`). Não vira campo: ninguém se apresenta como outra pessoa.
 */
export const VARIAVEL_DO_ATENDENTE = 'atendente';

/**
 * As variáveis em que a pessoa ESCREVE a mensagem, e não preenche um dado.
 *
 * São o que tira a abertura do modelo pronto (migração 20260916100000): a Meta exige
 * texto aprovado para começar conversa, então o que foi aprovado é a MOLDURA — a
 * saudação com o nome de quem envia e a saída obrigatória — e o meio é escrito na hora.
 */
export const VARIAVEIS_DE_TEXTO_LIVRE: readonly string[] = ['mensagem', 'texto', 'recado'];

/** Teto de `wa_enviar_modelo` por variável. Espelho de `app.modelo_teto_da_variavel`. */
export const MAXIMO_POR_VARIAVEL = 200;
export const MAXIMO_DO_TEXTO_LIVRE = 900;

export function tetoDaVariavel(variavel: string): number {
  return VARIAVEIS_DE_TEXTO_LIVRE.includes(variavel) ? MAXIMO_DO_TEXTO_LIVRE : MAXIMO_POR_VARIAVEL;
}

/** A variável de texto livre do modelo, quando ele tem uma. */
export function variavelLivreDoModelo(modelo: ModeloParaEnviar): string | null {
  return modelo.variaveis.find((v) => VARIAVEIS_DE_TEXTO_LIVRE.includes(v)) ?? null;
}

/**
 * Qual modelo abre a caixa.
 *
 * Quem manda quer escrever, não escolher: o modelo de texto livre vem primeiro,
 * depois o que o banco já sabe preencher inteiro (nenhum campo para digitar), e só
 * então a ordem do servidor. Trocar continua a um toque.
 */
/**
 * O CUMPRIMENTO VEM PRIMEIRO — e só em primeiro contato.
 *
 * Abrir conversa com um parágrafo de 240 caracteres é pedir para alguém ler um
 * discurso antes de dizer se é a pessoa certa. O jeito que funciona no WhatsApp
 * é o que todo mundo faz: cumprimenta, descobre com quem está falando e AÍ fala.
 * Foi exatamente esse o pedido — "começar apenas com boa tarde, e depois que eu
 * souber que estou falando com o responsável, aí sim mando o que quero".
 *
 * Então a ordem de preferência muda com o momento:
 *   1. **Primeiro contato** → o cumprimento, que não tem campo nenhum a
 *      preencher: a saudação vem do relógio e o nome de quem envia, da sessão.
 *      Um clique.
 *   2. **Retomada** (a conversa existe, a janela fechou) → a moldura livre, onde
 *      se escreve o que se quer dizer. Aqui já se sabe com quem se fala, e
 *      cumprimentar de novo seria começar do zero uma conversa que existe.
 *   3. Sem nenhuma das duas aprovadas → o que estiver pronto para enviar.
 */
/**
 * O cumprimento solto, um por período do dia.
 *
 * São três modelos e não um com `{{saudacao}}` porque a Meta recusa modelo que
 * COMEÇA com variável. Quem escolhe entre eles é o relógio de Natal, aqui: a
 * pessoa não escolhe período do dia, do mesmo jeito que não escolhe o próprio
 * nome na assinatura.
 */
export const CODIGOS_DO_CUMPRIMENTO = {
  manha: 'GEN-ABR-OLA-MANHA',
  tarde: 'GEN-ABR-OLA-TARDE',
  noite: 'GEN-ABR-OLA-NOITE',
} as const;

/** Qual cumprimento cabe agora, no fuso de Natal — não no do navegador. */
export function cumprimentoDaHora(agora: Date = new Date()): string {
  const hora = Number(
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Fortaleza',
      hour: 'numeric',
      hour12: false,
    }).format(agora),
  );
  if (hora < 12) return CODIGOS_DO_CUMPRIMENTO.manha;
  if (hora < 18) return CODIGOS_DO_CUMPRIMENTO.tarde;
  return CODIGOS_DO_CUMPRIMENTO.noite;
}

export function escolherModeloInicial(
  modelos: readonly ModeloParaEnviar[],
  sugeridos: Record<string, string>,
  primeiroContato = false,
  agora: Date = new Date(),
): ModeloParaEnviar | null {
  if (modelos.length === 0) return null;

  if (primeiroContato) {
    const daHora = modelos.find((m) => m.codigo === cumprimentoDaHora(agora));
    if (daHora) return daHora;
  }

  const livre = modelos.find((m) => variavelLivreDoModelo(m) !== null);
  if (livre) return livre;
  const pronto = modelos.find((m) => faltando(m, valoresIniciais(m, sugeridos)).length === 0);
  return pronto ?? modelos[0]!;
}

/** Começa pelo que o banco sugeriu e mantém o que a pessoa já tinha digitado. */
export function valoresIniciais(
  modelo: ModeloParaEnviar,
  sugeridos: Record<string, string>,
  digitados: Record<string, string> = {},
): Record<string, string> {
  return Object.fromEntries(modelo.variaveis.map((v) => [v, digitados[v] ?? sugeridos[v] ?? '']));
}

// ---------------------------------------------------------------------------
// Rótulos
// ---------------------------------------------------------------------------

/** O que cada variável dos modelos do R08 pede, na língua de quem está preenchendo. */
const ROTULOS: Record<string, string> = {
  nome: 'Nome da pessoa',
  atendente: 'Seu nome',
  empresa: 'Nome da empresa',
  origem: 'Onde você achou',
  detalhe: 'Detalhe do trabalho que chamou atenção',
  categoria: 'Categoria',
  estilo: 'Estilo do trabalho',
  tipo_evento: 'Tipo de evento',
  data: 'Data',
  dia: 'Dia',
  hora: 'Hora',
  hora_hoje: 'Hora de hoje',
  hora_amanha: 'Hora de amanhã',
  hora_manha: 'Hora da manhã',
  hora_tarde: 'Hora da tarde',
  local: 'Local',
  endereco: 'Endereço',
  link: 'Link',
  link_app: 'Link do app',
  link_perfil: 'Link do perfil',
  mes: 'Mês',
  n: 'Número',
  cliente: 'Cliente',
  gancho: 'Gancho',
  etapa_travada: 'Etapa em que parou',
  campo: 'Campo',
  campos_preenchidos: 'Campos preenchidos',
  instrucao: 'Instrução',
  fundador_autorizado: 'Fundador que autorizou citar',
};

const DICAS: Record<string, string> = {
  origem: 'Ex.: Instagram, Google Maps, Casamentos.com.br',
  detalhe: 'Algo real do perfil dele. Ex.: mesa de doces finos',
  estilo: 'Ex.: natural e documental',
};

export function rotuloDaVariavel(nome: string): string {
  return ROTULOS[nome] ?? nome.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export function dicaDaVariavel(nome: string): string | null {
  return DICAS[nome] ?? null;
}

const TIPOS: Record<string, string> = {
  abertura: 'Abertura',
  followup: 'Retomada',
  reativacao: 'Reativação',
  encerramento: 'Encerramento',
  onboarding: 'Cadastro',
  agendamento: 'Agenda',
};

/** O grupo do seletor: aberturas, retomadas, cadastro... */
export function grupoDoModelo(m: ModeloParaEnviar): string {
  return (m.tipo && TIPOS[m.tipo]) ?? 'Outros';
}

// ---------------------------------------------------------------------------
// Por que não dá agora
// ---------------------------------------------------------------------------

/** "segunda-feira às 09:00", no fuso de Natal. */
const DIA_SEMANA = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: TIMEZONE });
const HORA = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: TIMEZONE,
});
const DIA_MES = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  timeZone: TIMEZONE,
});

/** "hoje às 12:52", "ontem às 09:10", "sexta-feira, 11/09" — há quanto tempo esperamos. */
export function quandoFoi(iso: string, agora: Date = new Date()): string {
  const quando = new Date(iso);
  const dia = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(d);
  if (dia(quando) === dia(agora)) return `hoje às ${HORA.format(quando)}`;
  const ontem = new Date(agora.getTime() - 86_400_000);
  if (dia(quando) === dia(ontem)) return `ontem às ${HORA.format(quando)}`;
  return `${DIA_SEMANA.format(quando)}, ${DIA_MES.format(quando)}`;
}

export function quandoAbre(iso: string | null, agora: Date = new Date()): string | null {
  if (!iso) return null;
  const quando = new Date(iso);
  if (Number.isNaN(quando.getTime())) return null;
  const mesmoDia =
    new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(quando) ===
    new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(agora);
  return `${mesmoDia ? 'hoje' : DIA_SEMANA.format(quando)} às ${HORA.format(quando)}`;
}

/**
 * A frase do bloqueio da prévia. Os motivos são os mesmos nomes que o gatilho
 * levanta (`MOTIVOS_DE_RECUSA_DO_ENVIO`), mais os dois que só existem antes de
 * haver conversa.
 */
export function fraseDoBloqueio(
  bloqueio: NonNullable<PreviaDoEnvio['bloqueio']>,
  frases: Record<string, string>,
  agora: Date = new Date(),
): string {
  const base = frases[bloqueio.motivo] ?? 'Agora não dá para mandar mensagem para este parceiro.';
  const abre = quandoAbre(bloqueio.quando, agora);
  return abre ? `${base} Abre ${abre}.` : base;
}
