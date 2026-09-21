'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Bookmark, Search, Send, ShieldCheck, Trash2 } from 'lucide-react';
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
import type { Catalogos } from '@/components/parceiros/tipos';

import {
  apagarPublico,
  buscarModelos,
  buscarPrevia,
  buscarPublico,
  buscarTetoDeHoje,
  criarEnvio,
  ErroDoEnvio,
  listarPublicosSalvos,
  salvarPublico,
  type ConfigDoEnvio,
} from './dados';
import { CriarModelo } from './criar-modelo';
import { EscolhaMultipla } from './escolha-multipla';
import {
  acoesPara,
  duracaoEstimada,
  fraseDaRecusa,
  fraseDoMotivo,
  regrasIncompletas,
  regrasPara,
  variaveisComRegra,
} from './formatos';
import {
  CAMPOS_DA_FICHA,
  SITUACOES,
  TEMPERATURAS,
  TIPOS_DE_PARCEIRO,
  type AcaoDoBotao,
  type Assinatura,
  type FiltroDoPublico,
  type PessoaDoPublico,
  type RegraDaVariavel,
  type TipoDoEnvio,
} from './tipos';

/**
 * Montar um envio em massa, em três passos: para quem, o quê, como e quando.
 *
 * O passo 1 é o mais importante, e por isso vem primeiro e mostra as pessoas,
 * não só um número: quem manda para 120 precisa poder bater o olho e tirar os
 * três que não fazem sentido. Quem o banco não deixaria receber aparece
 * riscado, com o motivo — sumir com eles faria a pessoa achar que o filtro
 * errou.
 */

const PASSOS = [
  { n: 1, rotulo: 'Para quem' },
  { n: 2, rotulo: 'A mensagem' },
  { n: 3, rotulo: 'Como e quando' },
] as const;

const RITMOS = [5, 10, 15, 20, 30, 45, 60] as const;

/** Para onde vai quem toca no botão de link, se o envio não disser outro lugar. */
const DESTINO_PADRAO = 'https://admin.komune.app.br/seja-parceiro';

function temAtendente(corpo: string): boolean {
  return /\{\{\s*atendente\s*\}\}/.test(corpo);
}

/** Quantas linhas o passo 1 desenha de cada vez. A seleção vale para todas. */
const LINHAS_VISIVEIS = 150;

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
  const [passo, setPasso] = useState<1 | 2 | 3>(1);

  // ---------------- passo 1 ----------------
  const [filtro, setFiltro] = useState<FiltroDoPublico>({ situacoes: ['nunca_contatado'] });
  const filtroAdiado = useDeferredValue(filtro);
  const [desmarcados, setDesmarcados] = useState<Set<string>>(new Set());
  const [verTodas, setVerTodas] = useState(false);

  const publico = useQuery({
    queryKey: ['envios', 'publico', filtroAdiado],
    queryFn: () => buscarPublico(filtroAdiado),
  });
  const pessoas = useMemo(() => publico.data ?? [], [publico.data]);
  const podem = pessoas.filter((p) => p.bloqueio === null);
  const escolhidas = podem.filter((p) => !desmarcados.has(p.organization_id));

  function mudarFiltro(parcial: Partial<FiltroDoPublico>) {
    setFiltro((f) => ({ ...f, ...parcial }));
    setVerTodas(false);
  }

  // ---------------- passo 2 ----------------
  const [tipo, setTipo] = useState<TipoDoEnvio>('modelo');
  const [modeloId, setModeloId] = useState<number | null>(null);
  const [texto, setTexto] = useState('');
  const [regras, setRegras] = useState<Record<string, RegraDaVariavel>>({});
  const [acoesEditadas, setAcoesEditadas] = useState<Record<string, AcaoDoBotao>>({});
  const [linkDestino, setLinkDestino] = useState(DESTINO_PADRAO);

  const modelos = useQuery({ queryKey: ['envios', 'modelos'], queryFn: buscarModelos, staleTime: 60_000 });
  const modelo = modelos.data?.find((m) => m.id === modeloId) ?? null;
  const corpo = tipo === 'modelo' ? (modelo?.body ?? '') : texto;
  const variaveis = variaveisComRegra(corpo);
  const regrasDoCorpo = regrasPara(corpo, regras);
  const incompletas = regrasIncompletas(regrasDoCorpo);
  const botoes = tipo === 'modelo' ? (modelo?.botoes ?? []) : [];
  const acoes = acoesPara(botoes, acoesEditadas);
  const precisaDeLink =
    botoes.some((b) => b.tipo === 'link') || Object.values(acoes).some((a) => a.acao === 'link');
  const acoesIncompletas = Object.values(acoes).some(
    (a) => a.acao === 'link' && (a.texto.trim() === '' || a.botao.trim() === ''),
  );

  function mudarCorpo(novoTipo: TipoDoEnvio, novoModelo: number | null, novoTexto: string) {
    setTipo(novoTipo);
    setModeloId(novoModelo);
    setTexto(novoTexto);
    const novoCorpo =
      novoTipo === 'modelo' ? (modelos.data?.find((m) => m.id === novoModelo)?.body ?? '') : novoTexto;
    setRegras((r) => ({ ...r, ...regrasPara(novoCorpo, r) }));
  }

  // ---------------- passo 3 ----------------
  const [nome, setNome] = useState('');
  const [porHora, setPorHora] = useState(20);
  const [quando, setQuando] = useState<'agora' | 'depois'>('agora');
  const [inicio, setInicio] = useState('');
  const [assinatura, setAssinatura] = useState<Assinatura>('marca');
  const [atendentes, setAtendentes] = useState<string[]>([]);

  const teto = useQuery({ queryKey: ['envios', 'teto'], queryFn: buscarTetoDeHoje, staleTime: 60_000 });

  const config: ConfigDoEnvio = {
    nome,
    tipo,
    modeloId,
    texto,
    variaveis: regrasDoCorpo,
    assinatura,
    atendentes,
    porHora,
    inicio: quando === 'depois' && inicio ? new Date(inicio).toISOString() : null,
    filtro,
    linkDestino: precisaDeLink ? linkDestino : '',
    acoes,
  };

  // Em nome da marca ninguém assina: modelo com {{atendente}} não serve.
  const conflitoDeAssinatura = assinatura === 'marca' && temAtendente(corpo);
  const mensagemPronta =
    (tipo === 'modelo' ? modelo !== null : texto.trim().length > 0) &&
    incompletas.length === 0 &&
    !acoesIncompletas &&
    (!precisaDeLink || linkDestino.startsWith('https://'));

  const amostra = escolhidas.slice(0, 3).map((p) => p.organization_id);
  const previa = useQuery({
    queryKey: ['envios', 'previa', tipo, modeloId, texto, regrasDoCorpo, assinatura, atendentes, amostra],
    queryFn: () => buscarPrevia(config, amostra),
    enabled: passo >= 2 && mensagemPronta && amostra.length > 0,
  });

  const criar = useMutation({
    mutationFn: () => criarEnvio(config, escolhidas.map((p) => p.organization_id)),
    onSuccess: (r) => {
      toast.success('Envio criado.', {
        description: `${r.itens} mensagens na fila. O CRM manda aos poucos e para sozinho se muita gente bloquear.`,
      });
      void clientes.invalidateQueries({ queryKey: ['envios'] });
      aoCriar(r.id);
    },
    onError: (erro: Error) => {
      const e = erro instanceof ErroDoEnvio ? erro : null;
      toast.error('O envio não foi criado.', {
        description: e ? fraseDaRecusa(e.motivo, e.variavel) : erro.message,
      });
    },
  });

  // Quantos da seleção são primeiro contato (os que o teto do dia segura) e
  // quantos têm a janela de 24 h aberta (os únicos que recebem texto livre).
  const primeiros = escolhidas.filter((p) => p.situacao === 'nunca_contatado').length;
  const comJanela = escolhidas.filter((p) => p.situacao === 'janela_aberta').length;
  const vaoReceber = tipo === 'texto' ? comJanela : escolhidas.length;
  const tetoLivre = teto.data ? Math.max(teto.data.teto - teto.data.usados, 0) : null;

  const podeAvancar =
    passo === 1
      ? escolhidas.length > 0
      : passo === 2
        ? mensagemPronta
        : nome.trim().length > 0 && !conflitoDeAssinatura;

  return (
    <div className="space-y-4">
      {/* Os passos. Clicáveis para trás, nunca para a frente sem cumprir o anterior. */}
      <ol className="flex items-center gap-2 text-sm">
        {PASSOS.map((p) => (
          <li key={p.n} className="flex items-center gap-2">
            <button
              type="button"
              disabled={p.n > passo}
              onClick={() => setPasso(p.n)}
              className={cn(
                'flex items-center gap-2 rounded-full px-3 py-1.5 transition-colors',
                p.n === passo
                  ? 'bg-primary text-primary-foreground'
                  : p.n < passo
                    ? 'bg-primary/10 text-foreground hover:bg-primary/20'
                    : 'text-muted-foreground',
              )}
            >
              <span className="numerico font-medium">{p.n}</span>
              <span className="hidden sm:inline">{p.rotulo}</span>
            </button>
            {p.n < 3 ? <span className="h-px w-4 bg-hairline" aria-hidden="true" /> : null}
          </li>
        ))}
      </ol>

      {passo === 1 ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full md:w-64">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                type="search"
                placeholder="Nome contém…"
                value={filtro.busca ?? ''}
                onChange={(e) => mudarFiltro({ busca: e.target.value })}
                className="h-11 pl-9 md:h-8"
              />
            </div>
            <EscolhaMultipla
              rotulo="Situação"
              opcoes={SITUACOES}
              valor={filtro.situacoes ?? []}
              aoMudar={(v) => mudarFiltro({ situacoes: v })}
            />
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
                  mudarFiltro({ sem_contato_ha_dias: e.target.value === '' ? null : Number(e.target.value) })
                }
                className="numerico h-11 w-16 md:h-8"
              />
              dias
            </label>
          </div>

          <PublicosSalvos filtro={filtro} aoUsar={(f) => { setFiltro(f); setDesmarcados(new Set()); }} />

          <ListaDoPublico
            carregando={publico.isPending}
            erro={publico.isError ? (publico.error instanceof ErroDoEnvio ? fraseDaRecusa(publico.error.motivo) : 'Não deu para ler o público.') : null}
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
        </section>
      ) : null}

      {passo === 2 ? (
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="inline-flex rounded-lg bg-muted p-1 text-sm" role="tablist">
              {(
                [
                  ['modelo', 'Modelo aprovado'],
                  ['texto', 'Texto livre'],
                ] as const
              ).map(([valor, rotulo]) => (
                <button
                  key={valor}
                  type="button"
                  role="tab"
                  aria-selected={tipo === valor}
                  onClick={() => mudarCorpo(valor, modeloId, texto)}
                  className={cn(
                    'rounded-md px-3 py-1.5',
                    tipo === valor ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground',
                  )}
                >
                  {rotulo}
                </button>
              ))}
            </div>

            {tipo === 'modelo' ? (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground" htmlFor="modelo-do-envio">
                  Modelo (só os que a Meta aprovou)
                </label>
                <Select
                  value={modeloId === null ? '' : String(modeloId)}
                  onValueChange={(v) => mudarCorpo('modelo', Number(v), texto)}
                >
                  <SelectTrigger id="modelo-do-envio" className="toque h-11 w-full md:h-9">
                    <SelectValue placeholder={modelos.isPending ? 'Carregando…' : 'Escolha o modelo'} />
                  </SelectTrigger>
                  <SelectContent>
                    {(modelos.data ?? [])
                      .filter((m) => assinatura !== 'marca' || !temAtendente(m.body))
                      .map((m) => (
                        <SelectItem key={m.id} value={String(m.id)}>
                          {m.name}
                          {m.botoes.length > 0 ? ` · ${m.botoes.length} botão(ões)` : ''}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {modelo ? (
                  <div className="rounded-lg border border-hairline bg-card/60 px-3 py-2 text-sm">
                    <p className="whitespace-pre-wrap">{modelo.body}</p>
                    <ChipsDosBotoes botoes={botoes} />
                  </div>
                ) : null}
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {assinatura === 'marca'
                    ? 'Mostrando só os modelos em nome da Komune (sem nome de atendente).'
                    : 'Mostrando todos os modelos aprovados.'}
                </p>
                <CriarModelo />
              </div>
            ) : (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground" htmlFor="texto-do-envio">
                  Texto (use {'{{nome}}'}, {'{{empresa}}'}, {'{{categoria}}'}, {'{{cidade}}'} ou uma variável sua)
                </label>
                <textarea
                  id="texto-do-envio"
                  value={texto}
                  maxLength={1000}
                  rows={6}
                  onChange={(e) => mudarCorpo('texto', modeloId, e.target.value)}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  placeholder="Oi, {{nome}}! Passando para contar que…"
                />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Texto livre só chega a quem falou com a gente nas últimas 24 h
                  {pessoas.length > 0 ? (
                    <>
                      {' '}— <span className="numerico">{comJanela}</span> de{' '}
                      <span className="numerico">{escolhidas.length}</span> da sua seleção. Os outros
                      serão pulados.
                    </>
                  ) : '.'}{' '}
                  Sai assinado com o primeiro nome de quem envia.
                </p>
              </div>
            )}

            {Object.keys(acoes).length > 0 || precisaDeLink ? (
              <div className="space-y-2">
                <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  O que acontece em cada botão
                </h3>
                {Object.entries(acoes).map(([rotulo, acao]) => (
                  <EditorDeAcao
                    key={rotulo}
                    rotulo={rotulo}
                    acao={acao}
                    aoMudar={(a) => setAcoesEditadas((atual) => ({ ...atual, [rotulo]: a }))}
                  />
                ))}
                {precisaDeLink ? (
                  <div className="space-y-1">
                    <label htmlFor="destino-do-link" className="text-xs text-muted-foreground">
                      Para onde o link leva
                    </label>
                    <Input
                      id="destino-do-link"
                      value={linkDestino}
                      onChange={(e) => setLinkDestino(e.target.value)}
                      className="h-11 md:h-9"
                    />
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      O link passa pelo CRM, que conta o clique e marca a campanha (utm) antes de mandar
                      a pessoa para lá. O pixel da Meta no site mostra quem se cadastrou vindo deste envio.
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

            {variaveis.length > 0 ? (
              <div className="space-y-2">
                <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  De onde vem cada variável
                </h3>
                {variaveis.map((v) => (
                  <EditorDeRegra
                    key={v}
                    variavel={v}
                    regra={regrasDoCorpo[v] ?? { fixo: '' }}
                    aoMudar={(r) => setRegras((atual) => ({ ...atual, [v]: r }))}
                  />
                ))}
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {'{{atendente}}'} e {'{{saudacao}}'} são sempre automáticos: quem assina e bom
                  dia/boa tarde pelo relógio de Natal.
                </p>
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Como chega para as primeiras pessoas
            </h3>
            {!mensagemPronta ? (
              <p className="text-sm text-muted-foreground">
                {incompletas.length > 0
                  ? `Preencha o texto fixo de ${incompletas.map((v) => `{{${v}}}`).join(', ')}.`
                  : 'Escolha a mensagem para ver a prévia.'}
              </p>
            ) : previa.isPending ? (
              <p className="text-sm text-muted-foreground">Montando a prévia…</p>
            ) : (
              (previa.data?.itens ?? []).map((item) => {
                const pessoa = pessoas.find((p) => p.organization_id === item.organization_id);
                return (
                  <div key={item.organization_id} className="rounded-xl border border-hairline bg-card p-3">
                    <p className="mb-1 text-xs text-muted-foreground">
                      Para <span className="font-medium text-foreground">{pessoa?.nome}</span>
                      {assinatura === 'marca'
                        ? ' · em nome da Komune'
                        : item.assinante
                          ? ` · assinada por ${item.assinante}`
                          : null}
                    </p>
                    {item.ok ? (
                      <div className="rounded-lg bg-primary/10 px-3 py-2 text-sm text-foreground">
                        <p className="whitespace-pre-wrap">{item.corpo}</p>
                        <ChipsDosBotoes botoes={botoes} />
                      </div>
                    ) : (
                      <p className="text-sm text-destructive">
                        {fraseDoMotivo(item.motivo)} {item.variavel ? `({{${item.variavel}}})` : null}
                      </p>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>
      ) : null}

      {passo === 3 ? (
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <div className="space-y-4">
            <Campo rotulo="Nome do envio" htmlFor="nome-do-envio">
              <Input
                id="nome-do-envio"
                value={nome}
                maxLength={120}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Ex.: Abertura buffets de Natal — setembro"
                className="h-11 md:h-9"
              />
            </Campo>

            <Campo rotulo="Quando começa" htmlFor="quando">
              <div className="flex flex-wrap items-center gap-2">
                <Select value={quando} onValueChange={(v) => setQuando(v as 'agora' | 'depois')}>
                  <SelectTrigger id="quando" className="toque h-11 w-44 md:h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="agora">Agora</SelectItem>
                    <SelectItem value="depois">Em outro horário</SelectItem>
                  </SelectContent>
                </Select>
                {quando === 'depois' ? (
                  <Input
                    type="datetime-local"
                    value={inicio}
                    onChange={(e) => setInicio(e.target.value)}
                    className="h-11 w-56 md:h-9"
                  />
                ) : null}
              </div>
            </Campo>

            <Campo rotulo="Ritmo" htmlFor="ritmo">
              <Select value={String(porHora)} onValueChange={(v) => setPorHora(Number(v))}>
                <SelectTrigger id="ritmo" className="toque h-11 w-56 md:h-9">
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
                Cada mensagem sai num intervalo sorteado em volta do ritmo. Mais devagar parece gente;
                e dá tempo de o time responder quem responder.
              </p>
            </Campo>

            <Campo rotulo="Quem assina" htmlFor="assinatura">
              <Select value={assinatura} onValueChange={(v) => setAssinatura(v as Assinatura)}>
                <SelectTrigger id="assinatura" className="toque h-11 w-72 md:h-9">
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
              {conflitoDeAssinatura ? (
                <p className="text-[11px] leading-relaxed text-destructive">
                  O modelo escolhido diz o nome de quem envia. Em nome da Komune, volte e escolha um modelo
                  sem nome de atendente.
                </p>
              ) : (
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {assinatura === 'marca'
                    ? 'As respostas caem nas Conversas do responsável de cada parceiro (ou de quem montou o envio).'
                    : 'As respostas caem nas Conversas de quem assinou.'}
                </p>
              )}
            </Campo>
          </div>

          <aside className="space-y-3 rounded-2xl border border-hairline bg-card p-4">
            <h3 className="text-sm font-medium">Resumo</h3>
            <dl className="space-y-1.5 text-sm">
              <Linha rotulo="Vão receber" valor={`${vaoReceber} pessoas`} />
              <Linha rotulo="Primeiro contato" valor={`${tipo === 'texto' ? 0 : primeiros}`} />
              <Linha
                rotulo="Duração"
                valor={duracaoEstimada(vaoReceber, porHora, tipo === 'modelo' && primeiros > 0 ? (teto.data?.teto ?? null) : null)}
              />
              {tetoLivre !== null ? (
                <Linha rotulo="Teto de hoje" valor={`${tetoLivre} de ${teto.data?.teto} livres`} />
              ) : null}
            </dl>
            <div className="flex gap-2 rounded-lg bg-primary/10 p-3 text-[11px] leading-relaxed text-foreground">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>
                Proteções que não desligam: só de 8h às 17h45 em dia útil; ninguém que pediu para
                sair; ninguém que recebeu mensagem nossa sem responder nas últimas 72 h; teto de
                primeiros contatos do dia; e o envio para sozinho se 3 pessoas ou mais (acima de 2%)
                pedirem para sair.
              </p>
            </div>
          </aside>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-4">
        {passo > 1 ? (
          <Button variant="outline" className="toque h-11 md:h-9" onClick={() => setPasso((p) => (p - 1) as 1 | 2)}>
            <ArrowLeft aria-hidden="true" />
            Voltar
          </Button>
        ) : (
          <Button variant="ghost" className="toque h-11 md:h-9" onClick={aoCancelar}>
            Cancelar
          </Button>
        )}
        {passo < 3 ? (
          <Button className="toque h-11 md:h-9" disabled={!podeAvancar} onClick={() => setPasso((p) => (p + 1) as 2 | 3)}>
            Continuar
            <ArrowRight aria-hidden="true" />
          </Button>
        ) : (
          <Button className="toque h-11 md:h-9" disabled={!podeAvancar || criar.isPending} onClick={() => criar.mutate()}>
            <Send aria-hidden="true" />
            {criar.isPending ? 'Criando…' : `Criar envio para ${escolhidas.length}`}
          </Button>
        )}
        <span className="text-sm text-muted-foreground">
          <span className="numerico">{escolhidas.length}</span> selecionadas
        </span>
      </div>
    </div>
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

function PublicosSalvos({
  filtro,
  aoUsar,
}: {
  filtro: FiltroDoPublico;
  aoUsar: (f: FiltroDoPublico) => void;
}) {
  const clientes = useQueryClient();
  const salvos = useQuery({ queryKey: ['envios', 'publicos'], queryFn: listarPublicosSalvos });
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
  const apagar = useMutation({
    mutationFn: apagarPublico,
    onSuccess: () => void clientes.invalidateQueries({ queryKey: ['envios', 'publicos'] }),
  });

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Bookmark className="size-4 text-muted-foreground" aria-hidden="true" />
      {(salvos.data ?? []).map((s) => (
        <span key={s.id} className="inline-flex items-center rounded-full border border-hairline">
          <button type="button" className="px-3 py-1 hover:text-primary" onClick={() => aoUsar(s.filtro as FiltroDoPublico)}>
            {s.nome}
          </button>
          <button
            type="button"
            className="pr-2 text-muted-foreground hover:text-destructive"
            aria-label={`Apagar o público ${s.nome}`}
            onClick={() => apagar.mutate(s.id)}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
          </button>
        </span>
      ))}
      {nomeNovo === null ? (
        <Button variant="ghost" size="sm" className="toque h-11 md:h-7" onClick={() => setNomeNovo('')}>
          Salvar este público
        </Button>
      ) : (
        <form
          className="flex items-center gap-2"
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
            className="h-11 w-48 md:h-7"
          />
          <Button type="submit" size="sm" className="toque h-11 md:h-7" disabled={!nomeNovo.trim()}>
            Salvar
          </Button>
          <Button type="button" variant="ghost" size="sm" className="toque h-11 md:h-7" onClick={() => setNomeNovo(null)}>
            Cancelar
          </Button>
        </form>
      )}
    </div>
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
  if (total === 0) {
    return (
      <p className="rounded-xl border border-dashed border-hairline py-8 text-center text-sm text-muted-foreground">
        Ninguém com WhatsApp neste recorte. Afrouxe um filtro.
      </p>
    );
  }
  const foraDoAlcance = total - podem;
  return (
    <div className="overflow-hidden rounded-xl border border-hairline bg-card">
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

function ChipsDosBotoes({ botoes }: { botoes: readonly { tipo: string; texto: string }[] }) {
  if (botoes.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-1 border-t border-hairline pt-2">
      {botoes.map((b) => (
        <span
          key={b.texto}
          className="rounded-md bg-background/70 px-2 py-1 text-center text-xs font-medium text-primary"
        >
          {b.tipo === 'link' ? '↗ ' : ''}
          {b.texto}
        </span>
      ))}
    </div>
  );
}

function EditorDeAcao({
  rotulo,
  acao,
  aoMudar,
}: {
  rotulo: string;
  acao: AcaoDoBotao;
  aoMudar: (a: AcaoDoBotao) => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-hairline p-2">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_14rem] sm:items-center">
        <span className="text-sm">
          Quem tocar em <span className="font-medium">“{rotulo}”</span>
        </span>
        <Select
          value={acao.acao}
          onValueChange={(v) =>
            aoMudar(
              v === 'link'
                ? {
                    acao: 'link',
                    texto: 'Que bom! O cadastro leva 5 minutos e é grátis. É só tocar no botão abaixo.',
                    botao: 'Criar meu perfil',
                  }
                : { acao: v as 'sair' | 'nada' },
            )
          }
        >
          <SelectTrigger className="toque h-11 md:h-8" aria-label={`O que acontece em “${rotulo}”`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="link">recebe o link na hora</SelectItem>
            <SelectItem value="sair">sai da lista (não recebe mais)</SelectItem>
            <SelectItem value="nada">fica na caixa para o time responder</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {acao.acao === 'link' ? (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <textarea
            value={acao.texto}
            maxLength={900}
            rows={2}
            onChange={(e) => aoMudar({ ...acao, texto: e.target.value })}
            aria-label={`Texto que vai com o link em “${rotulo}”`}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
          <Input
            value={acao.botao}
            maxLength={20}
            onChange={(e) => aoMudar({ ...acao, botao: e.target.value })}
            aria-label={`Rótulo do botão do link em “${rotulo}”`}
            className="h-11 md:h-9"
          />
        </div>
      ) : null}
    </div>
  );
}
