'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { PhoneCall } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { Dia } from '@/components/agenda/tipos';
import { ErroDoRelatorio, EsqueletoRelatorio } from '@/components/relatorios/estados';

import { carregarLigacoesDoDia, chaveDasLigacoesDoDia, mensagemDoErro } from './dados';
import { DiaDaPessoa } from './dia-da-pessoa';
import { PassoDoDia } from './passo-do-dia';

/**
 * O Meu dia de quem liga (pivô de 06/10/2026).
 *
 * Quem liga é gente contratada por diária, e o dia dela é uma coisa só: ligar.
 * Por isso esta tela não é o Meu dia da gestão com menos abas — é outra, e tem
 * duas perguntas: "o que eu fiz hoje?" e "onde eu continuo?". Sem fila de quem
 * respondeu, sem meta, sem funil.
 *
 * Os números são os MESMOS que a gestão vê no relatório (`DiaDaPessoa`, lendo
 * `public.ligacoes_do_dia`): quem liga confere o próprio dia antes de alguém
 * conferir por ela.
 */
export function MeuDiaDeQuemLiga({
  usuarioId,
  nome,
  saudacao,
  hoje,
}: {
  usuarioId: string;
  nome: string;
  saudacao: string;
  hoje: Dia;
}) {
  const [dia, setDia] = useState<Dia>(hoje);
  const consulta = useQuery({
    queryKey: chaveDasLigacoesDoDia(dia, usuarioId),
    queryFn: () => carregarLigacoesDoDia(dia, usuarioId),
    // Quem volta da tela de Ligar espera ver a ligação que acabou de fazer.
    refetchOnMount: 'always',
  });

  const eu = consulta.data?.pessoas.find((p) => p.pessoa_id === usuarioId) ?? null;
  const jaLigouHoje = dia === hoje && (eu?.ligacoes ?? 0) > 0;

  return (
    <div className="flex w-full flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Início · Meu dia</p>
          <h1 className="mt-1 font-heading text-[32px] leading-tight font-normal tracking-[-0.02em]">
            {saudacao}, {nome}
          </h1>
        </div>
        <Button asChild className="toque h-11">
          <Link href="/ligar">
            <PhoneCall aria-hidden="true" />
            {jaLigouHoje ? 'Continuar ligando' : 'Começar a ligar'}
          </Link>
        </Button>
      </header>

      <div className="sombra-base rounded-xl bg-card p-4">
        <PassoDoDia dia={dia} hoje={hoje} aoTrocar={setDia} />
      </div>

      {consulta.isPending ? (
        <EsqueletoRelatorio colunas={5} linhas={5} />
      ) : consulta.isError ? (
        <ErroDoRelatorio
          causa={mensagemDoErro(consulta.error)}
          aoTentar={() => void consulta.refetch()}
        />
      ) : eu ? (
        <>
          <DiaDaPessoa pessoa={eu} dia={dia} />
          {eu.ligacoes === 0 ? (
            <p className="text-sm text-muted-foreground">
              {dia === hoje
                ? 'Você ainda não ligou hoje. Cada ligação que fizer aparece aqui assim que desligar.'
                : 'Você não ligou neste dia.'}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
