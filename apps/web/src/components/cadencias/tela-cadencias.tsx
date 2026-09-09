'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCw, Sunrise } from 'lucide-react';

import { LEITURA } from '@/lib/larguras';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import { AvisoDoEnvio, TetosDoDia } from './aviso-do-envio';
import { CartaoDaCadencia } from './cartao-da-cadencia';
import { buscarCadencias, mensagemDoErro } from './consultas';
import { DialogoDeMatricula } from './dialogo-matricula';
import { ErroDaTela, EsqueletoDasCadencias, NinguemEmCadencia } from './estados';
import { contatosNaCadencia } from './tipos';
import { usePapel } from './usar-papel';

/**
 * Cadências (RF-CON-13..17; R13 §7).
 *
 * A tela responde a três perguntas, nesta ordem:
 *
 *  1. **o que a máquina faz sozinha?** — e a resposta honesta abre a tela, porque uma
 *     lista de réguas cheia de setas sugere um robô que não existe;
 *  2. **quanto do teto do dia já foi usado?** — é o número que explica por que um
 *     toque pronto pode ficar para amanhã (RF-CON-10);
 *  3. **qual é a régua, e quem está parado em qual passo?** — os passos em ordem, com
 *     canal, atraso e condição, e a contagem de organizações em cada um.
 *
 * As três respostas vêm de uma chamada só (`public.cadencias_visao`), porque têm de
 * ser do mesmo instante: um teto lido às 10:00 ao lado de uma contagem lida às 10:03 é
 * uma tela que se contradiz sozinha. A segunda chamada (`public.meu_papel`) não
 * responde nenhuma delas — ela só diz se esta pessoa pode matricular, muda uma vez por
 * login e fica em cache por meia hora.
 *
 * A quarta pergunta chegou em 09/09 e é a que faltava: **como alguém entra numa
 * régua?** Até então `matricular_em_cadencia` existia no banco sem uma única chamada
 * no produto inteiro, e esta tela mostrava cinco réguas ligadas e permanentemente
 * vazias. O botão "Matricular" de cada cartão é a porta.
 */
export function TelaCadencias({ podeLigarDesligar }: { podeLigarDesligar: boolean }) {
  const clienteDeConsultas = useQueryClient();
  const visao = useQuery({ queryKey: ['cadencias', 'visao'], queryFn: buscarCadencias });
  // Quem matricula é `app.pode_matricular()`, e é o banco que responde: repetir a
  // lista de papéis aqui seria a segunda verdade que o ADR-03 evita.
  const papel = usePapel();
  const [matriculando, setMatriculando] = useState<{ slug: string; nome: string } | null>(null);

  const atualizar = useCallback(() => {
    void clienteDeConsultas.invalidateQueries({ queryKey: ['cadencias'] });
  }, [clienteDeConsultas]);

  const cadencias = visao.data?.cadencias ?? [];
  const ligadas = cadencias.filter((c) => c.ativa).length;
  const dentro = cadencias.reduce((soma, c) => soma + contatosNaCadencia(c), 0);

  return (
    <div className={cn(LEITURA, 'flex flex-col gap-5')}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Cadências</h1>
          <p className="text-sm text-muted-foreground">
            {visao.isPending ? (
              'carregando as réguas...'
            ) : visao.isError ? (
              'não deu para ler as réguas'
            ) : (
              <>
                {/* "Ligada" dizia respeito à chave; o que a chave controla é a
                    ENTRADA. Enquanto não havia porta de matrícula, a diferença não
                    aparecia — agora aparece, e a frase passa a ser a de quem opera. */}
                <span className="numerico">{ligadas}</span> de{' '}
                <span className="numerico">{cadencias.length}</span>
                {cadencias.length === 1 ? ' régua aceita' : ' réguas aceitam'} matrícula
                {' · '}
                {dentro > 0 ? (
                  <>
                    <span className="numerico">{dentro}</span>
                    {dentro === 1 ? ' organização dentro' : ' organizações dentro'}
                  </>
                ) : (
                  'nenhuma organização dentro'
                )}
                {/* Uma vez, aqui em cima — e não repetido nos cinco cartões. */}
                {podeLigarDesligar ? null : ' · ligar e desligar é de gestor ou admin'}
              </>
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* Abaixo de `sm` o rótulo some e sobra um sol. Um ícone sem nome não é
              link: no leitor de tela vira "link", sem mais nada, e no toque vira
              adivinhação. O `sr-only` devolve o nome sem devolver a largura. */}
          <Button asChild variant="outline" className="toque h-11 md:h-9">
            <Link href="/cadencias/resumo" aria-label="Abrir o Resumo do dia">
              <Sunrise aria-hidden="true" />
              <span className="hidden sm:inline">Resumo do dia</span>
              <span className="sr-only sm:hidden">Resumo do dia</span>
            </Link>
          </Button>
          <Button
            variant="outline"
            onClick={atualizar}
            disabled={visao.isFetching}
            aria-label="Atualizar as cadências"
            className="toque h-11 md:h-9"
          >
            <RotateCw className={cn(visao.isFetching && 'animate-spin')} aria-hidden="true" />
            <span className="sr-only">Atualizar</span>
          </Button>
        </div>
      </header>

      {visao.isPending ? (
        <EsqueletoDasCadencias />
      ) : visao.isError ? (
        <ErroDaTela
          titulo="Não deu para carregar as cadências"
          causa={mensagemDoErro(visao.error)}
          aoTentar={atualizar}
        />
      ) : (
        <>
          <AvisoDoEnvio visao={visao.data} />
          <TetosDoDia visao={visao.data} />

          {dentro === 0 ? (
            <NinguemEmCadencia quantasLigadas={ligadas} podeMatricular={papel.matricula} />
          ) : null}

          <section aria-label="As réguas" className="flex flex-col gap-4">
            {visao.data.cadencias.map((cadencia) => (
              <CartaoDaCadencia
                key={cadencia.slug}
                cadencia={cadencia}
                podeLigarDesligar={podeLigarDesligar}
                podeMatricular={papel.matricula}
                aoMudar={atualizar}
                aoMatricular={() => setMatriculando({ slug: cadencia.slug, nome: cadencia.nome })}
              />
            ))}
          </section>
        </>
      )}

      <DialogoDeMatricula cadencia={matriculando} aoFechar={() => setMatriculando(null)} />
    </div>
  );
}
