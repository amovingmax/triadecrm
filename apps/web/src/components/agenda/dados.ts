import { createClient } from '@/lib/supabase/server';
import { carregarPessoasAcompanhadas } from '@/lib/auth/equipe';
import type { Sessao } from '@/lib/auth/session';
import { carregarContextoDoRegistro, type ContextoDoRegistro } from '@/components/registro/dados';

/**
 * O que o servidor entrega pronto para a Agenda.
 *
 * Reusa inteiro o contexto da tela de registrar contato (catálogo de desfechos,
 * motivos de perda, etapas, feriados e formatos de reunião por funil): a Agenda
 * devolve o desfecho de um compromisso pela MESMA `public.registrar_contato`, então
 * precisa exatamente das mesmas listas. Acrescenta o que a outra tela não usa: quais
 * etapas significam "reunião com hora combinada" e, para admin e gestor, as pessoas
 * cuja agenda eles podem abrir.
 */
export type ContextoDaAgenda = ContextoDoRegistro & {
  /**
   * Ids das etapas cujo `required_fields` exige `meeting_at` — hoje `reuniao_marcada`
   * (funil fornecedor) e `demonstracao_marcada` (produtor). É a régua que separa uma
   * reunião marcada de uma tarefa "Marcar apresentação"; ver o cabeçalho de `tipos.ts`.
   * Lido do banco, e não de uma lista de slugs em código, porque o gestor edita as
   * etapas (RF-ADM-02).
   */
  etapasComHoraMarcada: number[];
  /**
   * Para o seletor da visão da equipe: a própria pessoa e quem ela acompanha pela
   * hierarquia (`lib/auth/hierarquia.ts` — o admin vê gestor, SDR e embaixador; o
   * gestor vê SDR e embaixador). Vazia quando `equipeDe` não é passado, e a tela nem
   * mostra o seletor.
   */
  pessoas: PessoaDaAgenda[];
};

export type PessoaDaAgenda = { id: string; nome: string };

export async function carregarContextoDaAgenda(
  opcoes: { equipeDe?: Pick<Sessao, 'id' | 'nome' | 'papel'> } = {},
): Promise<ContextoDaAgenda> {
  const supabase = await createClient();
  const [registro, etapas, pessoas] = await Promise.all([
    carregarContextoDoRegistro(),
    supabase.from('stages').select('id, required_fields'),
    opcoes.equipeDe ? carregarPessoasAcompanhadas(opcoes.equipeDe) : Promise.resolve([]),
  ]);

  return {
    ...registro,
    etapasComHoraMarcada: etapasQueMarcamHora(etapas.data ?? []),
    pessoas,
  };
}

/** As etapas que declaram `meeting_at` entre os campos obrigatórios. */
export function etapasQueMarcamHora(
  etapas: readonly { id: number; required_fields: unknown }[],
): number[] {
  return etapas
    .filter((etapa) =>
      Array.isArray(etapa.required_fields)
        ? etapa.required_fields.some(
            (campo) =>
              typeof campo === 'object' &&
              campo !== null &&
              (campo as { field?: unknown }).field === 'meeting_at',
          )
        : false,
    )
    .map((etapa) => etapa.id);
}
