import { z } from 'zod';

import { createClient } from '@/lib/supabase/client';

import { ErroDaConversa } from './acoes';
import type { FioCru, MensagemCrua } from './mensagens';

/**
 * As conversas de quem escreveu de um número que não é ficha nenhuma
 * (migração 20260915130000).
 *
 * A conversa nasce sem `organization_id` quando o número não bate com ficha nem
 * pessoa da base. A lista da tela Conversas é montada por ficha e não tinha onde
 * mostrá-la; aqui ela vira uma aba própria, com duas saídas: ligar a conversa a
 * uma ficha que já existe, ou criar a ficha a partir dela.
 */

export function conversasForaDaBase(fios: readonly FioCru[]): FioCru[] {
  return fios
    .filter((f) => f.organization_id === null)
    .sort((a, b) => (b.last_message_at ?? '').localeCompare(a.last_message_at ?? ''));
}

/**
 * "terminado em 4698". O número inteiro não aparece: quem liga lê telefone mascarado
 * na base (RF-BAS-14), e para criar ou ligar a ficha o banco usa o número da própria
 * conversa, sem ele passar pela tela.
 */
export function finalDoNumero(e164: string): string {
  const digitos = e164.replace(/\D/g, '');
  return digitos.length >= 4 ? `terminado em ${digitos.slice(-4)}` : 'sem número';
}

export const CHAVE_FORA_DA_BASE = ['conversas', 'fora-da-base'] as const;

export function chaveDasMensagensDoFio(fioId: string) {
  return ['conversas', 'fora-da-base', fioId] as const;
}

const COLUNAS_MENSAGEM =
  'id, conversation_id, organization_id, direction, type, status, body, media_path, media_mime, transcript, template_id, draft_id, author_kind, sent_by, approved_by, is_first_contact, business_initiated, optout_confirmation, origin, error_code, error_detail, created_at, sent_at, delivered_at, read_at, failed_at';

export async function carregarMensagensDoFio(fioId: string): Promise<MensagemCrua[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('messages')
    .select(COLUNAS_MENSAGEM)
    .eq('conversation_id', fioId)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) {
    throw new ErroDaConversa('Não deu para ler as mensagens desta conversa.', true, error);
  }
  return (data ?? []) as MensagemCrua[];
}

const resultadoSchema = z.object({
  ok: z.boolean(),
  motivo: z.string().nullish(),
  organization_id: z.string().nullish(),
  criada: z.boolean().nullish(),
});

export type ResultadoDaFicha = z.infer<typeof resultadoSchema>;

/** Por que não deu, em português. `organization_id` junto = a ficha já existe. */
export const MOTIVOS_DA_FICHA: Record<string, string> = {
  conversa_inexistente: 'Esta conversa não está mais disponível para você. Recarregue a tela.',
  ja_vinculada: 'Esta conversa já foi ligada a uma ficha.',
  ficha_inexistente: 'Essa ficha não existe mais ou não está visível para você.',
  nome_obrigatorio: 'Dê um nome à ficha.',
  telefone_invalido: 'O número desta conversa não é um telefone brasileiro válido.',
  telefone_suprimido: 'Este número pediu para não ser contatado. A ficha não é criada.',
  telefone_ja_cadastrado: 'Este número já é de uma ficha.',
  telefone_de_contato_existente: 'Este número já é de uma pessoa de outra ficha.',
  categoria_invalida: 'Escolha a categoria.',
  origem_invalida: 'A origem "Chegou pelo WhatsApp" não está cadastrada. Avise o time.',
  origem_desabilitada: 'A origem "Chegou pelo WhatsApp" está desligada no Admin.',
};

export function fraseDoResultado(r: ResultadoDaFicha): string {
  return (r.motivo && MOTIVOS_DA_FICHA[r.motivo]) || 'Não deu para concluir. Tente de novo.';
}

export async function vincularConversa(
  fioId: string,
  organizacaoId: string,
): Promise<ResultadoDaFicha> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('vincular_conversa', {
    p_conversation_id: fioId,
    p_organization_id: organizacaoId,
  });
  return ler(data, error);
}

export async function criarFichaDaConversa(entrada: {
  fioId: string;
  nome: string;
  categoriaId: number;
  tipo: 'fornecedor' | 'produtor' | 'cerimonialista';
}): Promise<ResultadoDaFicha> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('criar_ficha_da_conversa', {
    p_conversation_id: entrada.fioId,
    p_nome: entrada.nome.trim(),
    p_category_id: entrada.categoriaId,
    p_kind: entrada.tipo,
  });
  return ler(data, error);
}

function ler(data: unknown, error: { code?: string; message: string } | null): ResultadoDaFicha {
  if (error) {
    if (error.code === '42501') {
      throw new ErroDaConversa('Seu perfil não pode criar nem ligar fichas.', false, error);
    }
    throw new ErroDaConversa('Não deu para falar com o servidor. Tente de novo.', true, error);
  }
  const lido = resultadoSchema.safeParse(data);
  if (!lido.success) {
    throw new ErroDaConversa('A resposta do servidor veio incompleta. Recarregue a tela.', false);
  }
  return lido.data;
}
