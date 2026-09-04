'use client';

import { useCallback, useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

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
    const alvo = `${window.location.pathname}?dia=${dia}${visao === 'semana' ? '&visao=semana' : ''}`;
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

        <div
          className="flex items-center gap-1 rounded-lg border border-hairline p-0.5"
          role="group"
          aria-label="Como ver a agenda"
        >
          {(['dia', 'semana'] as const).map((opcao) => (
            <button
              key={opcao}
              type="button"
              aria-pressed={visao === opcao}
              onClick={() => setVisao(opcao)}
              className={cn(
                'toque h-10 rounded-[calc(var(--radius-lg)-2px)] px-3.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:h-7',
                visao === opcao ? 'acao-gradiente' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {opcao === 'dia' ? 'Dia' : 'Semana'}
            </button>
          ))}
        </div>
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
        aria-label={visao === 'dia' ? rotuloDiaPorExtenso(dia) : 'Semana inteira'}
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
        ) : (
          <ListaDoDia
            dia={dia}
            itens={doDia}
            catalogo={contexto.catalogo}
            aoPedirDesfecho={setPedido}
            proximo={proximoCompromisso(itens, referenciaDoProximo)}
            semanaVazia={abertos === 0}
            aoIrParaDia={irParaDia}
          />
        )}
      </section>

      <AindaNaoLigado />

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
    <section className="flex flex-col gap-2 border-t border-hairline pt-4">
      <h2 className="text-xs font-medium text-muted-foreground">O que ainda não está ligado</h2>
      <ul className="flex max-w-prose flex-col gap-1.5 text-xs leading-relaxed text-muted-foreground">
        <li>
          <span className="text-foreground">Google Calendar</span> (horários livres, criação do
          evento e link do Meet, RF-AGE-02 e RF-AGE-04): depende da conta Google do time conectada
          ao CRM. Hoje o compromisso vive só aqui.
        </li>
        <li>
          <span className="text-foreground">Lembretes de 24 h e 1 h</span> e o aviso de falta de
          confirmação (RF-AGE-06): dependem do número oficial na Cloud API da Meta, que entra com o
          módulo de Conversas.
        </li>
        <li>
          <span className="text-foreground">Rota otimizada</span> por tempo de deslocamento, com um
          link único do Maps para as paradas do dia (RF-ROT-03): depende da geocodificação dos
          endereços (RF-ROT-01). Por enquanto, ordem por bairro e um link de busca por parceiro.
        </li>
        <li>
          <span className="text-foreground">Página pública de agendamento</span> (RF-AGE-09) está
          fora do MVP.
        </li>
      </ul>
      <p className="text-xs text-muted-foreground">
        Todos os horários no fuso de Natal (America/Fortaleza), seja qual for o fuso do aparelho.
      </p>
    </section>
  );
}
