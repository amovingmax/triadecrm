'use client';

import { AlertTriangle, TrendingDown } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { cn } from '@/lib/utils';

import { chaveDoRelatorio } from './dados';
import {
  carregarPainelFunil,
  type FaixaDeResposta,
  type LinhaPessoaVende,
  type PainelFunilEquipe,
} from './dados-vende';
import {
  contagem,
  contaDaMeta,
  contar,
  decimalEnxuto,
  deltaDe,
  dias,
  dinheiroCurto,
  FAIXAS_DE_RESPOSTA,
  fimDoMes,
  gargaloDoFunil,
  horas,
  inteiro,
  lista,
  media,
  minutos,
  nomeDoMes,
  numero,
  pct,
  pctDaChance,
  plural,
  rotuloDaFaixaDeResposta,
  rotuloDoCampo,
  tetoRedondo,
  textoDaTrava,
  tituloDaEquipe,
  tituloDaPrevisao,
  tituloDaPrevisaoPorEtapa,
  tituloDaVelocidade,
  tituloDasMensagens,
  tituloDasObjecoes,
  tituloDasPerguntas,
  tituloDoFunilLongo,
  tituloDosCanais,
} from './formatos-vende';
import {
  ALVO,
  Barra,
  Cartao,
  Colunas,
  Dica,
  FilaDeKpis,
  Haltere,
  Legenda,
  MolduraDaAba,
  PlacarDaMeta,
  Quadrinho,
  Rodape,
  SemDado,
  SOMBRA_DE_ROLAGEM_NO_CARTAO,
  TiraKpi,
} from './graficos-vende';
import { diasNoPeriodo, type Periodo } from './periodo';
import type { DefinicaoPainel } from './tipos';

/**
 * Funil e equipe (09/11/2026): o placar do mês e a conta para a meta, cada passagem
 * do funil (quanto passou, em quanto tempo, o que travou), o que faz o lead marcar
 * visita (a velocidade da primeira resposta e o que já se sabe dele), as objeções,
 * os canais, a equipe e as mensagens que funcionam.
 *
 * Lê `relatorio_imova_painel_funil(p_de, p_ate)` (`dados-vende.ts`).
 */
export function PainelVendeFunil({ painel, periodo }: { painel: DefinicaoPainel; periodo: Periodo }) {
  const consulta = useQuery({
    queryKey: chaveDoRelatorio('vende-funil', periodo),
    queryFn: () => carregarPainelFunil(periodo),
  });
  const n = diasNoPeriodo(periodo);

  return (
    <MolduraDaAba
      painel={painel}
      consulta={consulta}
      tiras={5}
      apoio={
        <p className="text-xs text-muted-foreground">
          Contra os {n} {plural(n, 'dia anterior', 'dias anteriores')}.
        </p>
      }
    >
      {(dados) => <Conteudo dados={dados} />}
    </MolduraDaAba>
  );
}

function era(valor: number | null | undefined, formato: (v: number) => string): string | null {
  const v = numero(valor);
  return v === null ? null : `era ${formato(v)}`;
}

function Conteudo({ dados }: { dados: PainelFunilEquipe }) {
  const k = dados.kpis;
  return (
    <div className="flex flex-col gap-4">
      <FilaDeKpis colunas={5}>
        <TiraKpi
          rotulo="Lead → visita marcada"
          valor={pct(k?.lead_visita?.agora)}
          delta={deltaDe(k?.lead_visita?.agora, k?.lead_visita?.antes, 'pontos')}
          apoio={era(k?.lead_visita?.antes, pct)}
        />
        <TiraKpi
          rotulo="Visita → proposta"
          valor={pct(k?.visita_proposta?.agora)}
          delta={deltaDe(k?.visita_proposta?.agora, k?.visita_proposta?.antes, 'pontos')}
          apoio={era(k?.visita_proposta?.antes, pct)}
        />
        <TiraKpi
          rotulo="Proposta → fechado"
          valor={pct(k?.proposta_fechado?.agora)}
          delta={deltaDe(k?.proposta_fechado?.agora, k?.proposta_fechado?.antes, 'pontos')}
          apoio={era(k?.proposta_fechado?.antes, pct)}
        />
        <TiraKpi
          rotulo="Ciclo de venda"
          valor={dias(k?.ciclo_dias?.agora)}
          delta={deltaDe(k?.ciclo_dias?.agora, k?.ciclo_dias?.antes, 'dias', { menorEMelhor: true })}
          apoio={['mediana', era(k?.ciclo_dias?.antes, (v) => inteiro(v)), 'menos é melhor'].filter(Boolean).join(' · ')}
        />
        <TiraKpi
          rotulo="Perdidos"
          valor={inteiro(contagem(k?.perdidos))}
          apoio={`${inteiro(contagem(k?.perdidos_para_outra))} ${plural(contagem(k?.perdidos_para_outra), 'fechou', 'fecharam')} com outra imobiliária`}
        />
      </FilaDeKpis>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Placar dados={dados} />
        <PrevisaoPorEtapa dados={dados} />
      </div>

      <FunilComTravas dados={dados} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Velocidade dados={dados} />
        <Perguntas dados={dados} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Objecoes dados={dados} />
        <Canais dados={dados} />
      </div>

      <Equipe dados={dados} />
      <Mensagens dados={dados} />
    </div>
  );
}

function Placar({ dados }: { dados: PainelFunilEquipe }) {
  const p = dados.previsao;
  if (!p) {
    return (
      <Cartao grande titulo="A previsão do mês ainda não tem dado">
        <SemDado>A previsão sai do funil aberto. Ela aparece quando houver negócio em andamento.</SemDado>
      </Cartao>
    );
  }
  const meta = numero(p.meta) ?? numero(dados.premissas?.meta_mes);
  const esperado = Math.max(0, numero(p.esperado) ?? 0);
  const fechados = contagem(p.fechados);
  const baixa = numero(p.faixa_baixa);
  const alta = numero(p.faixa_alta);
  const faixa = baixa !== null && alta !== null && alta >= baixa ? ([baixa, alta] as const) : null;
  const escala = Math.ceil(Math.max(meta ?? 0, alta ?? 0, esperado, fechados, 1) + 1);
  const conta = contaDaMeta(p, meta);
  const fim = fimDoMes(p.mes);
  const ritmo = p.ritmo;
  const porSemanaHoje = numero(ritmo?.visitas_marcadas_por_semana);
  const etapas = [...lista(p.por_etapa)].sort((a, b) => (numero(b.esperado) ?? 0) - (numero(a.esperado) ?? 0));

  const quadrinhos: { numero: string; texto: string }[] = conta
    ? [
        { numero: inteiro(conta.faltam), texto: conta.faltam === 1 ? 'negócio além da previsão' : 'negócios além da previsão' },
        ...(conta.visitasFeitas !== null ? [{ numero: inteiro(conta.visitasFeitas), texto: 'visitas feitas a mais' }] : []),
        ...(conta.visitasMarcadas !== null
          ? [{ numero: inteiro(conta.visitasMarcadas), texto: `visitas marcadas a mais até ${fim}` }]
          : []),
        ...(conta.porSemana !== null
          ? [
              {
                numero: `+${inteiro(conta.porSemana)}`,
                texto: `por semana${porSemanaHoje !== null ? ` (hoje são ${decimalEnxuto(porSemanaHoje)})` : ''}`,
              },
            ]
          : []),
      ]
    : [
        ...etapas.slice(0, 2).map((e) => ({ numero: inteiro(contagem(e.abertos)), texto: `em “${e.etapa}” para acompanhar` })),
        ...(porSemanaHoje !== null ? [{ numero: decimalEnxuto(porSemanaHoje), texto: 'visitas marcadas por semana' }] : []),
        {
          numero: inteiro(Math.max(1, Math.ceil(contagem(p.dias_restantes) / 7))),
          texto: `${plural(Math.ceil(contagem(p.dias_restantes) / 7), 'semana', 'semanas')} até ${fim}`,
        },
      ];

  const partesDoRitmo = [
    numero(ritmo?.visitas_por_negocio) !== null ? `${decimalEnxuto(ritmo?.visitas_por_negocio)} visitas feitas por negócio` : null,
    numero(ritmo?.comparecimento) !== null ? `${pctDaChance(ritmo?.comparecimento)} das visitas marcadas acontecem` : null,
    porSemanaHoje !== null ? `${decimalEnxuto(porSemanaHoje)} visitas marcadas por semana` : null,
  ].filter(Boolean);

  return (
    <Cartao
      grande
      titulo={tituloDaPrevisao(p, meta)}
      sub={`Placar de ${nomeDoMes(p.mes).toLowerCase()}: fechados, previsão pelo funil aberto${meta !== null ? ` e meta de ${inteiro(meta)}` : ''}.`}
    >
      <PlacarDaMeta fechados={fechados} esperado={esperado} faixa={faixa} meta={meta} escala={escala} ticks />
      <Legenda
        itens={[
          { rotulo: `Fechados · ${inteiro(fechados)}`, cor: 'tinta' },
          { rotulo: `Previsão · ${decimalEnxuto(esperado)}`, cor: 'resto' },
          ...(faixa
            ? [{ rotulo: `Faixa provável · ${decimalEnxuto(faixa[0])} a ${decimalEnxuto(faixa[1])}`, cor: 'traco' as const, forma: 'linha' as const }]
            : []),
          ...(meta !== null ? [{ rotulo: 'Meta', cor: 'tinta' as const, forma: 'traco' as const }] : []),
        ]}
      />
      {quadrinhos.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {quadrinhos.map((q) => (
            <Quadrinho key={q.texto} numero={q.numero} texto={q.texto} />
          ))}
        </div>
      ) : null}
      {partesDoRitmo.length > 0 ? <Rodape>Ritmo dos últimos 90 dias: {partesDoRitmo.join(', ')}.</Rodape> : null}
    </Cartao>
  );
}

function PrevisaoPorEtapa({ dados }: { dados: PainelFunilEquipe }) {
  const p = dados.previsao;
  const etapas = lista(p?.por_etapa);
  const maximo = Math.max(0.0001, ...etapas.map((e) => numero(e.esperado) ?? 0));
  const topo = [...etapas].sort((a, b) => (numero(b.esperado) ?? 0) - (numero(a.esperado) ?? 0))[0];

  return (
    <Cartao
      grande
      titulo={tituloDaPrevisaoPorEtapa(etapas)}
      sub={`Negócios abertos × chance de fechar até ${fimDoMes(p?.mes) || 'o fim do mês'} = negócios esperados.`}
    >
      {etapas.length === 0 ? (
        <SemDado>Nenhum negócio aberto no funil.</SemDado>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {etapas.map((e) => {
            const destaque = e === topo;
            return (
              <li key={e.etapa} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.25rem] items-center gap-2.5 text-[13px]">
                <span className="flex min-w-0 flex-col">
                  <span className={cn('truncate', destaque && 'font-semibold')}>{e.etapa}</span>
                  <span className="numerico text-[11px] text-muted-foreground">
                    {inteiro(contagem(e.abertos))} {plural(contagem(e.abertos), 'aberto', 'abertos')} × {pctDaChance(e.chance)}
                  </span>
                </span>
                <Barra valor={numero(e.esperado)} maximo={maximo} cor={destaque ? 'tinta' : 'resto'} />
                <span className="numerico text-right font-medium">{decimalEnxuto(e.esperado)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Cartao>
  );
}

function FunilComTravas({ dados }: { dados: PainelFunilEquipe }) {
  const etapas = lista(dados.funil);
  const simples = etapas.map((e) => ({ etapa: e.etapa, leads: contagem(e.leads) }));
  const gargalo = gargaloDoFunil(simples);
  const maximo = Math.max(1, ...etapas.map((e) => Math.max(contagem(e.leads), contagem(e.antes))));
  const ciclo = numero(dados.ciclo_dias);

  return (
    <Cartao
      grande
      titulo={tituloDoFunilLongo(simples)}
      sub="Leads do período em cada etapa. O traço cinza é o período anterior. Entre as etapas: quanto passou, em quanto tempo e o que mais travou."
      extra={
        <div className="flex flex-col items-start gap-1.5 md:items-end">
          {ciclo !== null ? (
            <p className="text-xs text-muted-foreground">
              Do contato ao fechamento: <strong className="numerico text-sm font-semibold text-foreground">{dias(ciclo)}</strong>
            </p>
          ) : null}
          <Legenda
            itens={[
              { rotulo: 'Este período', cor: 'tinta' },
              { rotulo: 'Período anterior', cor: 'traco', forma: 'traco' },
            ]}
          />
        </div>
      }
    >
      {etapas.length === 0 ? (
        <SemDado>Nenhum lead entrou no funil no período.</SemDado>
      ) : (
        <ol className="flex flex-col">
          {etapas.map((e, i) => {
            const ehGargalo = gargalo?.indice === i;
            const trava = textoDaTrava(e.trava);
            const passou = numero(e.passou);
            const antes = numero(e.passou_antes);
            return (
              <li key={`${e.etapa}-${i}`} className="flex flex-col">
                {i > 0 ? (
                  <div
                    className={cn(
                      'flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-lg px-2 py-1.5 text-xs text-muted-foreground md:grid md:grid-cols-[9.5rem_9rem_5rem_minmax(0,1fr)] md:items-center',
                      ehGargalo && 'bg-quente-fundo',
                    )}
                  >
                    <span className="hidden md:block" aria-hidden="true" />
                    <span className={cn('numerico inline-flex items-center gap-1', ehGargalo ? 'font-semibold text-quente-texto' : 'font-semibold text-foreground')}>
                      {ehGargalo ? <TrendingDown className="size-3.5" aria-hidden="true" /> : <span aria-hidden="true">↓</span>}
                      {passou === null ? '—' : `${Math.round(passou)}%`}
                      {antes !== null ? <span className="font-normal text-muted-foreground"> · era {Math.round(antes)}%</span> : null}
                      {ehGargalo ? <span className="sr-only">, a maior perda</span> : null}
                    </span>
                    <span className="numerico">{numero(e.tempo_horas) === null ? '' : horas(e.tempo_horas)}</span>
                    <span className="w-full leading-snug md:w-auto">{trava}</span>
                  </div>
                ) : null}
                <div className="grid min-h-8 grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)_auto] items-center gap-3 px-2 md:grid-cols-[9.5rem_minmax(0,1fr)_7.5rem]">
                  <span className={cn('truncate text-sm', ehGargalo && 'font-semibold')}>{e.etapa}</span>
                  <Barra
                    valor={contagem(e.leads)}
                    maximo={maximo}
                    marcador={contagem(e.antes) / maximo}
                    altura="h-5"
                  />
                  <span className="text-right text-xs whitespace-nowrap text-muted-foreground">
                    <strong className="numerico text-[15px] font-medium text-foreground">{inteiro(contagem(e.leads))}</strong> · era{' '}
                    {inteiro(contagem(e.antes))}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Cartao>
  );
}

function Velocidade({ dados }: { dados: PainelFunilEquipe }) {
  const linhas = lista(dados.velocidade);
  const porFaixa = new Map<FaixaDeResposta, { leads: number; visitas: number }>(
    linhas.map((v) => [v.faixa, { leads: contagem(v.leads), visitas: contagem(v.visitas) }]),
  );
  const itens = FAIXAS_DE_RESPOSTA.filter((f) => porFaixa.has(f)).map((f) => {
    const v = porFaixa.get(f) ?? { leads: 0, visitas: 0 };
    const taxa = v.leads > 0 ? (v.visitas / v.leads) * 100 : null;
    return { faixa: f, ...v, taxa };
  });
  const teto = tetoRedondo(Math.max(0, ...itens.map((i) => i.taxa ?? 0)));
  const total = itens.reduce((s, i) => s + i.leads, 0);
  const lentos = itens.filter((i) => i.faixa !== 'ate_5').reduce((s, i) => s + i.leads, 0);

  return (
    <Cartao
      titulo={tituloDaVelocidade(linhas)}
      sub="Quanto de cada faixa de primeira resposta marcou visita. Passe o mouse ou o foco numa coluna para ver quantos leads."
    >
      {total === 0 ? (
        <SemDado>Nenhum lead foi respondido no período.</SemDado>
      ) : (
        <Colunas
          maximo={teto}
          altura="h-44"
          eixoY={[`${teto}%`, `${teto / 2}%`, '0']}
          larguraDaBarra="w-[60%]"
          itens={itens.map((i, n) => ({
            chave: i.faixa,
            valor: i.taxa,
            rotulo: i.taxa === null ? '—' : `${Math.round(i.taxa)}%`,
            eixo: rotuloDaFaixaDeResposta(i.faixa),
            destaque: n === 0,
            dica: `${inteiro(i.visitas)} de ${contar(i.leads, 'lead', 'leads')} marcaram visita`,
            aria: `${rotuloDaFaixaDeResposta(i.faixa)}: ${i.taxa === null ? 'sem leads' : `${Math.round(i.taxa)}% marcaram visita`}, de ${contar(i.leads, 'lead', 'leads')}`,
          }))}
        />
      )}
      {total > 0 && lentos > 0 ? (
        <Rodape acao>
          → {inteiro(lentos)} dos {contar(total, 'lead', 'leads')} esperaram mais de 5 minutos pela primeira resposta.
        </Rodape>
      ) : null}
    </Cartao>
  );
}

function Perguntas({ dados }: { dados: PainelFunilEquipe }) {
  const perguntas = lista(dados.perguntas);
  const teto = tetoRedondo(
    Math.max(0, ...perguntas.flatMap((p) => [numero(p.sabe_pct) ?? 0, numero(p.nao_sabe_pct) ?? 0])),
  );
  const razao = (p: (typeof perguntas)[number]) => {
    const s = numero(p.sabe_pct);
    const n = numero(p.nao_sabe_pct);
    return s !== null && n !== null && n > 0 ? s / n : 0;
  };
  const melhor = [...perguntas].sort((a, b) => razao(b) - razao(a))[0];
  const falta = melhor ? contagem(melhor.falta_em) : 0;

  return (
    <Cartao
      titulo={tituloDasPerguntas(perguntas)}
      sub="Quanto marcou visita: quem ainda não disse e quem já disse. À direita, quantos leads em conversa ainda não disseram."
      extra={
        <Legenda
          itens={[
            { rotulo: 'ainda não disse', forma: 'circulo-vazio' },
            { rotulo: 'já disse', forma: 'circulo' },
          ]}
        />
      }
    >
      {perguntas.length === 0 ? (
        <SemDado>A IA ainda não leu o que os leads já disseram.</SemDado>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {perguntas.map((p) => {
            const sim = numero(p.sabe_pct);
            const nao = numero(p.nao_sabe_pct);
            const texto = `${rotuloDoCampo(p.campo)}: quem já disse, ${sim === null ? 'sem dado' : `${pct(sim)} marcou visita`}; quem não disse, ${nao === null ? 'sem dado' : pct(nao)}. ${contar(contagem(p.falta_em), 'lead ainda não disse', 'leads ainda não disseram')}.`;
            return (
              <li key={p.campo} className="grid min-h-9 grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)_3.75rem] items-center gap-2.5 sm:grid-cols-[8rem_minmax(0,1fr)_4.25rem]">
                <span className={cn('text-[13px] leading-snug', p === melhor && razao(p) >= 1.5 && 'font-semibold')}>
                  {rotuloDoCampo(p.campo)}
                </span>
                <Dica texto={texto}>
                  <button type="button" aria-label={texto} className={cn(ALVO, 'py-1')}>
                    <Haltere de={nao} ate={sim} maximo={teto} rotuloDe={pct(nao)} rotuloAte={pct(sim)} />
                  </button>
                </Dica>
                <span className="numerico text-right text-xs">falta {inteiro(contagem(p.falta_em))}</span>
              </li>
            );
          })}
        </ul>
      )}
      {melhor && falta > 0 && razao(melhor) >= 1.5 ? (
        <Rodape acao>
          → {contar(falta, 'lead em conversa ainda não disse', 'leads em conversa ainda não disseram')}{' '}
          {rotuloDoCampo(melhor.campo, 'naFrase')}: pergunte na primeira conversa.
        </Rodape>
      ) : null}
    </Cartao>
  );
}

function Objecoes({ dados }: { dados: PainelFunilEquipe }) {
  const objecoes = [...lista(dados.objecoes)].sort((a, b) => contagem(b.leads) - contagem(a.leads));
  const maxLeads = Math.max(1, ...objecoes.map((o) => contagem(o.leads)));
  const tetoVisita = tetoRedondo(Math.max(0, ...objecoes.map((o) => numero(o.visitaram_pct) ?? 0)));
  const maisComum = objecoes[0]?.objecao;
  const maisResolve = [...objecoes]
    .filter((o) => contagem(o.leads) >= 3 && numero(o.visitaram_pct) !== null)
    .sort((a, b) => (numero(b.visitaram_pct) ?? 0) - (numero(a.visitaram_pct) ?? 0))[0]?.objecao;

  return (
    <Cartao titulo={tituloDasObjecoes(objecoes)} sub="Leads com cada objeção e quanto deles ainda chegou à visita.">
      {objecoes.length === 0 ? (
        <SemDado>Nenhuma objeção anotada no período.</SemDado>
      ) : (
        <div className="grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)_minmax(0,1fr)] sm:gap-x-4">
          <span />
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
            <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[3px] bg-foreground" />
            Leads com a objeção
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
            <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[3px] bg-(--vende-azul)" />
            Ainda visitaram
          </span>
          {objecoes.map((o) => {
            const forte = o.objecao === maisComum || o.objecao === maisResolve;
            const visitou = numero(o.visitaram_pct);
            return (
              <div key={o.objecao} className="contents">
                <span className={cn('text-[13px] leading-snug first-letter:uppercase', forte && 'font-semibold')}>{o.objecao}</span>
                <span className="flex min-w-0 items-center gap-2">
                  <Barra valor={contagem(o.leads)} maximo={maxLeads} altura="h-3.5" className="max-w-[80%]" />
                  <span className="numerico text-xs">{inteiro(contagem(o.leads))}</span>
                </span>
                <span className="flex min-w-0 items-center gap-2">
                  {visitou !== null ? (
                    <Barra valor={visitou} maximo={tetoVisita} cor="azul" altura="h-3.5" className="max-w-[80%]" />
                  ) : null}
                  <span className="numerico text-xs">{visitou === null ? '—' : pct(visitou)}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Cartao>
  );
}

function Canais({ dados }: { dados: PainelFunilEquipe }) {
  const canais = dados.canais;
  const lista_ = canais ? [...canais].sort((a, b) => (numero(b.leads_pct) ?? 0) - (numero(a.leads_pct) ?? 0)) : [];
  const teto = tetoRedondo(Math.max(0, ...lista_.flatMap((c) => [numero(c.leads_pct) ?? 0, numero(c.vendas_pct) ?? 0])));
  const melhor = [...lista_]
    .filter((c) => (numero(c.vendas_pct) ?? 0) > 0)
    .sort(
      (a, b) =>
        (numero(b.vendas_pct) ?? 0) - (numero(b.leads_pct) ?? 0) - ((numero(a.vendas_pct) ?? 0) - (numero(a.leads_pct) ?? 0)),
    )[0]?.canal;

  return (
    <Cartao
      titulo={tituloDosCanais(canais)}
      sub="Parte de cada canal de chegada nos leads e nos negócios fechados."
      extra={
        canais && canais.length > 0 ? (
          <Legenda
            itens={[
              { rotulo: 'Leads', cor: 'resto' },
              { rotulo: 'Vendas', cor: 'tinta' },
            ]}
          />
        ) : undefined
      }
    >
      {!canais ? (
        <SemDado>
          O canal de chegada (placa, anúncios, redes sociais, indicação) ainda não está no ar. Este gráfico aparece quando
          estiver.
        </SemDado>
      ) : lista_.length === 0 ? (
        <SemDado>Nenhum lead com canal de chegada no período.</SemDado>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {lista_.map((c) => (
            <li key={c.canal} className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
              <span className={cn('text-[13px]', c.canal === melhor && 'font-semibold')}>{c.canal}</span>
              <span className="flex flex-col gap-0.5">
                <span className="flex items-center gap-1.5">
                  <Barra valor={numero(c.leads_pct)} maximo={teto} cor="resto" altura="h-2.5" className="max-w-[85%]" />
                  <span className="numerico text-[11px] text-muted-foreground">
                    {pct(c.leads_pct)}
                    <span className="sr-only"> dos leads</span>
                  </span>
                </span>
                <span className="flex items-center gap-1.5">
                  <Barra valor={numero(c.vendas_pct)} maximo={teto} altura="h-2.5" className="max-w-[85%]" />
                  <span className="numerico text-[11px] font-semibold">
                    {pct(c.vendas_pct)}
                    <span className="sr-only"> das vendas</span>
                  </span>
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Cartao>
  );
}

type Passo = {
  titulo: string;
  sub: string;
  valor: (p: LinhaPessoaVende) => number | null;
  texto: (v: number) => string;
  menorEMelhor?: boolean;
};

const PASSOS: readonly Passo[] = [
  {
    titulo: 'Primeira resposta',
    sub: 'mediana · menos é melhor',
    valor: (p) => numero(p.primeira_resposta_min),
    texto: (v) => minutos(v),
    menorEMelhor: true,
  },
  { titulo: 'Marca visita', sub: 'dos leads que atendeu', valor: (p) => numero(p.marca_visita_pct), texto: (v) => pct(v) },
  {
    titulo: 'Visita vira proposta',
    sub: 'das visitas que fez',
    valor: (p) => numero(p.visita_proposta_pct),
    texto: (v) => pct(v),
  },
];

function Equipe({ dados }: { dados: PainelFunilEquipe }) {
  const equipe = lista(dados.equipe);
  const ia = dados.ia;

  return (
    <Cartao
      grande
      titulo={tituloDaEquipe(equipe)}
      sub="Os três passos que decidem a venda, por pessoa."
      extra={<Legenda itens={[{ rotulo: 'Média da equipe', cor: 'traco', forma: 'traco' }]} />}
    >
      {equipe.length === 0 ? (
        <SemDado>Ninguém da equipe atendeu lead no período.</SemDado>
      ) : (
        <>
          <div className="grid gap-7 md:grid-cols-3">
            {PASSOS.map((passo) => (
              <MultiploDaEquipe key={passo.titulo} passo={passo} equipe={equipe} />
            ))}
          </div>
          {/* `relative` segura o `sr-only` (absoluto) dentro da rolagem. */}
          <div className="relative -mx-4 overflow-x-auto md:-mx-5" style={SOMBRA_DE_ROLAGEM_NO_CARTAO}>
            <table className="w-full min-w-[880px] border-collapse text-[13px]">
              <caption className="sr-only">A equipe e a IA, pessoa a pessoa</caption>
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pr-2 pl-4 text-left font-semibold md:pl-5">
                    Pessoa
                  </th>
                  {['Atendeu', '1ª resposta', 'Visitas marcadas', 'Visita → proposta', 'Fechou', 'Promessas em dia'].map((c) => (
                    <th key={c} scope="col" className="px-2 py-2 text-right font-semibold">
                      {c}
                    </th>
                  ))}
                  <th scope="col" className="py-2 pr-4 pl-2 text-right font-semibold md:pr-5">
                    Parado agora
                  </th>
                </tr>
              </thead>
              <tbody>
                {equipe.map((p) => {
                  const promessas = numero(p.promessas_em_dia_pct);
                  const baixa = promessas !== null && promessas < 65;
                  return (
                    <tr key={p.pessoa_id} className="border-t border-hairline">
                      <th scope="row" className="py-2.5 pr-2 pl-4 text-left font-semibold md:pl-5">
                        {p.nome}
                      </th>
                      <td className="numerico px-2 py-2.5 text-right">{inteiro(contagem(p.atendeu))}</td>
                      <td className="numerico px-2 py-2.5 text-right">{minutos(p.primeira_resposta_min)}</td>
                      <td className="numerico px-2 py-2.5 text-right">{inteiro(contagem(p.visitas_marcadas))}</td>
                      <td className="numerico px-2 py-2.5 text-right">{pct(p.visita_proposta_pct)}</td>
                      <td className="numerico px-2 py-2.5 text-right">{inteiro(contagem(p.fechou))}</td>
                      <td className={cn('numerico px-2 py-2.5 text-right', baixa && 'font-semibold text-quente-texto')}>
                        <span className="inline-flex items-center justify-end gap-1">
                          {baixa ? <AlertTriangle className="size-3.5" aria-hidden="true" /> : null}
                          {pct(promessas)}
                          {baixa ? <span className="sr-only">, abaixo de 65%</span> : null}
                        </span>
                      </td>
                      <td className="numerico py-2.5 pr-4 pl-2 text-right md:pr-5">{dinheiroCurto(p.parado_valor)}</td>
                    </tr>
                  );
                })}
                {ia ? (
                  <tr className="border-t border-hairline text-muted-foreground">
                    <th scope="row" className="py-2.5 pr-2 pl-4 text-left font-semibold text-foreground md:pl-5">
                      IA
                    </th>
                    <td className="numerico px-2 py-2.5 text-right text-foreground">{inteiro(contagem(ia.atendeu))}</td>
                    <td className="numerico px-2 py-2.5 text-right text-foreground">{minutos(ia.primeira_resposta_min)}</td>
                    <td className="numerico px-2 py-2.5 text-right text-foreground">{inteiro(contagem(ia.visitas_marcadas))}</td>
                    <td className="px-2 py-2.5 text-right">—</td>
                    <td className="px-2 py-2.5 text-right">—</td>
                    <td className="px-2 py-2.5 text-right">—</td>
                    <td className="py-2.5 pr-4 pl-2 text-right md:pr-5">—</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <Rodape>Promessas em dia abaixo de 65% aparecem com o sinal de alerta.</Rodape>
        </>
      )}
    </Cartao>
  );
}

function MultiploDaEquipe({ passo, equipe }: { passo: Passo; equipe: readonly LinhaPessoaVende[] }) {
  const valores = equipe.map((p) => passo.valor(p));
  const bons = valores.filter((v): v is number => v !== null);
  const m = media(bons);
  const teto = passo.menorEMelhor ? Math.max(1, ...bons) * 1.1 : tetoRedondo(Math.max(0, ...bons));
  const melhor = bons.length > 0 ? (passo.menorEMelhor ? Math.min(...bons) : Math.max(...bons)) : null;

  return (
    <figure className="flex min-w-0 flex-col gap-2.5">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{passo.titulo}</span>
        <span className="text-[11px] text-muted-foreground">{passo.sub}</span>
      </figcaption>
      <ul className="flex flex-col gap-2">
        {equipe.map((p, i) => {
          const v = valores[i] ?? null;
          const destaque = v !== null && v === melhor;
          return (
            <li key={p.pessoa_id} className="grid grid-cols-[minmax(0,4.5rem)_minmax(0,1fr)_3.25rem] items-center gap-2.5">
              <span className={cn('truncate text-[13px]', destaque && 'font-semibold')}>{p.nome}</span>
              <Barra valor={v} maximo={teto} cor={destaque ? 'tinta' : 'resto'} marcador={m === null ? null : m / teto} />
              <span className="numerico text-right text-[13px] font-medium">{v === null ? '—' : passo.texto(v)}</span>
            </li>
          );
        })}
      </ul>
      <span className="text-[11px] text-muted-foreground">
        Média: <span className="numerico">{m === null ? '—' : passo.texto(m)}</span>
      </span>
    </figure>
  );
}

function Mensagens({ dados }: { dados: PainelFunilEquipe }) {
  const mensagens = [...lista(dados.mensagens)]
    .sort((a, b) => (numero(b.visitas_pct) ?? 0) - (numero(a.visitas_pct) ?? 0))
    .slice(0, 8);
  const m = numero(dados.mensagens_media_visita_pct);
  const teto = tetoRedondo(Math.max(m ?? 0, ...mensagens.map((x) => numero(x.visitas_pct) ?? 0)));

  return (
    <Cartao
      grande
      titulo={tituloDasMensagens(mensagens, m)}
      sub={`Quanto marcou visita depois de cada mensagem (equipe e IA).${m !== null && mensagens.length > 0 ? ` O traço é a média: ${pct(m)}.` : ''}`}
      extra={
        m !== null && mensagens.length > 0 ? (
          <Legenda itens={[{ rotulo: 'Média', cor: 'traco', forma: 'traco' }]} />
        ) : undefined
      }
    >
      {mensagens.length === 0 ? (
        <SemDado>Nenhuma mensagem foi enviada vezes bastantes no período para comparar.</SemDado>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {mensagens.map((x, i) => {
            const v = numero(x.visitas_pct);
            const acima = v !== null && (m === null || v >= m);
            return (
              <li key={i} className="flex min-w-0 flex-col gap-2 rounded-lg p-3.5 ring-1 ring-border ring-inset">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="line-clamp-4 text-[13px] leading-snug">“{x.texto}”</span>
                  <span className="numerico text-lg font-medium">{pct(v)}</span>
                </span>
                <span className="relative block rounded-[3px] bg-muted">
                  <Barra valor={v} maximo={teto} cor={acima ? 'tinta' : 'resto'} altura="h-2.5" marcador={m === null ? null : m / teto} />
                </span>
                <span className="text-[11px] text-muted-foreground">{contar(contagem(x.enviados), 'envio', 'envios')}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Cartao>
  );
}
