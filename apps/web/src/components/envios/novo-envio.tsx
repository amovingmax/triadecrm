'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bookmark,
  ChevronDown,
  ChevronRight,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cumprimentoDaHora } from '@/components/conversas/envio-de-modelo';
import type { Catalogos } from '@/components/parceiros/tipos';

import {
  apagarPublico,
  buscarCumprimentos,
  buscarEtiquetasESetores,
  buscarPrevia,
  buscarPublico,
  buscarTetoDeHoje,
  criarEnvio,
  ErroDoEnvio,
  listarPublicosSalvos,
  salvarPublico,
  type ConfigDoEnvio,
} from './dados';
import { EscolhaMultipla } from './escolha-multipla';
import {
  custoEstimado,
  duracaoEstimada,
  filtrosEscondidos,
  formatarReais,
  fraseDaRecusa,
  fraseDoMotivo,
  nomeSugerido,
  regrasIncompletas,
  regrasPara,
  variaveisComRegra,
} from './formatos';
import {
  CAMPOS_DA_FICHA,
  SITUACOES,
  TEMPERATURAS,
  TIPOS_DE_PARCEIRO,
  type Assinatura,
  type FiltroDoPublico,
  type PessoaDoPublico,
  type RegraDaVariavel,
  type TipoDoEnvio,
} from './tipos';

/**
 * Montar uma campanha numa tela só (Fase 5, plano aprovado pelo Rafael em
 * 21/09/2026: "montar um envio em menos de 1 minuto").
 *
 * À esquerda, as duas perguntas de toda campanha — para quem e qual
 * mensagem. À direita, sempre à vista, como ela chega e o botão de enviar.
 * Tudo o que tem um padrão bom (quem assina, ritmo, de onde vem cada variável)
 * mora em "Opções avançadas", já preenchido: quem não abre envia do jeito certo.
 *
 * A mensagem é o cumprimento ou texto livre, e mais nada (decisão do Rafael,
 * 22/09/2026): o cumprimento abre a janela de 24 h e o time conversa com quem
 * responder; o texto livre fala com quem já está com a janela aberta.
 *
 * A lista de pessoas continua lá, recolhida: quem manda para 120 ainda pode
 * bater o olho e tirar os três que não fazem sentido. Quem o banco não deixaria
 * receber aparece riscado, com o motivo — sumir com eles faria a pessoa achar
 * que o filtro errou.
 */

const RITMOS = [5, 10, 15, 20, 30, 45, 60] as const;

/** Quantas linhas a lista desenha de cada vez. A seleção vale para todas. */
const LINHAS_VISIVEIS = 150;

/** A nota do número na Meta, dita como quem opera fala. */
const QUALIDADE_EM_PT: Record<string, string> = {
  GREEN: 'verde',
  YELLOW: 'amarela',
  RED: 'vermelha',
  UNKNOWN: 'desconhecida',
};

const ROTULO_DA_ASSINATURA: Record<Assinatura, string> = {
  marca: 'em nome da Komune',
  eu: 'assinada por você',
  responsavel: 'assinada pelo responsável',
  revezar: 'dividida entre atendentes',
};

function temAtendente(corpo: string): boolean {
  return /\{\{\s*atendente\s*\}\}/.test(corpo);
}

export function NovoEnvio({
  catalogos,
  aoCriar,
  aoCancelar,
}: {
  catalogos: Catalogos;
  aoCriar: (id: string) => void;
  aoCancelar: () => void;
}) {
  const clientes = useQueryClient();

  // ---------------- para quem ----------------
  const [filtro, setFiltro] = useState<FiltroDoPublico>({ situacoes: ['nunca_contatado'] });
  const filtroAdiado = useDeferredValue(filtro);
  const [desmarcados, setDesmarcados] = useState<Set<string>>(new Set());
  const [maisFiltros, setMaisFiltros] = useState(false);
  const [verLista, setVerLista] = useState(false);
  const [verTodas, setVerTodas] = useState(false);

  const publico = useQuery({
    queryKey: ['envios', 'publico', filtroAdiado],
    queryFn: () => buscarPublico(filtroAdiado),
    // Trocar um filtro não apaga a contagem: a anterior fica, esmaecida, até a nova chegar.
    placeholderData: (anterior) => anterior,
  });
  const segmentos = useQuery({
    queryKey: ['envios', 'segmentos'],
    queryFn: buscarEtiquetasESetores,
    staleTime: 5 * 60_000,
  });
  const pessoas = useMemo(() => publico.data ?? [], [publico.data]);
  const podem = pessoas.filter((p) => p.bloqueio === null);
  const escolhidas = podem.filter((p) => !desmarcados.has(p.organization_id));
  const situacoes = filtro.situacoes ?? [];
  const escondidos = filtrosEscondidos(filtro);

  function mudarFiltro(parcial: Partial<FiltroDoPublico>) {
    setFiltro((f) => ({ ...f, ...parcial }));
    setVerTodas(false);
  }

  function alternarSituacao(valor: string) {
    mudarFiltro({
      situacoes: situacoes.includes(valor)
        ? situacoes.filter((s) => s !== valor)
        : [...situacoes, valor],
    });
  }

  // ---------------- mensagem ----------------
  const [tipo, setTipo] = useState<TipoDoEnvio>('modelo');
  const [texto, setTexto] = useState('');
  const [regras, setRegras] = useState<Record<string, RegraDaVariavel>>({});

  // ---------------- como e quando ----------------
  const [nomeEscrito, setNomeEscrito] = useState<string | null>(null);
  const [porHora, setPorHora] = useState(20);
  const [agendar, setAgendar] = useState(false);
  const [inicio, setInicio] = useState('');
  const [assinatura, setAssinatura] = useState<Assinatura>('marca');
  const [atendentes, setAtendentes] = useState<string[]>([]);
  const [vista, setVista] = useState(0);

  // Fora da janela, só o cumprimento (decisão do Rafael, 22/09/2026). Os três
  // viram uma opção só: o banco troca pelo do período na hora de cada envio
  // (`app.modelo_da_hora`), então qualquer um serve de ponto de partida — o de
  // agora deixa a prévia certa.
  const cumprimentos = useQuery({
    queryKey: ['envios', 'cumprimentos'],
    queryFn: buscarCumprimentos,
    staleTime: 60_000,
  });
  const modelo =
    cumprimentos.data?.find((m) => m.template_code === cumprimentoDaHora()) ??
    cumprimentos.data?.[0] ??
    null;
  const modeloId = tipo === 'modelo' ? (modelo?.id ?? null) : null;
  const corpo = tipo === 'modelo' ? (modelo?.body ?? '') : texto;
  const variaveis = variaveisComRegra(corpo);
  const regrasDoCorpo = regrasPara(corpo, regras);
  const incompletas = regrasIncompletas(regrasDoCorpo);
  // Texto fixo é o que só a pessoa sabe (o nome do evento, a data): fica à
  // vista. O que vem da ficha já tem regra e reserva: fica nas opções.
  const fixas = variaveis.filter((v) => 'fixo' in (regrasDoCorpo[v] ?? { fixo: '' }));
  const daFicha = variaveis.filter((v) => !fixas.includes(v));

  function mudarTexto(novoTexto: string) {
    setTexto(novoTexto);
    setRegras((r) => ({ ...r, ...regrasPara(novoTexto, r) }));
  }

  const nome = nomeEscrito ?? nomeSugerido(tipo === 'texto' ? 'Texto livre' : 'Cumprimento');

  // Texto livre só chega a quem está com a janela de 24 h aberta: os outros nem
  // entram na fila (entrariam só para aparecer como "pulados").
  const destinatarios =
    tipo === 'texto' ? escolhidas.filter((p) => p.situacao === 'janela_aberta') : escolhidas;
  const vaoReceber = destinatarios.length;
  const comJanela = escolhidas.filter((p) => p.situacao === 'janela_aberta').length;
  const primeiros = destinatarios.filter((p) => p.situacao === 'nunca_contatado').length;

  const teto = useQuery({ queryKey: ['envios', 'teto'], queryFn: buscarTetoDeHoje, staleTime: 60_000 });
  const tetoLivre = teto.data ? Math.max(teto.data.teto - teto.data.usados, 0) : null;
  const tetoSegura = tipo === 'modelo' && tetoLivre !== null && primeiros > tetoLivre;

  const config: ConfigDoEnvio = {
    nome,
    tipo,
    modeloId,
    texto,
    variaveis: regrasDoCorpo,
    assinatura,
    atendentes,
    porHora,
    inicio: agendar && inicio ? new Date(inicio).toISOString() : null,
    filtro,
    // O cumprimento não tem botão: nem link, nem ação.
    linkDestino: '',
    acoes: {},
  };

  const conflitoDeAssinatura = assinatura === 'marca' && temAtendente(corpo);
  const mensagemPronta =
    (tipo === 'modelo' ? modelo !== null : texto.trim().length > 0) && incompletas.length === 0;

  const amostra = destinatarios.slice(0, 3).map((p) => p.organization_id);
  const previa = useQuery({
    queryKey: ['envios', 'previa', tipo, modeloId, texto, regrasDoCorpo, assinatura, atendentes, amostra],
    queryFn: () => buscarPrevia(config, amostra),
    enabled: mensagemPronta && amostra.length > 0,
    // Digitar o texto fixo não pisca a prévia: a anterior fica até a nova chegar.
    placeholderData: (anterior) => anterior,
  });
  const itensDaPrevia = previa.data?.itens ?? [];
  const itemVisto = itensDaPrevia.length > 0 ? itensDaPrevia[vista % itensDaPrevia.length] : undefined;

  const criar = useMutation({
    mutationFn: () => criarEnvio(config, destinatarios.map((p) => p.organization_id)),
    onSuccess: (r) => {
      toast.success(config.inicio ? 'Campanha agendada.' : 'Enviando a campanha.', {
        description: `${r.itens} mensagens saem aos poucos. A campanha para sozinha se muita gente bloquear.`,
      });
      void clientes.invalidateQueries({ queryKey: ['envios'] });
      aoCriar(r.id);
    },
    onError: (erro: Error) => {
      const e = erro instanceof ErroDoEnvio ? erro : null;
      toast.error('A campanha não foi criada.', {
        description: e ? fraseDaRecusa(e.motivo, e.variavel) : erro.message,
      });
    },
  });

  /** O primeiro motivo de o botão estar apagado, dito ao lado dele. */
  function oQueFalta(): string | null {
    if (publico.isPending) return null;
    if (escolhidas.length === 0) return 'Ninguém no público: afrouxe um filtro.';
    if (tipo === 'modelo' && cumprimentos.isPending) return null;
    if (tipo === 'modelo' && !modelo) return 'O cumprimento ainda não foi aprovado pela Meta.';
    if (tipo === 'texto' && texto.trim() === '') return 'Escreva o texto.';
    if (tipo === 'texto' && vaoReceber === 0) {
      return 'Ninguém deste público falou com a gente nas últimas 24 h: texto livre não chega. Mande o cumprimento.';
    }
    if (incompletas.length > 0) return `Preencha ${incompletas.map((v) => `{{${v}}}`).join(', ')}.`;
    if (conflitoDeAssinatura) {
      return 'O texto diz o nome de quem envia: troque quem assina em Opções avançadas.';
    }
    if (assinatura === 'revezar' && atendentes.length === 0) {
      return 'Escolha quem divide a campanha, em Opções avançadas.';
    }
    if (agendar && inicio === '') return 'Escolha o dia e a hora do início.';
    if (nome.trim() === '') return 'Dê um nome à campanha.';
    return null;
  }
  const falta = oQueFalta();
  const podeEnviar = falta === null && !publico.isPending && vaoReceber > 0;

  const custo = tipo === 'texto' ? 0 : modelo ? custoEstimado(modelo.category, vaoReceber, comJanela) : null;
  const tiradas = podem.length - escolhidas.length;
  const foraDoAlcance = pessoas.length - podem.length;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
      <div className="min-w-0 divide-y divide-hairline rounded-2xl border border-hairline bg-card">
        {/* ------------------------------ Para quem ------------------------------ */}
        <section aria-labelledby="bloco-publico" className="space-y-3 p-4 md:p-5">
          <h2 id="bloco-publico" className="text-sm font-semibold">
            Para quem
          </h2>

          <div role="group" aria-label="Situação" className="flex flex-wrap gap-2">
            <Chip ativo={situacoes.length === 0} aoClicar={() => mudarFiltro({ situacoes: [] })}>
              Todos
            </Chip>
            {SITUACOES.map((s) => (
              <Chip
                key={s.valor}
                ativo={situacoes.includes(s.valor)}
                dica={s.dica}
                aoClicar={() => alternarSituacao(s.valor)}
              >
                {s.rotulo}
              </Chip>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <EscolhaMultipla
              rotulo="Etiqueta"
              opcoes={(segmentos.data?.etiquetas ?? []).map((e) => ({ valor: e.id, rotulo: e.nome }))}
              valor={filtro.tags ?? []}
              aoMudar={(v) => mudarFiltro({ tags: v })}
            />
            <EscolhaMultipla
              rotulo="Setor"
              opcoes={(segmentos.data?.setores ?? []).map((s) => ({ valor: s.id, rotulo: s.nome }))}
              valor={filtro.setores ?? []}
              aoMudar={(v) => mudarFiltro({ setores: v })}
            />
            <Button
              variant="outline"
              aria-expanded={maisFiltros}
              onClick={() => setMaisFiltros((m) => !m)}
              className={cn(
                'toque h-11 shrink-0 md:h-8',
                escondidos > 0 && 'border-primary/50 bg-primary/5 text-foreground',
              )}
            >
              <SlidersHorizontal aria-hidden="true" />
              {escondidos > 0 ? `Mais filtros: ${escondidos}` : 'Mais filtros'}
            </Button>
            <PublicosSalvos
              aoUsar={(f) => {
                setFiltro(f);
                setDesmarcados(new Set());
                setVerTodas(false);
              }}
            />
          </div>

          {maisFiltros ? (
            <div className="space-y-3 rounded-xl bg-muted/40 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full md:w-56">
                  <Search
                    className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    type="search"
                    aria-label="Nome contém"
                    placeholder="Nome contém…"
                    value={filtro.busca ?? ''}
                    onChange={(e) => mudarFiltro({ busca: e.target.value })}
                    className="h-11 bg-background pl-9 md:h-8"
                  />
                </div>
                <EscolhaMultipla
                  rotulo="Tipo"
                  opcoes={TIPOS_DE_PARCEIRO}
                  valor={filtro.tipos ?? []}
                  aoMudar={(v) => mudarFiltro({ tipos: v })}
                />
                <EscolhaMultipla
                  rotulo="Etapa"
                  opcoes={catalogos.etapas.map((e) => ({ valor: e.id, rotulo: e.nome, grupo: e.funil }))}
                  valor={filtro.etapas ?? []}
                  aoMudar={(v) => mudarFiltro({ etapas: v })}
                />
                <EscolhaMultipla
                  rotulo="Categoria"
                  opcoes={catalogos.categorias.map((c) => ({ valor: c.id, rotulo: c.nome }))}
                  valor={filtro.categorias ?? []}
                  aoMudar={(v) => mudarFiltro({ categorias: v })}
                />
                <EscolhaMultipla
                  rotulo="Cidade"
                  opcoes={catalogos.cidades.map((c) => ({
                    valor: c.id,
                    rotulo: c.nome,
                    grupo: c.grandeNatal ? 'Grande Natal' : 'Interior',
                  }))}
                  valor={filtro.cidades ?? []}
                  aoMudar={(v) => mudarFiltro({ cidades: v })}
                />
                <EscolhaMultipla
                  rotulo="Responsável"
                  opcoes={catalogos.pessoas.map((p) => ({ valor: p.id, rotulo: p.nome }))}
                  valor={filtro.responsaveis ?? []}
                  aoMudar={(v) => mudarFiltro({ responsaveis: v })}
                />
                <EscolhaMultipla
                  rotulo="Temperatura"
                  opcoes={TEMPERATURAS}
                  valor={filtro.temperaturas ?? []}
                  aoMudar={(v) => mudarFiltro({ temperaturas: v })}
                />
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  Sem mensagem nossa há
                  <Input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={filtro.sem_contato_ha_dias ?? ''}
                    onChange={(e) =>
                      mudarFiltro({
                        sem_contato_ha_dias: e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                    className="numerico h-11 w-16 bg-background md:h-8"
                  />
                  dias
                </label>
              </div>
              <SalvarPublico filtro={filtro} />
            </div>
          ) : null}

          <div
            aria-live="polite"
            className={cn(
              'flex flex-wrap items-center gap-x-2 gap-y-1 text-sm transition-opacity',
              publico.isFetching && !publico.isPending && 'opacity-60',
            )}
          >
            {publico.isError ? (
              <span className="text-destructive">
                {publico.error instanceof ErroDoEnvio
                  ? fraseDaRecusa(publico.error.motivo)
                  : 'Não deu para ler o público.'}
              </span>
            ) : publico.isPending ? (
              <span className="text-muted-foreground">Procurando…</span>
            ) : pessoas.length === 0 ? (
              <span className="text-muted-foreground">Ninguém com WhatsApp neste recorte. Afrouxe um filtro.</span>
            ) : (
              <>
                <span>
                  <span className="numerico font-semibold">{escolhidas.length}</span>{' '}
                  {escolhidas.length === 1 ? 'pessoa' : 'pessoas'}
                </span>
                {tiradas > 0 ? (
                  <span className="text-muted-foreground">
                    · <span className="numerico">{tiradas}</span> {tiradas === 1 ? 'tirada' : 'tiradas'} por você
                  </span>
                ) : null}
                {foraDoAlcance > 0 ? (
                  <span className="text-muted-foreground">
                    · <span className="numerico">{foraDoAlcance}</span> não podem receber agora
                  </span>
                ) : null}
                <button
                  type="button"
                  aria-expanded={verLista}
                  onClick={() => setVerLista((v) => !v)}
                  className="toque inline-flex min-h-11 items-center gap-1 text-primary hover:underline md:min-h-0"
                >
                  {verLista ? 'Esconder a lista' : 'Ver quem'}
                  <ChevronDown
                    className={cn('size-3.5 transition-transform', verLista && 'rotate-180')}
                    aria-hidden="true"
                  />
                </button>
              </>
            )}
          </div>

          {verLista ? (
            <ListaDoPublico
              carregando={publico.isPending}
              erro={null}
              pessoas={verTodas ? pessoas : pessoas.slice(0, LINHAS_VISIVEIS)}
              total={pessoas.length}
              desmarcados={desmarcados}
              aoMarcar={(id, marcado) =>
                setDesmarcados((d) => {
                  const novo = new Set(d);
                  if (marcado) novo.delete(id);
                  else novo.add(id);
                  return novo;
                })
              }
              aoMarcarTodas={(marcar) =>
                setDesmarcados(marcar ? new Set() : new Set(podem.map((p) => p.organization_id)))
              }
              escolhidas={escolhidas.length}
              podem={podem.length}
              aoVerTodas={() => setVerTodas(true)}
            />
          ) : null}
        </section>

        {/* ------------------------------ Mensagem ------------------------------ */}
        <section aria-labelledby="bloco-mensagem" className="space-y-3 p-4 md:p-5">
          <h2 id="bloco-mensagem" className="text-sm font-semibold">
            Mensagem
          </h2>
          <div role="group" aria-labelledby="bloco-mensagem" className="flex flex-wrap gap-2">
            <Chip ativo={tipo === 'modelo'} aoClicar={() => setTipo('modelo')}>
              Cumprimento
            </Chip>
            <Chip ativo={tipo === 'texto'} aoClicar={() => setTipo('texto')}>
              Texto livre
            </Chip>
          </div>

          {tipo === 'modelo' ? (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              “Bom dia!”, “Boa tarde!” ou “Boa noite!”, conforme a hora de cada envio. Quem responder
              abre 24 h de conversa livre com o time.
            </p>
          ) : null}

          {tipo === 'texto' ? (
            <div className="space-y-1">
              <textarea
                aria-label="Texto da mensagem"
                value={texto}
                maxLength={1000}
                rows={5}
                onChange={(e) => mudarTexto(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                placeholder="Oi, {{nome}}! Passando para contar que…"
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Use {'{{nome}}'}, {'{{empresa}}'}, {'{{categoria}}'} ou {'{{cidade}}'}. Chega só a quem falou
                com a gente nas últimas 24 h: <span className="numerico">{comJanela}</span> de{' '}
                <span className="numerico">{escolhidas.length}</span> deste público.
              </p>
            </div>
          ) : null}

          {fixas.map((v) => {
            const regra = regrasDoCorpo[v];
            return (
              <div key={v} className="grid gap-1 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center">
                <label htmlFor={`fixo-${v}`} className="text-sm">
                  <code>{`{{${v}}}`}</code>
                </label>
                <Input
                  id={`fixo-${v}`}
                  value={regra && 'fixo' in regra ? regra.fixo : ''}
                  maxLength={200}
                  onChange={(e) => setRegras((atual) => ({ ...atual, [v]: { fixo: e.target.value } }))}
                  placeholder="O texto, igual para todos"
                  className="h-11 md:h-9"
                />
              </div>
            );
          })}
        </section>

        {/* -------------------------- Opções avançadas -------------------------- */}
        <details className="group">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-sm md:px-5 [&::-webkit-details-marker]:hidden">
            <ChevronRight
              className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
              aria-hidden="true"
            />
            <span className="font-medium">Opções avançadas</span>
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {ROTULO_DA_ASSINATURA[assinatura]} · {porHora} por hora
            </span>
          </summary>

          <div className="space-y-5 px-4 pb-5 md:px-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Quem assina" htmlFor="assinatura">
                <Select value={assinatura} onValueChange={(v) => setAssinatura(v as Assinatura)}>
                  <SelectTrigger id="assinatura" className="toque h-11 w-full md:h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="marca">Em nome da Komune (sem nome de atendente)</SelectItem>
                    <SelectItem value="eu">Eu</SelectItem>
                    <SelectItem value="responsavel">O responsável de cada parceiro</SelectItem>
                    <SelectItem value="revezar">Dividir entre atendentes</SelectItem>
                  </SelectContent>
                </Select>
                {assinatura === 'revezar' ? (
                  <div className="pt-1">
                    <EscolhaMultipla
                      rotulo="Atendentes"
                      opcoes={catalogos.pessoas.map((p) => ({ valor: p.id, rotulo: p.nome }))}
                      valor={atendentes}
                      aoMudar={setAtendentes}
                    />
                  </div>
                ) : null}
                <p
                  className={cn(
                    'text-[11px] leading-relaxed',
                    conflitoDeAssinatura ? 'text-destructive' : 'text-muted-foreground',
                  )}
                >
                  {conflitoDeAssinatura
                    ? 'O modelo escolhido diz o nome de quem envia. Em nome da Komune, escolha um modelo sem nome de atendente.'
                    : assinatura === 'marca'
                      ? 'As respostas caem nas Conversas do responsável de cada parceiro (ou de quem montou a campanha).'
                      : 'As respostas caem nas Conversas de quem assinou.'}
                </p>
              </Campo>

              <Campo rotulo="Ritmo" htmlFor="ritmo">
                <Select value={String(porHora)} onValueChange={(v) => setPorHora(Number(v))}>
                  <SelectTrigger id="ritmo" className="toque h-11 w-full md:h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RITMOS.map((r) => (
                      <SelectItem key={r} value={String(r)}>
                        {r} por hora{r === 20 ? ' (recomendado)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Mais devagar parece gente, e dá tempo de o time responder quem responder.
                </p>
              </Campo>
            </div>

            {daFicha.length > 0 ? (
              <div className="space-y-2">
                <h3 className="text-xs font-medium text-muted-foreground">De onde vem cada variável</h3>
                {daFicha.map((v) => (
                  <EditorDeRegra
                    key={v}
                    variavel={v}
                    regra={regrasDoCorpo[v] ?? { fixo: '' }}
                    aoMudar={(r) => setRegras((atual) => ({ ...atual, [v]: r }))}
                  />
                ))}
              </div>
            ) : null}

            <div className="flex gap-2 rounded-lg bg-muted/60 p-3 text-[11px] leading-relaxed text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>
                Sempre ligadas: só de 8h às 17h45 em dia útil; ninguém que pediu para sair; ninguém que
                recebeu mensagem nossa sem responder nas últimas 72 h; teto de aberturas do dia (toda
                conversa que a gente começa conta, inclusive recontato — é como a Meta conta); e a campanha
                para sozinha se 3 pessoas ou mais (acima de 2%) pedirem para sair.
              </p>
            </div>
          </div>
        </details>
      </div>

      {/* ------------------------- Como chega e enviar ------------------------- */}
      <aside className="space-y-4 lg:sticky lg:top-20">
        <section aria-labelledby="bloco-previa" className="space-y-2 rounded-2xl border border-hairline bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 id="bloco-previa" className="text-sm font-semibold">
              Como chega
            </h2>
            {tipo === 'texto' && itensDaPrevia.length > 1 ? (
              <button
                type="button"
                onClick={() => setVista((i) => i + 1)}
                className="toque min-h-11 text-xs text-primary hover:underline md:min-h-0"
              >
                Ver outra pessoa
              </button>
            ) : null}
          </div>
          {!mensagemPronta ? (
            <p className="text-sm text-muted-foreground">
              {incompletas.length > 0
                ? `Preencha ${incompletas.map((v) => `{{${v}}}`).join(', ')} para ver a prévia.`
                : tipo === 'texto'
                  ? 'Escreva o texto para ver a prévia.'
                  : cumprimentos.isPending
                    ? 'Carregando…'
                    : 'O cumprimento ainda não foi aprovado pela Meta.'}
            </p>
          ) : amostra.length === 0 ? (
            <p className="text-sm text-muted-foreground">A prévia aparece quando houver alguém no público.</p>
          ) : !itemVisto ? (
            <p className="text-sm text-muted-foreground">Montando a prévia…</p>
          ) : (
            <div className={cn('space-y-1.5 transition-opacity', previa.isPlaceholderData && 'opacity-60')}>
              <p className="text-xs text-muted-foreground">
                Para{' '}
                <span className="font-medium text-foreground">
                  {pessoas.find((p) => p.organization_id === itemVisto.organization_id)?.nome}
                </span>
                {assinatura === 'marca'
                  ? ' · em nome da Komune'
                  : itemVisto.assinante
                    ? ` · assinada por ${itemVisto.assinante}`
                    : null}
              </p>
              {itemVisto.ok ? (
                <div className="rounded-lg bg-primary/10 px-3 py-2 text-sm text-foreground">
                  <p className="whitespace-pre-wrap">{itemVisto.corpo}</p>
                </div>
              ) : (
                <p className="text-sm text-destructive">
                  {fraseDoMotivo(itemVisto.motivo)} {itemVisto.variavel ? `({{${itemVisto.variavel}}})` : null}
                </p>
              )}
            </div>
          )}
        </section>

        <section aria-labelledby="bloco-enviar" className="space-y-3 rounded-2xl border border-hairline bg-card p-4">
          <h2 id="bloco-enviar" className="sr-only">
            Enviar
          </h2>
          <p className="flex items-baseline gap-2">
            <span className="numerico text-3xl font-semibold">{vaoReceber}</span>
            <span className="text-sm text-muted-foreground">{vaoReceber === 1 ? 'vai receber' : 'vão receber'}</span>
          </p>
          <dl className="space-y-1 text-sm">
            <Linha
              rotulo="Duração"
              valor={duracaoEstimada(
                vaoReceber,
                porHora,
                tipo === 'modelo' && primeiros > 0 ? (teto.data?.teto ?? null) : null,
              )}
            />
            {custo !== null ? (
              <Linha rotulo="Custo na Meta" valor={custo === 0 ? 'grátis' : `≈ ${formatarReais(custo)}`} />
            ) : null}
          </dl>
          {teto.data ? (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              <span className="numerico">{teto.data.teto}</span> aberturas por dia ·{' '}
              <span className="numerico">{teto.data.usados}</span> usadas hoje ·{' '}
              {teto.data.quemManda === 'meta'
                ? `o teto é da Meta hoje${teto.data.qualidade ? ` — qualidade ${QUALIDADE_EM_PT[teto.data.qualidade] ?? teto.data.qualidade.toLowerCase()}` : ''}`
                : 'o teto é nosso (aquecimento)'}
              .
            </p>
          ) : null}
          {tetoSegura ? (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Hoje ainda cabem <span className="numerico">{tetoLivre}</span> aberturas: o resto sai nos
              próximos dias úteis. Toda conversa que a gente começa conta aqui, inclusive recontato — é como a
              Meta conta.
            </p>
          ) : null}

          <Campo rotulo="Nome da campanha" htmlFor="nome-da-campanha">
            <Input
              id="nome-da-campanha"
              value={nome}
              maxLength={120}
              onChange={(e) => setNomeEscrito(e.target.value)}
              placeholder="Ex.: Convite buffets — setembro"
              className="h-11 md:h-9"
            />
          </Campo>

          <div className="space-y-2">
            <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-0">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={agendar}
                onChange={(e) => setAgendar(e.target.checked)}
              />
              Agendar para outro horário
            </label>
            {agendar ? (
              <Input
                type="datetime-local"
                aria-label="Início da campanha"
                value={inicio}
                onChange={(e) => setInicio(e.target.value)}
                className="h-11 md:h-9"
              />
            ) : null}
          </div>

          <Button
            className="toque h-11 w-full"
            disabled={!podeEnviar || criar.isPending}
            onClick={() => criar.mutate()}
          >
            <Send aria-hidden="true" />
            {criar.isPending
              ? agendar
                ? 'Agendando…'
                : 'Enviando…'
              : `${agendar ? 'Agendar' : 'Enviar'} para ${vaoReceber}`}
          </Button>
          {falta ? <p className="text-xs leading-relaxed text-muted-foreground">{falta}</p> : null}
          <Button variant="ghost" className="toque h-11 w-full md:h-9" onClick={aoCancelar}>
            Cancelar
          </Button>
        </section>
      </aside>
    </div>
  );
}

/** Pílula de "qualquer um destes", no desenho das pílulas de seção do CRM (`ui/abas`). */
function Chip({
  ativo,
  dica,
  aoClicar,
  children,
}: {
  ativo: boolean;
  dica?: string;
  aoClicar: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      title={dica}
      onClick={aoClicar}
      className={cn(
        'toque flex h-11 items-center rounded-full border px-3.5 text-sm transition-colors md:h-8',
        'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
        ativo
          ? 'border-transparent bg-foreground text-background'
          : 'border-hairline text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function Campo({ rotulo, htmlFor, children }: { rotulo: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {rotulo}
      </label>
      {children}
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className="numerico text-right font-medium">{valor}</dd>
    </div>
  );
}

function EditorDeRegra({
  variavel,
  regra,
  aoMudar,
}: {
  variavel: string;
  regra: RegraDaVariavel;
  aoMudar: (r: RegraDaVariavel) => void;
}) {
  const fonte = 'fixo' in regra ? 'fixo' : regra.campo;
  const valor = 'fixo' in regra ? regra.fixo : regra.reserva;
  return (
    <div className="grid gap-2 rounded-lg border border-hairline p-2 sm:grid-cols-[7rem_12rem_minmax(0,1fr)] sm:items-center">
      <code className="text-sm font-medium">{`{{${variavel}}}`}</code>
      <Select
        value={fonte}
        onValueChange={(v) =>
          aoMudar(v === 'fixo' ? { fixo: valor } : { campo: v as (typeof CAMPOS_DA_FICHA)[number]['valor'], reserva: valor })
        }
      >
        <SelectTrigger className="toque h-11 md:h-8" aria-label={`De onde vem {{${variavel}}}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CAMPOS_DA_FICHA.map((c) => (
            <SelectItem key={c.valor} value={c.valor}>
              {c.rotulo}
            </SelectItem>
          ))}
          <SelectItem value="fixo">Texto fixo (igual para todos)</SelectItem>
        </SelectContent>
      </Select>
      <Input
        value={valor}
        maxLength={200}
        onChange={(e) => aoMudar('fixo' in regra ? { fixo: e.target.value } : { ...regra, reserva: e.target.value })}
        placeholder={'fixo' in regra ? 'O texto' : 'Se a ficha não tiver, usar…'}
        aria-label={'fixo' in regra ? `Texto de {{${variavel}}}` : `Reserva de {{${variavel}}}`}
        className="h-11 md:h-8"
      />
    </div>
  );
}

/** Os públicos salvos, a um clique. Sem nenhum salvo, não ocupa lugar. */
function PublicosSalvos({ aoUsar }: { aoUsar: (f: FiltroDoPublico) => void }) {
  const clientes = useQueryClient();
  const salvos = useQuery({ queryKey: ['envios', 'publicos'], queryFn: listarPublicosSalvos });
  const apagar = useMutation({
    mutationFn: apagarPublico,
    onSuccess: () => void clientes.invalidateQueries({ queryKey: ['envios', 'publicos'] }),
  });

  if ((salvos.data ?? []).length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Bookmark className="size-4 text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">Públicos salvos:</span>
      {(salvos.data ?? []).map((s) => (
        <span key={s.id} className="inline-flex items-center rounded-full border border-hairline">
          <button
            type="button"
            className="toque min-h-11 px-3 hover:text-primary md:min-h-7"
            onClick={() => aoUsar(s.filtro as FiltroDoPublico)}
          >
            {s.nome}
          </button>
          <button
            type="button"
            className="toque min-h-11 pr-2 text-muted-foreground hover:text-destructive md:min-h-7"
            aria-label={`Apagar o público ${s.nome}`}
            onClick={() => apagar.mutate(s.id)}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
          </button>
        </span>
      ))}
    </div>
  );
}

function SalvarPublico({ filtro }: { filtro: FiltroDoPublico }) {
  const clientes = useQueryClient();
  const [nomeNovo, setNomeNovo] = useState<string | null>(null);

  const salvar = useMutation({
    mutationFn: (nome: string) => salvarPublico(nome, filtro),
    onSuccess: () => {
      toast.success('Público salvo.');
      setNomeNovo(null);
      void clientes.invalidateQueries({ queryKey: ['envios', 'publicos'] });
    },
    onError: () => toast.error('O público não foi salvo.'),
  });

  if (nomeNovo === null) {
    return (
      <Button variant="ghost" size="sm" className="toque h-11 md:h-7" onClick={() => setNomeNovo('')}>
        <Bookmark aria-hidden="true" />
        Salvar estes filtros como público
      </Button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (nomeNovo.trim()) salvar.mutate(nomeNovo);
      }}
    >
      <Input
        autoFocus
        value={nomeNovo}
        maxLength={80}
        onChange={(e) => setNomeNovo(e.target.value)}
        placeholder="Nome do público"
        aria-label="Nome do público"
        className="h-11 w-48 bg-background md:h-7"
      />
      <Button type="submit" size="sm" className="toque h-11 md:h-7" disabled={!nomeNovo.trim()}>
        Salvar
      </Button>
      <Button type="button" variant="ghost" size="sm" className="toque h-11 md:h-7" onClick={() => setNomeNovo(null)}>
        Cancelar
      </Button>
    </form>
  );
}

const ROTULO_DA_SITUACAO: Record<string, string> = Object.fromEntries(
  SITUACOES.map((s) => [s.valor, s.rotulo]),
);

function ListaDoPublico({
  carregando,
  erro,
  pessoas,
  total,
  desmarcados,
  aoMarcar,
  aoMarcarTodas,
  escolhidas,
  podem,
  aoVerTodas,
}: {
  carregando: boolean;
  erro: string | null;
  pessoas: PessoaDoPublico[];
  total: number;
  desmarcados: Set<string>;
  aoMarcar: (id: string, marcado: boolean) => void;
  aoMarcarTodas: (marcar: boolean) => void;
  escolhidas: number;
  podem: number;
  aoVerTodas: () => void;
}) {
  if (erro) return <p className="text-sm text-destructive">{erro}</p>;
  if (carregando) return <p className="py-6 text-sm text-muted-foreground">Procurando…</p>;
  if (total === 0) return null;
  const foraDoAlcance = total - podem;
  return (
    <div className="overflow-hidden rounded-xl border border-hairline bg-background">
      <div className="flex flex-wrap items-center gap-3 border-b border-hairline px-3 py-2 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={escolhidas === podem && podem > 0}
            ref={(el) => {
              if (el) el.indeterminate = escolhidas > 0 && escolhidas < podem;
            }}
            onChange={(e) => aoMarcarTodas(e.target.checked)}
          />
          <span>
            <span className="numerico font-medium">{escolhidas}</span> de{' '}
            <span className="numerico">{podem}</span> marcadas
          </span>
        </label>
        {foraDoAlcance > 0 ? (
          <span className="text-muted-foreground">
            · <span className="numerico">{foraDoAlcance}</span> ficam de fora (motivo na linha)
          </span>
        ) : null}
      </div>
      <ul className="max-h-112 divide-y divide-hairline overflow-y-auto">
        {pessoas.map((p) => {
          const bloqueada = p.bloqueio !== null;
          return (
            <li key={p.organization_id}>
              <label
                className={cn(
                  'flex cursor-pointer items-start gap-3 px-3 py-2 text-sm hover:bg-muted/50',
                  bloqueada && 'cursor-not-allowed opacity-60',
                )}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-primary"
                  disabled={bloqueada}
                  checked={!bloqueada && !desmarcados.has(p.organization_id)}
                  onChange={(e) => aoMarcar(p.organization_id, e.target.checked)}
                />
                <span className="min-w-0 flex-1">
                  <span className={cn('font-medium', bloqueada && 'line-through')}>{p.nome}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[p.categoria, p.cidade, p.etapa, p.responsavel].filter(Boolean).join(' · ') || '—'}
                  </span>
                  {bloqueada ? (
                    <span className="block text-xs text-destructive">{fraseDoMotivo(p.bloqueio)}</span>
                  ) : null}
                </span>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  {ROTULO_DA_SITUACAO[p.situacao] ?? p.situacao}
                  {p.cadastrado_komune ? ' · na Komune' : ''}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {pessoas.length < total ? (
        <button type="button" onClick={aoVerTodas} className="w-full border-t border-hairline py-2 text-sm text-primary hover:bg-muted/50">
          Mostrar as {total} (a seleção já vale para todas)
        </button>
      ) : null}
    </div>
  );
}
