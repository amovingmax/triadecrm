'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

import { buscarFreios, buscarSaudeDaEsteira } from './dados';
import { rotuloDaRecusaDoAtendimento } from './formatos';

import type { Freios } from './tipos';

/**
 * Ajustes → Atendimento (Fase 3, 22/09/2026).
 *
 * Tudo o que o CRM faz sozinho no WhatsApp, num lugar só, com um interruptor
 * por automação: lead automático, distribuição, fora do horário e — desde
 * 28/09/2026 (ADR-16) — a introdução automática. Embaixo, as listas que a
 * equipe usa na caixa de resposta: respostas prontas e etiquetas.
 */
type Config = {
  lead_automatico?: boolean;
  distribuicao_automatica?: boolean;
  ausencia_ativa?: boolean;
  /** A introdução automática (ADR-16, 28/09/2026). */
  introducao_ativa?: boolean;
  /** O cumprimento automático para quem é aprovado no Radar do Google Maps (28/09/2026). */
  cumprimento_automatico?: boolean;
  /** Quantos cumprimentos por hora o lote da casa tenta. O teto do dia manda acima disto. */
  cumprimento_por_hora?: number;
};

async function carregar() {
  const supabase = createClient();
  // Duas consultas, e não quatro: as respostas prontas e as etiquetas saíram
  // desta aba em 29/09/2026 e agora carregam sozinhas, na aba Catálogos, só
  // quando alguém abre a seção delas.
  const [config, modelo] = await Promise.all([
    supabase.from('app_settings').select('value').eq('key', 'atendimento').maybeSingle(),
    supabase
      .from('message_templates')
      .select('template_code, body')
      .in('template_code', ['GEN-SYS-AUSENCIA', 'GEN-SYS-INTRO', 'GEN-SYS-TUDOBEM']),
  ]);
  const corpos = (modelo.data ?? []) as { template_code: string; body: string }[];
  const corpo = (codigo: string) => corpos.find((t) => t.template_code === codigo)?.body ?? '';
  return {
    config: (config.data?.value ?? {}) as Config,
    textoAusencia: corpo('GEN-SYS-AUSENCIA'),
    textoIntroducao: corpo('GEN-SYS-INTRO'),
    textoTudoBem: corpo('GEN-SYS-TUDOBEM'),
  };
}

async function configurar(p: Record<string, unknown>) {
  const { data, error } = await createClient().rpc('atendimento_configurar', { p });
  if (error) throw new Error(error.message);
  const r = data as { ok?: boolean; motivo?: string } | null;
  if (!r?.ok) throw new Error(rotuloDaRecusaDoAtendimento(r?.motivo));
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
  const { config, textoAusencia, textoIntroducao, textoTudoBem } = consulta.data;

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      {/* Os freios vêm ANTES dos interruptores porque é o que muda o
          comportamento de tudo abaixo deles: não adianta ligar uma automação
          que o orçamento já parou. */}
      {freios.data ? <Freios3 f={freios.data} aoReligar={() => void freios.refetch()} /> : null}

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-base font-medium">O que o CRM faz sozinho</h2>
        {/* O interruptor diz o que o CRM PODE fazer; o link diz o que ele FEZ.
            Um interruptor sem consequência visível é um interruptor que ninguém
            audita — e a pergunta do Rafael em 28/09/2026 foi exatamente essa. O
            destino é Conversas, e não uma tela aqui, porque quem precisa flagrar
            "o robô falou e ninguém assumiu" é quem atende, inclusive sdr, e
            Ajustes é só de admin e gestor. */}
        <p className="text-xs text-muted-foreground">
          Para ver o que saiu sozinho de verdade — e se o lead respondeu e alguém assumiu —,
          abra{' '}
          <Link href="/conversas?aba=automaticas" className="underline underline-offset-2">
            Conversas → Automáticas
          </Link>
          .
        </p>
        <Interruptor
          id="lead-automatico"
          titulo="Lead automático"
          descricao="Quem escreve pela primeira vez vira parceiro e card no funil."
          ligado={config.lead_automatico ?? false}
          podeEditar={podeEditar}
          aoMudar={(v) => mudar.mutate({ lead_automatico: v })}
        />
        <Interruptor
          id="distribuicao"
          titulo="Distribuir conversas novas"
          descricao="Conversa sem dono cai com quem tem menos conversas abertas."
          ligado={config.distribuicao_automatica ?? false}
          podeEditar={podeEditar}
          aoMudar={(v) => mudar.mutate({ distribuicao_automatica: v })}
        />
        <Interruptor
          id="ausencia"
          titulo="Responder fora do horário"
          descricao="Fora de 8h–17h45, quem escreve recebe um aviso. No máximo um a cada 12 h."
          ligado={config.ausencia_ativa ?? false}
          podeEditar={podeEditar}
          aoMudar={(v) => mudar.mutate({ ausencia_ativa: v })}
        />
        {config.ausencia_ativa ? (
          <TextoAutomatico
            id="texto-ausencia"
            rotulo="Texto do aviso"
            inicial={textoAusencia}
            podeEditar={podeEditar}
            aoSalvar={(t) => mudar.mutate({ texto_ausencia: t })}
          />
        ) : null}
        {/* O CUMPRIMENTO AUTOMÁTICO (28/09/2026). Este e o de baixo são os dois
            que fazem o CRM ABRIR conversa sozinho, e por isso vêm no fim e na
            ordem em que acontecem: primeiro o "Bom dia!", depois a apresentação
            para quem responder. Os outros três só organizam o que chega.

            Este é o único da tela que fala com quem NUNCA falou com a gente. O
            texto embaixo diz isso com todas as letras porque ligar um botão que
            manda WhatsApp para desconhecido não pode parecer ligar uma luz. */}
        <Interruptor
          id="cumprimento-automatico"
          titulo="Mandar o cumprimento a quem eu aprovar no Google Maps"
          descricao="Aprovou no Radar → sai “Bom dia!” sozinho, dentro do horário e do teto do dia."
          ligado={config.cumprimento_automatico ?? false}
          podeEditar={podeEditar}
          aoMudar={(v) => mudar.mutate({ cumprimento_automatico: v })}
        />
        {config.cumprimento_automatico ? (
          <Ritmo
            valor={config.cumprimento_por_hora ?? 6}
            podeEditar={podeEditar}
            aoMudar={(n) => mudar.mutate({ cumprimento_por_hora: String(n) })}
          />
        ) : null}

        {/* A introdução (ADR-16, 28/09/2026). */}
        <Interruptor
          id="introducao"
          titulo="Apresentar a Komune quando o lead responder o cumprimento"
          descricao="Quem responder recebe “Tudo bem?” e, 15 s depois, a apresentação. Sem nome."
          ligado={config.introducao_ativa ?? false}
          podeEditar={podeEditar}
          aoMudar={(v) => mudar.mutate({ introducao_ativa: v })}
        />
        {/* OS DOIS TEXTOS DO MESMO FLUXO, na ordem em que a pessoa os lê. O
            "Tudo bem?" é a ponte: ele existe para a apresentação não chegar
            como um panfleto em cima de um "oi". */}
        {config.introducao_ativa ? (
          <TextoAutomatico
            id="texto-tudo-bem"
            rotulo='Texto da ponte — sai 3 a 6 s depois da resposta (sem variável)'
            inicial={textoTudoBem}
            podeEditar={podeEditar}
            aoSalvar={(t) => mudar.mutate({ texto_tudo_bem: t })}
          />
        ) : null}
        {config.introducao_ativa ? (
          <TextoAutomatico
            id="texto-introducao"
            rotulo="Texto da apresentação — sai 15 a 20 s depois (sem variável: sai exatamente assim)"
            inicial={textoIntroducao}
            podeEditar={podeEditar}
            aoSalvar={(t) => mudar.mutate({ texto_introducao: t })}
          />
        ) : null}
      </section>

      {/* As respostas prontas e as etiquetas saíram desta aba em 29/09/2026:
          são CATÁLOGOS, e a aba Catálogos existe ao lado. Atendimento é sobre o
          que o CRM faz sozinho; resposta pronta é o que uma pessoa digita, e
          etiqueta é o que uma pessoa põe na ficha. */}

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

/**
 * O ritmo do cumprimento automático — o freio de quem acabou de ligar isto.
 *
 * Não é o teto: o teto do dia é do banco (`app.wa_teto_da_meta`) e manda acima
 * de qualquer número daqui. Este é só a VELOCIDADE dentro do dia, e existe
 * porque despejar quarenta cumprimentos às 8h01 é o que derruba a nota de um
 * número novo. Quem muda aqui muda também o lote que já está rodando.
 */
function Ritmo({
  valor,
  podeEditar,
  aoMudar,
}: {
  valor: number;
  podeEditar: boolean;
  aoMudar: (n: number) => void;
}) {
  const OPCOES = [
    { n: 2, rotulo: 'Devagar — 2 por hora' },
    { n: 6, rotulo: 'Normal — 6 por hora' },
    { n: 12, rotulo: 'Rápido — 12 por hora' },
    { n: 20, rotulo: 'Muito rápido — 20 por hora' },
  ];
  return (
    <label className="flex flex-wrap items-center gap-2 pl-1 text-sm">
      <span className="text-muted-foreground">Ritmo:</span>
      <select
        value={valor}
        disabled={!podeEditar}
        onChange={(e) => aoMudar(Number(e.target.value))}
        className="h-9 rounded-md border border-hairline bg-background px-2 text-sm disabled:opacity-60"
      >
        {OPCOES.map((o) => (
          <option key={o.n} value={o.n}>
            {o.rotulo}
          </option>
        ))}
        {OPCOES.every((o) => o.n !== valor) ? <option value={valor}>{valor} por hora</option> : null}
      </select>
      <span className="text-xs text-muted-foreground">
        O teto do dia manda acima disto — isto só espalha os envios pelo dia.
      </span>
    </label>
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

/** O corpo de uma das duas mensagens que o CRM manda sozinho. */
function TextoAutomatico({
  id,
  rotulo,
  inicial,
  podeEditar,
  aoSalvar,
}: {
  id: string;
  rotulo: string;
  inicial: string;
  podeEditar: boolean;
  aoSalvar: (texto: string) => void;
}) {
  const [texto, setTexto] = useState(inicial);
  // NASCE FECHADO (29/09/2026). Rafael, com o print de Ajustes: "ta muito
  // complexo as telas desse CRM". Duas caixas de texto sempre abertas — uma
  // delas com a apresentação inteira — enchiam a tela de parede antes de
  // qualquer interruptor. O texto é para MUDAR de vez em quando; o interruptor
  // é para olhar todo dia. Quem nasce aberto é o que se olha todo dia.
  //
  // `<details>` nativo: abre sem JavaScript e o Ctrl+F acha o texto mesmo
  // fechado (mesma razão de `NotaRecolhida`).
  return (
    <details className="group pl-4">
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
        <ChevronRight
          className="size-3.5 shrink-0 transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
        {rotulo}
        <span className="truncate text-muted-foreground/70">— “{primeiraLinha(inicial)}”</span>
      </summary>
      <div className="flex flex-col gap-2 pt-2">
      <label htmlFor={id} className="sr-only">
        {rotulo}
      </label>
      <textarea
        id={id}
        value={texto}
        maxLength={1000}
        rows={4}
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
    </details>
  );
}

/** A primeira linha do texto, curta, para o resumo do `<summary>`. */
function primeiraLinha(texto: string): string {
  const linha = texto.trim().split('\n')[0]?.trim() ?? '';
  return linha.length > 60 ? `${linha.slice(0, 60)}…` : linha;
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

  // ABRE SOZINHO SÓ QUANDO HÁ O QUE OLHAR (29/09/2026). Rafael: "ta muito
  // complexo as telas desse CRM". Os três freios são MONITORAMENTO, e ocupavam
  // a tela inteira antes do primeiro interruptor — todo dia, inclusive nos dias
  // em que os três estão verdes, que é a esmagadora maioria. Agora, em dia de
  // paz, eles são uma linha; no dia em que um deles aperta, a seção nasce
  // aberta e o resumo diz qual, porque aí ela é a primeira coisa a ler.
  const apertou = naLinha || f.orcamento.situacao === 'parou'
    || f.numero.banido || f.numero.restrito_saida || f.numero.restrito_entrada
    || f.robo.freio !== null;

  return (
    <details open={apertou} className="group flex flex-col gap-3">
      <summary className="flex cursor-pointer list-none items-center gap-1.5">
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
        <h2 className="font-heading text-base font-medium">Os freios</h2>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-xs',
            apertou
              ? 'bg-destructive/15 font-medium text-destructive-texto'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {apertou ? 'um deles apertou' : 'tudo certo'}
        </span>
      </summary>
      <p className="pt-3 text-xs text-muted-foreground">
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
    </details>
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
