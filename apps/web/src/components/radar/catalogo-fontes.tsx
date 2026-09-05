'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, CircleHelp, ExternalLink, Power, PowerOff } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { alternarFonte, buscarFontes, mensagemDoErro, MOTIVO_DA_FONTE } from './dados';
import { ErroDaFila } from './estados';
import {
  ROTULO_DO_CAMPO,
  ROTULO_DO_COLETOR,
  ROTULO_TIPO_DE_FONTE,
  type FonteDoRadar,
} from './tipos';

/**
 * O catálogo das 11 fontes (RF-RAD-01, RF-RAD-03; anexo R03 §1 e §2).
 *
 * É o "registro de operação" que o requisito exige ANTES de habilitar qualquer
 * fonte: base legal, avaliação dos termos de uso, `robots.txt` conferido e limite
 * de requisições. Cada texto aqui vem do banco (`sources`), que por sua vez veio
 * da avaliação do anexo R03 — nada é escrito na tela à mão.
 *
 * Ligar uma fonte aqui NÃO começa coleta nenhuma, e a distinção continua valendo
 * agora que o coletor existe: ligada quer dizer "liberada como origem" — ela pode
 * ser escolhida no cadastro de um candidato ou de um parceiro, e o coletor só a
 * lê quando alguém agenda uma coleta. Desligar, sim, para a coleta: o worker
 * recusa lote de fonte desligada (RF-RAD-01).
 */
export function CatalogoDeFontes({ podeLigar }: { podeLigar: boolean }) {
  const clienteDeConsultas = useQueryClient();
  const [alterando, setAlterando] = useState<number | null>(null);

  const consulta = useQuery({ queryKey: ['radar', 'fontes'], queryFn: buscarFontes });

  const mutacao = useMutation({
    mutationFn: ({ id, ligar }: { id: number; ligar: boolean }) => alternarFonte(id, ligar),
    onSuccess: (resposta, variaveis) => {
      if (!resposta.ok) {
        toast.error('Não deu para mudar essa fonte.', {
          description: MOTIVO_DA_FONTE[resposta.motivo ?? ''] ?? 'Tente de novo.',
        });
        return;
      }
      toast.success(variaveis.ligar ? 'Fonte ligada.' : 'Fonte desligada.', {
        description: variaveis.ligar
          ? 'Ela já pode ser escolhida como origem, e o coletor volta a aceitar coleta dela. Ligar não inicia coleta nenhuma sozinho.'
          : 'Ela deixa de aparecer como origem em cadastros novos, e o coletor passa a recusar coleta dela.',
      });
      void clienteDeConsultas.invalidateQueries({ queryKey: ['radar'] });
    },
    onError: (erro) =>
      toast.error('Não deu para mudar essa fonte.', {
        description: mensagemDoErro(erro),
      }),
    onSettled: () => setAlterando(null),
  });

  if (consulta.isPending) return <EsqueletoDasFontes />;
  if (consulta.isError) {
    return (
      <ErroDaFila causa={mensagemDoErro(consulta.error)} aoTentar={() => void consulta.refetch()} />
    );
  }

  const fontes = consulta.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
        As <span className="numerico">11</span> fontes avaliadas no anexo R03, com a base legal, o
        que os termos de uso permitem, o que o robots.txt libera e o intervalo mínimo entre
        requisições (RF-RAD-01 e RF-RAD-03).{' '}
        <span className="text-foreground">
          Ligar uma fonte aqui a libera como origem de cadastro — não inicia coleta nenhuma.
        </span>
      </p>

      <ul className="flex flex-col">
        {fontes.map((fonte) => (
          <LinhaDaFonte
            key={fonte.id}
            fonte={fonte}
            podeLigar={podeLigar}
            ocupada={alterando === fonte.id}
            aoAlternar={() => {
              setAlterando(fonte.id);
              mutacao.mutate({ id: fonte.id, ligar: !fonte.ligada });
            }}
          />
        ))}
      </ul>

      <p className="max-w-prose border-t border-hairline pt-4 text-xs leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">GetNinjas está fora das fontes</span>, por
        decisão do projeto: os termos proíbem uso comercial dos dados e a página pública não traz
        lista de profissionais nem contato. Ele serve só como sinal de demanda por categoria, em
        consulta manual — nunca coleta automatizada, nunca pedido falso de orçamento.
      </p>
    </div>
  );
}

function LinhaDaFonte({
  fonte,
  podeLigar,
  ocupada,
  aoAlternar,
}: {
  fonte: FonteDoRadar;
  podeLigar: boolean;
  ocupada: boolean;
  aoAlternar: () => void;
}) {
  const robots = leituraDoRobots(fonte);
  // Fonte em que nenhuma requisição sai daqui: manual, indicação e planilha.
  const semRobo = fonte.tipo === 'manual' || fonte.tipo === 'referral' || fonte.base_url === null;

  return (
    <li
      className={cn(
        'flex flex-col gap-3 border-b border-hairline py-4',
        !fonte.ligada && 'opacity-70',
        ocupada && 'pointer-events-none opacity-50',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <h3 className="font-heading text-[15px] leading-tight font-medium tracking-tight">
          {fonte.nome}
        </h3>
        <Badge variant="pilula" className="font-normal">
          {ROTULO_TIPO_DE_FONTE[fonte.tipo]}
        </Badge>
        {/* "já funciona" é só para o que de fato funciona hoje: as origens em que uma
            pessoa digita o dado. Todo o resto é promessa de calendário e é assim que
            aparece. */}
        {fonte.coletor === 'manual' ? (
          <Badge variant="pilula" className="font-normal">
            já funciona hoje
          </Badge>
        ) : fonte.fase ? (
          <Badge variant="pilula" className="font-normal">
            {fonte.fase === 'mvp' ? 'previsto para o MVP' : `previsto para a ${fonte.fase}`}
          </Badge>
        ) : null}
        {fonte.curadoria_manual ? (
          <Badge variant="pilula" className="font-normal">
            curadoria humana
          </Badge>
        ) : null}

        {podeLigar ? (
          <Button
            variant="outline"
            onClick={aoAlternar}
            aria-pressed={fonte.ligada}
            className="toque ml-auto h-11 md:h-8"
          >
            {fonte.ligada ? <PowerOff aria-hidden="true" /> : <Power aria-hidden="true" />}
            {fonte.ligada ? 'Desligar' : 'Ligar'}
          </Button>
        ) : (
          <Badge variant="pilula" className="ml-auto font-normal">
            {fonte.ligada ? 'ligada' : 'desligada'}
          </Badge>
        )}
      </div>

      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
        {semRobo ? (
          // Uma linha só. Dizer "robots.txt não avaliado", "sem requisição a
          // servidor de terceiro" e "entrada feita por pessoa" na mesma fonte é
          // repetir três vezes que ali não entra robô.
          <li className="flex items-center gap-1.5">
            <CircleCheck className="size-3.5" aria-hidden="true" />
            sem robô: o dado é enviado por uma pessoa
          </li>
        ) : (
          <>
            <li className="flex items-center gap-1.5">
              <robots.Icone className="size-3.5" aria-hidden="true" />
              {robots.texto}
            </li>
            <li>
              <span className="sr-only">Intervalo entre requisições: </span>
              <span className="numerico">1</span> requisição a cada{' '}
              <span className="numerico">{fonte.intervalo_segundos}</span> s
            </li>
            {fonte.periodicidade ? <li>coleta {fonte.periodicidade}</li> : null}
            <li>
              {/* O que o banco guarda em `collector.enabled` é "previsto para esta
                  fase", não "rodando". Nenhum coletor existe ainda, e a linha diz
                  isso com todas as letras — o contrário faria a tela prometer um
                  robô que não há. */}
              coletor por {ROTULO_DO_COLETOR[fonte.coletor ?? ''] ?? fonte.coletor}: ainda não
              construído
            </li>
          </>
        )}
        {fonte.base_url ? (
          <li>
            <a
              href={fonte.base_url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex min-h-11 items-center gap-1 underline underline-offset-4 hover:text-foreground md:min-h-0"
            >
              abrir a fonte
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          </li>
        ) : null}
      </ul>

      {fonte.campos.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Campos permitidos</span> (RF-RAD-04):{' '}
          {fonte.campos.map((campo) => ROTULO_DO_CAMPO[campo] ?? campo).join(', ')}.
        </p>
      ) : null}

      {fonte.avaliacao ? (
        <details className="group/detalhe">
          <summary className="inline-flex h-11 cursor-pointer list-none items-center text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground md:h-6">
            Ver a avaliação jurídica e as regras desta fonte
          </summary>
          <div className="mt-2 space-y-2 rounded-lg border border-hairline bg-muted/40 p-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">Base legal:</span>{' '}
              {fonte.base_legal.replace(/_/g, ' ')}.
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">{fonte.avaliacao}</p>
            {fonte.robots_nota ? (
              <p className="text-xs leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground">robots.txt:</span> {fonte.robots_nota}
                .
              </p>
            ) : null}
          </div>
        </details>
      ) : null}
    </li>
  );
}

/** O que o robots.txt desta fonte permite, em uma linha — e o ícone que a resume. */
function leituraDoRobots(fonte: FonteDoRadar): {
  texto: string;
  Icone: typeof CircleCheck;
} {
  if (fonte.robots_ok === true) return { texto: 'robots.txt confere', Icone: CircleCheck };
  if (fonte.robots_ok === false) {
    return { texto: 'robots.txt bloqueia robô nesta fonte', Icone: CircleAlert };
  }
  return { texto: 'robots.txt ainda não avaliado', Icone: CircleHelp };
}

function EsqueletoDasFontes() {
  return (
    <ul aria-busy="true" aria-live="polite" className="flex flex-col">
      <li className="sr-only">Carregando o catálogo de fontes.</li>
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className="flex flex-col gap-3 border-b border-hairline py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-5 w-36 rounded-full" />
            <Skeleton className="ml-auto h-11 w-24 rounded-lg md:h-8" />
          </div>
          <div className="flex flex-wrap gap-3">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3.5 w-28" />
          </div>
          <Skeleton className="h-3 w-full max-w-lg" />
        </li>
      ))}
    </ul>
  );
}
