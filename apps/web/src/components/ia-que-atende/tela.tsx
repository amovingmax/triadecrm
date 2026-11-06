'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, BotOff, Check, ExternalLink, Pencil, ThumbsUp, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
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
  procurarConversas,
  tirarDoCaderno,
  type LinhaDoCaderno,
  type PainelDaIa,
  type RespostaDaIa,
} from './dados';
import { DialogoDeCorrecao } from './na-conversa';

/**
 * A tela "IA que atende" (Imova, 06/11/2026).
 *
 * É a tela da semana de treino: o placar diz se ela está pronta para os clientes,
 * "Respostas" é onde quem acompanha diz "Boa" ou "Corrigir" sem abrir conversa por
 * conversa, "Caderno" é o que ela sabe (o que o Janio ensinou, as correções e o
 * que a equipe escrever) e "Configuração" liga, desliga e escolhe a conversa do
 * treino. A IA lê o caderno e os imóveis da aba Anúncios a cada resposta.
 */

type Aba = 'respostas' | 'caderno' | 'configuracao';

const ABAS: readonly { id: Aba; rotulo: string }[] = [
  { id: 'respostas', rotulo: 'Respostas' },
  { id: 'caderno', rotulo: 'Caderno' },
  { id: 'configuracao', rotulo: 'Configuração' },
];

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
  const painel = useQuery({ queryKey: CHAVE_DO_PAINEL, queryFn: () => carregarPainel(7) });
  const p = painel.data;

  return (
    <div className="flex w-full max-w-4xl flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-[32px] leading-tight font-normal tracking-[-0.02em]">
          IA que atende
        </h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Ela responde os clientes sozinha, tira dúvidas dos imóveis, marca visita e passa para um
          corretor quando é coisa de gente. As mensagens saem assinadas &ldquo;
          {p?.config.assinatura ?? 'Imova'}&rdquo;.
        </p>
        {p ? <Situacao painel={p} /> : null}
      </header>

      {p ? <Placar painel={p} /> : null}

      <SeletorDeAba itens={ABAS} ativo={aba} aoTrocar={setAba} rotulo="Partes da IA que atende" />

      {aba === 'respostas' ? <Respostas /> : null}
      {aba === 'caderno' ? <Caderno /> : null}
      {aba === 'configuracao' && p ? <Configuracao painel={p} /> : null}
    </div>
  );
}

function Situacao({ painel }: { painel: PainelDaIa }) {
  const { config, treino } = painel;
  const texto = !config.ligada
    ? 'Desligada: não responde ninguém.'
    : config.modo === 'treino'
      ? treino
        ? `Ligada, em treino: responde só a conversa de ${treino.nome ?? 'treino'}.`
        : 'Ligada, em treino, mas sem conversa de treino escolhida: não responde ninguém.'
      : 'Ligada para os clientes: responde toda conversa em que ninguém do time escreveu.';
  return (
    <p
      className={cn(
        'flex items-center gap-2 rounded-lg border border-hairline px-3 py-2 text-sm',
        config.ligada ? 'bg-card' : 'bg-muted/40 text-muted-foreground',
      )}
    >
      {config.ligada ? <Bot className="size-4 shrink-0" aria-hidden="true" /> : <BotOff className="size-4 shrink-0" aria-hidden="true" />}
      <span>{texto}</span>
      {treino && config.ligada ? (
        <Link
          href={linkDaConversa({ organizacaoId: treino.organizacaoId, conversaId: treino.id })}
          className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs underline underline-offset-2"
        >
          Abrir a conversa <ExternalLink className="size-3" aria-hidden="true" />
        </Link>
      ) : null}
    </p>
  );
}

function Placar({ painel }: { painel: PainelDaIa }) {
  const { placar, caderno } = painel;
  const avaliadas = placar.boas + placar.corrigidas;
  const acerto = avaliadas === 0 ? null : Math.round((placar.boas / avaliadas) * 100);
  const itens: { rotulo: string; valor: string; detalhe?: string }[] = [
    { rotulo: 'Respostas', valor: String(placar.respostas), detalhe: `${placar.conversas} conversa(s)` },
    {
      rotulo: 'Boas',
      valor: acerto === null ? '—' : `${acerto}%`,
      detalhe: `${placar.boas} boas · ${placar.corrigidas} corrigidas`,
    },
    { rotulo: 'Sem avaliação', valor: String(placar.semAvaliacao) },
    { rotulo: 'Passou para corretor', valor: String(placar.passadas) },
    { rotulo: 'Visitas marcadas', valor: String(placar.visitas) },
    {
      rotulo: 'Caderno',
      valor: String(caderno.ativas),
      detalhe: `${caderno.doTreino} do treino · ${caderno.correcoes} correções`,
    },
    {
      rotulo: 'Custo da IA',
      valor: `US$ ${painel.custoUsd.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      detalhe: `${painel.imoveis} imóveis na base`,
    },
  ];
  return (
    <section aria-label="Placar dos últimos 7 dias" className="flex flex-col gap-2">
      <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Últimos 7 dias
      </h2>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {itens.map((i) => (
          <div key={i.rotulo} className="rounded-lg border border-hairline bg-card px-3 py-2">
            <dt className="text-xs text-muted-foreground">{i.rotulo}</dt>
            <dd className="numerico text-xl">{i.valor}</dd>
            {i.detalhe ? <dd className="text-[11px] text-muted-foreground">{i.detalhe}</dd> : null}
          </div>
        ))}
      </dl>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Respostas
// ---------------------------------------------------------------------------

function Respostas() {
  const clientes = useQueryClient();
  const consulta = useQuery({ queryKey: CHAVE_DAS_RECENTES, queryFn: () => carregarRespostasRecentes(40) });
  const [corrigindo, setCorrigindo] = useState<RespostaDaIa | null>(null);
  const boa = useMutation({
    mutationFn: (r: RespostaDaIa) => avaliarResposta(r.id, 'boa', null),
    onSuccess: () => void clientes.invalidateQueries({ queryKey: CHAVE_DA_IA }),
    onError: (e) => toast.error(mensagemDoErro(e)),
  });

  if (consulta.isPending) return <p className="text-sm text-muted-foreground">Carregando as respostas…</p>;
  if (consulta.isError) return <p className="text-sm text-destructive-texto">Não deu para carregar as respostas.</p>;
  const lista = consulta.data;
  if (lista.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-hairline px-4 py-6 text-center text-sm text-muted-foreground">
        A IA ainda não respondeu ninguém. Ligue-a na Configuração e mande uma mensagem pela conversa
        do treino.
      </p>
    );
  }

  return (
    <section aria-label="Respostas da IA" className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Diga se cada resposta estava certa. &ldquo;Corrigir&rdquo; ensina a IA: a correção vai para o
        caderno.
      </p>
      <ul className="flex flex-col gap-2">
        {lista.map((r) => (
          <li key={r.id} className="flex flex-col gap-2 rounded-lg border border-hairline bg-card px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{r.nomeDaConversa ?? 'Conversa'}</span>
              <span>·</span>
              <time dateTime={r.criadaEm} className="numerico">
                {QUANDO.format(new Date(r.criadaEm))}
              </time>
              <span>·</span>
              <span>{ROTULO_DA_ACAO[r.acao] ?? r.acao}</span>
              <Link href={linkDaConversa(r)} className="ml-auto inline-flex items-center gap-1 underline underline-offset-2">
                Abrir <ExternalLink className="size-3" aria-hidden="true" />
              </Link>
            </div>
            {r.clienteDisse ? (
              <p className="text-sm whitespace-pre-line text-muted-foreground">
                <span className="font-medium">Cliente:</span> {r.clienteDisse}
              </p>
            ) : null}
            <p className="text-sm whitespace-pre-line">
              <span className="font-medium">IA:</span> {semAssinatura(r.corpo)}
            </p>
            {r.motivo ? <p className="text-xs text-muted-foreground">Por quê: {r.motivo}</p> : null}
            <div className="flex flex-wrap items-center gap-2">
              {r.avaliacao === 'boa' ? (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Check className="size-3.5" aria-hidden="true" /> Boa resposta
                </span>
              ) : r.avaliacao === 'corrigir' ? (
                <span className="text-xs text-muted-foreground">
                  <Pencil className="mr-1 inline size-3.5" aria-hidden="true" />
                  Corrigida: {r.correcao}
                </span>
              ) : (
                <>
                  <Button type="button" size="sm" variant="outline" disabled={boa.isPending} onClick={() => boa.mutate(r)}>
                    <ThumbsUp aria-hidden="true" /> Boa
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => setCorrigindo(r)}>
                    <Pencil aria-hidden="true" /> Corrigir
                  </Button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      <DialogoDeCorrecao resposta={corrigindo} aoFechar={() => setCorrigindo(null)} />
    </section>
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

function Caderno() {
  const clientes = useQueryClient();
  const consulta = useQuery({ queryKey: CHAVE_DO_CADERNO, queryFn: carregarCaderno });
  const [novo, setNovo] = useState('');
  const [editando, setEditando] = useState<{ id: number; texto: string } | null>(null);
  const idNovo = useId();
  const atualizar = () => void clientes.invalidateQueries({ queryKey: CHAVE_DA_IA });

  const escrever = useMutation({
    mutationFn: ({ texto, id }: { texto: string; id: number | null }) => escreverNoCaderno(texto, id),
    onSuccess: (_r, { id }) => {
      atualizar();
      if (id === null) setNovo('');
      else setEditando(null);
      toast.success(id === null ? 'Anotado no caderno.' : 'Linha do caderno atualizada.');
    },
    onError: (e) => toast.error(mensagemDoErro(e)),
  });
  const tirar = useMutation({
    mutationFn: (id: number) => tirarDoCaderno(id),
    onSuccess: () => {
      atualizar();
      toast.success('Tirado do caderno. A IA deixa de seguir isso.');
    },
    onError: (e) => toast.error(mensagemDoErro(e)),
  });

  return (
    <section aria-label="Caderno da IA" className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        O que a IA sabe da Imova além dos anúncios. Ela lê tudo daqui a cada resposta. Entra pelo
        treino (o Janio escreve &ldquo;IA, anota: …&rdquo; na conversa dele), pelas correções e por
        aqui. Não escreva telefone: ele é tirado antes de chegar à IA.
      </p>
      <div className="flex flex-col gap-2 rounded-lg border border-hairline bg-card p-3">
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
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-base focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:text-sm"
        />
        <div>
          <Button
            type="button"
            disabled={escrever.isPending || novo.trim().length < 3}
            onClick={() => escrever.mutate({ texto: novo.trim(), id: null })}
          >
            Anotar no caderno
          </Button>
        </div>
      </div>

      {consulta.isPending ? (
        <p className="text-sm text-muted-foreground">Carregando o caderno…</p>
      ) : consulta.isError ? (
        <p className="text-sm text-destructive-texto">Não deu para carregar o caderno.</p>
      ) : consulta.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">O caderno ainda está vazio.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {consulta.data.map((l) => (
            <li key={l.id} className="flex flex-col gap-2 rounded-lg border border-hairline bg-card px-3 py-2.5">
              {editando?.id === l.id ? (
                <>
                  <textarea
                    aria-label="Texto da linha do caderno"
                    rows={3}
                    maxLength={2000}
                    value={editando.texto}
                    onChange={(e) => setEditando({ id: l.id, texto: e.target.value })}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-base focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:text-sm"
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={escrever.isPending || editando.texto.trim().length < 3}
                      onClick={() => escrever.mutate({ texto: editando.texto.trim(), id: l.id })}
                    >
                      Salvar
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setEditando(null)}>
                      Cancelar
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm whitespace-pre-line">{l.texto}</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{ROTULO_DA_ORIGEM[l.origem]}</span>
                    <span>·</span>
                    <time dateTime={l.criadoEm} className="numerico">
                      {QUANDO.format(new Date(l.criadoEm))}
                    </time>
                    <span className="ml-auto flex gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditando({ id: l.id, texto: l.texto })}
                      >
                        <Pencil aria-hidden="true" /> Editar
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={tirar.isPending}
                        onClick={() => tirar.mutate(l.id)}
                      >
                        <Trash2 aria-hidden="true" /> Tirar
                      </Button>
                    </span>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

function Configuracao({ painel }: { painel: PainelDaIa }) {
  const clientes = useQueryClient();
  const { config, podeConfigurar } = painel;
  const setores = useQuery({ queryKey: [...CHAVE_DA_IA, 'setores'], queryFn: carregarSetores });
  const [aviso, setAviso] = useState(config.avisoCorretor);
  const [busca, setBusca] = useState('');
  const idAviso = useId();
  const idBusca = useId();
  const idSetor = useId();
  const idModelo = useId();


  const achadas = useQuery({
    queryKey: [...CHAVE_DA_IA, 'procurar', busca],
    queryFn: () => procurarConversas(busca),
    enabled: busca.trim().length >= 2,
  });

  const salvar = useMutation({
    mutationFn: (valores: Record<string, unknown>) => configurarIa(valores),
    onSuccess: () => {
      void clientes.invalidateQueries({ queryKey: CHAVE_DA_IA });
      toast.success('Configuração salva.');
    },
    onError: (e) => toast.error(mensagemDoErro(e)),
  });

  if (!podeConfigurar) {
    return (
      <p className="text-sm text-muted-foreground">
        Ligar, desligar e configurar a IA é da gestão (admin e gestor). Você pode avaliar as
        respostas e escrever no caderno.
      </p>
    );
  }

  return (
    <section aria-label="Configuração da IA" className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-lg border border-hairline bg-card p-3">
        <h3 className="text-sm font-medium">Ligada</h3>
        <p className="text-sm text-muted-foreground">
          Desligada, ela não responde ninguém e nada mais muda. Ligada, responde conforme o modo.
        </p>
        <div>
          <Button
            type="button"
            variant={config.ligada ? 'outline' : 'default'}
            disabled={salvar.isPending}
            onClick={() => salvar.mutate({ ligada: !config.ligada })}
          >
            {config.ligada ? <BotOff aria-hidden="true" /> : <Bot aria-hidden="true" />}
            {config.ligada ? 'Desligar a IA' : 'Ligar a IA'}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-hairline bg-card p-3">
        <h3 className="text-sm font-medium">Modo</h3>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant={config.modo === 'treino' ? 'default' : 'outline'}
            disabled={salvar.isPending}
            onClick={() => salvar.mutate({ modo: 'treino' })}
          >
            Treino: só a conversa do treino
          </Button>
          <Button
            type="button"
            variant={config.modo === 'clientes' ? 'default' : 'outline'}
            disabled={salvar.isPending}
            onClick={() => salvar.mutate({ modo: 'clientes' })}
          >
            Clientes: toda conversa nova
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Com clientes, ela responde as conversas em que ninguém do time escreveu. Quando alguém do
          time escreve, a IA para naquela conversa.
        </p>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-hairline bg-card p-3">
        <h3 className="text-sm font-medium">Conversa do treino</h3>
        <p className="text-sm text-muted-foreground">
          {painel.treino
            ? `Hoje: ${painel.treino.nome ?? 'sem nome'}. Ali, quem escreve é da equipe e pode ensinar a IA.`
            : 'Nenhuma ainda. Procure a conversa do Janio Ramalho.'}
        </p>
        <label htmlFor={idBusca} className="text-xs text-muted-foreground">
          Procurar pelo nome
        </label>
        <Input id={idBusca} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Janio" />
        {achadas.data && achadas.data.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {achadas.data.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">{c.nome}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={salvar.isPending || c.id === config.conversaDeTreino}
                  onClick={() => {
                    salvar.mutate({ conversa_de_treino: c.id });
                    setBusca('');
                  }}
                >
                  {c.id === config.conversaDeTreino ? 'É esta' : 'Treinar por esta'}
                </Button>
              </li>
            ))}
          </ul>
        ) : busca.trim().length >= 2 && !achadas.isPending ? (
          <p className="text-xs text-muted-foreground">Nenhuma conversa com esse nome.</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-hairline bg-card p-3">
        <h3 className="text-sm font-medium">Quando passa para um corretor</h3>
        <label htmlFor={idSetor} className="text-xs text-muted-foreground">
          Quem recebe a conversa
        </label>
        <select
          id={idSetor}
          value={config.setorCorretores ?? ''}
          disabled={salvar.isPending}
          onChange={(e) =>
            salvar.mutate({ setor_corretores: e.target.value === '' ? null : Number(e.target.value) })
          }
          className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
        >
          <option value="">Fica com quem já atende a conversa</option>
          {(setores.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              Setor {s.nome} (vai para quem tem menos conversas)
            </option>
          ))}
        </select>
        <label htmlFor={idAviso} className="text-xs text-muted-foreground">
          O aviso que o cliente recebe
        </label>
        <textarea
          id={idAviso}
          rows={2}
          maxLength={400}
          value={aviso}
          onChange={(e) => setAviso(e.target.value)}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-base focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:text-sm"
        />
        <div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={salvar.isPending || aviso.trim() === config.avisoCorretor || aviso.trim().length < 10}
            onClick={() => salvar.mutate({ aviso_corretor: aviso.trim() })}
          >
            Salvar o aviso
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-hairline bg-card p-3">
        <label htmlFor={idModelo} className="text-sm font-medium">
          Modelo
        </label>
        <select
          id={idModelo}
          value={config.modelo}
          disabled={salvar.isPending}
          onChange={(e) => salvar.mutate({ modelo: e.target.value })}
          className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
        >
          <option value="claude-opus-5-5">Claude Opus 5.5: o mais capaz (cerca de 1 a 5 centavos de dólar por resposta)</option>
          <option value="claude-sonnet-5-5">Claude Sonnet 5.5: metade do custo</option>
        </select>
      </div>
    </section>
  );
}
