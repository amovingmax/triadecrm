import type { Metadata } from 'next';

import { requireSession } from '@/lib/auth/session';
import { carregarContextoDaAgenda } from '@/components/agenda/dados';
import { TelaAgenda } from '@/components/agenda/tela-agenda';
import { hojeEmNatal, type Dia, type Visao } from '@/components/agenda/tipos';
import { ProvedorConsultas } from '@/components/consultas/provedor-consultas';

export const metadata: Metadata = { title: 'Agenda' };

/**
 * Agenda: reuniões e visitas da semana (PRD §7.5, RF-AGE e RF-ROT).
 *
 * O servidor faz quatro coisas e sai da frente: exige sessão (o proxy já barra antes;
 * aqui é a segunda camada), entrega o contexto que a folha de desfecho precisa
 * (catálogo, motivos de perda, etapas, feriados — o mesmo da tela de registrar
 * contato), resolve o dia e a visão da query string, e carimba o "hoje" em
 * `America/Fortaleza`.
 *
 * O "hoje" e o "agora" vêm daqui de propósito: ler o relógio durante a renderização
 * do cliente é impuro (a mesma árvore devolveria valores diferentes em dois desenhos)
 * e é o que a regra `react-hooks/purity` proíbe. A busca dos compromissos roda no
 * cliente, com TanStack Query, porque a semana muda o dia inteiro.
 */
export default async function Pagina({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [sessao, contexto, params] = await Promise.all([
    requireSession(),
    carregarContextoDaAgenda(),
    searchParams,
  ]);

  const agora = new Date();
  const hoje = hojeEmNatal(agora);

  return (
    <ProvedorConsultas>
      <TelaAgenda
        usuarioId={sessao.id}
        contexto={contexto}
        hoje={hoje}
        agoraIso={agora.toISOString()}
        diaInicial={diaDaUrl(params.dia) ?? hoje}
        visaoInicial={params.visao === 'semana' ? ('semana' as Visao) : ('dia' as Visao)}
      />
    </ProvedorConsultas>
  );
}

/** `?dia=2026-09-10`, quando é uma data de calendário de verdade. */
function diaDaUrl(valor: string | string[] | undefined): Dia | null {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return null;
  const instante = new Date(`${valor}T12:00:00Z`);
  return Number.isNaN(instante.getTime()) || instante.toISOString().slice(0, 10) !== valor
    ? null
    : valor;
}
