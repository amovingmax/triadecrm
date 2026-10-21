import type { QueryClient } from '@tanstack/react-query';

import { hojeEmNatal } from '@/components/agenda/tipos';
import { buscarMeuPapel, CHAVE_MEU_PAPEL } from '@/components/cadencias/usar-papel';
import { carregarConversas, CHAVE_CONVERSAS } from '@/components/conversas/dados';
import { carregarFunisDisponiveis, CHAVE_FUNIS_DISPONIVEIS } from '@/components/funis/acoes/consultas';
import { filtrosQuadroDaUrl } from '@/components/funis/tipos';
import { consultaDoQuadro } from '@/components/funis/use-quadro';
import { carregarLigacoesDoDia, chaveDasLigacoesDoDia } from '@/components/ligacoes-do-dia/dados';
import { carregarLotes, CHAVE_LOTES } from '@/components/ligacao/consultas';
import { buscarParceiros, chaveDaBusca } from '@/components/parceiros/busca';
import { carregarConsultoria, CHAVE_CONSULTORIA } from '@/components/parceiros/consultoria';
import { filtrosDaUrl } from '@/components/parceiros/tipos';
import { buscarFila, buscarResumo, chaveDaFila } from '@/components/revisao/dados';
import { FILTROS_INICIAIS } from '@/components/revisao/tipos';
import { type AppRole } from '@/lib/auth/role';
import { podeMarcarConsultoria } from '@/lib/navegacao';

/**
 * O que cada tela do menu busca AO ABRIR, para ser buscado antes do toque
 * (`adiantar-dados.tsx`). Cada entrada usa a mesma chave e a mesma função da própria
 * tela — se divergissem, o que veio antes nunca seria achado. A tela aberta pelo
 * menu é sempre a do endereço sem filtro (`/parceiros`, `/funis`), então o recorte é
 * o padrão da URL vazia.
 *
 * Ficam de fora o Meu dia (é a tela de entrada, e já está aberta), a Agenda (a busca
 * dela depende do catálogo e das etapas que o servidor entrega à página) e as Metas
 * (uma consulta por pessoa da equipe). Delas o menu adianta só a página e o código.
 *
 * Só leitura: são as mesmas consultas que a tela faria um instante depois.
 *
 * Este arquivo é baixado só quando o aparelho fica ocioso (`import()`), para não
 * pesar a primeira carga; e o código que ele traz é o mesmo que as telas usam.
 */
export type Adiantador = (cliente: QueryClient, papel: AppRole) => Promise<void>;

type Consulta = { queryKey: readonly unknown[]; queryFn: () => Promise<unknown> };

/**
 * Busca só o que ainda não está no aparelho. O que já está, a tela mostra na hora e
 * renova por cima ao abrir (`provedor-consultas.tsx`); buscar de novo aqui seria
 * dobrar o pedido.
 */
async function seFaltar(cliente: QueryClient, consulta: Consulta): Promise<void> {
  if (cliente.getQueryData(consulta.queryKey) !== undefined) return;
  await cliente.prefetchQuery(consulta);
}

export const ADIANTADORES: Readonly<Partial<Record<string, Adiantador>>> = {
  '/ligar': (cliente) => seFaltar(cliente, { queryKey: CHAVE_LOTES, queryFn: carregarLotes }),

  '/parceiros': async (cliente, papel) => {
    const filtros = filtrosDaUrl({});
    await Promise.all([
      seFaltar(cliente, { queryKey: chaveDaBusca(filtros), queryFn: () => buscarParceiros(filtros) }),
      podeMarcarConsultoria(papel)
        ? seFaltar(cliente, { queryKey: CHAVE_CONSULTORIA, queryFn: carregarConsultoria })
        : undefined,
    ]);
  },

  // O quadro depende do id do funil padrão, que vem da lista de funis: a mesma
  // ordem em que a tela pergunta.
  '/funis': async (cliente) => {
    const filtros = filtrosQuadroDaUrl({});
    const [funis] = await Promise.all([
      cliente.ensureQueryData({ queryKey: CHAVE_FUNIS_DISPONIVEIS, queryFn: carregarFunisDisponiveis }),
      seFaltar(cliente, { queryKey: CHAVE_MEU_PAPEL, queryFn: buscarMeuPapel }),
    ]);
    const funil = funis.find((f) => f.slug === filtros.funil);
    if (funil) await seFaltar(cliente, consultaDoQuadro(filtros, funil.id));
  },

  '/conversas': (cliente) =>
    seFaltar(cliente, { queryKey: CHAVE_CONVERSAS, queryFn: carregarConversas }),

  '/revisao': async (cliente) => {
    await Promise.all([
      seFaltar(cliente, { queryKey: ['radar', 'resumo'], queryFn: buscarResumo }),
      seFaltar(cliente, {
        queryKey: chaveDaFila(FILTROS_INICIAIS),
        queryFn: () => buscarFila(FILTROS_INICIAIS),
      }),
    ]);
  },

  // O painel que abre é o das ligações de hoje (`painelDaUrl`), do time inteiro.
  '/relatorios': async (cliente) => {
    const hoje = hojeEmNatal();
    await seFaltar(cliente, {
      queryKey: chaveDasLigacoesDoDia(hoje, null),
      queryFn: () => carregarLigacoesDoDia(hoje, null),
    });
  },
};
