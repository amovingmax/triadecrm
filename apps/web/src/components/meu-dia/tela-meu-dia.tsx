'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, MessagesSquare, RotateCw, Users } from 'lucide-react';

import type { AppRole } from '@/lib/auth/role';
import { NotaRecolhida } from '@/components/ui/nota-recolhida';
import { SeletorDeAba } from '@/components/ui/abas';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TRABALHO } from '@/lib/larguras';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { RevelarLista } from '@/components/movimento';
import { diaDoInstante, rotuloDiaPorExtenso, somarDias } from '@/components/agenda/tipos';

import {
  buscarFeitoHoje,
  buscarFilaDoDia,
  buscarProximosDias,
  buscarResumoDoDia,
  contarCandidatosAguardandoRevisao,
  contarNegociosSemResponsavel,
  LIMITE_DA_FILA,
  mensagemDoErro,
} from './consultas';
import {
  ErroDaFila,
  EsqueletoDaFila,
  FilaVazia,
  FilaVaziaDeOutraPessoa,
  NadaParaHoje,
  SemProximos,
} from './estados';
import { agruparFeitoHoje, contarPessoas, type RegistroDoDia } from './feito';
import { AvisosRecebidos } from '@/components/agenda/avisos-recebidos';

import { FeitoHoje } from './feito-hoje';
import { ItemDaFila } from './item-da-fila';
import { PulsoDoDia } from './pulso-do-dia';
import { ResumoDoDia } from './resumo-do-dia';
import {
  agruparFila,
  agruparPorDia,
  alcanceDeQuemRespondeu,
  blocosParaFazer,
  contarPendentesDeHoje,
  ehDosProximos,
  filaVisivel,
  type AbaDoDia,
  type BlocoPreenchido,
  type DiaDaFila,
  type ItemDoDia,
} from './tipos';

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
 *
 * A fila é mostrada em três abas (`AbaDoDia` em `tipos.ts`): "Para fazer", que abre
 * com quem respondeu no WhatsApp e segue pelas faixas do banco; "Feito hoje", o que a
 * pessoa registrou com resultado; e "Próximos dias", o futuro agrupado por dia.
 *
 * Quem acompanha equipe (admin e gestor, `lib/auth/hierarquia.ts`) escolhe de quem é
 * o dia. No dia de outra pessoa a tela é só leitura: cada linha leva à ficha, e não
 * ao lugar onde se registra — senão o registro sairia no nome de quem olha.
 */

/** Lista vazia estável: um `?? []` novo a cada renderização invalidaria os memos. */
const SEM_ITENS: ItemDoDia[] = [];
const SEM_REGISTROS: RegistroDoDia[] = [];

/** Uma pessoa do seletor "De quem é o dia". O papel decide o bloco de quem respondeu. */
export type PessoaDoSeletor = { id: string; nome: string; papel: AppRole | null };

export function TelaMeuDia({
  nome,
  saudacao,
  data,
  podeDefinirMeta,
  usuarioId,
  hoje,
  abaInicial,
  pessoas,
  pessoaInicial,
}: {
  /** Primeiro nome de quem entrou; a tela fala com a pessoa, não com "o usuário". */
  nome: string;
  /** "Bom dia" / "Boa tarde" / "Boa noite", resolvido no servidor. */
  saudacao: string;
  /** "Quinta-feira, 4 de setembro", resolvido no servidor, em America/Fortaleza. */
  data: string;
  podeDefinirMeta: boolean;
  /** Quem entrou. */
  usuarioId: string;
  /** Hoje em `America/Fortaleza`, resolvido no servidor: data durante a renderização é impura. */
  hoje: string;
  /** `?aba=`, validado no servidor. */
  abaInicial: AbaDoDia;
  /**
   * Quem entrou e quem ela acompanha pela hierarquia (`lib/auth/hierarquia.ts`).
   * Com uma pessoa só, não há seletor.
   */
  pessoas: readonly PessoaDoSeletor[];
  /** De quem é o dia ao abrir: quem entrou, ou `?pessoa=` validado no servidor. */
  pessoaInicial: string;
}) {
  const clienteDeConsultas = useQueryClient();
  const [aba, setAba] = useState<AbaDoDia>(abaInicial);
  const [pessoa, setPessoa] = useState<string>(pessoaInicial);
  const doProprio = pessoa === usuarioId;
  const escolhida = pessoas.find((p) => p.id === pessoa);
  const nomeDaPessoa = escolhida?.nome ?? null;
  // Para o próprio dia as chamadas continuam sem `p_user_id`, como sempre foram.
  const alvo = doProprio ? undefined : pessoa;
  // De quem é o bloco de quem respondeu que a `meu_dia` devolve para esta pessoa:
  // para admin, gestor e sdr é a fila de TODOS (ADR-17), e não a dela.
  const alcance = alcanceDeQuemRespondeu(escolhida?.papel ?? null);

  // A aba e a pessoa moram na URL, como a visão da Agenda: "Feito hoje" é um lugar
  // para onde se manda alguém, e voltar da ficha do parceiro tem de devolver a aba e
  // o dia em que se estava.
  useEffect(() => {
    const busca = new URLSearchParams();
    if (aba !== 'fazer') busca.set('aba', aba);
    if (!doProprio) busca.set('pessoa', pessoa);
    const texto = busca.toString();
    const destino = `${window.location.pathname}${texto ? `?${texto}` : ''}`;
    if (destino !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, '', destino);
    }
  }, [aba, pessoa, doProprio]);

  const fila = useQuery({
    queryKey: ['meu-dia', 'fila', pessoa],
    queryFn: () => buscarFilaDoDia(alvo),
  });
  const resumo = useQuery({
    queryKey: ['meu-dia', 'resumo', pessoa],
    queryFn: () => buscarResumoDoDia(alvo),
  });
  // Sempre de novo ao abrir a tela: quem acabou de registrar na Agenda e volta para
  // cá espera ver o registro, e o cache de 30 s escondia os últimos.
  const feito = useQuery({
    queryKey: ['meu-dia', 'feito', pessoa, hoje],
    queryFn: () => buscarFeitoHoje(pessoa, hoje),
    refetchOnMount: 'always',
  });

  // Quem está lendo enxerga a base inteira? É o `app.sees_all()` do banco, e só o
  // embaixador fica de fora: para ele, parceiro que a view não devolve pode ser
  // só um parceiro que não é dele (ver `montarProximosDias`).
  const papelDeQuemEntrou = pessoas.find((p) => p.id === usuarioId)?.papel ?? null;
  const leitorVeTudo = papelDeQuemEntrou !== null && papelDeQuemEntrou !== 'embaixador';

  // Os próximos dias têm leitura PRÓPRIA, e não saem mais da fila: a fila tem teto
  // de 60 linhas e o futuro é a última faixa dela, então quem tinha 60 pendências
  // não via nenhum compromisso marcado (ver `montarProximosDias`). Sempre de novo ao
  // abrir a tela, como o "Feito hoje": quem marca na Agenda e volta espera ver.
  const futuros = useQuery({
    queryKey: ['meu-dia', 'proximos', pessoa, hoje],
    queryFn: () => buscarProximosDias(pessoa, hoje, leitorVeTudo),
    refetchOnMount: 'always',
  });

  const itens = fila.data ?? SEM_ITENS;
  // No dia de outra pessoa, sem a fila comum de quem respondeu (ver `filaVisivel`).
  const visiveis = filaVisivel(itens, { doProprio, alcance });

  // As duas só quando a fila volta vazia: é a única situação em que esses números
  // mudam o que a tela tem a dizer, e assim não custam ida à rede em carregamento
  // nenhum dos outros. Separadas, e não numa consulta só: se uma falhar, a outra
  // ainda aponta um caminho, e um caminho é o que falta nessa hora.
  // Só no próprio dia: são caminhos para quem está com a fila vazia agir, e não
  // dizem nada sobre a fila de outra pessoa.
  const semDono = useQuery({
    queryKey: ['meu-dia', 'sem-responsavel'],
    queryFn: contarNegociosSemResponsavel,
    enabled: doProprio && fila.isSuccess && fila.data.length === 0,
  });

  const aRevisar = useQuery({
    queryKey: ['meu-dia', 'radar-a-revisar'],
    queryFn: contarCandidatosAguardandoRevisao,
    enabled: doProprio && fila.isSuccess && fila.data.length === 0,
  });

  const atualizar = useCallback(() => {
    void clienteDeConsultas.invalidateQueries({ queryKey: ['meu-dia'] });
  }, [clienteDeConsultas]);

  const blocos = blocosParaFazer(agruparFila(visiveis));
  const pendentes = contarPendentesDeHoje(visiveis);
  // O teto vale para o que o BANCO devolveu, e não para o que sobrou na tela.
  const cheia = itens.length >= LIMITE_DA_FILA;
  // Se a leitura própria falhar, vale o que a fila trouxe do futuro — e aí, com a
  // fila cheia, o aviso do corte volta, porque o corte voltou a existir.
  const proximos = futuros.isSuccess ? futuros.data : visiveis.filter(ehDosProximos);
  const proximosPodemFaltar = !futuros.isSuccess && cheia;
  const diasProximos = agruparPorDia(proximos, diaDoInstante);
  const categorias = agruparFeitoHoje(feito.data ?? SEM_REGISTROS);
  const feitas = contarPessoas(categorias);
  // As conversas que ficaram de fora no dia de outra pessoa: só para a linha que
  // explica onde elas estão.
  const conversasDeTodos = itens.length - visiveis.length;
  const atualizando =
    fila.isFetching || resumo.isFetching || feito.isFetching || futuros.isFetching;

  return (
    // Coluna de leitura, ancorada na goteira esquerda como o resto do produto. Sem
    // o teto, em 1440px o prazo de cada linha fica a mais de um palmo do nome do
    // parceiro e a barra de meta vira um traço de 400px por causa de um número de
    // um dígito. Esta tela é uma fila que se lê de cima para baixo, não uma tabela.
    // TRABALHO, e não LEITURA (29/09/2026). A coluna de 896px ancorada à
    // esquerda era uma decisão documentada — texto acima de ~90 caracteres custa
    // o retorno do olho, e o título no mesmo lugar em toda tela faz o produto
    // parecer montado. Rafael pediu o contrário, com o print na mão: "a tela é
    // composta por inteira e centralizada (...) quero fidelidade total ao
    // protótipo", e um terço da tela vazio à direita é o que ele vê todo dia.
    //
    // O que o teto protegia continua protegido onde importa: a PROSA do pulso
    // tem teto próprio (`max-w-[90ch]`, ver `pulso-do-dia.tsx`). O resto desta
    // tela é cartão e linha com colunas, que não sofre com largura.
    <div className={cn(TRABALHO, 'flex flex-col gap-4')}>
      {/* Sem `flex-wrap`: em 390px o botão quebrava para uma linha inteira só dele,
          encostado à esquerda, empurrando o resumo para baixo da dobra. Ele é uma
          ação secundária e o lugar dela é o canto, ao lado do título, nos dois
          tamanhos de tela. */}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Trilha e título no degrau do sistema (29/09/2026): 32px em peso
              400 com tracking de -0.02em. O `font-semibold text-2xl` de antes
              era um título de seção com cara de página; o sistema separa os dois
              pelo PESO — título grande é leve, ênfase é que é pesada. */}
          <p className="text-xs text-muted-foreground">Início · Meu dia</p>
          <h1 className="mt-1 font-heading text-[32px] leading-tight font-normal tracking-[-0.02em]">
            {saudacao}
            {nome ? `, ${nome}` : ''}.
          </h1>
          {/* "Pendentes", e não "para agora": este número soma as quatro faixas que
              não têm data à frente (vencido, com prazo para hoje, negócio sem
              próximo passo e negócio parado na etapa), enquanto o bloco "Urgente" lá
              embaixo é só a primeira delas. Dois números com o mesmo nome e contas
              diferentes na mesma tela fazem quem lê "14 itens para agora" em cima de
              um bloco "Agora · 3" concluir que a tela perdeu onze pelo caminho.
              Mudar o cabeçalho, e não o bloco, porque o total é o que a pessoa deve
              hoje — contar só as prioridades do bloco esconderia o resto da dívida.
              O zero já dizia "nada pendente"; agora a frase toda combina com ele. */}
          <p className="text-sm text-muted-foreground">
            {data}
            {fila.isPending ? (
              <> · carregando a fila...</>
            ) : fila.isError ? null : pendentes > 0 ? (
              <>
                {' · '}
                <span className="numerico">{pendentes}</span>
                {pendentes === 1 ? ' item pendente' : ' itens pendentes'}
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

      {pessoas.length > 1 ? (
        <SeletorDePessoa
          pessoas={pessoas}
          pessoa={pessoa}
          usuarioId={usuarioId}
          nomeDaPessoa={doProprio ? null : nomeDaPessoa}
          aoTrocar={setPessoa}
        />
      ) : null}

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

      {/* O Pulso é o CONTEXTO da fila — por que o dia está assim —, e contexto vem
          antes da lista, não no lugar dela. Quem responde "o que eu faço agora?"
          continua sendo a fila, que sai do Postgres com prioridade calculada.
          E é de quem entrou: no dia de outra pessoa ele contaria a história
          errada ao lado dos números dela. */}
      {/* Compromisso que o gestor marcou na agenda desta pessoa: aparece aqui
          também, porque o Meu dia é a primeira tela que ela abre. */}
      {doProprio ? <AvisosRecebidos usuarioId={usuarioId} /> : null}

      {doProprio ? <PulsoDoDia /> : null}

      <SeletorDeAba
        rotulo={doProprio ? 'O seu dia' : `O dia de ${nomeDaPessoa ?? 'outra pessoa'}`}
        ativo={aba}
        aoTrocar={setAba}
        itens={[
          { id: 'fazer', rotulo: 'Para fazer', contagem: fila.isSuccess ? pendentes : null },
          { id: 'feito', rotulo: 'Feito hoje', contagem: feito.isSuccess ? feitas : null },
          {
            id: 'proximos',
            rotulo: 'Próximos dias',
            rotuloCurto: 'Próximos',
            contagem:
              futuros.isPending || (futuros.isError && !fila.isSuccess) ? null : proximos.length,
          },
        ]}
      />

      {aba === 'feito' ? (
        <section role="tabpanel" aria-label="Feito hoje" className="flex flex-col gap-4">
          <FeitoHoje
            quem={doProprio ? null : nomeDaPessoa}
            categorias={categorias}
            portasBatidas={
              resumo.data?.find((m) => m.metrica === 'doors_knocked')?.realizado ?? null
            }
            carregando={feito.isPending}
            erro={feito.isError ? mensagemDoErro(feito.error) : null}
            aoTentar={() => void feito.refetch()}
          />
        </section>
      ) : (
        <section
          role="tabpanel"
          aria-label={aba === 'fazer' ? 'Para fazer' : 'Próximos dias'}
          className="flex flex-col gap-4"
        >
          {aba === 'fazer' && fila.isSuccess && !doProprio && alcance === 'todos' ? (
            <FilaDeTodos
              nome={nomeDaPessoa}
              quantas={conversasDeTodos}
              aoVoltar={() => setPessoa(usuarioId)}
            />
          ) : null}

          {aba === 'proximos' ? (
            // A aba do futuro responde pela leitura dela, e não pela da fila: um
            // erro na fila não esconde a agenda, e a fila vazia não quer dizer
            // que não há nada marcado.
            futuros.isPending || (futuros.isError && fila.isPending) ? (
              <EsqueletoDaFila />
            ) : futuros.isError && fila.isError ? (
              <ErroDaFila
                causa={mensagemDoErro(futuros.error)}
                aoTentar={() => {
                  void futuros.refetch();
                  void fila.refetch();
                }}
              />
            ) : diasProximos.length === 0 ? (
              proximosPodemFaltar ? (
                <FuturoCortado />
              ) : (
                <SemProximos />
              )
            ) : (
              <RevelarLista>
                {proximosPodemFaltar ? <FuturoCortado /> : null}
                {diasProximos.map((dia, ordem) => (
                  <DiaDosProximos
                    key={dia.dia ?? 'sem-data'}
                    dia={dia}
                    somenteLeitura={!doProprio}
                    amanha={somarDias(hoje, 1)}
                    deslocamento={diasProximos
                      .slice(0, ordem)
                      .reduce((total, anterior) => total + anterior.itens.length, 0)}
                  />
                ))}
              </RevelarLista>
            )
          ) : fila.isPending ? (
            <EsqueletoDaFila />
          ) : fila.isError ? (
            <ErroDaFila causa={mensagemDoErro(fila.error)} aoTentar={() => void fila.refetch()} />
          ) : visiveis.length === 0 ? (
            doProprio ? (
              <FilaVazia
                nome={nome}
                semResponsavel={semDono.data ?? null}
                aguardandoRevisao={aRevisar.data ?? null}
              />
            ) : (
              <FilaVaziaDeOutraPessoa nome={nomeDaPessoa} />
            )
          ) : (
            <>
              {pendentes === 0 ? (
                <NadaParaHoje
                  quantosDepois={proximos.length}
                  aoVerProximos={() => setAba('proximos')}
                />
              ) : null}
              <RevelarLista>
                {blocos.map((bloco, ordem) => (
                  <Bloco
                    key={bloco.id}
                    bloco={bloco}
                    somenteLeitura={!doProprio}
                    deslocamento={blocos
                      .slice(0, ordem)
                      .reduce((total, anterior) => total + anterior.itens.length, 0)}
                  />
                ))}
              </RevelarLista>
            </>
          )}
        </section>
      )}

      {aba === 'fazer' && !fila.isPending && !fila.isError ? (
        <NotaDoQueFalta cheia={cheia} />
      ) : null}
    </div>
  );
}

/**
 * Um dia da aba "Próximos dias", no mesmo cartão dos blocos de "Para fazer". O
 * título é o dia por extenso, e amanhã se chama amanhã: "02/10" pede uma conta que
 * "Amanhã" já fez.
 */
function DiaDosProximos({
  dia,
  amanha,
  deslocamento,
  somenteLeitura,
}: {
  dia: DiaDaFila;
  amanha: string;
  deslocamento: number;
  somenteLeitura: boolean;
}) {
  const idDoTitulo = `proximos-${dia.dia ?? 'sem-data'}`;
  const titulo =
    dia.dia === null
      ? 'Sem data'
      : dia.dia === amanha
        ? `Amanhã · ${rotuloDiaPorExtenso(dia.dia)}`
        : rotuloDiaPorExtenso(dia.dia);

  return (
    <section
      aria-labelledby={idDoTitulo}
      className="sombra-base flex flex-col gap-3 rounded-xl bg-card p-4 sm:p-5"
    >
      <h2 className="flex items-center gap-2 pb-1.5">
        <span
          id={idDoTitulo}
          className="font-heading text-sm font-semibold tracking-tight first-letter:uppercase"
        >
          {titulo}
        </span>
        <span className="numerico rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
          {dia.itens.length}
        </span>
      </h2>
      <ul className="flex flex-col gap-2">
        {dia.itens.map((item, ordem) => (
          <ItemDaFila
            key={chaveDoItem(item, ordem)}
            item={item}
            indice={deslocamento + ordem}
            somenteLeitura={somenteLeitura}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * A fila vem da `public.meu_dia` com teto de `LIMITE_DA_FILA` itens, ordenada por
 * urgência, e o futuro é a última faixa: num dia cheio é ele que fica de fora.
 *
 * Desde 02/10/2026 a aba lê os compromissos por conta própria (`buscarProximosDias`)
 * e este aviso só aparece no RECUO: quando essa leitura falha e a tela mostra o
 * que a fila trouxe. Aí o corte volta a existir, e "Próximos · 5" pareceria a
 * semana inteira quando eram só os cinco que couberam.
 */
function FuturoCortado() {
  return (
    <p className="sombra-base rounded-xl bg-card p-4 text-sm text-muted-foreground">
      A fila traz no máximo <span className="numerico">{LIMITE_DA_FILA}</span> itens, e hoje ela
      está cheia: os compromissos mais distantes podem não estar aqui. A{' '}
      <Link href="/agenda" className="underline underline-offset-4 hover:text-foreground">
        Agenda
      </Link>{' '}
      mostra todos.
    </p>
  );
}

/**
 * O lugar do bloco "Responderam e estão esperando" no dia de outra pessoa.
 *
 * Desde 28/09/2026 (ADR-17, migração 20261002180000) a `public.meu_dia` devolve, para
 * admin, gestor e sdr, a fila de quem respondeu de TODO MUNDO — é o que faz a
 * resposta de um lead deixar de depender de uma pessoa abrir o CRM. No dia da
 * Heloísa aberto pelo gestor, esse bloco não seria o dia dela: seriam as mesmas
 * conversas que o próprio gestor vê no dia dele, rotuladas com o nome dela. Então
 * ele sai daqui (`filaVisivel`), e esta linha diz onde ele está, em voz baixa — é
 * uma explicação, não um aviso. O embaixador é a exceção: a fila dele é só dele, e
 * aparece em só leitura como o resto.
 */
function FilaDeTodos({
  nome,
  quantas,
  aoVoltar,
}: {
  nome: string | null;
  quantas: number;
  aoVoltar: () => void;
}) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
      <MessagesSquare className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span>
        A fila de quem respondeu no WhatsApp é de todos, e não{' '}
        {nome ? `de ${nome}` : 'desta pessoa'}: ela aparece no próprio dia de quem abre o Meu dia
        {quantas > 0 ? (
          <>
            {' '}
            (agora, <span className="numerico">{quantas}</span>{' '}
            {quantas === 1 ? 'conversa esperando' : 'conversas esperando'})
          </>
        ) : null}
        .{' '}
        <button
          type="button"
          onClick={aoVoltar}
          className="toque min-h-11 cursor-pointer underline underline-offset-4 hover:text-foreground sm:min-h-0"
        >
          Ver no meu dia
        </button>
      </span>
    </p>
  );
}

/**
 * Um bloco da aba "Para fazer". O futuro saiu daqui para a aba "Próximos dias"; o
 * que continua nascendo fechado é o bloco dos avisos do sistema, que é do motor e
 * não da carteira. Fechado, ele ainda diz quantos são — esconder o número seria
 * esconder o dia.
 */
function Bloco({
  bloco,
  deslocamento,
  somenteLeitura,
}: {
  bloco: BlocoPreenchido;
  deslocamento: number;
  somenteLeitura: boolean;
}) {
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
      {/* A explicação do bloco ("Passou da hora, ou acontece em menos de três
          horas") vira `title`: ela é regra, lida uma vez, e disputava a linha do
          cabeçalho com o que muda todo dia — o nome do bloco e a contagem. */}
      <span className="sr-only">{bloco.explicacao}</span>
    </>
  );

  const molde = 'flex w-full items-center gap-2 pb-1.5 text-left';

  // O BLOCO VIROU CARTÃO (29/09/2026). Ele era um título solto com uma lista
  // embaixo, direto sobre a página: no desenho novo a página é cinza e tudo que
  // é conteúdo mora num cartão branco. Sem isso a fila ficava boiando, que foi o
  // que o Rafael viu ao comparar com o protótipo.
  return (
    <section
      aria-labelledby={idDoTitulo}
      className="sombra-base flex flex-col gap-3 rounded-xl bg-card p-4 sm:p-5"
    >
      {recolhivel ? (
        <button
          type="button"
          onClick={() => setAberto((valor) => !valor)}
          aria-expanded={aberto}
          aria-controls={idDaLista}
          title={bloco.explicacao}
          className={cn(
            molde,
            'toque min-h-11 cursor-pointer outline-none focus-visible:bg-muted/40 sm:min-h-9',
          )}
        >
          {cabecalho}
        </button>
      ) : (
        <h2 className={molde} title={bloco.explicacao}>
          {cabecalho}
        </h2>
      )}

      {/* 8px entre as linhas, e não 2: com fundo próprio (29/09/2026) elas são
          superfícies, e superfície colada em superfície vira um bloco só. */}
      <ul id={idDaLista} hidden={!aberto} className="flex flex-col gap-2">
        {bloco.itens.map((item, ordem) => (
          <ItemDaFila
            key={chaveDoItem(item, ordem)}
            item={item}
            indice={deslocamento + ordem}
            somenteLeitura={somenteLeitura}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * Chave estável da linha. O TIPO entra sempre, e não só no fallback: desde
 * 28/09/2026 o mesmo negócio pode render duas linhas — a conversa que espera
 * resposta e o cartão parado na etapa são itens diferentes da mesma empresa, e
 * até então os dois devolviam a mesma chave. A organização entra depois do
 * negócio porque a conversa de uma ficha sem negócio aberto não tem `negocioId`.
 */
function chaveDoItem(item: ItemDoDia, ordem: number): string {
  return `${item.tipo}-${item.tarefaId ?? item.atividadeId ?? item.negocioId ?? item.organizacaoId ?? ordem}`;
}

/**
 * O rodapé honesto. Metade do RF-MET-04 depende de coisa que ainda não existe, e a
 * tela diz isso em português em vez de fingir que a fila está completa — uma fila
 * curta e verdadeira vale mais que uma fila cheia e falsa.
 *
 * O que uma nota destas não pode fazer é inventar a limitação. Ela dizia que "o
 * coletor do Radar ainda não roda" enquanto havia dezenas de candidatos reais
 * esperando decisão na outra tela: uma nota errada sobre o que falta é pior que
 * nota nenhuma, porque convence quem confia na tela de que não há o que fazer no
 * CRM. O limite verdadeiro é outro, e é permanente — candidato não é alvo de
 * contato até alguém aprovar, então ele nunca entrou nesta fila e continua sendo
 * decidido na Revisão.
 */
function NotaDoQueFalta({ cheia }: { cheia: boolean }) {
  return (
    <NotaRecolhida titulo="O que ainda não entra nesta fila">
      <ul className="flex list-disc flex-col gap-1 pl-4">
        <li>
          A fila mostra no máximo <span className="numerico">15</span> conversas esperando resposta
          por vez, para não empurrar as reuniões e as tarefas para fora da lista. O resto está em{' '}
          <Link href="/conversas" className="underline underline-offset-4 hover:text-foreground">
            Conversas → Responderam
          </Link>
          .
        </li>
        <li>
          Link do Meet e rota otimizada das visitas. A reunião e a visita do dia já entram na fila,
          vindas da Agenda; o que falta é o Google Calendar conectado e a geocodificação dos
          endereços.
        </li>
        <li>
          Candidato esperando revisão. Ele só vira alvo de contato depois de aprovado, então nunca
          entra aqui — a fila de decisão fica em{' '}
          <Link href="/revisao" className="underline underline-offset-4 hover:text-foreground">
            Revisão
          </Link>
          .
        </li>
        {cheia ? (
          <li>
            A fila mostra no máximo <span className="numerico">{LIMITE_DA_FILA}</span> itens de uma
            vez. Hoje ela está cheia: o que ficou de fora tem data mais distante.
          </li>
        ) : null}
      </ul>
    </NotaRecolhida>
  );
}

/**
 * De quem é o dia. Só existe para quem acompanha alguém (admin e gestor), e fica
 * numa linha própria, e não ao lado do "Atualizar": em 390px os dois não cabem
 * juntos com o título. Fora do próprio dia, a frase ao lado repete de quem são os
 * números, porque a saudação lá em cima continua falando com quem entrou.
 */
function SeletorDePessoa({
  pessoas,
  pessoa,
  usuarioId,
  nomeDaPessoa,
  aoTrocar,
}: {
  pessoas: readonly PessoaDoSeletor[];
  pessoa: string;
  usuarioId: string;
  /** `null` no próprio dia. */
  nomeDaPessoa: string | null;
  aoTrocar: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
      <Select value={pessoa} onValueChange={aoTrocar}>
        <SelectTrigger
          className="toque h-11 w-full min-w-52 bg-card sm:w-auto md:h-9"
          aria-label="De quem é o dia"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <SelectValue />
          </span>
        </SelectTrigger>
        <SelectContent>
          {pessoas.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.id === usuarioId ? `${p.nome} (você)` : p.nome}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {nomeDaPessoa ? (
        <p
          className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground"
          role="status"
        >
          <span>
            Você está vendo o dia de{' '}
            <span className="font-medium text-foreground">{nomeDaPessoa}</span>, só para leitura.
          </span>
          <button
            type="button"
            onClick={() => aoTrocar(usuarioId)}
            className="toque min-h-11 cursor-pointer underline underline-offset-4 hover:text-foreground sm:min-h-0"
          >
            Voltar ao meu dia
          </button>
        </p>
      ) : null}
    </div>
  );
}
