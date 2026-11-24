'use client';

import Link from 'next/link';
import { useId, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bot,
  BotOff,
  Check,
  ChevronRight,
  ExternalLink,
  Pencil,
  Plus,
  ThumbsUp,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Chave } from '@/components/admin/chave';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { FaixaDeNumeros, NumeroCompacto } from '@/components/ui/faixa-de-numeros';
import { FaixaDeslizante } from '@/components/ui/faixa-deslizante';
import { Input } from '@/components/ui/input';
import { SeletorDeAba } from '@/components/ui/abas';

import {
  CHAVE_DA_IA,
  CHAVE_DAS_RECENTES,
  CHAVE_DO_CADERNO,
  CHAVE_DO_PAINEL,
  ErroDaIa,
  avaliarResposta,
  carregarCaderno,
  carregarPainel,
  carregarRespostasRecentes,
  carregarSetores,
  configurarIa,
  escreverNoCaderno,
  linkDaConversa,
  marcarConversaDeTeste,
  procurarConversas,
  tirarDoCaderno,
  type ConversaAchada,
  type LinhaDoCaderno,
  type ModeloDaIa,
  type PainelDaIa,
  type RespostaDaIa,
} from './dados';
import {
  FILTROS_DAS_RESPOSTAS,
  RESPOSTAS_POR_VEZ,
  filtrarRespostas,
  partirNota,
  situacaoDaIa,
  type FiltroDasRespostas,
  type TomDaSituacao,
} from './formas';
import { DialogoDeCorrecao } from './na-conversa';

/**
 * A tela "IA que atende" (Imova, 06/11/2026).
 *
 * É a tela da semana de treino: o placar diz se ela está pronta para os clientes,
 * "Respostas" é onde quem acompanha diz "Boa" ou "Corrigir" sem abrir conversa por
 * conversa, "Caderno" é o que ela sabe (o que o Janio ensinou, as correções e o
 * que a equipe escrever) e "Configuração" liga, desliga e escolhe a conversa do
 * treino e as de teste (10/11/2026: a IA conversa ali sem aprender). A IA lê o
 * caderno e os imóveis da aba Anúncios a cada resposta.
 *
 * O DESENHO DE 24/11/2026 (protótipo responsivo aprovado pelo dono). No celular a
 * tela tinha uns 12.000 px de altura e 120 alvos pequenos. Agora: a situação num
 * cartão com selo e botão; os sete números numa faixa que desliza no celular; as
 * abas presas logo abaixo do cabeçalho ao rolar, com os filtros das respostas
 * junto; cada resposta como uma mini-conversa (os balões da conversa da casa), o
 * "Por quê" recolhido e Boa, Corrigir e Abrir com 44 px no celular e 40 no
 * computador; a lista mostra 10 de cada vez. Filtro e "Mostrar mais" só
 * reorganizam o que já veio do banco: nenhuma consulta nova. As funções são as de
 * antes, nos mesmos lugares; o caderno ganhou o botão "Ensinar" para abrir a caixa
 * de escrever, e "Tirar" passou para dentro da edição da nota.
 */

type Aba = 'respostas' | 'caderno' | 'configuracao';

const ABAS: readonly { id: Aba; rotulo: string }[] = [
  { id: 'respostas', rotulo: 'Respostas' },
  { id: 'caderno', rotulo: 'Caderno' },
  { id: 'configuracao', rotulo: 'Configuração' },
];

/** O que muda a IA (ligar, modo, anotar): 44px no celular, 40 no computador. */
const BOTAO_PRINCIPAL = 'toque h-11 md:h-10';
/** Os botões de cada linha (Salvar, Treinar por esta, Tirar…): 44px no celular, 36 no computador. */
const BOTAO_DA_LINHA = 'toque h-11 px-3.5 md:h-9 md:px-3';
/** Seletor nativo com letra de 16px no celular: abaixo disso o iOS dá zoom ao tocar. */
const SELETOR =
  'h-11 min-w-0 rounded-lg border border-input bg-background px-3 text-base md:h-10 md:text-sm';
/** A caixa de texto das notas e do aviso: 16px no celular pelo mesmo motivo. */
const CAIXA_DE_TEXTO =
  'w-full rounded-lg border border-input bg-background px-3 py-2 text-base focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:text-sm';
/** O cartão de cada parte (o `.cartao.pad` do protótipo). */
const CARTAO = 'flex flex-col gap-3 rounded-xl bg-card p-4 sombra-base';
const TITULO_DO_CARTAO = 'flex items-center gap-2 text-[17px] font-bold tracking-[-0.01em]';

function mensagemDoErro(e: unknown): string {
  if (e instanceof ErroDaIa) return e.message;
  return 'O servidor não respondeu. Tente de novo.';
}

function semAssinatura(corpo: string): string {
  return corpo.replace(/^\*[^*\n]{1,60}:\*\n/, '');
}

const QUANDO = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Fortaleza',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const ROTULO_DA_ACAO: Readonly<Record<string, string>> = {
  respondeu: 'respondeu',
  passou_para_pessoa: 'passou para um corretor',
  marcou_visita: 'marcou visita',
  anotou: 'anotou',
};

export function TelaDaIa() {
  const [aba, setAba] = useState<Aba>('respostas');
  const [filtro, setFiltro] = useState<FiltroDasRespostas>('Todas');
  const [quantas, setQuantas] = useState(RESPOSTAS_POR_VEZ);
  const painel = useQuery({ queryKey: CHAVE_DO_PAINEL, queryFn: () => carregarPainel(7) });
  const p = painel.data;

  return (
    <div className="flex w-full flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-[28px] leading-tight font-normal tracking-[-0.02em] md:text-[32px]">
          IA que atende
        </h1>
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          Ela responde os clientes sozinha, tira dúvidas dos imóveis, marca visita e passa para um
          corretor quando é coisa de gente. As mensagens saem assinadas &ldquo;
          {p?.config.assinatura ?? 'Imova'}&rdquo;.
        </p>
      </header>

      {p ? <Situacao painel={p} /> : null}
      {p ? <Placar painel={p} /> : null}

      {/* As abas (e os filtros das respostas) ficam presas logo abaixo do cabeçalho
          da casca, que tem 56px no celular e 72 do `md` para cima. A faixa vai de
          ponta a ponta da página, com o fundo da tela esfumado por trás. */}
      <div className="sticky top-14 z-20 -mx-4 flex flex-col gap-2.5 bg-background/90 px-4 py-2.5 backdrop-blur-md md:top-[72px] md:-mx-5 md:px-5">
        <SeletorDeAba itens={ABAS} ativo={aba} aoTrocar={setAba} rotulo="Partes da IA que atende" />
        {aba === 'respostas' ? (
          <FaixaDeslizante rotulo="Filtrar respostas" ativo={filtro} sangria>
            {FILTROS_DAS_RESPOSTAS.map((f) => (
              <Chip
                key={f}
                ativo={f === filtro}
                onClick={() => {
                  setFiltro(f);
                  setQuantas(RESPOSTAS_POR_VEZ);
                }}
              >
                {f}
              </Chip>
            ))}
          </FaixaDeslizante>
        ) : null}
      </div>

      {aba === 'respostas' ? (
        <Respostas
          filtro={filtro}
          quantas={quantas}
          aoMostrarMais={() => setQuantas((n) => n + RESPOSTAS_POR_VEZ)}
          assinatura={p?.config.assinatura ?? 'Imova'}
        />
      ) : null}
      {aba === 'caderno' ? <Caderno /> : null}
      {aba === 'configuracao' && p ? <Configuracao painel={p} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A situação e o placar
// ---------------------------------------------------------------------------

const COR_DO_SELO: Readonly<Record<TomDaSituacao, string>> = {
  atendendo: 'bg-cliente-fundo text-cliente-texto',
  treino: 'bg-menta-fundo text-menta-texto',
  parada: 'bg-quente-fundo text-quente-texto',
  desligada: 'bg-muted text-muted-foreground',
};

function Situacao({ painel }: { painel: PainelDaIa }) {
  const { config, treino } = painel;
  const s = situacaoDaIa(painel);
  const Icone = config.ligada ? Bot : BotOff;
  return (
    <section
      aria-label="Situação da IA"
      className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3.5 gap-y-1.5 rounded-xl bg-card p-4 sombra-base md:grid-cols-[auto_minmax(0,1fr)_auto]"
    >
      <span
        aria-hidden="true"
        className={cn(
          'row-span-2 grid size-11 place-items-center rounded-xl',
          config.ligada ? 'bg-primary/12 text-primary' : 'bg-muted text-muted-foreground',
        )}
      >
        <Icone className="size-5" />
      </span>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <h2 className="text-base font-semibold">{s.titulo}</h2>
        <span
          className={cn(
            'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap',
            COR_DO_SELO[s.tom],
          )}
        >
          <span aria-hidden="true" className="size-[7px] rounded-full bg-current" />
          {s.selo}
        </span>
      </div>
      <p className="col-start-2 text-sm text-muted-foreground">{s.frase}</p>
      {treino && config.ligada ? (
        <div className="col-span-2 mt-1.5 md:col-span-1 md:col-start-3 md:row-span-2 md:row-start-1 md:mt-0 md:self-center">
          <Button asChild variant="outline" className={BOTAO_PRINCIPAL}>
            <Link
              href={linkDaConversa({ organizacaoId: treino.organizacaoId, conversaId: treino.id })}
            >
              <ExternalLink aria-hidden="true" />
              Abrir a conversa
            </Link>
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function Placar({ painel }: { painel: PainelDaIa }) {
  const { placar, caderno } = painel;
  const id = useId();
  const avaliadas = placar.boas + placar.corrigidas;
  const acerto = avaliadas === 0 ? null : Math.round((placar.boas / avaliadas) * 100);
  const itens: { rotulo: string; valor: ReactNode; detalhe?: string }[] = [
    {
      rotulo: 'Respostas',
      valor: String(placar.respostas),
      detalhe: `${placar.conversas} conversa(s)${placar.noTeste > 0 ? ` · ${placar.noTeste} no teste` : ''}`,
    },
    {
      rotulo: 'Boas',
      valor: acerto === null ? '—' : `${acerto}%`,
      detalhe: `${placar.boas} boas · ${placar.corrigidas} corrigidas`,
    },
    { rotulo: 'Sem avaliação', valor: String(placar.semAvaliacao) },
    { rotulo: 'Passou p/ corretor', valor: String(placar.passadas) },
    { rotulo: 'Visitas marcadas', valor: String(placar.visitas) },
    {
      rotulo: 'Caderno',
      valor: String(caderno.ativas),
      detalhe: `${caderno.doTreino} do treino · ${caderno.correcoes} correções`,
    },
    {
      rotulo: 'Custo da IA',
      // "US$" pequeno, como unidade: no tablet e no notebook a caixa tem uns 120px,
      // e "US$ 0,00" inteiro em 24px quebrava em duas linhas.
      valor: (
        <span className="whitespace-nowrap">
          <span className="font-sans text-[13px] font-medium text-muted-foreground">US$</span>{' '}
          {painel.custoUsd.toLocaleString('pt-BR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </span>
      ),
      detalhe: `${painel.imoveis} imóveis na base`,
    },
  ];
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="text-xs font-bold tracking-[0.07em] text-muted-foreground uppercase">
        Últimos 7 dias
      </h2>
      {/* Mínimo de 7,5rem e não os 8,5 da faixa: assim os sete cabem numa linha já no
          notebook de 1024 px, e no tablet ficam em duas (5 + 2), como no protótipo. */}
      <FaixaDeNumeros
        rotulo="Placar dos últimos 7 dias"
        className="md:grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))]"
      >
        {itens.map((i) => (
          <NumeroCompacto key={i.rotulo} rotulo={i.rotulo} valor={i.valor} detalhe={i.detalhe} />
        ))}
      </FaixaDeNumeros>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Respostas
// ---------------------------------------------------------------------------

function Respostas({
  filtro,
  quantas,
  aoMostrarMais,
  assinatura,
}: {
  filtro: FiltroDasRespostas;
  quantas: number;
  aoMostrarMais: () => void;
  assinatura: string;
}) {
  const clientes = useQueryClient();
  const consulta = useQuery({
    queryKey: CHAVE_DAS_RECENTES,
    queryFn: () => carregarRespostasRecentes(40),
  });
  const [corrigindo, setCorrigindo] = useState<RespostaDaIa | null>(null);
  const boa = useMutation({
    mutationFn: (r: RespostaDaIa) => avaliarResposta(r.id, 'boa', null),
    onSuccess: () => void clientes.invalidateQueries({ queryKey: CHAVE_DA_IA }),
    onError: (e) => toast.error(mensagemDoErro(e)),
  });

  if (consulta.isPending)
    return <p className="text-sm text-muted-foreground">Carregando as respostas…</p>;
  if (consulta.isError)
    return <p className="text-sm text-destructive-texto">Não deu para carregar as respostas.</p>;
  const lista = consulta.data;
  if (lista.length === 0) {
    return (
      <p className="rounded-xl bg-card px-4 py-8 text-center text-sm text-muted-foreground sombra-base">
        A IA ainda não respondeu ninguém. Ligue-a na Configuração e mande uma mensagem pela conversa
        do treino.
      </p>
    );
  }

  const doFiltro = filtrarRespostas(lista, filtro);
  const mostradas = doFiltro.slice(0, quantas);
  const restam = doFiltro.length - mostradas.length;

  return (
    <section aria-label="Respostas da IA" className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Diga se cada resposta estava certa. &ldquo;Corrigir&rdquo; ensina a IA: a correção vai para
        o caderno.
      </p>
      {mostradas.length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-xl bg-card px-6 py-10 text-center sombra-base">
          <Bot className="mb-1 size-6 text-muted-foreground" aria-hidden="true" />
          <p className="font-medium">Nenhuma resposta neste filtro</p>
          <p className="text-sm text-muted-foreground">Troque o filtro para ver as outras.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {mostradas.map((r) => (
            <li key={r.id}>
              <CartaoDaResposta
                resposta={r}
                assinatura={assinatura}
                ocupado={boa.isPending}
                aoDizerBoa={() => boa.mutate(r)}
                aoCorrigir={() => setCorrigindo(r)}
              />
            </li>
          ))}
        </ul>
      )}
      {restam > 0 ? (
        <Button
          type="button"
          variant="outline"
          className="toque h-11 w-full md:h-10"
          onClick={aoMostrarMais}
        >
          Mostrar mais {Math.min(restam, RESPOSTAS_POR_VEZ)}
        </Button>
      ) : null}
      <DialogoDeCorrecao resposta={corrigindo} aoFechar={() => setCorrigindo(null)} />
    </section>
  );
}

/** O balão da mini-conversa, com as cores da conversa da casa (tokens `wpp-*`). */
function Balao({
  deQuem,
  autor,
  children,
}: {
  deQuem: 'cliente' | 'ia';
  autor: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'max-w-[88%] rounded-[14px] px-3 pt-2 pb-2 text-sm leading-snug break-words whitespace-pre-line text-foreground shadow-wpp',
        deQuem === 'cliente' ? 'self-start bg-wpp-entra' : 'self-end bg-wpp-sai',
      )}
    >
      <p
        className={cn(
          'mb-0.5 text-[11.5px] font-bold',
          deQuem === 'cliente' ? 'text-muted-foreground' : 'text-wpp-autor',
        )}
      >
        {autor}
      </p>
      {children}
    </div>
  );
}

function CartaoDaResposta({
  resposta: r,
  assinatura,
  ocupado,
  aoDizerBoa,
  aoCorrigir,
}: {
  resposta: RespostaDaIa;
  assinatura: string;
  ocupado: boolean;
  aoDizerBoa: () => void;
  aoCorrigir: () => void;
}) {
  const passou = r.acao === 'passou_para_pessoa';
  return (
    <article className="flex flex-col gap-2.5 rounded-xl bg-card px-4 py-3.5 sombra-base">
      {/* O link fica fora da linha que quebra: com nome longo, o selo desce e o
          ícone continua no canto, em vez de ir sozinho para uma linha vazia. */}
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
          <span className="min-w-0 truncate font-semibold">{r.nomeDaConversa ?? 'Conversa'}</span>
          <time dateTime={r.criadaEm} className="numerico text-muted-foreground">
            {QUANDO.format(new Date(r.criadaEm))}
          </time>
          <span
            className={cn(
              'inline-flex h-[22px] shrink-0 items-center rounded-full px-2 text-[11.5px] font-semibold whitespace-nowrap',
              passou
                ? 'bg-menta-fundo text-menta-texto'
                : 'text-foreground/80 ring-1 ring-border ring-inset',
            )}
          >
            {ROTULO_DA_ACAO[r.acao] ?? r.acao}
          </span>
        </div>
        <Link
          href={linkDaConversa(r)}
          aria-label="Abrir a conversa"
          title="Abrir a conversa"
          className="toque -my-2.5 -mr-2 grid size-11 shrink-0 place-items-center rounded-full text-foreground transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none md:-my-2 md:size-10"
        >
          <ExternalLink className="size-4" aria-hidden="true" />
        </Link>
      </div>

      <div className="flex flex-col gap-1.5 rounded-[14px] bg-[var(--wpp-papel)] p-2.5">
        {r.clienteDisse ? (
          <Balao deQuem="cliente" autor="Cliente">
            {r.clienteDisse}
          </Balao>
        ) : null}
        <Balao deQuem="ia" autor={`IA · ${assinatura}`}>
          {semAssinatura(r.corpo)}
        </Balao>
      </div>

      {r.motivo ? (
        <details className="group">
          <summary className="flex min-h-9 w-fit cursor-pointer list-none items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRight
              className="size-3.5 shrink-0 transition-transform group-open:rotate-90"
              aria-hidden="true"
            />
            Por quê
          </summary>
          <p className="pb-1 pl-5 text-[13px] text-muted-foreground">{r.motivo}</p>
        </details>
      ) : null}

      {r.avaliacao === 'boa' ? (
        <span className="inline-flex h-9 w-fit items-center gap-1.5 rounded-xl bg-cliente-fundo px-3 text-[13px] font-medium text-cliente-texto">
          <Check className="size-4" aria-hidden="true" /> Boa resposta
        </span>
      ) : r.avaliacao === 'corrigir' ? (
        <div className="flex flex-col gap-1.5">
          <span className="inline-flex h-9 w-fit items-center gap-1.5 rounded-xl bg-muted px-3 text-[13px] font-medium">
            <Pencil className="size-4" aria-hidden="true" /> Corrigida
          </span>
          {r.correcao ? (
            <p className="text-[13px] whitespace-pre-line text-muted-foreground">{r.correcao}</p>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className={BOTAO_DA_LINHA}
            disabled={ocupado}
            onClick={aoDizerBoa}
          >
            <ThumbsUp aria-hidden="true" /> Boa
          </Button>
          <Button type="button" variant="outline" className={BOTAO_DA_LINHA} onClick={aoCorrigir}>
            <Pencil aria-hidden="true" /> Corrigir
          </Button>
        </div>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Caderno
// ---------------------------------------------------------------------------

const ROTULO_DA_ORIGEM: Readonly<Record<LinhaDoCaderno['origem'], string>> = {
  treino: 'do treino',
  correcao: 'correção',
  tela: 'escrito pela equipe',
};

/** Acima disto a nota passa de duas linhas no celular e ganha o "abrir" ao toque. */
const NOTA_LONGA = 90;

function Caderno() {
  const clientes = useQueryClient();
  const consulta = useQuery({ queryKey: CHAVE_DO_CADERNO, queryFn: carregarCaderno });
  const [ensinando, setEnsinando] = useState(false);
  const [novo, setNovo] = useState('');
  const [editando, setEditando] = useState<{ id: number; texto: string } | null>(null);
  const [abertas, setAbertas] = useState<ReadonlySet<number>>(new Set());
  const idNovo = useId();
  const idCaixa = useId();
  const atualizar = () => void clientes.invalidateQueries({ queryKey: CHAVE_DA_IA });

  const escrever = useMutation({
    mutationFn: ({ texto, id }: { texto: string; id: number | null }) =>
      escreverNoCaderno(texto, id),
    onSuccess: (_r, { id }) => {
      atualizar();
      if (id === null) {
        setNovo('');
        setEnsinando(false);
      } else setEditando(null);
      toast.success(id === null ? 'Anotado no caderno.' : 'Linha do caderno atualizada.');
    },
    onError: (e) => toast.error(mensagemDoErro(e)),
  });
  const tirar = useMutation({
    mutationFn: (id: number) => tirarDoCaderno(id),
    onSuccess: () => {
      atualizar();
      setEditando(null);
      toast.success('Tirado do caderno. A IA deixa de seguir isso.');
    },
    onError: (e) => toast.error(mensagemDoErro(e)),
  });

  const alternar = (id: number) =>
    setAbertas((atual) => {
      const nova = new Set(atual);
      if (nova.has(id)) nova.delete(id);
      else nova.add(id);
      return nova;
    });

  return (
    <section aria-label="Caderno da IA" className={CARTAO}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <h2 className={TITULO_DO_CARTAO}>
            Caderno da IA
            {consulta.data ? (
              <span className="numerico inline-grid h-[22px] min-w-[22px] place-items-center rounded-full bg-muted px-1.5 text-xs font-semibold text-muted-foreground">
                {consulta.data.length}
              </span>
            ) : null}
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            O que a IA sabe da Imova além dos anúncios. Ela lê tudo daqui a cada resposta. Entra
            pelo treino (o Janio escreve &ldquo;IA, anota: …&rdquo; na conversa dele), pelas
            correções e por aqui. Não escreva telefone: ele é tirado antes de chegar à IA.
          </p>
        </div>
        <Button
          type="button"
          className={BOTAO_PRINCIPAL}
          aria-expanded={ensinando}
          aria-controls={idCaixa}
          onClick={() => setEnsinando((v) => !v)}
        >
          <Plus aria-hidden="true" /> Ensinar
        </Button>
      </header>

      {ensinando ? (
        <div id={idCaixa} className="flex flex-col gap-2 rounded-xl bg-muted/50 p-3">
          <label htmlFor={idNovo} className="text-sm font-medium">
            Ensinar uma coisa nova
          </label>
          <textarea
            id={idNovo}
            rows={3}
            maxLength={2000}
            value={novo}
            onChange={(e) => setNovo(e.target.value)}
            placeholder="Ex.: A visita aos imóveis é de segunda a sábado, das 8h às 17h."
            className={CAIXA_DE_TEXTO}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className={BOTAO_PRINCIPAL}
              disabled={escrever.isPending || novo.trim().length < 3}
              onClick={() => escrever.mutate({ texto: novo.trim(), id: null })}
            >
              Anotar no caderno
            </Button>
            <Button
              type="button"
              variant="ghost"
              className={BOTAO_PRINCIPAL}
              onClick={() => setEnsinando(false)}
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}

      {consulta.isPending ? (
        <p className="text-sm text-muted-foreground">Carregando o caderno…</p>
      ) : consulta.isError ? (
        <p className="text-sm text-destructive-texto">Não deu para carregar o caderno.</p>
      ) : consulta.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">O caderno ainda está vazio.</p>
      ) : (
        <ul>
          {consulta.data.map((l) => {
            const nota = partirNota(l.texto);
            const numero = nota.numero ?? String(l.id);
            if (editando?.id === l.id) {
              return (
                <li
                  key={l.id}
                  className="flex flex-col gap-2 border-t border-hairline py-3.5 first:border-t-0"
                >
                  <textarea
                    aria-label={`Texto da nota ${numero}`}
                    rows={5}
                    maxLength={2000}
                    value={editando.texto}
                    onChange={(e) => setEditando({ id: l.id, texto: e.target.value })}
                    className={CAIXA_DE_TEXTO}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      className={BOTAO_DA_LINHA}
                      disabled={escrever.isPending || editando.texto.trim().length < 3}
                      onClick={() => escrever.mutate({ texto: editando.texto.trim(), id: l.id })}
                    >
                      Salvar
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className={BOTAO_DA_LINHA}
                      onClick={() => setEditando(null)}
                    >
                      Cancelar
                    </Button>
                    {/* "Tirar" mora dentro da edição: na lista, o lápis é o único botão
                        da nota, e tirar uma nota sem querer ficou mais difícil. */}
                    <Button
                      type="button"
                      variant="ghost"
                      className={cn(BOTAO_DA_LINHA, 'ml-auto text-destructive-texto')}
                      disabled={tirar.isPending}
                      onClick={() => tirar.mutate(l.id)}
                    >
                      <Trash2 aria-hidden="true" /> Tirar do caderno
                    </Button>
                  </div>
                </li>
              );
            }
            const aberta = abertas.has(l.id);
            const longa = nota.corpo.length > NOTA_LONGA || (nota.titulo?.length ?? 0) > 40;
            const conteudo = (
              <>
                {nota.titulo ? (
                  <span className={cn('block font-semibold', !aberta && 'truncate')}>
                    {nota.titulo}
                  </span>
                ) : null}
                <span
                  className={cn(
                    'block whitespace-pre-line',
                    nota.titulo ? 'text-[13px] text-muted-foreground' : 'text-sm',
                    !aberta && 'line-clamp-2',
                  )}
                >
                  {nota.corpo}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {ROTULO_DA_ORIGEM[l.origem]} ·{' '}
                  <time dateTime={l.criadoEm} className="numerico">
                    {QUANDO.format(new Date(l.criadoEm))}
                  </time>
                </span>
              </>
            );
            return (
              <li
                key={l.id}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 border-t border-hairline py-3.5 first:border-t-0"
              >
                <span
                  className="numerico mt-0.5 grid h-7 min-w-10 place-items-center rounded-lg bg-muted px-1.5 text-xs font-bold whitespace-nowrap text-muted-foreground"
                  title={nota.numero ? undefined : 'Número da nota no caderno'}
                >
                  {numero}
                </span>
                {longa ? (
                  // A nota longa mostra duas linhas; tocar abre o texto inteiro (e fecha).
                  <button
                    type="button"
                    aria-expanded={aberta}
                    onClick={() => alternar(l.id)}
                    className="min-w-0 rounded-lg text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    {conteudo}
                  </button>
                ) : (
                  <div className="min-w-0">{conteudo}</div>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="toque -mt-1.5 -mr-2 size-11 md:size-10"
                  aria-label={`Editar a nota ${numero}`}
                  onClick={() => setEditando({ id: l.id, texto: l.texto })}
                >
                  <Pencil aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

/**
 * Procurar uma conversa pelo nome ou pelo telefone (sem acento e sem maiúscula) e
 * oferecer um botão para cada uma: "Treinar por esta" ou "Testar por esta".
 */
function ProcurarConversa({
  placeholder,
  acao,
}: {
  placeholder: string;
  acao: (conversa: ConversaAchada, limpar: () => void) => ReactNode;
}) {
  const [busca, setBusca] = useState('');
  const id = useId();
  const achadas = useQuery({
    queryKey: [...CHAVE_DA_IA, 'procurar', busca],
    queryFn: () => procurarConversas(busca),
    enabled: busca.trim().length >= 2,
  });
  return (
    <>
      <label htmlFor={id} className="-mb-1.5 text-xs text-muted-foreground">
        Procurar pelo nome ou telefone
      </label>
      <Input
        id={id}
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder={placeholder}
        className="h-11 md:h-10"
      />
      {achadas.data && achadas.data.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {achadas.data.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">
                {c.nome}
                {c.telefone ? (
                  <span className="ml-1.5 text-xs text-muted-foreground">{c.telefone}</span>
                ) : null}
              </span>
              {acao(c, () => setBusca(''))}
            </li>
          ))}
        </ul>
      ) : achadas.isError ? (
        <p className="text-xs text-destructive">Não deu para procurar agora. Tente de novo.</p>
      ) : busca.trim().length >= 2 && !achadas.isPending ? (
        <p className="text-xs text-muted-foreground">Nenhuma conversa com esse nome ou telefone.</p>
      ) : null}
    </>
  );
}

/** Uma escolha entre poucas, como opção de rádio num cartão (modo e modelo). */
function OpcaoEmCartao({
  marcada,
  titulo,
  descricao,
  desabilitada,
  aoEscolher,
}: {
  marcada: boolean;
  titulo: string;
  descricao: string;
  desabilitada: boolean;
  aoEscolher: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={marcada}
      disabled={desabilitada}
      onClick={() => {
        if (!marcada) aoEscolher();
      }}
      className={cn(
        'toque grid w-full grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 rounded-[14px] border p-3.5 text-left transition-colors disabled:opacity-60',
        'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
        marcada
          ? 'border-primary bg-primary/6 ring-1 ring-primary'
          : 'border-border bg-card hover:border-input',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'row-span-2 mt-0.5 grid size-5 place-items-center rounded-full border-2',
          marcada ? 'border-primary' : 'border-input',
        )}
      >
        {marcada ? <span className="size-2.5 rounded-full bg-primary" /> : null}
      </span>
      <span className="text-sm font-semibold">{titulo}</span>
      <span className="text-[13px] text-muted-foreground">{descricao}</span>
    </button>
  );
}

const MODELOS: readonly { id: ModeloDaIa; titulo: string; descricao: string }[] = [
  {
    id: 'claude-haiku-5-5',
    titulo: 'Claude Haiku 5.5',
    descricao: 'O mais econômico (menos de 0,2 centavo de dólar por resposta)',
  },
  {
    id: 'claude-sonnet-5-5',
    titulo: 'Claude Sonnet 5.5',
    descricao: 'Intermediário (metade do custo do Opus)',
  },
  {
    id: 'claude-opus-5-5',
    titulo: 'Claude Opus 5.5',
    descricao: 'O mais capaz (cerca de 1 a 6 centavos de dólar por resposta)',
  },
];

function Configuracao({ painel }: { painel: PainelDaIa }) {
  const clientes = useQueryClient();
  const { config, podeConfigurar } = painel;
  const setores = useQuery({ queryKey: [...CHAVE_DA_IA, 'setores'], queryFn: carregarSetores });
  const [aviso, setAviso] = useState(config.avisoCorretor);
  const idLigada = useId();
  const idModo = useId();
  const idModelo = useId();
  const idAviso = useId();
  const idSetor = useId();

  const salvar = useMutation({
    mutationFn: (valores: Record<string, unknown>) => configurarIa(valores),
    onSuccess: () => {
      void clientes.invalidateQueries({ queryKey: CHAVE_DA_IA });
      toast.success('Configuração salva.');
    },
    onError: (e) => toast.error(mensagemDoErro(e)),
  });

  const marcar = useMutation({
    mutationFn: ({ id, teste }: { id: string; teste: boolean }) => marcarConversaDeTeste(id, teste),
    onSuccess: (_, { teste }) => {
      void clientes.invalidateQueries({ queryKey: CHAVE_DA_IA });
      if (teste) {
        toast.success('A IA vai conversar nesta conversa, sem aprender.', {
          description: config.ligada
            ? 'Ela responde à última mensagem que ainda estiver sem resposta (das últimas 24 h).'
            : 'Ela só responde depois que for ligada.',
        });
      } else {
        toast.success('A conversa saiu do teste, e a IA parou nela.');
      }
    },
    onError: (e) => toast.error(mensagemDoErro(e)),
  });

  if (!podeConfigurar) {
    return (
      <p className="rounded-xl bg-card p-4 text-sm text-muted-foreground sombra-base">
        Ligar, desligar e configurar a IA é da gestão (admin e gestor). Você pode avaliar as
        respostas e escrever no caderno.
      </p>
    );
  }

  return (
    <section aria-label="Configuração da IA" className="flex flex-col gap-4">
      <div className={CARTAO}>
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <label htmlFor={idLigada} className="text-[15px] font-semibold">
              {config.ligada ? 'A IA está ligada' : 'A IA está desligada'}
            </label>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Desligada, ela não responde ninguém e nada mais muda. Ligada, responde conforme o
              modo.
            </p>
          </div>
          <Chave
            id={idLigada}
            ligada={config.ligada}
            desabilitada={salvar.isPending}
            aoMudar={(ligada) => salvar.mutate({ ligada })}
            className="-my-2.5 -mr-1"
          />
        </div>
      </div>

      <div className={CARTAO}>
        <h2 id={idModo} className={TITULO_DO_CARTAO}>
          Modo
        </h2>
        <div role="radiogroup" aria-labelledby={idModo} className="grid gap-2 sm:grid-cols-2">
          <OpcaoEmCartao
            marcada={config.modo === 'treino'}
            titulo="Treino"
            descricao="A do treino e as de teste."
            desabilitada={salvar.isPending}
            aoEscolher={() => salvar.mutate({ modo: 'treino' })}
          />
          <OpcaoEmCartao
            marcada={config.modo === 'clientes'}
            titulo="Clientes"
            descricao="Toda conversa nova."
            desabilitada={salvar.isPending}
            aoEscolher={() => salvar.mutate({ modo: 'clientes' })}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Com clientes, ela responde as conversas em que ninguém do time escreveu. Quando alguém do
          time escreve, a IA para naquela conversa.
        </p>
      </div>

      <div className={CARTAO}>
        <h2 className={TITULO_DO_CARTAO}>Conversa do treino</h2>
        <p className="-mt-1.5 text-sm text-muted-foreground">
          {painel.treino
            ? `Hoje: ${painel.treino.nome ?? 'sem nome'}. Ali, quem escreve é da equipe e pode ensinar a IA.`
            : 'Nenhuma ainda. Procure a conversa do Janio Ramalho.'}
        </p>
        <ProcurarConversa
          placeholder="Janio"
          acao={(c, limpar) => (
            <Button
              type="button"
              variant="outline"
              className={BOTAO_DA_LINHA}
              disabled={salvar.isPending || c.id === config.conversaDeTreino}
              onClick={() => {
                salvar.mutate({ conversa_de_treino: c.id });
                limpar();
              }}
            >
              {c.id === config.conversaDeTreino ? 'É esta' : 'Treinar por esta'}
            </Button>
          )}
        />
      </div>

      <div className={CARTAO}>
        <h2 className={TITULO_DO_CARTAO}>Conversas de teste</h2>
        <p className="-mt-1.5 text-sm text-muted-foreground">
          A IA conversa ali como conversa com um cliente, também no modo treino, mas não aprende
          nada: o que for escrito nelas não vai para o caderno, e nenhuma foto vira referência.
          Pedir corretor mostra o aviso, mas não passa a conversa nem abre tarefa. Até 5.
        </p>
        {painel.testes.length > 0 ? (
          <ul>
            {painel.testes.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-2 border-t border-hairline py-1.5 text-sm first:border-t-0"
              >
                <span className="min-w-0">
                  <Link
                    href={linkDaConversa({ organizacaoId: t.organizacaoId, conversaId: t.id })}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {t.nome}
                  </Link>
                  {t.telefone ? (
                    <span className="ml-1.5 text-xs whitespace-nowrap text-muted-foreground">
                      {t.telefone}
                    </span>
                  ) : null}
                  {config.ligada && !t.atende ? (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      (IA parada aqui: religue no topo da conversa)
                    </span>
                  ) : null}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  className={BOTAO_DA_LINHA}
                  disabled={marcar.isPending}
                  onClick={() => marcar.mutate({ id: t.id, teste: false })}
                >
                  <Trash2 aria-hidden="true" /> Tirar
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">Nenhuma ainda.</p>
        )}
        <ProcurarConversa
          placeholder="Matheu"
          acao={(c, limpar) => {
            const jaE = painel.testes.some((t) => t.id === c.id);
            const doTreino = c.id === config.conversaDeTreino;
            return (
              <Button
                type="button"
                variant="outline"
                className={BOTAO_DA_LINHA}
                disabled={marcar.isPending || jaE || doTreino}
                title={doTreino ? 'É a conversa do treino: lá a IA aprende.' : undefined}
                onClick={() => {
                  marcar.mutate({ id: c.id, teste: true });
                  limpar();
                }}
              >
                {doTreino ? 'É a do treino' : jaE ? 'Já é de teste' : 'Testar por esta'}
              </Button>
            );
          }}
        />
      </div>

      <div className={CARTAO}>
        <h2 className={TITULO_DO_CARTAO}>Quando passa para um corretor</h2>
        <label htmlFor={idSetor} className="-mb-1.5 text-xs text-muted-foreground">
          Quem recebe a conversa
        </label>
        <select
          id={idSetor}
          value={config.setorCorretores ?? ''}
          disabled={salvar.isPending}
          onChange={(e) =>
            salvar.mutate({
              setor_corretores: e.target.value === '' ? null : Number(e.target.value),
            })
          }
          className={SELETOR}
        >
          <option value="">Fica com quem já atende a conversa</option>
          {(setores.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              Setor {s.nome} (vai para quem tem menos conversas)
            </option>
          ))}
        </select>
        <label htmlFor={idAviso} className="-mb-1.5 text-xs text-muted-foreground">
          O aviso que o cliente recebe
        </label>
        <textarea
          id={idAviso}
          rows={2}
          maxLength={400}
          value={aviso}
          onChange={(e) => setAviso(e.target.value)}
          className={CAIXA_DE_TEXTO}
        />
        <div>
          <Button
            type="button"
            variant="outline"
            className={BOTAO_DA_LINHA}
            disabled={
              salvar.isPending || aviso.trim() === config.avisoCorretor || aviso.trim().length < 10
            }
            onClick={() => salvar.mutate({ aviso_corretor: aviso.trim() })}
          >
            Salvar o aviso
          </Button>
        </div>
      </div>

      <div className={CARTAO}>
        <h2 id={idModelo} className={TITULO_DO_CARTAO}>
          Modelo
        </h2>
        <div role="radiogroup" aria-labelledby={idModelo} className="flex flex-col gap-2">
          {MODELOS.map((m) => (
            <OpcaoEmCartao
              key={m.id}
              marcada={config.modelo === m.id}
              titulo={m.titulo}
              descricao={m.descricao}
              desabilitada={salvar.isPending}
              aoEscolher={() => salvar.mutate({ modelo: m.id })}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
