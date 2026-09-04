'use client';

import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, RotateCw } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { RevelarLista } from '@/components/movimento';

import {
  buscarFilaDoDia,
  buscarResumoDoDia,
  contarNegociosSemResponsavel,
  LIMITE_DA_FILA,
  mensagemDoErro,
} from './consultas';
import { ErroDaFila, EsqueletoDaFila, FilaVazia, NadaParaHoje } from './estados';
import { ItemDaFila } from './item-da-fila';
import { ResumoDoDia } from './resumo-do-dia';
import { agruparFila, contarPendentesDeHoje, type BlocoPreenchido, type ItemDoDia } from './tipos';

/**
 * Meu dia (RF-MET-03, RF-MET-04): a rota padrão do aplicativo e a primeira tela que
 * a Heloísa abre de manhã, no celular, antes de sair.
 *
 * A tela responde a uma pergunta só — "o que eu faço agora?" — e responde na ordem
 * em que o banco já ordenou (`public.meu_dia`): reunião em menos de três horas,
 * interação sem resultado registrado, tarefa vencida, próxima ação vencida, o que
 * vence hoje, negócio sem próximo passo, negócio parado além do prazo da etapa e,
 * por último, o que tem data à frente.
 *
 * Nada é reordenado aqui e nada é calculado aqui: prioridade, motivo e atraso saem
 * do Postgres, que é o mesmo lugar de onde saem os relatórios. Se a fila e o
 * relatório de segunda discordassem, um dos dois estaria mentindo.
 *
 * Duas consultas, não uma: a fila e o resumo mudam em ritmos diferentes (registrar
 * um contato mexe nas duas, mas mover um cartão no funil só mexe na fila), e separá-las
 * deixa o resumo aparecer sem esperar as 60 linhas.
 */

/** Lista vazia estável: um `?? []` novo a cada renderização invalidaria os memos. */
const SEM_ITENS: ItemDoDia[] = [];

export function TelaMeuDia({
  nome,
  saudacao,
  data,
  podeDefinirMeta,
}: {
  /** Primeiro nome de quem entrou; a tela fala com a pessoa, não com "o usuário". */
  nome: string;
  /** "Bom dia" / "Boa tarde" / "Boa noite", resolvido no servidor. */
  saudacao: string;
  /** "Quinta-feira, 4 de setembro", resolvido no servidor, em America/Fortaleza. */
  data: string;
  podeDefinirMeta: boolean;
}) {
  const clienteDeConsultas = useQueryClient();

  const fila = useQuery({ queryKey: ['meu-dia', 'fila'], queryFn: buscarFilaDoDia });
  const resumo = useQuery({ queryKey: ['meu-dia', 'resumo'], queryFn: buscarResumoDoDia });

  // Só quando a fila volta vazia: é a única situação em que o número muda o que a
  // tela tem a dizer, e não custa uma terceira ida à rede em todo carregamento.
  const semDono = useQuery({
    queryKey: ['meu-dia', 'sem-responsavel'],
    queryFn: contarNegociosSemResponsavel,
    enabled: fila.isSuccess && fila.data.length === 0,
  });

  const atualizar = useCallback(() => {
    void clienteDeConsultas.invalidateQueries({ queryKey: ['meu-dia'] });
  }, [clienteDeConsultas]);

  const itens = fila.data ?? SEM_ITENS;
  const blocos = agruparFila(itens);
  const pendentes = contarPendentesDeHoje(itens);
  const depois = itens.length - pendentes;
  const atualizando = fila.isFetching || resumo.isFetching;

  return (
    // Coluna de leitura, ancorada na goteira esquerda como o resto do produto. Sem
    // o teto, em 1440px o prazo de cada linha fica a mais de um palmo do nome do
    // parceiro e a barra de meta vira um traço de 400px por causa de um número de
    // um dígito. Esta tela é uma fila que se lê de cima para baixo, não uma tabela.
    <div className="flex w-full max-w-4xl flex-col gap-5">
      {/* Sem `flex-wrap`: em 390px o botão quebrava para uma linha inteira só dele,
          encostado à esquerda, empurrando o resumo para baixo da dobra. Ele é uma
          ação secundária e o lugar dela é o canto, ao lado do título, nos dois
          tamanhos de tela. */}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {saudacao}
            {nome ? `, ${nome}` : ''}.
          </h1>
          <p className="text-sm text-muted-foreground">
            {data}
            {fila.isPending ? (
              <> · carregando a sua fila...</>
            ) : fila.isError ? null : pendentes > 0 ? (
              <>
                {' · '}
                <span className="numerico">{pendentes}</span>
                {pendentes === 1 ? ' item para agora' : ' itens para agora'}
              </>
            ) : (
              ' · nada pendente'
            )}
          </p>
        </div>

        <Button
          variant="outline"
          onClick={atualizar}
          disabled={atualizando}
          aria-label="Atualizar a fila e o resumo"
          className="toque h-11 md:h-9"
        >
          <RotateCw className={cn(atualizando && 'animate-spin')} aria-hidden="true" />
          <span className="hidden sm:inline">Atualizar</span>
        </Button>
      </header>

      {resumo.isError ? (
        <p className="text-sm text-muted-foreground">
          O resumo do dia não carregou. {mensagemDoErro(resumo.error)}
        </p>
      ) : (
        <ResumoDoDia
          metricas={resumo.data ?? []}
          carregando={resumo.isPending}
          podeDefinirMeta={podeDefinirMeta}
        />
      )}

      <section aria-label="Fila do dia" className="flex flex-col gap-4">
        {fila.isPending ? (
          <EsqueletoDaFila />
        ) : fila.isError ? (
          <ErroDaFila causa={mensagemDoErro(fila.error)} aoTentar={() => void fila.refetch()} />
        ) : itens.length === 0 ? (
          <FilaVazia nome={nome} semResponsavel={semDono.data ?? null} />
        ) : (
          <>
            {pendentes === 0 ? <NadaParaHoje quantosDepois={depois} /> : null}
            <RevelarLista>
              {blocos.map((bloco, ordem) => (
                <Bloco
                  key={bloco.id}
                  bloco={bloco}
                  deslocamento={blocos
                    .slice(0, ordem)
                    .reduce((total, anterior) => total + anterior.itens.length, 0)}
                />
              ))}
            </RevelarLista>
          </>
        )}
      </section>

      {!fila.isPending && !fila.isError ? (
        <NotaDoQueFalta cheia={itens.length >= LIMITE_DA_FILA} />
      ) : null}
    </div>
  );
}

/**
 * Um bloco da fila. O bloco do futuro nasce fechado: ele é o maior de todos (tudo o
 * que tem data à frente cai nele) e disputaria a tela justamente com o que precisa
 * ser feito agora. Fechado, ele ainda diz quantos são — esconder o número seria
 * esconder o dia.
 */
function Bloco({ bloco, deslocamento }: { bloco: BlocoPreenchido; deslocamento: number }) {
  const [aberto, setAberto] = useState(!bloco.recolhidoPorPadrao);
  const idDoTitulo = `bloco-${bloco.id}`;
  const idDaLista = `lista-${bloco.id}`;
  const recolhivel = bloco.recolhidoPorPadrao === true;

  const cabecalho = (
    <>
      <span className="flex items-center gap-2">
        <span id={idDoTitulo} className="font-heading text-sm font-semibold tracking-tight">
          {bloco.titulo}
        </span>
        <span className="numerico rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
          {bloco.itens.length}
        </span>
        {recolhivel ? (
          <ChevronDown
            className={cn(
              'size-4 text-muted-foreground transition-transform',
              aberto && 'rotate-180',
            )}
            aria-hidden="true"
          />
        ) : null}
      </span>
      <span className="text-xs text-muted-foreground sm:text-right">{bloco.explicacao}</span>
    </>
  );

  const molde =
    'flex w-full flex-col items-start gap-0.5 border-b border-hairline pb-2 text-left sm:flex-row sm:items-baseline sm:justify-between sm:gap-4';

  return (
    <section aria-labelledby={idDoTitulo} className="flex flex-col">
      {recolhivel ? (
        <button
          type="button"
          onClick={() => setAberto((valor) => !valor)}
          aria-expanded={aberto}
          aria-controls={idDaLista}
          className={cn(
            molde,
            'toque min-h-11 cursor-pointer outline-none focus-visible:bg-muted/40 sm:min-h-9',
          )}
        >
          {cabecalho}
        </button>
      ) : (
        <h2 className={molde}>{cabecalho}</h2>
      )}

      <ul id={idDaLista} hidden={!aberto}>
        {bloco.itens.map((item, ordem) => (
          <ItemDaFila key={chaveDoItem(item, ordem)} item={item} indice={deslocamento + ordem} />
        ))}
      </ul>
    </section>
  );
}

/**
 * Chave estável da linha. Tarefa e negócio têm id; a interação sem resultado tem o
 * id da atividade. O índice só entra como desempate no caso que não tem nenhum dos
 * três, para o React não reciclar a linha errada.
 */
function chaveDoItem(item: ItemDoDia, ordem: number): string {
  return item.tarefaId ?? item.atividadeId ?? item.negocioId ?? `${item.tipo}-${ordem}`;
}

/**
 * O rodapé honesto. Metade do RF-MET-04 depende de coisa que ainda não existe, e a
 * tela diz isso em português em vez de fingir que a fila está completa — uma fila
 * curta e verdadeira vale mais que uma fila cheia e falsa.
 */
function NotaDoQueFalta({ cheia }: { cheia: boolean }) {
  return (
    <section
      aria-label="O que ainda não entra nesta fila"
      className="rounded-lg border border-hairline bg-card px-4 py-3"
    >
      <p className="text-sm font-medium">O que ainda não entra nesta fila</p>
      <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4 text-xs text-muted-foreground">
        <li>
          Conversa de WhatsApp esperando resposta. O inbox oficial ainda não está ligado, então
          &quot;o parceiro respondeu e está sem resposta há mais de 2 h&quot; não tem como ser
          medido hoje.
        </li>
        <li>
          Link do Meet e rota otimizada das visitas. A reunião e a visita do dia já entram na fila,
          vindas da Agenda; o que falta é o Google Calendar conectado (RF-AGE-02) e a
          geocodificação dos endereços (RF-ROT-01).
        </li>
        <li>Candidato novo esperando revisão: o coletor do Radar ainda não roda.</li>
        {cheia ? (
          <li>
            A fila mostra no máximo <span className="numerico">{LIMITE_DA_FILA}</span> itens de uma
            vez. Hoje ela está cheia: o que ficou de fora tem data mais distante.
          </li>
        ) : null}
      </ul>
    </section>
  );
}
