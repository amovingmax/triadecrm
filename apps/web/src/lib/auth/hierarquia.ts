import type { AppRole } from './role';

/**
 * Quem acompanha o dia de quem: métricas (Meu dia, Metas) e agenda.
 *
 * A regra é de cima para baixo e só isso: o admin acompanha gestor, SDR e
 * embaixador; o gestor acompanha SDR e embaixador. Ninguém acompanha um par (gestor
 * não abre o dia de outro gestor) nem quem está acima.
 *
 * Leitura e financeiro ficam de fora da lista de propósito: não têm agenda, não
 * registram contato e não têm meta de campo — no seletor seriam um nome que abre
 * uma tela vazia. O robô, pelo mesmo motivo.
 *
 * É regra de TELA, não de segurança: a RLS de `activities` e `tasks` já deixa quem
 * enxerga tudo ler a base inteira (`app.sees_all()`), e `public.meu_dia` e
 * `public.goal_progress` aceitam outra pessoa para qualquer gestor ou admin. O que
 * esta regra decide é quem aparece para ser escolhido.
 */
const ACOMPANHA: Readonly<Record<AppRole, readonly AppRole[]>> = {
  admin: ['gestor', 'sdr', 'embaixador'],
  gestor: ['sdr', 'embaixador'],
  sdr: [],
  embaixador: [],
  leitura: [],
  financeiro: [],
  bot: [],
};

/** Os papéis cujo dia `papel` pode abrir, além do próprio. */
export function papeisAcompanhados(papel: AppRole): readonly AppRole[] {
  return ACOMPANHA[papel];
}

/** O papel acompanha alguém: é o que liga o seletor de pessoa nas telas. */
export function acompanhaEquipe(papel: AppRole): boolean {
  return ACOMPANHA[papel].length > 0;
}

export type PessoaDoTime = { id: string; nome: string; papel: AppRole | null };

/** Uma pessoa do seletor. O papel vai junto: o Meu dia precisa dele (ver `tela-meu-dia`). */
export type PessoaAcompanhada = { id: string; nome: string; papel: AppRole };

/**
 * A lista do seletor: a própria pessoa primeiro, depois quem ela acompanha, em
 * ordem alfabética. Quem não tem papel conhecido não entra — na dúvida, não mostra.
 */
export function pessoasAcompanhadas(
  eu: { id: string; nome: string; papel: AppRole },
  time: readonly PessoaDoTime[],
): PessoaAcompanhada[] {
  const abaixo = ACOMPANHA[eu.papel];
  const outras = time
    .flatMap((p) =>
      p.id !== eu.id && p.papel !== null && abaixo.includes(p.papel)
        ? [{ id: p.id, nome: p.nome, papel: p.papel }]
        : [],
    )
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  return [{ id: eu.id, nome: eu.nome, papel: eu.papel }, ...outras];
}

/** `?pessoa=` só vale se estiver na lista; senão, a tela abre no dia de quem entrou. */
export function pessoaPedida(
  pedida: string | string[] | undefined,
  lista: readonly { id: string }[],
  euId: string,
): string {
  return typeof pedida === 'string' && lista.some((p) => p.id === pedida) ? pedida : euId;
}
