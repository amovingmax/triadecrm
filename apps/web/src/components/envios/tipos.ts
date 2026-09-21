import { z } from 'zod';

/**
 * O vocabulário dos envios em massa (migração `20260921100000_envios_em_massa`).
 *
 * Os schemas espelham o que as RPCs devolvem. Campo a mais é ignorado, campo a
 * menos quebra aqui — e não três telas depois, num `undefined` silencioso.
 */

// ---------------------------------------------------------------------------
// O público
// ---------------------------------------------------------------------------

export const SITUACOES = [
  { valor: 'nunca_contatado', rotulo: 'Nunca contatado', dica: 'Nunca recebeu mensagem nossa.' },
  { valor: 'sem_resposta', rotulo: 'Não respondeu', dica: 'Recebeu e nunca respondeu.' },
  { valor: 'ja_conversou', rotulo: 'Já conversou', dica: 'Respondeu alguma vez.' },
  {
    valor: 'janela_aberta',
    rotulo: 'Falou nas últimas 24 h',
    dica: 'Janela aberta: vale texto livre, sem modelo da Meta.',
  },
  {
    valor: 'cadastrado_komune',
    rotulo: 'Cadastrado na Komune',
    dica: 'Já tem perfil na plataforma.',
  },
] as const;
export type Situacao = (typeof SITUACOES)[number]['valor'];

export const TIPOS_DE_PARCEIRO = [
  { valor: 'fornecedor', rotulo: 'Fornecedor' },
  { valor: 'produtor', rotulo: 'Produtor' },
  { valor: 'cerimonialista', rotulo: 'Cerimonialista' },
  { valor: 'espaco', rotulo: 'Espaço' },
  { valor: 'empresa', rotulo: 'Empresa' },
  { valor: 'outro', rotulo: 'Outro' },
] as const;

export const TEMPERATURAS = [
  { valor: 'frio', rotulo: 'Frio' },
  { valor: 'morno', rotulo: 'Morno' },
  { valor: 'quente', rotulo: 'Quente' },
  { valor: 'cliente', rotulo: 'Cliente' },
  { valor: 'cliente_ativo', rotulo: 'Cliente ativo' },
] as const;

/** O filtro, no formato que `app.envio_publico` lê. Toda chave é opcional. */
export type FiltroDoPublico = {
  situacoes?: string[];
  tipos?: string[];
  etapas?: number[];
  categorias?: number[];
  cidades?: number[];
  responsaveis?: string[];
  temperaturas?: string[];
  sem_contato_ha_dias?: number | null;
  busca?: string;
};

export const pessoaDoPublicoSchema = z.object({
  organization_id: z.string(),
  nome: z.string(),
  tipo: z.string().nullable(),
  categoria: z.string().nullable(),
  cidade: z.string().nullable(),
  etapa: z.string().nullable(),
  responsavel: z.string().nullable(),
  temperatura: z.string().nullable(),
  situacao: z.string(),
  cadastrado_komune: z.boolean(),
  ultimo_envio: z.string().nullable(),
  bloqueio: z.string().nullable(),
});
export type PessoaDoPublico = z.infer<typeof pessoaDoPublicoSchema>;

export const publicoSalvoSchema = z.object({
  id: z.string(),
  nome: z.string(),
  filtro: z.record(z.string(), z.unknown()),
});
export type PublicoSalvo = z.infer<typeof publicoSalvoSchema>;

// ---------------------------------------------------------------------------
// A mensagem
// ---------------------------------------------------------------------------

export const modeloSchema = z.object({
  id: z.number(),
  template_code: z.string(),
  name: z.string(),
  body: z.string(),
  category: z.string().nullable(),
  kind: z.string().nullable(),
});
export type Modelo = z.infer<typeof modeloSchema>;

/** De onde vem o valor de uma variável. */
export const CAMPOS_DA_FICHA = [
  { valor: 'nome', rotulo: 'Nome da pessoa' },
  { valor: 'empresa', rotulo: 'Nome da empresa' },
  { valor: 'categoria', rotulo: 'Categoria' },
  { valor: 'cidade', rotulo: 'Cidade' },
  { valor: 'origem', rotulo: 'Onde achamos (fonte)' },
] as const;
export type CampoDaFicha = (typeof CAMPOS_DA_FICHA)[number]['valor'];

/** A regra de uma variável: puxa da ficha (com reserva) ou é texto fixo. */
export type RegraDaVariavel =
  | { campo: CampoDaFicha; reserva: string }
  | { fixo: string };

export type TipoDoEnvio = 'modelo' | 'texto';
export type Assinatura = 'eu' | 'responsavel' | 'revezar';

export const previaSchema = z.object({
  ok: z.boolean(),
  motivo: z.string().optional(),
  itens: z
    .array(
      z.object({
        organization_id: z.string(),
        assinante: z.string().nullable(),
        ok: z.boolean(),
        corpo: z.string().optional(),
        motivo: z.string().optional(),
        variavel: z.string().optional(),
      }),
    )
    .optional(),
});
export type Previa = z.infer<typeof previaSchema>;

// ---------------------------------------------------------------------------
// O acompanhamento
// ---------------------------------------------------------------------------

export const STATUS_DO_ENVIO = {
  agendado: 'Agendado',
  enviando: 'Enviando',
  pausado: 'Pausado',
  parado: 'Parado pela proteção',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
} as const;
export type StatusDoEnvio = keyof typeof STATUS_DO_ENVIO;

export const contagemSchema = z.object({
  total: z.number(),
  pendentes: z.number(),
  enviadas: z.number(),
  puladas: z.number(),
  canceladas: z.number(),
  entregues: z.number(),
  lidas: z.number(),
  falharam: z.number(),
  responderam: z.number(),
  sairam: z.number(),
});
export type Contagem = z.infer<typeof contagemSchema>;

export const envioSchema = z.object({
  id: z.string(),
  nome: z.string(),
  tipo: z.enum(['modelo', 'texto']),
  status: z.enum(['agendado', 'enviando', 'pausado', 'parado', 'concluido', 'cancelado']),
  motivo_parada: z.string().nullable(),
  por_hora: z.number(),
  inicio: z.string(),
  proximo_em: z.string(),
  criado_em: z.string(),
  concluido_em: z.string().nullable(),
  criado_por: z.string().nullable(),
  modelo: z.string().nullable(),
  contagem: contagemSchema,
});
export type Envio = z.infer<typeof envioSchema>;

export const itemDoEnvioSchema = z.object({
  posicao: z.number(),
  organization_id: z.string(),
  nome: z.string(),
  assinante: z.string().nullable(),
  status: z.enum(['pendente', 'enviada', 'pulada', 'cancelada']),
  motivo: z.string().nullable(),
  processado_em: z.string().nullable(),
  conversa_id: z.string().nullable(),
  mensagem: z.string().nullable(),
  erro: z.string().nullable(),
  respondeu: z.boolean().nullable(),
});
export type ItemDoEnvio = z.infer<typeof itemDoEnvioSchema>;
