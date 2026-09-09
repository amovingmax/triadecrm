'use client';

import { useMemo, useState } from 'react';
import { keepPreviousData, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Info, RotateCw } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { formatarNumero } from '@/components/parceiros/formatos';

import {
  buscarPapeisDoTime,
  buscarProgresso,
  CHAVE_METAS,
  CHAVE_PAPEIS,
  chaveDoProgresso,
  mensagemDoErro,
} from './dados';
import { CartaoPessoa } from './cartao-pessoa';
import { FolhaMeta } from './folha-meta';
import {
  deslocarPeriodo,
  ehPeriodoAtual,
  inicioDoPeriodo,
  rotuloDoPeriodo,
  type Periodo,
} from './periodo';
import { SeletorPeriodo } from './seletor-periodo';
import { ehProxy, type LinhaProgresso, type Pessoa } from './tipos';

/**
 * Metas (RF-MET-01/02, anexo R07 §3).
 *
 * Meta contra realizado, por pessoa e por período, com a conta inteira feita no
 * Postgres (`public.goal_progress`): a tela não soma nada, não guarda agregado e não
 * inventa métrica. O que ela faz é escolher o recorte, mostrar o número e dizer, em
 * português, o que está faltando e a que ritmo.
 *
 * Três decisões que se veem na tela:
 *
 * 1. Os cartões ficam LADO A LADO e em ordem alfabética. Não há placar, posição nem
 *    pontuação composta: o leaderboard do RF-MET-09 é v1 e vem com regra própria de
 *    reconhecimento, e antecipá-lo aqui seria o painel de call center que o R07 §3.1
 *    documenta como risco (Lei de Goodhart).
 * 2. A tela é NEUTRA de cor. A única cromia do produto é a escala térmica do negócio;
 *    verde de "bateu" e vermelho de "não bateu" apagariam esse significado.
 * 3. O que ainda não existe está escrito na própria tela: as métricas marcadas como
 *    proxy (o cadastro e a publicação, cuja fonte de verdade é a plataforma Komune) e
 *    as que o banco declarar sem lastro. As frases vêm do banco, em
 *    `goal_progress.fonte`, e o texto daqui não repete NENHUMA delas: era assim que
 *    "respostas recebidas depende do inbox do D5" continuava escrito na tela meses
 *    depois de a tabela de mensagens existir e receber.
 */
export function TelaMetas({
  pessoas,
  euId,
  podeDefinir,
  hoje,
}: {
  /**
   * Diretório do time, em ordem alfabética. Para sdr, só a própria pessoa.
   *
   * A lista traz todo perfil ATIVO, inclusive quem o banco impede de produzir
   * número: `app.can_write()` só deixa admin, gestor, sdr e embaixador escreverem
   * em `activities`, `organizations` e `deals`, e toda métrica de `goal_progress`
   * conta exatamente essas três tabelas. Para `leitura`, `financeiro` e `bot` o
   * realizado nasce zero e morre zero — e a meta combinada com essa pessoa vira
   * cobrança do Assistente por um trabalho que a RLS proíbe de registrar.
   *
   * A tela não some com a pessoa e não tranca o botão: ela DIZ o motivo, no cartão
   * e dentro da folha, antes de alguém combinar um alvo (`porQueFicaEmZero`). O
   * papel vem de `public.team_directory`, o diretório do próprio banco; a única
   * coisa espelhada aqui é a LISTA de `app.can_write()`, do mesmo jeito e pelo
   * mesmo motivo que `lib/navegacao.ts` já a espelha.
   *
   * O QUE FALTA NO BANCO, e não cabia nesta tela: `goals_insert` e `goals_update`
   * aceitam `user_id` de perfil que não escreve, então meta impossível continua
   * entrando por chamada direta à API, sem passar por aqui. Fechar isso é política
   * nova em `public.goals`, não componente.
   * PRECISA DE DECISÃO HUMANA (Rafael): se o gestor pode definir meta para alguém
   * de `leitura` de propósito — combinado registrado antes de a pessoa trocar de
   * papel —, o aviso desta tela é o fim da história e o banco fica como está; se
   * não pode, a recusa entra lá, com nome, e a tela passa a não oferecer.
   */
  pessoas: Pessoa[];
  euId: string;
  /** Gestor e admin definem meta pela tela (a RLS de `public.goals` é a regra de verdade). */
  podeDefinir: boolean;
  /** Hoje em America/Fortaleza, resolvido no servidor (evita divergência de hidratação). */
  hoje: string;
}) {
  const [periodo, setPeriodo] = useState<Periodo>('day');
  const [inicio, setInicio] = useState<string>(() => inicioDoPeriodo(hoje, 'day'));
  const [folha, setFolha] = useState<{ pessoa: Pessoa; metrica: string | null } | null>(null);
  const clienteDeConsultas = useQueryClient();

  const consultas = useQueries({
    queries: pessoas.map((pessoa) => ({
      queryKey: chaveDoProgresso(pessoa.id, periodo, inicio),
      queryFn: () => buscarProgresso(pessoa.id, periodo, inicio),
      placeholderData: keepPreviousData,
    })),
  });

  // Uma consulta só, para o time inteiro, e desligada do ciclo das metas: o papel
  // não muda porque alguém salvou um alvo. Falha dela não aparece na tela — sem o
  // mapa, o cartão apenas deixa de mostrar o aviso, e nada mais depende disto.
  const papeis = useQuery({
    queryKey: CHAVE_PAPEIS,
    queryFn: buscarPapeisDoTime,
    staleTime: 5 * 60 * 1000,
  });

  const rotulo = rotuloDoPeriodo(inicio, periodo, hoje);
  const ehAtual = ehPeriodoAtual(inicio, periodo, hoje);

  // Qualquer resposta serve para os dados que valem para o período inteiro (dias
  // úteis) e para o catálogo de métricas: eles não dependem de quem é a pessoa.
  const referencia: LinhaProgresso[] = useMemo(() => {
    for (const consulta of consultas) {
      const linhas = consulta.data;
      if (linhas && linhas.length > 0) return linhas;
    }
    return [];
  }, [consultas]);

  const primeira = referencia[0];
  // Quando TODAS as consultas falham o problema é um só (rede, sessão, banco fora do
  // ar). Repetir o mesmo aviso em cinco cartões não informa nada a mais e enche a
  // tela de alarme; um aviso e um botão bastam.
  const todasFalharam = consultas.length > 0 && consultas.every((c) => c.isError);
  const erroGeral = todasFalharam ? mensagemDoErro(consultas[0]?.error) : null;
  const semNenhumaMeta =
    consultas.length > 0 &&
    consultas.every((c) => c.data !== undefined) &&
    consultas.every((c) => (c.data ?? []).every((linha) => linha.meta === null));

  // Um aviso só, no alto: com dois parágrafos dizendo quase a mesma coisa, quem lê
  // desconta os dois. Para quem não define meta, a frase junta o que falta com quem
  // resolve; para o gestor, ela diz onde ficar o botão.
  const aviso = !podeDefinir
    ? semNenhumaMeta
      ? 'Nenhuma meta definida para você neste período: os números abaixo são o seu realizado. Quem define a meta é o gestor.'
      : 'Você vê a sua própria meta. O acompanhamento do time e a definição dos alvos ficam com o gestor.'
    : semNenhumaMeta
      ? 'Nenhuma meta definida para este período. Os números abaixo são o realizado; use "Definir meta" no cartão da pessoa para dar um alvo a ele.'
      : null;

  // As linhas de quem a folha vai editar, sem valor de reserva. Antes daqui saía
  // `?? referencia` — a primeira resposta que tivesse chegado, de qualquer pessoa.
  // Bastava UMA das consultas paralelas falhar (rede de celular, sessão expirada)
  // para o gestor abrir "Meta de João", ver 12 no campo, achar que era a meta atual
  // do João e salvar: gravava no João a meta da Maria, com o nome do João no título,
  // no aviso de sucesso e no histórico — erro que ninguém descobre depois. Sem os
  // dados da pessoa a folha não abre, e o botão que a abriria já está desabilitado
  // no cartão dela.
  const linhasDaFolha = folha
    ? consultas[pessoas.findIndex((p) => p.id === folha.pessoa.id)]?.data
    : undefined;

  function trocarPeriodo(novo: Periodo) {
    setPeriodo(novo);
    setInicio(inicioDoPeriodo(hoje, novo));
  }

  function andar(passos: number) {
    setInicio((atual) => deslocarPeriodo(atual, periodo, passos));
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <header className="flex flex-col gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Metas</h1>
          <p className="text-sm text-muted-foreground">
            {rotulo.map((parte, i) => (
              <span key={i} className={parte.mono ? 'numerico' : undefined}>
                {parte.texto}
              </span>
            ))}
            {/* "5 de 5 dias úteis" lia como período encerrado numa sexta ainda por
                trabalhar: `app.business_days` conta o dia de HOJE entre os decorridos.
                O ordinal diz a mesma coisa sem a ambiguidade, e período passado mostra
                só o total. */}
            {primeira && primeira.dias_uteis_total > 1 ? (
              ehAtual ? (
                <>
                  {' · '}
                  <span className="numerico">{formatarNumero(primeira.dias_uteis_decorridos)}</span>
                  º dia útil de{' '}
                  <span className="numerico">{formatarNumero(primeira.dias_uteis_total)}</span>
                </>
              ) : (
                <>
                  {' · '}
                  <span className="numerico">{formatarNumero(primeira.dias_uteis_total)}</span> dias
                  úteis
                </>
              )
            ) : null}
          </p>
        </div>

        <SeletorPeriodo
          periodo={periodo}
          aoTrocarPeriodo={trocarPeriodo}
          aoAndar={andar}
          aoVoltarParaAgora={() => setInicio(inicioDoPeriodo(hoje, periodo))}
          ehAtual={ehAtual}
        />
      </header>

      {aviso ? (
        <p className="rounded-xl border border-hairline bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          {aviso}
        </p>
      ) : null}

      {/* Ordem alfabética, nunca por resultado: esta tela acompanha, não classifica.
          Com uma pessoa só (o que sdr enxerga) o cartão não se estica pela tela
          inteira: uma coluna de 672px é a medida em que o número grande e a frase
          embaixo ainda são lidos como um bloco. Ele se CENTRALIZA nessa medida —
          encostado à esquerda, sobrava metade da tela vazia à direita. */}
      {erroGeral ? (
        <section
          aria-label="Metas por pessoa"
          className="flex max-w-2xl flex-col items-start gap-3 rounded-xl border border-hairline px-4 py-8"
        >
          <p className="font-heading font-medium">Não deu para carregar as metas</p>
          <p className="text-sm text-muted-foreground">
            {erroGeral} Enquanto isso, o realizado do dia continua sendo gravado normalmente pelo
            registro de atividade.
          </p>
          <Button
            variant="outline"
            onClick={() => consultas.forEach((c) => void c.refetch())}
            className="toque h-11 md:h-9"
          >
            <RotateCw aria-hidden="true" />
            Tentar de novo
          </Button>
        </section>
      ) : (
        <section
          aria-label="Metas por pessoa"
          className={cn(
            'grid grid-cols-1 items-start gap-4',
            pessoas.length > 1 ? 'lg:grid-cols-2' : 'mx-auto w-full max-w-2xl',
          )}
        >
          {pessoas.map((pessoa, indice) => {
            const consulta = consultas[indice];
            return (
              <CartaoPessoa
                key={pessoa.id}
                pessoa={pessoa}
                ehVoce={pessoa.id === euId}
                papel={papeis.data?.[pessoa.id]}
                linhas={consulta?.data}
                carregando={consulta?.isPending ?? true}
                erro={consulta?.isError ? mensagemDoErro(consulta.error) : null}
                aoTentarDeNovo={() => void consulta?.refetch()}
                podeDefinir={podeDefinir}
                aoDefinirMeta={(metrica) => setFolha({ pessoa, metrica })}
              />
            );
          })}
        </section>
      )}

      {referencia.length > 0 ? <ComoContamos linhas={referencia} /> : null}

      {folha && linhasDaFolha && linhasDaFolha.length > 0 ? (
        <FolhaMeta
          aberta
          aoFechar={() => setFolha(null)}
          pessoa={folha.pessoa}
          papel={papeis.data?.[folha.pessoa.id]}
          periodo={periodo}
          // O período que a folha GRAVA é o mesmo que o título dela promete: `rotulo`
          // e `inicio` saem do mesmo estado. Tirado de `periodo_inicio` de uma linha,
          // durante a troca de período (o TanStack segura a resposta anterior por
          // `keepPreviousData`) a folha dizia "Semana de 07/09" e escrevia na de
          // 31/08. O gatilho `goals_before_write` normaliza de novo no banco.
          inicio={inicio}
          rotuloPeriodo={rotulo}
          linhas={linhasDaFolha}
          metricaInicial={folha.metrica}
          aoGravar={() => void clienteDeConsultas.invalidateQueries({ queryKey: CHAVE_METAS })}
        />
      ) : null}
    </div>
  );
}

/**
 * A régua de contagem, escrita no banco e repetida aqui (RF-MET-01: "regra de
 * contagem explícita"). Fica recolhida porque é referência, não leitura diária — mas
 * o aviso do que ainda não está ligado fica FORA do recolhimento, visível sempre.
 */
function ComoContamos({ linhas }: { linhas: LinhaProgresso[] }) {
  const pendentes = linhas.filter((l) => !l.mensuravel);
  const proxies = linhas.filter(ehProxy);

  return (
    <section className="flex flex-col gap-3 border-t border-hairline pt-4">
      {pendentes.length > 0 || proxies.length > 0 ? (
        <div className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            {proxies.length > 0 ? (
              <>
                <span className="text-foreground">
                  {proxies.map((l) => l.metrica_rotulo).join(' e ')}
                </span>{' '}
                {proxies.length === 1 ? 'sai' : 'saem'} do funil do CRM como proxy: a fonte da
                verdade é a plataforma Komune, e essa integração ainda não está ligada.{' '}
              </>
            ) : null}
            {/* O MOTIVO não se escreve aqui. Ele vem do banco, na `fonte` da própria
                métrica, e está logo abaixo em "Como cada número é contado": duplicar a
                explicação foi o que deixou uma data de cronograma interno na tela
                depois de a métrica já ter de onde sair. */}
            {pendentes.length > 0 ? (
              <>
                <span className="text-foreground">
                  {pendentes.map((l) => l.metrica_rotulo).join(' e ')}
                </span>{' '}
                {pendentes.length === 1 ? 'ainda não é medível' : 'ainda não são medíveis'}: a linha
                aparece sem número, em vez de mostrar zero. O motivo de cada uma está em &ldquo;Como cada
                número é contado&rdquo;, aqui embaixo.
              </>
            ) : null}
          </p>
        </div>
      ) : null}

      <details className="group/como">
        <summary className="toque flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground md:min-h-8">
          <ChevronDown
            className="size-4 transition-transform group-open/como:rotate-180"
            aria-hidden="true"
          />
          Como cada número é contado
        </summary>
        <dl className="flex flex-col gap-2 pt-2 pl-5.5">
          {linhas.map((linha) => (
            <div key={linha.metrica} className="text-xs leading-relaxed">
              <dt className="inline font-medium">{linha.metrica_rotulo}: </dt>
              <dd className="inline text-muted-foreground">{linha.fonte}.</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}
