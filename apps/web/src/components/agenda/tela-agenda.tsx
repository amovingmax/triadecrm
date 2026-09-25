'use client';

import { useCallback, useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { SeletorDeAba } from '@/components/ui/abas';
import { NotaRecolhida } from '@/components/ui/nota-recolhida';

import { cn } from '@/lib/utils';
import {
  EXTRAS_VAZIOS,
  FolhaExtra,
  precisaDeExtra,
  type ValoresExtras,
} from '@/components/registro/folha-extra';
import { instanteEmFortaleza, type DesfechoCatalogo } from '@/components/registro/tipos';

import { buscarCompromissos, chaveDaAgenda, ErroDaAgenda } from './consultas';
import { type ContextoDaAgenda } from './dados';
import { ErroDaAgendaNaTela, EsqueletoAgenda } from './estados';
import { FolhaDesfecho } from './folha-desfecho';
import { ListaDoDia } from './lista-dia';
import { registrarDesfechoDoCompromisso } from './registrar-desfecho';
import { TelaRota } from './tela-rota';
import { TiraDaSemana } from './tira-semana';
import {
  contarPorDia,
  diaDoInstante,
  inicioDaSemana,
  proximoCompromisso,
  rotuloDiaPorExtenso,
  somarDias,
  type Compromisso,
  type Dia,
  type PedidoDeDesfecho,
  type Visao,
} from './tipos';
import { VisaoDaSemana } from './visao-semana';

/**
 * A Agenda (PRD §7.5): as reuniões e as visitas da semana, e o desfecho de cada uma.
 *
 * Três decisões que sustentam o resto do módulo:
 *
 * 1. **A semana inteira é UMA consulta.** Trocar de dia dentro da semana não vai ao
 *    servidor: a tira de navegação precisa da contagem de todos os dias para ser um
 *    mapa, e buscar dia a dia daria sete idas à rede para desenhar sete números.
 *
 * 2. **Nenhuma ação escreve etapa por conta própria.** "Realizada", "Não compareceu"
 *    e "Reagendar" gravam pela `public.registrar_contato`, a mesma da tela de campo,
 *    com desfechos do mesmo catálogo. A agenda não tem regra de funil.
 *
 * 3. **O dia e a visão moram na URL** (`?dia=`, `?visao=`), por `replaceState`: um
 *    link de "a quinta da Heloísa" pode ser mandado no grupo, e voltar do parceiro
 *    traz o mesmo dia. Sem entrada nova no histórico a cada toque na tira.
 */
const SEM_ITENS: Compromisso[] = [];

export function TelaAgenda({
  usuarioId,
  contexto,
  hoje,
  agoraIso,
  diaInicial,
  visaoInicial,
}: {
  usuarioId: string;
  contexto: ContextoDaAgenda;
  /** Hoje em `America/Fortaleza`, resolvido no servidor: data durante a renderização é impura. */
  hoje: Dia;
  agoraIso: string;
  diaInicial: Dia;
  visaoInicial: Visao;
}) {
  const [dia, setDia] = useState<Dia>(diaInicial);
  const [visao, setVisao] = useState<Visao>(visaoInicial);
  const [pedido, setPedido] = useState<PedidoDeDesfecho | null>(null);
  const [pendente, setPendente] = useState<{
    compromisso: Compromisso;
    desfecho: DesfechoCatalogo;
  } | null>(null);

  const clienteDeConsultas = useQueryClient();
  const inicio = inicioDaSemana(dia);
  const fim = somarDias(inicio, 6);

  useEffect(() => {
    const alvo = `${window.location.pathname}?dia=${dia}${visao === 'dia' ? '' : `&visao=${visao}`}`;
    if (alvo !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, '', alvo);
    }
  }, [dia, visao]);

  const consulta = useQuery({
    queryKey: chaveDaAgenda(usuarioId, inicio, fim),
    queryFn: () =>
      buscarCompromissos({
        usuarioId,
        primeiroDia: inicio,
        ultimoDia: fim,
        etapasComHoraMarcada: contexto.etapasComHoraMarcada,
      }),
    placeholderData: keepPreviousData,
  });

  const itens = consulta.data ?? SEM_ITENS;
  const doDia = itens.filter((c) => diaDoInstante(c.quando) === dia);
  const contagem = contarPorDia(itens);
  const abertos = itens.filter((c) => !c.concluido).length;
  // "O próximo" conta a partir do dia que está aberto na tela, nunca de trás dele:
  // num dia vazio de quarta, apontar para a terça que já passou manda a pessoa para o
  // passado. Quando o dia aberto é hoje, a referência é o relógio.
  const inicioDoDia = instanteEmFortaleza(dia, 0);
  const referenciaDoProximo = agoraIso > inicioDoDia ? agoraIso : inicioDoDia;

  const gravacao = useMutation({
    mutationFn: (params: {
      compromisso: Compromisso;
      desfecho: DesfechoCatalogo;
      extras: ValoresExtras;
    }) =>
      registrarDesfechoDoCompromisso({
        ...params,
        etapasAlvo: contexto.etapasAlvo,
        feriados: contexto.feriados,
      }),
    onSuccess: (resultado) => {
      if (!resultado.ok) {
        toast.error(resultado.frase);
        return;
      }
      toast.success(resultado.frase);
      if (!resultado.compromissoFechado) {
        toast.warning('O resultado foi gravado, mas o compromisso continuou aberto na lista.');
      }
      /* A reunião não fechou. É `warning` e não `error` porque o registro
         entrou: o que falhou foi fechar o objeto. E precisa aparecer, porque é a
         falha desta tela que ninguém veria — a linha continua viva em
         `public.reunioes`, segurando o horário na trava de colisão e contando no
         teto de 4 do dia, e o único sintoma seria um horário que some da grade
         sem explicação. */
      if (resultado.avisoDaReuniao) {
        toast.warning('A reunião continua aberta.', {
          description: resultado.avisoDaReuniao,
          duration: 12_000,
        });
      }
      void clienteDeConsultas.invalidateQueries({ queryKey: ['agenda'] });
    },
    onError: () => {
      toast.error('Não deu para falar com o servidor. Confira a conexão e tente de novo.');
    },
  });

  const gravar = useCallback(
    (compromisso: Compromisso, desfecho: DesfechoCatalogo, extras: ValoresExtras) => {
      setPedido(null);
      setPendente(null);
      gravacao.mutate({ compromisso, desfecho, extras });
    },
    [gravacao],
  );

  const escolherDesfecho = useCallback(
    (desfecho: DesfechoCatalogo) => {
      if (!pedido) return;
      const compromisso = pedido.compromisso;
      setPedido(null);
      if (precisaDeExtra(desfecho)) {
        setPendente({ compromisso, desfecho });
        return;
      }
      gravar(compromisso, desfecho, EXTRAS_VAZIOS);
    },
    [pedido, gravar],
  );

  const irParaDia = useCallback((novo: Dia) => {
    setDia(novo);
    setVisao('dia');
  }, []);

  const erro = consulta.error;

  return (
    <div className="flex w-full flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Agenda</h1>
          <p className="text-sm text-muted-foreground">
            {consulta.isPending ? (
              'Carregando a semana...'
            ) : (
              <>
                <span className="numerico">{abertos}</span>
                {abertos === 1 ? ' compromisso aberto' : ' compromissos abertos'} nesta semana
              </>
            )}
          </p>
        </div>

        {/* Era um segmentado com contorno e a opção ativa em `acao-gradiente` — o
            mesmo tratamento do botão de AÇÃO PRINCIPAL do produto, gasto aqui
            para dizer qual das três visões está aberta. Escolher visão não é a
            ação principal de tela nenhuma. */}
        <SeletorDeAba
          rotulo="Como ver a agenda"
          ativo={visao}
          aoTrocar={setVisao}
          itens={[
            { id: 'dia', rotulo: 'Dia' },
            { id: 'semana', rotulo: 'Semana' },
            { id: 'rota', rotulo: 'Rota' },
          ]}
        />
      </header>

      <TiraDaSemana
        inicio={inicio}
        diaAtivo={dia}
        hoje={hoje}
        contagem={contagem}
        aoEscolherDia={(novo) => setDia(novo)}
        aoTrocarSemana={(passo) => setDia(somarDias(dia, passo * 7))}
        aoVoltarParaHoje={() => setDia(hoje)}
      />

      <section
        aria-label={
          visao === 'semana'
            ? 'Semana inteira'
            : visao === 'rota'
              ? `Rota da tarde de ${rotuloDiaPorExtenso(dia)}`
              : rotuloDiaPorExtenso(dia)
        }
        className={cn(
          'border-t border-hairline pt-4',
          consulta.isPlaceholderData && 'pointer-events-none opacity-60',
        )}
      >
        {visao === 'dia' ? (
          <h2 className="pb-3 text-sm font-medium first-letter:uppercase">
            {rotuloDiaPorExtenso(dia)}
            {dia === hoje ? <span className="text-muted-foreground"> · hoje</span> : null}
          </h2>
        ) : null}

        {consulta.isPending ? (
          <EsqueletoAgenda />
        ) : erro ? (
          <ErroDaAgendaNaTela
            causa={erro instanceof ErroDaAgenda ? erro.message : 'A busca falhou.'}
            podeTentar={!(erro instanceof ErroDaAgenda) || erro.podeTentarDeNovo}
            aoTentar={() => void consulta.refetch()}
          />
        ) : visao === 'semana' ? (
          <VisaoDaSemana inicio={inicio} itens={itens} hoje={hoje} aoIrParaDia={irParaDia} />
        ) : visao === 'rota' ? (
          <TelaRota usuarioId={usuarioId} dia={dia} hoje={hoje} />
        ) : (
          <ListaDoDia
            dia={dia}
            itens={doDia}
            catalogo={contexto.catalogo}
            aoPedirDesfecho={setPedido}
            aoMudarReuniao={() => void clienteDeConsultas.invalidateQueries({ queryKey: ['agenda'] })}
            proximo={proximoCompromisso(itens, referenciaDoProximo)}
            semanaVazia={abertos === 0}
            aoIrParaDia={irParaDia}
          />
        )}
      </section>

      {/* A faixa de conexão com o Google saiu com o calendário (ADR-15): não há
          mais nada para configurar aqui — a sala de cada pessoa mora em Ajustes,
          e o livre/ocupado é calculado pelo CRM. Na aba Rota a nota não aparece:
          ela fala da lista do dia. */}
      {visao === 'rota' ? null : <AindaNaoLigado />}

      <FolhaDesfecho
        pedido={pedido}
        etapasAlvo={contexto.etapasAlvo}
        gravando={gravacao.isPending}
        aoEscolher={escolherDesfecho}
        aoFechar={() => setPedido(null)}
      />

      <FolhaExtra
        desfecho={pendente?.desfecho ?? null}
        motivosPerda={contexto.motivosPerda}
        formatosDaEtapa={contexto.formatosDeReuniao[pendente?.compromisso.pipelineId ?? -1] ?? []}
        aoConfirmar={(extras) => {
          if (pendente) gravar(pendente.compromisso, pendente.desfecho, extras);
        }}
        aoCancelar={() => setPendente(null)}
      />
    </div>
  );
}

/**
 * O que esta tela ainda NÃO faz, e do que cada coisa depende.
 *
 * Fica na própria tela, e não num documento: quem usa precisa saber que o lembrete de
 * 24 h não vai sair, senão conta com ele. Tela bonita que esconde o que não existe é
 * pior do que tela simples que diz a verdade.
 */
function AindaNaoLigado() {
  return (
    <NotaRecolhida titulo="O que ainda não está ligado">
      <ul className="flex flex-col gap-1.5">
        <li>
          <span className="text-foreground">Lembrete automático ao parceiro</span>, na véspera e
          na hora: depende de a Meta aprovar os dois modelos de 24 h, que ainda estão
          pendentes. Na véspera a janela de resposta livre já fechou, e o CRM não manda
          texto livre fora dela. Enquanto isso, quem atende recebe uma tarefa às 17h do dia
          anterior para confirmar por conta própria.
        </li>
        <li>
          <span className="text-foreground">Rota otimizada</span> por tempo de deslocamento já
          existe: está na aba <span className="text-foreground">Rota</span>.
          Aqui, na lista do dia, a ordem continua sendo a do relógio e o agrupamento é por bairro —
          são perguntas diferentes.
        </li>
        <li>
          <span className="text-foreground">Página pública de agendamento</span> está
          fora do MVP.
        </li>
      </ul>
      <p className="mt-2">
        Todos os horários no fuso de Natal (America/Fortaleza), seja qual for o fuso do aparelho.
      </p>
    </NotaRecolhida>
  );
}
