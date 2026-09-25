'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { buscarFreios, buscarSaudeDaEsteira } from './dados';

import type { Freios } from './tipos';

/**
 * Ajustes → Atendimento (Fase 3, 22/09/2026).
 *
 * Tudo o que o CRM faz sozinho no WhatsApp, num lugar só, com um interruptor
 * por automação: lead automático, distribuição, fora do horário. Embaixo, as
 * listas que a equipe usa na caixa de resposta: respostas prontas e etiquetas.
 */
type Config = {
  lead_automatico?: boolean;
  distribuicao_automatica?: boolean;
  ausencia_ativa?: boolean;
};
type Resposta = { id: number; atalho: string; titulo: string; texto: string; ativo: boolean };
type Etiqueta = { id: number; name: string; color: string | null };

const CORES = ['#24705c', '#2563eb', '#7c3aed', '#db2777', '#d97706', '#64748b'];

async function carregar() {
  const supabase = createClient();
  const [config, modelo, respostas, etiquetas] = await Promise.all([
    supabase.from('app_settings').select('value').eq('key', 'atendimento').maybeSingle(),
    supabase.from('message_templates').select('body').eq('template_code', 'GEN-SYS-AUSENCIA').maybeSingle(),
    supabase.from('respostas_rapidas').select('id, atalho, titulo, texto, ativo').order('atalho'),
    supabase.from('tags').select('id, name, color').order('name'),
  ]);
  return {
    config: (config.data?.value ?? {}) as Config,
    textoAusencia: (modelo.data?.body as string | undefined) ?? '',
    respostas: (respostas.data ?? []) as Resposta[],
    etiquetas: (etiquetas.data ?? []) as Etiqueta[],
  };
}

async function configurar(p: Record<string, unknown>) {
  const { data, error } = await createClient().rpc('atendimento_configurar', { p });
  if (error) throw new Error(error.message);
  if (!(data as { ok?: boolean } | null)?.ok) throw new Error('O banco recusou a mudança.');
}

/** Nome de gente para os dois robôs que fazem o CRM falar. */
const ROTULO_DO_ROBO: Record<'wa' | 'ai', string> = {
  wa: 'WhatsApp (recebe e envia)',
  ai: 'IA (classifica e rascunha)',
};

export function PainelAtendimento({ podeEditar }: { podeEditar: boolean }) {
  const clientes = useQueryClient();
  const consulta = useQuery({ queryKey: ['admin', 'atendimento'], queryFn: carregar });
  const saude = useQuery({
    queryKey: ['admin', 'saude-dos-workers'],
    queryFn: buscarSaudeDaEsteira,
    refetchInterval: 60_000,
  });
  const freios = useQuery({
    queryKey: ['admin', 'freios'],
    queryFn: buscarFreios,
    refetchInterval: 60_000,
  });
  const recarregar = () => void clientes.invalidateQueries({ queryKey: ['admin', 'atendimento'] });

  const mudar = useMutation({
    mutationFn: configurar,
    onSuccess: () => {
      toast.success('Salvo.');
      recarregar();
    },
    onError: (e: Error) => toast.error('Não salvou.', { description: e.message }),
  });

  if (consulta.isPending) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (consulta.isError || !consulta.data) {
    return <p className="text-sm text-destructive">Não deu para ler as configurações.</p>;
  }
  const { config, textoAusencia, respostas, etiquetas } = consulta.data;

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      {/* Os freios vêm ANTES dos interruptores porque é o que muda o
          comportamento de tudo abaixo deles: não adianta ligar uma automação
          que o orçamento já parou. */}
      {freios.data ? <Freios3 f={freios.data} aoReligar={() => void freios.refetch()} /> : null}

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-base font-medium">O que o CRM faz sozinho</h2>
        <Interruptor
          id="lead-automatico"
          titulo="Lead automático"
          descricao="Quem escreve pela primeira vez vira parceiro e card no funil de captação, na etapa Respondeu."
          ligado={config.lead_automatico ?? false}
          podeEditar={podeEditar}
          aoMudar={(v) => mudar.mutate({ lead_automatico: v })}
        />
        <Interruptor
          id="distribuicao"
          titulo="Distribuir conversas novas"
          descricao="Conversa de quem não tem responsável cai com quem tem menos conversas abertas no setor."
          ligado={config.distribuicao_automatica ?? false}
          podeEditar={podeEditar}
          aoMudar={(v) => mudar.mutate({ distribuicao_automatica: v })}
        />
        <Interruptor
          id="ausencia"
          titulo="Responder fora do horário"
          descricao="Fora de segunda a sexta, 8h às 17h45, quem escreve recebe um aviso. No máximo um a cada 12 h por conversa."
          ligado={config.ausencia_ativa ?? false}
          podeEditar={podeEditar}
          aoMudar={(v) => mudar.mutate({ ausencia_ativa: v })}
        />
        {config.ausencia_ativa ? (
          <TextoDaAusencia inicial={textoAusencia} podeEditar={podeEditar} aoSalvar={(t) => mudar.mutate({ texto_ausencia: t })} />
        ) : null}
      </section>

      <RespostasProntas respostas={respostas} podeEditar={podeEditar} aoMudar={recarregar} />
      <Etiquetas etiquetas={etiquetas} podeEditar={podeEditar} aoMudar={recarregar} />

      {/*
        O robô está de pé? Uma linha, não um painel: worker, quando bateu ponto
        pela última vez e o veredito do próprio banco. `vivo` vem de
        `public.esteira_saude()` — batida nos últimos 2 minutos —, e a tela NÃO
        recalcula isso. Só `wa` e `ai`: são os dois que fazem o CRM falar. O
        `rotas` roda sob demanda e ficar parado é o normal dele, então uma
        bolinha vermelha ali ensinaria a equipe a ignorar bolinha vermelha.
      */}
      <section className="border-t border-hairline pt-4">
        <h2 className="font-heading text-base font-medium">Os robôs</h2>
        {saude.isPending ? (
          <p className="mt-2 text-sm text-muted-foreground">Carregando…</p>
        ) : !saude.data ? (
          <p className="mt-2 text-sm text-muted-foreground">
            O seu acesso não lê a saúde dos robôs.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {(['wa', 'ai'] as const).map((nome) => {
              // Em `const` porque `saude.data` é `SaudeDaEsteira | null` e o
              // TypeScript perde o estreitamento dentro do callback.
              const batidas = saude.data?.workers ?? [];
              const batida = batidas.find((w) => w.worker === nome);
              return (
                <li key={nome} className="flex items-center gap-2 text-sm">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'size-2 rounded-full',
                      batida?.vivo ? 'bg-emerald-600' : 'bg-muted-foreground/40',
                    )}
                  />
                  <span className="font-medium">{ROTULO_DO_ROBO[nome]}</span>
                  <span className="text-muted-foreground">
                    {batida
                      ? batida.vivo
                        ? `de pé, bateu ponto há ${Math.max(0, Math.round(batida.ha_segundos))}s`
                        : `parado há ${Math.max(0, Math.round(batida.ha_segundos / 60))} min`
                      : 'nunca bateu ponto'}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Interruptor({
  id,
  titulo,
  descricao,
  ligado,
  podeEditar,
  aoMudar,
}: {
  id: string;
  titulo: string;
  descricao: string;
  ligado: boolean;
  podeEditar: boolean;
  aoMudar: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-hairline bg-card px-4 py-3">
      <div>
        <label htmlFor={id} className="text-sm font-medium">
          {titulo}
        </label>
        <p className="text-xs leading-relaxed text-muted-foreground">{descricao}</p>
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={ligado}
        disabled={!podeEditar}
        onClick={() => aoMudar(!ligado)}
        className={cn(
          'relative mt-1 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50',
          ligado ? 'bg-primary' : 'bg-muted-foreground/30',
        )}
      >
        <span className="sr-only">{ligado ? 'Ligado' : 'Desligado'}</span>
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-0.5 left-0.5 size-5 rounded-full bg-background shadow transition-transform',
            ligado && 'translate-x-5',
          )}
        />
      </button>
    </div>
  );
}

function TextoDaAusencia({
  inicial,
  podeEditar,
  aoSalvar,
}: {
  inicial: string;
  podeEditar: boolean;
  aoSalvar: (texto: string) => void;
}) {
  const [texto, setTexto] = useState(inicial);
  return (
    <div className="flex flex-col gap-2 pl-4">
      <label htmlFor="texto-ausencia" className="text-xs text-muted-foreground">
        Texto do aviso
      </label>
      <textarea
        id="texto-ausencia"
        value={texto}
        maxLength={1000}
        rows={3}
        disabled={!podeEditar}
        onChange={(e) => setTexto(e.target.value)}
        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      />
      {podeEditar && texto.trim() !== inicial.trim() ? (
        <div>
          <Button size="sm" className="toque h-11 md:h-8" onClick={() => aoSalvar(texto.trim())} disabled={!texto.trim()}>
            Salvar o texto
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function RespostasProntas({
  respostas,
  podeEditar,
  aoMudar,
}: {
  respostas: Resposta[];
  podeEditar: boolean;
  aoMudar: () => void;
}) {
  const [atalho, setAtalho] = useState('');
  const [titulo, setTitulo] = useState('');
  const [texto, setTexto] = useState('');

  const criar = useMutation({
    mutationFn: async () => {
      const { error } = await createClient()
        .from('respostas_rapidas')
        .insert({ atalho: atalho.trim().toLowerCase().replace(/^\//, ''), titulo: titulo.trim(), texto: texto.trim() });
      if (error) throw new Error(error.code === '23505' ? 'Já existe um atalho com esse nome.' : 'Use só letras minúsculas, números e hífen no atalho.');
    },
    onSuccess: () => {
      setAtalho('');
      setTitulo('');
      setTexto('');
      toast.success('Resposta pronta criada.');
      aoMudar();
    },
    onError: (e: Error) => toast.error('Não criou.', { description: e.message }),
  });
  const apagar = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await createClient().from('respostas_rapidas').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: aoMudar,
  });

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="font-heading text-base font-medium">Respostas prontas</h2>
        <p className="text-sm text-muted-foreground">
          Na caixa de resposta das Conversas, digite <code>/</code> e escolha. O texto entra na hora.
        </p>
      </div>
      <ul className="divide-y divide-hairline rounded-xl border border-hairline bg-card">
        {respostas.map((r) => (
          <li key={r.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
            <code className="shrink-0 text-primary">/{r.atalho}</code>
            <span className="min-w-0 flex-1">
              <span className="font-medium">{r.titulo}</span>
              <span className="block truncate text-xs text-muted-foreground">{r.texto}</span>
            </span>
            {podeEditar ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Apagar /${r.atalho}`}
                onClick={() => apagar.mutate(r.id)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {podeEditar ? (
        <form
          className="grid gap-2 sm:grid-cols-[9rem_12rem_minmax(0,1fr)_auto] sm:items-start"
          onSubmit={(e) => {
            e.preventDefault();
            criar.mutate();
          }}
        >
          <Input aria-label="Atalho" placeholder="/preco" value={atalho} maxLength={31} onChange={(e) => setAtalho(e.target.value)} className="h-11 md:h-9" />
          <Input aria-label="Nome" placeholder="Nome" value={titulo} maxLength={60} onChange={(e) => setTitulo(e.target.value)} className="h-11 md:h-9" />
          <Input aria-label="Texto" placeholder="O texto que entra na mensagem" value={texto} maxLength={1000} onChange={(e) => setTexto(e.target.value)} className="h-11 md:h-9" />
          <Button type="submit" className="toque h-11 md:h-9" disabled={!atalho.trim() || !titulo.trim() || !texto.trim() || criar.isPending}>
            <Plus aria-hidden="true" />
            Criar
          </Button>
        </form>
      ) : null}
    </section>
  );
}

function Etiquetas({
  etiquetas,
  podeEditar,
  aoMudar,
}: {
  etiquetas: Etiqueta[];
  podeEditar: boolean;
  aoMudar: () => void;
}) {
  const [nome, setNome] = useState('');
  const [cor, setCor] = useState(CORES[0] ?? '#24705c');
  const criar = useMutation({
    mutationFn: async () => {
      const { error } = await createClient().from('tags').insert({ name: nome.trim().toLowerCase(), color: cor });
      if (error) throw new Error(error.code === '23505' ? 'Essa etiqueta já existe.' : error.message);
    },
    onSuccess: () => {
      setNome('');
      aoMudar();
    },
    onError: (e: Error) => toast.error('Não criou.', { description: e.message }),
  });
  const apagar = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await createClient().from('tags').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: aoMudar,
    onError: () => toast.error('Não apagou: a etiqueta ainda está em uso.'),
  });

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="font-heading text-base font-medium">Etiquetas</h2>
        <p className="text-sm text-muted-foreground">
          Marcam o parceiro. Aparecem no topo da conversa, e qualquer pessoa do time põe e tira.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {etiquetas.map((e) => (
          <span
            key={e.id}
            className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-card py-1 pr-1 pl-2.5 text-sm"
          >
            <span className="size-2.5 rounded-full" style={{ background: e.color ?? '#64748b' }} aria-hidden="true" />
            {e.name}
            {podeEditar ? (
              <button
                type="button"
                aria-label={`Apagar a etiqueta ${e.name}`}
                onClick={() => apagar.mutate(e.id)}
                className="rounded-full p-1 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </button>
            ) : null}
          </span>
        ))}
      </div>
      {podeEditar ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (nome.trim()) criar.mutate();
          }}
        >
          <Input aria-label="Nome da etiqueta" placeholder="Nova etiqueta" value={nome} maxLength={40} onChange={(e) => setNome(e.target.value)} className="h-11 w-48 md:h-9" />
          <span className="flex items-center gap-1" role="radiogroup" aria-label="Cor">
            {CORES.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={cor === c}
                aria-label={`Cor ${c}`}
                onClick={() => setCor(c)}
                className={cn('size-7 rounded-full border-2', cor === c ? 'border-foreground' : 'border-transparent')}
                style={{ background: c }}
              />
            ))}
          </span>
          <Button type="submit" className="toque h-11 md:h-9" disabled={!nome.trim() || criar.isPending}>
            <Plus aria-hidden="true" />
            Criar
          </Button>
        </form>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Os três freios da Fase 3
// ---------------------------------------------------------------------------

const QUALIDADE_EM_PT: Record<string, string> = {
  GREEN: 'verde',
  YELLOW: 'amarela',
  RED: 'vermelha',
  UNKNOWN: 'desconhecida',
};

function usd(v: number): string {
  return `US$ ${v.toFixed(2).replace('.', ',')}`;
}

function Freios3({ f, aoReligar }: { f: Freios; aoReligar: () => void }) {
  const freado = f.orcamento.situacao === 'freou';
  const naLinha = f.orcamento.situacao === 'passou_de_80';
  const quemManda =
    f.numero.teto_dia !== null && f.numero.teto_nosso !== null && f.numero.teto_dia < f.numero.teto_nosso
      ? 'meta'
      : 'nos';

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-heading text-base font-medium">Os freios</h2>
      <p className="text-xs text-muted-foreground">
        Enquanto uma pessoa aprova cada mensagem, ela é o freio. Estes três existem para o dia em que
        ninguém estiver olhando.
      </p>

      <Cartao
        titulo="Orçamento de IA"
        estado={freado ? 'ruim' : naLinha ? 'atencao' : 'ok'}
        linha={`${usd(f.orcamento.gasto_usd)} de ${usd(f.orcamento.orcamento_usd)} · alerta em ${usd(
          f.orcamento.limite_de_alerta_usd,
        )}`}
      >
        {freado ? (
          <>
            O orçamento acabou: nenhuma chamada de IA está saindo. As mensagens que chegam viram tarefa, e o
            que ficou devendo volta sozinho quando o mês virar.
          </>
        ) : naLinha ? (
          <>
            O orçamento passou da linha de alerta: só a classificação e a transcrição continuam rodando —{' '}
            <span className="numerico">{f.orcamento.propositos_parados.length}</span> propósitos estão parados.
          </>
        ) : (
          'Dentro do orçamento.'
        )}
        {f.orcamento.adiados > 0 ? (
          <>
            {' '}
            <span className="numerico">{f.orcamento.adiados}</span> trabalhos estão anotados como dívida e
            voltam sozinhos.
          </>
        ) : null}
      </Cartao>

      <Cartao
        titulo="Número na Meta"
        estado={
          f.numero.banido || f.numero.qualidade === 'RED'
            ? 'ruim'
            : f.numero.restrito_saida || f.numero.restrito_entrada || f.numero.qualidade === 'YELLOW'
              ? 'atencao'
              : 'ok'
        }
        linha={
          f.numero.qualidade === null && f.numero.teto_dia === null
            ? 'Ainda não perguntamos à Meta como está o número'
            : `Qualidade: ${QUALIDADE_EM_PT[f.numero.qualidade ?? ''] ?? 'desconhecida'} · Teto da Meta: ${
                f.numero.teto_dia === null ? 'não sei' : `${f.numero.teto_dia}/dia`
              } · Nosso: ${f.numero.teto_nosso ?? '?'}/dia · Quem manda hoje: ${
                quemManda === 'meta' ? 'a Meta' : 'nós'
              }`
        }
      >
        {f.numero.banido ? (
          'A Meta desativou a conta. Nada sai por enquanto.'
        ) : f.numero.restrito_saida || f.numero.restrito_entrada ? (
          <>
            A Meta restringiu o número
            {f.numero.ate ? ` até ${new Date(f.numero.ate).toLocaleString('pt-BR')}` : ' por prazo não informado'}
            .
          </>
        ) : f.numero.qualidade === null && f.numero.teto_dia === null ? (
          'O worker-wa pergunta de 30 em 30 minutos. Os campos de webhook precisam estar assinados no painel do app.'
        ) : (
          <>
            <span className="numerico">{f.numero.usados}</span> aberturas usadas hoje. Toda conversa que a
            gente começa conta aqui, inclusive recontato — é como a Meta conta.
          </>
        )}
      </Cartao>

      <Cartao
        titulo="Teto de fala do robô"
        estado={f.robo.freio !== null ? 'ruim' : 'ok'}
        linha={`${f.robo.falas_por_conversa} falas por conversa em 24 h · ${f.robo.falas_na_ultima_hora} de ${f.robo.fusivel_por_hora} na última hora`}
      >
        {f.robo.freio !== null ? (
          <span className="flex flex-wrap items-center gap-2">
            <span>O fusível disparou ({f.robo.freio.motivo ?? 'sem motivo'}): o robô está mudo.</span>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const { error } = await createClient().rpc('wa_bot_ligar', { p_ativo: true });
                if (error) toast.error('Não deu para religar.', { description: error.message });
                else {
                  toast.success('Religado — o freio foi apagado no mesmo gesto.');
                  aoReligar();
                }
              }}
            >
              Religar o bot
            </Button>
          </span>
        ) : f.robo.ativo ? (
          'O robô está falando dentro do teto.'
        ) : (
          'O bot de entrada está desligado.'
        )}
      </Cartao>
    </section>
  );
}

function Cartao({
  titulo,
  linha,
  estado,
  children,
}: {
  titulo: string;
  linha: string;
  estado: 'ok' | 'atencao' | 'ruim';
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        estado === 'ruim'
          ? 'border-destructive/40 bg-destructive/5'
          : estado === 'atencao'
            ? 'border-amber-500/40 bg-amber-500/5'
            : 'border-border bg-muted/30',
      )}
    >
      <p className="text-sm font-medium">{titulo}</p>
      <p className="text-xs text-muted-foreground">{linha}</p>
      <p className="mt-1 text-xs leading-relaxed">{children}</p>
    </div>
  );
}
