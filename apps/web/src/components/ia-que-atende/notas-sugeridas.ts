/**
 * A IA aprende com as respostas de vocês (Imova, 27/11/2026).
 *
 * Quando um admin responde uma pergunta do aviso de decisão, a IA escreve a nota que
 * guardaria essa resposta no caderno e a deixa sugerida. O cartão "Guardar para os próximos
 * clientes?" aparece para quem respondeu (no canto, logo depois da resposta), e qualquer
 * pessoa da gestão vê as sugeridas na aba Caderno. Guardar, Editar ou Agora não.
 *
 * O banco decide tudo (migração 20261127190000): quem vê e quem guarda
 * (`app.is_manager()`), onde a nota entra (a ficha do imóvel ou a nota geral; sem elas, nasce
 * uma) e a trava (`app.ia_nota_problema`). Aqui ficam as chamadas e a mesma trava, para
 * avisar antes do clique.
 */
import { createClient } from '@/lib/supabase/client';

export type Alcance = 'imovel' | 'geral';

export interface NotaSugerida {
  readonly id: string;
  readonly decisaoId: string;
  /** Para onde vai "Ver conversa". */
  readonly caminho: string;
  /** As palavras do cliente. */
  readonly pergunta: string;
  /** O que o admin respondeu. */
  readonly resposta: string;
  readonly textoDoImovel: string | null;
  readonly textoGeral: string | null;
  readonly alcanceSugerido: Alcance;
  /** "a sala em Ponta Negra". */
  readonly imovel: string | null;
  readonly codigo: string | null;
  /** A ficha onde entra ("FICHA 5. TERRENO …") ou o nome da ficha nova. */
  readonly ondeNoImovel: string | null;
  readonly fichaNova: boolean;
  /** A nota geral onde entra; nula quando ainda não há (nasce uma). */
  readonly ondeNoGeral: string | null;
  readonly respondidaPor: string | null;
  readonly respondidaPorMim: boolean;
  readonly respondidaEm: string | null;
  readonly criadaEm: string;
}

export const CHAVE_DAS_NOTAS_SUGERIDAS = ['ia-notas-sugeridas'] as const;

export const PISO_DA_NOTA = 10;
export const TETO_DA_NOTA = 300;

const texto = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

/** Espaços seguidos viram um e as pontas saem (`app.ia_nota_limpa`). */
export function limparNota(valor: string): string {
  return valor.replace(/\s+/g, ' ').trim();
}

const LETRAS = /[A-Za-zÀ-ÖØ-öø-ÿ]+/;

/** Por que a nota não pode entrar (nulo = pode). A mesma regra de `app.ia_nota_problema`. */
export function problemaDaNota(valor: string): string | null {
  const t = limparNota(valor);
  if (t.length < PISO_DA_NOTA) return 'Escreva a nota em uma frase.';
  if (t.length > TETO_DA_NOTA) return `A nota passa de ${TETO_DA_NOTA} letras. Encurte.`;
  if (t.includes('@')) return 'Tire o e-mail ou o @: a nota não guarda contato.';
  if (/https?:\/\/|www\./i.test(t)) return 'Tire o link.';
  if (/\[\[[A-Z]+_\d+\]\]/.test(t)) return 'Tire o marcador de nome.';
  if (/(^|[^A-Za-z0-9])[A-Z]{2}\d{3,4}(_IMOVA)?(?!\d)/.test(t)) {
    return 'Tire o código do anúncio: a IA nunca diz o código ao cliente.';
  }
  if (t.split(LETRAS).some((parte) => parte.replace(/\D/g, '').length >= 10)) {
    return 'Tire o número comprido: parece telefone, e a IA trava com ele.';
  }
  return null;
}

const MOTIVOS: Readonly<Record<string, string>> = {
  sem_permissao: 'Só a gestão guarda notas no caderno.',
  nao_existe: 'Essa sugestão não existe mais. Recarregue a página.',
  ja_decidida: 'Alguém já decidiu essa sugestão.',
  escopo_invalido: 'Escolha para quais imóveis a nota vale.',
  sem_imovel: 'A pergunta não era de um imóvel: a nota só pode valer para todos.',
  texto_curta: 'Escreva a nota em uma frase.',
  texto_longa: `A nota passa de ${TETO_DA_NOTA} letras. Encurte.`,
  texto_arroba: 'Tire o e-mail ou o @: a nota não guarda contato.',
  texto_link: 'Tire o link.',
  texto_marcador: 'Tire o marcador de nome.',
  texto_codigo: 'Tire o código do anúncio.',
  texto_telefone: 'Tire o número comprido: parece telefone.',
};

/** A frase da recusa do banco, com quem já decidiu quando ele diz. */
export function fraseDoMotivoDaNota(motivo: string | null | undefined, por?: string | null): string {
  if (motivo === 'ja_decidida' && por) return `${por} já decidiu essa sugestão.`;
  return (motivo && MOTIVOS[motivo]) || 'Não deu certo. Tente de novo.';
}

/** O texto da nota para o alcance escolhido (o do outro, se este não existir). */
export function textoDoAlcance(nota: NotaSugerida, alcance: Alcance): string {
  return (alcance === 'imovel' ? nota.textoDoImovel : nota.textoGeral) ?? '';
}

/** Os alcances que a nota tem (sem imóvel, só "todos"). */
export function alcancesDaNota(nota: NotaSugerida): readonly Alcance[] {
  return [
    ...(nota.textoDoImovel !== null && nota.ondeNoImovel !== null ? (['imovel'] as const) : []),
    ...(nota.textoGeral !== null ? (['geral'] as const) : []),
  ];
}

/** "Entra na FICHA 5 · …", "Entra numa ficha nova: …", "Entra na nota 8 · …". */
export function ondeEntra(nota: NotaSugerida, alcance: Alcance): string {
  if (alcance === 'imovel') {
    const onde = nota.ondeNoImovel ?? 'a ficha do imóvel';
    return nota.fichaNova ? `Entra numa ficha nova: ${onde}` : `Entra na ${onde}`;
  }
  return nota.ondeNoGeral
    ? `Entra na nota ${nota.ondeNoGeral} (vale para todos os imóveis)`
    : 'Entra numa nota nova, que vale para todos os imóveis';
}

/** O rótulo de cada alcance no cartão. */
export function rotuloDoAlcance(nota: NotaSugerida, alcance: Alcance): string {
  if (alcance === 'geral') return 'Todos os imóveis da Imova';
  return nota.imovel ? `Só ${nota.imovel}` : 'Só este imóvel';
}

/** A conversa da resposta: com ficha, `?org=`; sem, `?cliente=` (como as outras telas). */
export function caminhoDaConversa(conversaId: string | null, organizacaoId: string | null): string {
  if (organizacaoId) return `/conversas?org=${encodeURIComponent(organizacaoId)}`;
  if (conversaId) return `/conversas?cliente=${encodeURIComponent(conversaId)}`;
  return '/conversas';
}

/** O cartão no canto aparece só para quem respondeu, nas 2 horas seguintes à resposta. */
export function apareceNoCanto(nota: NotaSugerida, agora: number): boolean {
  if (!nota.respondidaPorMim) return false;
  const quando = Date.parse(nota.respondidaEm ?? nota.criadaEm);
  return Number.isFinite(quando) && agora - quando < 2 * 60 * 60 * 1000;
}

export function lerNotaSugerida(bruto: unknown): NotaSugerida | null {
  const v = (bruto ?? {}) as Record<string, unknown>;
  const id = texto(v.id);
  const decisaoId = texto(v.decisao_id);
  const pergunta = texto(v.pergunta);
  const resposta = texto(v.resposta);
  const textoDoImovel = texto(v.texto_imovel);
  const textoGeral = texto(v.texto_geral);
  if (id === null || decisaoId === null || pergunta === null || resposta === null) return null;
  if (textoDoImovel === null && textoGeral === null) return null;
  const alcanceSugerido: Alcance =
    v.escopo_sugerido === 'geral' && textoGeral !== null
      ? 'geral'
      : textoDoImovel !== null
        ? 'imovel'
        : 'geral';
  return {
    id,
    decisaoId,
    caminho: caminhoDaConversa(texto(v.conversation_id), texto(v.organization_id)),
    pergunta,
    resposta,
    textoDoImovel,
    textoGeral,
    alcanceSugerido,
    imovel: texto(v.imovel),
    codigo: texto(v.codigo),
    ondeNoImovel: texto(v.onde_imovel),
    fichaNova: v.ficha_nova === true,
    ondeNoGeral: texto(v.onde_geral),
    respondidaPor: texto(v.respondida_por),
    respondidaPorMim: v.respondida_por_mim === true,
    respondidaEm: texto(v.respondida_em),
    criadaEm: texto(v.criado_em) ?? new Date(0).toISOString(),
  };
}

export async function lerNotasSugeridas(): Promise<NotaSugerida[]> {
  const { data, error } = await createClient().rpc('ia_notas_sugeridas_abertas');
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : [])
    .map(lerNotaSugerida)
    .filter((n): n is NotaSugerida => n !== null);
}

export type ResultadoDaNota =
  | { ok: true; onde: string | null; nova: boolean }
  | { ok: false; motivo: string; por: string | null };

function lerResultado(data: unknown, error: { message: string } | null): ResultadoDaNota {
  if (error) return { ok: false, motivo: error.message, por: null };
  const r = (data ?? {}) as Record<string, unknown>;
  if (r.ok !== true) return { ok: false, motivo: String(r.motivo ?? 'falhou'), por: texto(r.por) };
  return { ok: true, onde: texto(r.onde), nova: r.nova === true };
}

/** Guarda no caderno; `texto` nulo guarda o que a IA escreveu para o alcance. */
export async function guardarNota(
  id: string,
  alcance: Alcance,
  textoEditado: string | null,
): Promise<ResultadoDaNota> {
  const { data, error } = await createClient().rpc('ia_nota_guardar', {
    p_id: id,
    p_escopo: alcance,
    p_texto: textoEditado === null ? null : limparNota(textoEditado),
  });
  return lerResultado(data, error);
}

/** "Agora não": a sugestão sai e nada entra no caderno. */
export async function descartarNota(id: string): Promise<ResultadoDaNota> {
  const { data, error } = await createClient().rpc('ia_nota_descartar', { p_id: id });
  return lerResultado(data, error);
}
