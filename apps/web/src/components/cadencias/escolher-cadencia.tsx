'use client';

import { useEffect, useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Route } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ICONE_CANAL } from '@/components/conversas/icones';

import {
  buscarPortaDoNegocio,
  chaveDaPortaDoNegocio,
  matricular,
  mensagemDoErro,
} from './consultas';
import {
  cadenciaAceita,
  fraseDoPrimeiroToque,
  mensagemDaRecusaDeMatricula,
  nomeDoCanal,
  recusaPedeCampo,
  type CadenciaDoNegocio,
} from './tipos';

/**
 * A porta de entrada da cadência, onde a pergunta nasce.
 *
 * `public.matricular_em_cadencia` está no banco desde 04/09 e, até esta tela, nada a
 * chamava: as cinco réguas apareciam ligadas e vazias, e iam continuar vazias. A
 * pergunta "quem cobra o retorno deste parceiro?" nasce no segundo em que alguém
 * move um cartão de etapa — então é aí que a resposta é oferecida, e não numa tela
 * separada que ninguém abre no meio do trabalho.
 *
 * ---------------------------------------------------------------------------
 * Três decisões, e o argumento de cada uma
 * ---------------------------------------------------------------------------
 *
 * 1. **A oferta só aparece quando o banco diz que aceita.** `cadencias_do_negocio`
 *    consulta o MESMO guarda que a gravação consulta (`app.recusa_de_matricula`), com
 *    as mesmas nove recusas na mesma ordem. Não há aqui nenhuma cópia da regra — e é
 *    por isso que uma décima recusa, no dia em que existir, chega a esta tela sem uma
 *    linha de TypeScript nova.
 *
 * 2. **A régua recusada aparece com o motivo, em vez de sumir.** Uma lista que só
 *    mostra o que dá certo faz a pessoa procurar a régua que ela esperava e não achar.
 *    "Este parceiro já está numa régua" encerra a procura em uma frase.
 *
 * 3. **Nada aqui é obrigatório.** Matricular é oferta, não etapa do formulário: a
 *    folha de mover já terminou o trabalho dela quando esta parte aparece, e "Agora
 *    não" fecha sem nenhum aviso. Uma pergunta que trava o fluxo vira uma pergunta que
 *    todo mundo responde no automático.
 */
export function EscolherCadencia({
  dealId,
  aoFechar,
  aoNadaAOferecer,
}: {
  dealId: string;
  /** Chamado por "Agora não" e depois de a matrícula ser aceita. */
  aoFechar: () => void;
  /**
   * O banco não tem nada a oferecer para este negócio (etapa de encerramento, papel
   * sem matrícula, todas as réguas recusando). Quem chama precisa saber, senão fica
   * uma folha aberta com um cabeçalho e nada embaixo.
   */
  aoNadaAOferecer?: () => void;
}) {
  const idGancho = useId();
  const cliente = useQueryClient();
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const [gancho, setGancho] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);

  const porta = useQuery({
    queryKey: chaveDaPortaDoNegocio(dealId),
    queryFn: () => buscarPortaDoNegocio(dealId),
    // Um toque pendente que nasce em outra aba muda a resposta: uma lista velha
    // ofereceria justamente o que o banco acabou de fechar.
    staleTime: 0,
  });

  const resposta = porta.data;
  const sugeridas =
    resposta?.ok && resposta.papel_matricula ? resposta.cadencias.filter((c) => c.sugerida) : [];
  // Só depois de a resposta chegar: enquanto a consulta corre, "nada a oferecer" seria
  // um palpite, e fecharia a folha antes de o banco ter dito qualquer coisa.
  const nadaAOferecer = (porta.isError || Boolean(resposta)) && sugeridas.length === 0;

  useEffect(() => {
    if (nadaAOferecer) aoNadaAOferecer?.();
  }, [nadaAOferecer, aoNadaAOferecer]);

  if (porta.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-2 rounded-xl border border-hairline p-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-11 w-full rounded-lg" />
      </div>
    );
  }

  // A oferta é um extra: se ela falhar, o movimento do cartão continua feito e a
  // folha não vira uma tela de erro por causa de uma pergunta opcional.
  if (!resposta || !resposta.ok || !resposta.papel_matricula) return null;
  if (sugeridas.length === 0) return null;

  const negocio = resposta.negocio;
  const alvo = sugeridas.find((c) => c.slug === escolhida) ?? null;
  const precisaDeGancho = alvo ? alvo.exige_gancho : false;

  async function enviar() {
    if (!alvo) return;
    setSalvando(true);
    setFalha(null);
    try {
      const feito = await matricular({
        organizationId: negocio.organization_id,
        slug: alvo.slug,
        gancho: precisaDeGancho ? gancho : null,
        dealId: negocio.deal_id,
      });
      if (!feito.ok) {
        setFalha(mensagemDaRecusaDeMatricula(feito.motivo));
        // A recusa pode ter nascido entre a leitura e o envio (outra pessoa
        // matriculou primeiro): reler é o que faz a lista parar de mentir.
        void porta.refetch();
        return;
      }
      toast.success(`${negocio.organizacao} entrou em ${alvo.nome}.`, {
        description: fraseDoPrimeiroToque(feito.primeiro_toque),
      });
      void cliente.invalidateQueries({ queryKey: ['cadencias'] });
      aoFechar();
    } catch (erro) {
      setFalha(mensagemDoErro(erro));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section
      aria-label="Matricular numa régua"
      className="flex flex-col gap-3 rounded-xl border border-hairline p-3"
    >
      <div className="flex items-start gap-2">
        <Route aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="text-sm">
          <span className="font-medium">Quem cobra o retorno?</span>{' '}
          <span className="text-muted-foreground">
            {negocio.organizacao} está em {negocio.etapa}. A régua agenda as tarefas de
            acompanhamento até alguém responder — ela não manda mensagem sozinha.
          </span>
        </p>
      </div>

      <ul className="flex flex-col overflow-hidden rounded-lg border border-hairline">
        {sugeridas.map((cadencia) => (
          <OpcaoDeCadencia
            key={cadencia.slug}
            cadencia={cadencia}
            marcada={cadencia.slug === escolhida}
            aoEscolher={() => {
              setEscolhida(cadencia.slug);
              setFalha(null);
            }}
          />
        ))}
      </ul>

      {precisaDeGancho ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={idGancho} className="text-sm font-medium">
            Gancho do novo contato
          </label>
          <Input
            id={idGancho}
            value={gancho}
            onChange={(evento) => setGancho(evento.target.value)}
            placeholder="Ex.: lead real de casamento em dezembro no bairro dele"
            className="h-11 md:h-9"
          />
          <p className="text-xs text-muted-foreground">
            O banco recusa esta régua sem gancho, e é de propósito: reativar sem motivo real é
            recomeçar do zero com quem já disse não uma vez.
          </p>
        </div>
      ) : null}

      {falha ? (
        <p role="alert" className="text-sm text-destructive-texto">
          {falha}
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
        <Button type="button" variant="ghost" onClick={aoFechar} className="toque h-11 md:h-9">
          Agora não
        </Button>
        <Button
          type="button"
          onClick={() => void enviar()}
          disabled={!alvo || salvando || (precisaDeGancho && gancho.trim().length === 0)}
          className="toque h-11 md:h-9"
        >
          {salvando ? (
            <>
              <Loader2 aria-hidden="true" className="animate-spin" />
              Matriculando...
            </>
          ) : (
            'Matricular'
          )}
        </Button>
      </div>
    </section>
  );
}

/**
 * Uma régua na lista.
 *
 * A recusada não some: ela fica cinza, sem rádio, com a frase do banco embaixo. É a
 * diferença entre "esta régua não está aqui" (a pessoa procura de novo amanhã) e
 * "este parceiro já está numa régua" (a pessoa entende e segue).
 */
function OpcaoDeCadencia({
  cadencia,
  marcada,
  aoEscolher,
}: {
  cadencia: CadenciaDoNegocio;
  marcada: boolean;
  aoEscolher: () => void;
}) {
  const aceita = cadenciaAceita(cadencia);
  const canal = cadencia.primeiro_passo?.canal ?? null;
  const Icone = canal ? ICONE_CANAL[canal] : null;

  if (!aceita) {
    return (
      <li className="flex flex-col gap-0.5 border-b border-hairline px-3 py-2.5 opacity-60 last:border-b-0">
        <span className="text-sm font-medium">{cadencia.nome}</span>
        <span className="text-xs text-muted-foreground">
          {mensagemDaRecusaDeMatricula(cadencia.motivo ?? '')}
        </span>
      </li>
    );
  }

  return (
    <li className="border-b border-hairline last:border-b-0">
      <label
        className={cn(
          'toque flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors',
          marcada ? 'bg-muted' : 'hover:bg-muted/50',
        )}
      >
        <input
          type="radio"
          name="cadencia-do-negocio"
          value={cadencia.slug}
          checked={marcada}
          onChange={aoEscolher}
          className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-medium">{cadencia.nome}</span>
          <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            {Icone ? <Icone className="size-3 shrink-0" aria-hidden="true" /> : null}
            {canal ? `Começa por ${nomeDoCanal(canal).toLowerCase()}` : 'Régua sem passos'}
            {' · '}
            <span className="numerico">{cadencia.passos}</span>
            {cadencia.passos === 1 ? ' passo' : ' passos'}
          </span>
          {cadencia.nota_de_entrada ? (
            <span className="text-xs text-muted-foreground">
              Entra aqui quem: {cadencia.nota_de_entrada}
            </span>
          ) : null}
          {/* `gancho_obrigatorio` é a única recusa que a própria folha resolve, e
              dizer isso antes evita o clique que ia falhar. */}
          {recusaPedeCampo(cadencia.motivo) ? (
            <span className="text-xs text-muted-foreground">
              Precisa de um gancho escrito por gente.
            </span>
          ) : null}
        </span>
      </label>
    </li>
  );
}
