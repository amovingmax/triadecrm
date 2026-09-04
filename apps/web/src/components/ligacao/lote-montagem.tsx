'use client';

/**
 * Montar o lote de hoje (R13 §3.1).
 *
 * ---------------------------------------------------------------------------
 * A tela é de MONTAR, não de ligar
 * ---------------------------------------------------------------------------
 * São dois momentos com propósitos opostos, e misturá-los é o que faz o operador
 * escolher para quem ligar — exatamente o que o R13 §3.1 proíbe. Aqui se pensa uma
 * vez, de manhã: qual funil, qual origem de temperatura, qual roteiro. Depois disso a
 * tela de ligar não tem busca, não tem lista e não tem "escolher outro".
 *
 * O caminho curto tem quatro toques — funil, temperatura, montar, e o nome que já vem
 * escrito. Tamanho, ordem, tentativas, meta e período moram atrás de "Ajustar", e
 * ninguém precisa abrir.
 *
 * ---------------------------------------------------------------------------
 * A regra dura: um lote não mistura temperaturas
 * ---------------------------------------------------------------------------
 * A temperatura é uma LISTA nesta tela, e não um botão de rádio, de propósito. Um
 * rádio tornaria a mistura impossível e a regra invisível; quem nunca puder errar
 * nunca vai saber por que a regra existe. Aqui a pessoa consegue marcar duas — e a
 * tela mostra o que aconteceria, escreve o motivo (a conversão do lote vira uma média
 * sem significado) e não deixa montar até sobrar uma, oferecendo o atalho de ficar com
 * uma delas.
 *
 * ---------------------------------------------------------------------------
 * O resumo é do banco, não da prévia
 * ---------------------------------------------------------------------------
 * A prévia estima; a montagem reserva. Entre um clique e o outro a Heloísa pode ter
 * montado o lote dela e levado três buffets. Por isso o que aparece depois de montar é
 * o retorno de `montar_lote` — "25 pedidos, 18 entraram" com os motivos —, e não o
 * número que estava na tela um segundo antes.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, PhoneOutgoing, SlidersHorizontal, TriangleAlert } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { traduzirFalha } from '@/components/funis/acoes/erros';
import { ChipTemperatura } from '@/components/temperatura';

import {
  CHAVE_FUNIS_DE_LIGACAO,
  CHAVE_LOTES,
  CHAVE_ROTEIROS,
  carregarBaseDaMontagem,
  carregarFunisDeLigacao,
  carregarRoteirosPublicados,
  chaveDaBase,
  exclusoesEmFrases,
  mensagemDaRecusaDaMontagem,
  montarLote,
  type FunilDeLigacao,
  type ResultadoDaMontagem,
} from './consultas';
import {
  EsqueletoDaPrevia,
  LENTE_LIMPA,
  PainelDaPrevia,
  TEMPERATURAS_DE_ORIGEM,
  calcularPrevia,
  lenteEstaLimpa,
  type LenteDaBase,
  type TemperaturaDeOrigem,
} from './lote-previa';
import {
  HORAS_ENTRE_TENTATIVAS,
  MAX_TENTATIVAS,
  ROTULOS_ORDEM,
  TAMANHO_MAXIMO_DO_LOTE,
  TAMANHO_PADRAO_DO_LOTE,
  type OrdemDaFila,
} from './tipos';

const FUSO = 'America/Fortaleza';

/** Hoje, como dia civil de Fortaleza (`YYYY-MM-DD`). O lote é um turno, não um instante. */
function hojeEmFortaleza(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(new Date());
}

function diaDaSemanaPorExtenso(): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, weekday: 'long' }).format(new Date());
}

const ROTULO_TEMPERATURA: Record<TemperaturaDeOrigem, string> = {
  frio: 'frios',
  morno: 'mornos',
  quente: 'quentes',
};

/**
 * O nome que já vem escrito. "Buffets frios — quinta" é o exemplo do R13, e nomear o
 * lote é o que faz a lista de amanhã ser legível — mas digitar um nome não pode ser o
 * primeiro obstáculo do dia. Quem quiser troca; quem não quiser não perde um toque.
 */
function nomeSugerido(funil: FunilDeLigacao | null, temperaturas: TemperaturaDeOrigem[]): string {
  const base = funil ? funil.nome.replace(/^Captação de /i, '') : 'Parceiros';
  const calor = temperaturas.length === 1 ? ` ${ROTULO_TEMPERATURA[temperaturas[0]!]}` : '';
  return `${base[0]?.toUpperCase()}${base.slice(1)}${calor} — ${diaDaSemanaPorExtenso().replace('-feira', '')}`;
}

// ---------------------------------------------------------------------------
// Blocos pequenos
// ---------------------------------------------------------------------------

function Bloco({
  rotulo,
  dica,
  children,
}: {
  rotulo: string;
  dica?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">{rotulo}</legend>
      {dica ? <p className="-mt-1 text-xs text-muted-foreground">{dica}</p> : null}
      {children}
    </fieldset>
  );
}

function Pastilha({
  ativa,
  aoAlternar,
  children,
  className,
}: {
  ativa: boolean;
  aoAlternar: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativa}
      onClick={aoAlternar}
      className={cn(
        // `min-h` e não `h`: o nome de categoria mais longo da base ("Locais: salões,
        // chácaras, hotéis, restaurantes, praia") quebra em duas linhas dentro de
        // 390px, e altura fixa cortaria a segunda. `text-left` porque o padrão do
        // <button> é centralizar, e rótulo de filtro centralizado em duas linhas
        // parece título, não opção.
        'toque inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 py-2 text-left text-sm font-medium transition-colors md:min-h-9',
        ativa
          ? 'border-foreground/25 bg-muted text-foreground'
          : 'border-input text-muted-foreground hover:bg-muted/60 hover:text-foreground',
        className,
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// A folha
// ---------------------------------------------------------------------------

export function FolhaDeMontagem({ aberta, aoFechar }: { aberta: boolean; aoFechar: () => void }) {
  return (
    <Sheet open={aberta} onOpenChange={(estado) => (estado ? undefined : aoFechar())}>
      <SheetContent
        side="right"
        className="data-[side=right]:w-full data-[side=right]:sm:max-w-4xl"
      >
        <SheetHeader className="gap-1">
          <SheetTitle className="font-heading text-lg">Montar lote de hoje</SheetTitle>
          <SheetDescription>
            Um funil, uma origem de temperatura, um roteiro. Depois disso é só ligar.
          </SheetDescription>
        </SheetHeader>
        <FormularioDeMontagem aoFechar={aoFechar} />
      </SheetContent>
    </Sheet>
  );
}

function FormularioDeMontagem({ aoFechar }: { aoFechar: () => void }) {
  const cliente = useQueryClient();

  const funis = useQuery({
    queryKey: CHAVE_FUNIS_DE_LIGACAO,
    queryFn: carregarFunisDeLigacao,
    staleTime: 60 * 60_000,
  });
  const roteiros = useQuery({
    queryKey: CHAVE_ROTEIROS,
    queryFn: carregarRoteirosPublicados,
    staleTime: 60 * 60_000,
  });

  const [funilEscolhido, setFunilEscolhido] = useState<number | null>(null);
  const [temperaturas, setTemperaturas] = useState<TemperaturaDeOrigem[]>(['frio']);
  const [categoriaIds, setCategoriaIds] = useState<number[]>([]);
  const [nome, setNome] = useState('');
  const [nomeEditado, setNomeEditado] = useState(false);
  const [roteiroEscolhido, setRoteiroEscolhido] = useState<string | null>(null);
  const [ordem, setOrdem] = useState<OrdemDaFila>('prioridade');
  const [tamanho, setTamanho] = useState(TAMANHO_PADRAO_DO_LOTE);
  const [maxTentativas, setMaxTentativas] = useState(MAX_TENTATIVAS);
  const [horasEntreTentativas, setHorasEntreTentativas] = useState(HORAS_ENTRE_TENTATIVAS);
  const [metaLigacoes, setMetaLigacoes] = useState<number | null>(null);
  const [iniciaEm, setIniciaEm] = useState(hojeEmFortaleza);
  const [terminaEm, setTerminaEm] = useState(hojeEmFortaleza);
  const [lente, setLente] = useState<LenteDaBase>(LENTE_LIMPA);
  const [abriuAjustes, setAbriuAjustes] = useState(false);
  const [abriuLente, setAbriuLente] = useState(false);
  const [resumo, setResumo] = useState<Extract<ResultadoDaMontagem, { montado: true }> | null>(
    null,
  );
  const [recusa, setRecusa] = useState<string | null>(null);

  // O primeiro funil e o primeiro roteiro entram sozinhos: são dois toques que a
  // pessoa daria em 100% das vezes, e a base tem um roteiro publicado só. A escolha
  // é DERIVADA, não copiada para o estado num efeito: escrever o padrão em `useState`
  // depois que a consulta chega é uma renderização em cascata e um estado que já
  // nasce podendo divergir da lista que o servidor mandou.
  const pipelineId = funilEscolhido ?? funis.data?.[0]?.id ?? null;
  const roteiroId = roteiroEscolhido ?? roteiros.data?.[0]?.id ?? null;

  const funilAtual = useMemo(
    () => (funis.data ?? []).find((f) => f.id === pipelineId) ?? null,
    [funis.data, pipelineId],
  );

  const base = useQuery({
    queryKey: chaveDaBase(pipelineId),
    queryFn: () => carregarBaseDaMontagem(pipelineId ?? 0),
    enabled: pipelineId !== null,
  });

  const previa = useMemo(
    () =>
      calcularPrevia(base.data?.candidatos ?? [], { temperaturas, categoriaIds }, lente, tamanho),
    [base.data, temperaturas, categoriaIds, lente, tamanho],
  );

  const nomeFinal = nomeEditado ? nome : nomeSugerido(funilAtual, temperaturas);

  const montagem = useMutation({
    mutationFn: montarLote,
    onSuccess: (resultado) => {
      if (resultado.montado) {
        setResumo(resultado);
        setRecusa(null);
        void cliente.invalidateQueries({ queryKey: CHAVE_LOTES });
        void cliente.invalidateQueries({ queryKey: chaveDaBase(pipelineId) });
      } else {
        setRecusa(mensagemDaRecusaDaMontagem(resultado.motivo));
      }
    },
  });

  const misturaTemperatura = temperaturas.length > 1;
  const semTemperatura = temperaturas.length === 0;
  const impedimento = semTemperatura
    ? 'Escolha a origem de temperatura do lote.'
    : misturaTemperatura
      ? 'Um lote não mistura temperaturas.'
      : !funilAtual
        ? 'Escolha o funil.'
        : !roteiroId
          ? 'Escolha o roteiro.'
          : nomeFinal.trim().length === 0
            ? 'Dê um nome ao lote.'
            : previa.elegiveis === 0 && !base.isPending
              ? 'Ninguém desse recorte pode entrar hoje. Troque a temperatura, tire uma categoria ou encerre um lote para devolver contatos à base.'
              : null;

  // Já montou: a folha vira recibo. Mostrar o formulário de novo convidaria a montar
  // um segundo lote por engano, e um lote a mais é uma reserva a mais em cima da base.
  if (resumo) {
    return (
      <ReciboDaMontagem
        resumo={resumo}
        aoFechar={() => {
          setResumo(null);
          aoFechar();
        }}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Duas colunas no desktop com a prévia grudada no topo: o número que muda é o
          motivo de mexer no filtro, e ele não pode sair da tela quando a lista de
          categorias empurra a página. No celular vira uma coluna só, e a ordem é a
          da decisão: recorte, prévia, ajustes. */}
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 pb-4">
        <div className="grid items-start gap-5 md:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex min-w-0 flex-col gap-5 md:col-start-1 md:row-start-1">
            <Bloco rotulo="Funil" dica="Um lote não mistura funis: funil único é roteiro único.">
              <div className="flex flex-wrap gap-2">
                {(funis.data ?? []).map((funil) => (
                  <Pastilha
                    key={funil.id}
                    ativa={funil.id === pipelineId}
                    aoAlternar={() => {
                      setFunilEscolhido(funil.id);
                      setCategoriaIds([]);
                      setLente(LENTE_LIMPA);
                    }}
                  >
                    {funil.nome}
                  </Pastilha>
                ))}
                {funis.isPending ? (
                  <p className="text-sm text-muted-foreground">Carregando os funis...</p>
                ) : null}
              </div>
            </Bloco>

            <Bloco
              rotulo="Origem de temperatura"
              dica="Todo mundo do lote entra com esta temperatura."
            >
              <div className="flex flex-wrap gap-2">
                {TEMPERATURAS_DE_ORIGEM.map((temperatura) => {
                  const quantos = (base.data?.candidatos ?? []).filter(
                    (c) => c.temperatura === temperatura && c.motivo === null,
                  ).length;
                  return (
                    <Pastilha
                      key={temperatura}
                      ativa={temperaturas.includes(temperatura)}
                      aoAlternar={() =>
                        setTemperaturas((atuais) =>
                          atuais.includes(temperatura)
                            ? atuais.filter((t) => t !== temperatura)
                            : [...atuais, temperatura],
                        )
                      }
                    >
                      <ChipTemperatura temperatura={temperatura} comDescricao={false} />
                      <span className="numerico text-xs text-muted-foreground">{quantos}</span>
                    </Pastilha>
                  );
                })}
              </div>
            </Bloco>

            {misturaTemperatura ? (
              <AvisoDaMistura
                temperaturas={temperaturas}
                aoFicarCom={(temperatura) => setTemperaturas([temperatura])}
              />
            ) : null}

            <Bloco
              rotulo="Categorias"
              dica={
                categoriaIds.length === 0
                  ? 'Sem escolha nenhuma, entram todas as categorias do funil.'
                  : `${categoriaIds.length} escolhidas.`
              }
            >
              {/* O teto de altura só existe no desktop, onde a prévia fica ao lado e não
              pode ser empurrada para fora da tela por 16 categorias. No celular a
              lista corre com a página: rolagem dentro de rolagem corta chip no meio. */}
              <div className="flex flex-wrap gap-2 md:max-h-44 md:overflow-y-auto">
                {(base.data?.categorias ?? []).map((categoria) => (
                  <Pastilha
                    key={categoria.id}
                    ativa={categoriaIds.includes(categoria.id)}
                    aoAlternar={() =>
                      setCategoriaIds((atuais) =>
                        atuais.includes(categoria.id)
                          ? atuais.filter((id) => id !== categoria.id)
                          : [...atuais, categoria.id],
                      )
                    }
                  >
                    {categoria.nome}
                    <span className="numerico text-xs text-muted-foreground">
                      {categoria.quantos}
                    </span>
                  </Pastilha>
                ))}
                {base.isPending ? (
                  <p className="text-sm text-muted-foreground">Lendo a base...</p>
                ) : null}
                {!base.isPending && (base.data?.categorias ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Esta base não tem categoria preenchida. O lote sai com o funil inteiro.
                  </p>
                ) : null}
              </div>
            </Bloco>
          </div>

          <div className="min-w-0 md:sticky md:top-0 md:col-start-2 md:row-span-2 md:row-start-1">
            {base.isPending ? (
              <EsqueletoDaPrevia />
            ) : base.isError ? (
              <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                {traduzirFalha(base.error).titulo} {traduzirFalha(base.error).saida}
              </p>
            ) : (
              <PainelDaPrevia
                previa={previa}
                tamanho={tamanho}
                lenteLigada={!lenteEstaLimpa(lente)}
              />
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-5 md:col-start-1 md:row-start-2">
            <Sanfona
              rotulo="Ler a base por bairro, telefone e tempo parado"
              aberta={abriuLente}
              aoAlternar={() => setAbriuLente((v) => !v)}
            >
              <LenteDaBaseCampos
                lente={lente}
                aoMudar={setLente}
                cidades={base.data?.cidades ?? []}
                bairros={base.data?.bairros ?? []}
              />
            </Sanfona>

            <Sanfona
              rotulo="Ajustar nome, tamanho, ordem e roteiro"
              aberta={abriuAjustes}
              aoAlternar={() => setAbriuAjustes((v) => !v)}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <Label htmlFor="lote-nome">Nome do lote</Label>
                  <Input
                    id="lote-nome"
                    value={nomeFinal}
                    maxLength={60}
                    onChange={(e) => {
                      setNomeEditado(true);
                      setNome(e.target.value);
                    }}
                    className="h-11 md:h-9"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="lote-tamanho">Quantos contatos</Label>
                  <Input
                    id="lote-tamanho"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={TAMANHO_MAXIMO_DO_LOTE}
                    value={tamanho}
                    onChange={(e) =>
                      setTamanho(faixa(e.target.value, 1, TAMANHO_MAXIMO_DO_LOTE, 1))
                    }
                    className="numerico h-11 md:h-9"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="lote-ordem">Ordem da fila</Label>
                  <Select value={ordem} onValueChange={(v) => setOrdem(v as OrdemDaFila)}>
                    <SelectTrigger id="lote-ordem" className="h-11 w-full md:h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(ROTULOS_ORDEM).map(([valor, rotulo]) => (
                        <SelectItem key={valor} value={valor}>
                          {rotulo}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="lote-roteiro">Roteiro</Label>
                  <Select value={roteiroId ?? ''} onValueChange={setRoteiroEscolhido}>
                    <SelectTrigger id="lote-roteiro" className="h-11 w-full md:h-9">
                      <SelectValue placeholder="Escolha o roteiro" />
                    </SelectTrigger>
                    <SelectContent>
                      {(roteiros.data ?? []).map((roteiro) => (
                        <SelectItem key={roteiro.id} value={roteiro.id}>
                          {roteiro.nome} (v{roteiro.versao})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="lote-tentativas">Tentativas por número</Label>
                  <Input
                    id="lote-tentativas"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={5}
                    value={maxTentativas}
                    onChange={(e) => setMaxTentativas(faixa(e.target.value, 1, 5, MAX_TENTATIVAS))}
                    className="numerico h-11 md:h-9"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="lote-horas">Horas entre duas tentativas</Label>
                  <Input
                    id="lote-horas"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={168}
                    value={horasEntreTentativas}
                    onChange={(e) =>
                      setHorasEntreTentativas(faixa(e.target.value, 1, 168, HORAS_ENTRE_TENTATIVAS))
                    }
                    className="numerico h-11 md:h-9"
                  />
                  <p className="text-xs text-muted-foreground">
                    20 horas jogam a segunda tentativa para outro período do dia — é o que muda a
                    taxa de atendimento.
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="lote-meta">Meta de ligações (opcional)</Label>
                  <Input
                    id="lote-meta"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={metaLigacoes ?? ''}
                    placeholder="sem meta"
                    onChange={(e) =>
                      setMetaLigacoes(
                        e.target.value === '' ? null : faixa(e.target.value, 1, 999, 1),
                      )
                    }
                    className="numerico h-11 md:h-9"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="lote-inicio">Vale a partir de</Label>
                  <Input
                    id="lote-inicio"
                    type="date"
                    value={iniciaEm}
                    onChange={(e) => {
                      setIniciaEm(e.target.value);
                      if (e.target.value > terminaEm) setTerminaEm(e.target.value);
                    }}
                    className="numerico h-11 md:h-9"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="lote-fim">Vale até</Label>
                  <Input
                    id="lote-fim"
                    type="date"
                    min={iniciaEm}
                    value={terminaEm}
                    onChange={(e) => setTerminaEm(e.target.value)}
                    className="numerico h-11 md:h-9"
                  />
                  <p className="text-xs text-muted-foreground">
                    Fora do período o lote não entrega contato e as reservas caem.
                  </p>
                </div>
              </div>
            </Sanfona>
          </div>
        </div>
      </div>

      <footer className="flex flex-col gap-2 border-t bg-popover px-4 pt-3 pb-4">
        {recusa ? (
          <p className="flex items-start gap-2 text-sm text-destructive-texto">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {recusa}
          </p>
        ) : null}
        {montagem.isError ? (
          <p className="flex items-start gap-2 text-sm text-destructive-texto">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {traduzirFalha(montagem.error).titulo} {traduzirFalha(montagem.error).saida}
          </p>
        ) : null}
        {impedimento ? <p className="text-sm text-muted-foreground">{impedimento}</p> : null}

        <div className="flex items-center gap-2">
          <Button
            className="toque h-12 flex-1 md:h-10"
            disabled={impedimento !== null || montagem.isPending || base.isPending}
            onClick={() => {
              if (!funilAtual || !roteiroId || temperaturas.length !== 1) return;
              setRecusa(null);
              montagem.mutate({
                nome: nomeFinal.trim(),
                pipelineId: funilAtual.id,
                temperaturaOrigem: temperaturas[0]!,
                categoriaIds,
                roteiroId,
                ordem,
                tamanho,
                maxTentativas,
                horasEntreTentativas,
                metaLigacoes,
                iniciaEm,
                terminaEm,
              });
            }}
          >
            <PhoneOutgoing aria-hidden="true" />
            {montagem.isPending ? 'Montando...' : `Montar ${previa.entram || tamanho}`}
          </Button>
          <Button variant="ghost" className="toque h-12 md:h-10" onClick={aoFechar}>
            Cancelar
          </Button>
        </div>
      </footer>
    </div>
  );
}

function faixa(valor: string, minimo: number, maximo: number, padrao: number): number {
  const numero = Number.parseInt(valor, 10);
  if (Number.isNaN(numero)) return padrao;
  return Math.min(maximo, Math.max(minimo, numero));
}

// ---------------------------------------------------------------------------
// A regra dura, escrita na tela
// ---------------------------------------------------------------------------

function AvisoDaMistura({
  temperaturas,
  aoFicarCom,
}: {
  temperaturas: TemperaturaDeOrigem[];
  aoFicarCom: (temperatura: TemperaturaDeOrigem) => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4"
    >
      <p className="flex items-center gap-2 font-medium text-destructive-texto">
        <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
        Um lote não mistura temperaturas.
      </p>
      <p className="text-sm text-foreground/90">
        Você marcou {listar(temperaturas.map((t) => ROTULO_TEMPERATURA[t]))}. Se os dois grupos
        entrarem no mesmo lote, a conversão dele vira uma média sem significado: os quentes carregam
        os frios e ninguém consegue dizer se foi o roteiro que funcionou ou se a base já era boa. É
        por isso que a origem de temperatura é campo do lote, e não filtro.
      </p>
      <p className="text-sm text-foreground/90">
        Escolha uma agora e monte o outro lote em seguida — aí sim os dois números comparam.
      </p>
      <div className="flex flex-wrap gap-2">
        {temperaturas.map((temperatura) => (
          <Button
            key={temperatura}
            variant="outline"
            className="toque h-11 md:h-9"
            onClick={() => aoFicarCom(temperatura)}
          >
            Ficar só com {ROTULO_TEMPERATURA[temperatura]}
          </Button>
        ))}
      </div>
    </div>
  );
}

function listar(itens: string[]): string {
  if (itens.length <= 1) return itens[0] ?? '';
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Sanfona, lente e recibo
// ---------------------------------------------------------------------------

function Sanfona({
  rotulo,
  aberta,
  aoAlternar,
  children,
}: {
  rotulo: string;
  aberta: boolean;
  aoAlternar: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border">
      <button
        type="button"
        onClick={aoAlternar}
        aria-expanded={aberta}
        className="toque flex min-h-12 w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm font-medium md:min-h-11"
      >
        <span className="flex items-center gap-2">
          <SlidersHorizontal aria-hidden="true" className="size-4 text-muted-foreground" />
          {rotulo}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'size-4 text-muted-foreground transition-transform',
            aberta && 'rotate-180',
          )}
        />
      </button>
      {aberta ? <div className="border-t p-4">{children}</div> : null}
    </div>
  );
}

function LenteDaBaseCampos({
  lente,
  aoMudar,
  cidades,
  bairros,
}: {
  lente: LenteDaBase;
  aoMudar: (lente: LenteDaBase) => void;
  cidades: readonly string[];
  bairros: readonly string[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        Isto é leitura, não recorte: muda a prévia que você está vendo, não o lote que o banco vai
        reservar.
      </p>

      {cidades.length > 1 ? (
        <Bloco rotulo="Cidade">
          <div className="flex flex-wrap gap-2">
            {cidades.map((cidade) => (
              <Pastilha
                key={cidade}
                ativa={lente.cidades.includes(cidade)}
                aoAlternar={() =>
                  aoMudar({
                    ...lente,
                    cidades: lente.cidades.includes(cidade)
                      ? lente.cidades.filter((c) => c !== cidade)
                      : [...lente.cidades, cidade],
                  })
                }
              >
                {cidade}
              </Pastilha>
            ))}
          </div>
        </Bloco>
      ) : null}

      {bairros.length > 0 ? (
        <Bloco rotulo="Bairro">
          <div className="flex flex-wrap gap-2 md:max-h-40 md:overflow-y-auto">
            {bairros.map((bairro) => (
              <Pastilha
                key={bairro}
                ativa={lente.bairros.includes(bairro)}
                aoAlternar={() =>
                  aoMudar({
                    ...lente,
                    bairros: lente.bairros.includes(bairro)
                      ? lente.bairros.filter((b) => b !== bairro)
                      : [...lente.bairros, bairro],
                  })
                }
              >
                {bairro}
              </Pastilha>
            ))}
          </div>
        </Bloco>
      ) : null}

      <Bloco rotulo="Telefone">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['todos', 'Tanto faz'],
              ['com', 'Só com telefone'],
              ['sem', 'Só sem telefone'],
            ] as const
          ).map(([valor, rotulo]) => (
            <Pastilha
              key={valor}
              ativa={lente.telefone === valor}
              aoAlternar={() => aoMudar({ ...lente, telefone: valor })}
            >
              {rotulo}
            </Pastilha>
          ))}
        </div>
      </Bloco>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lente-tentativas">Já tentei no máximo</Label>
          <Input
            id="lente-tentativas"
            type="number"
            inputMode="numeric"
            min={0}
            max={9}
            placeholder="tanto faz"
            value={lente.tentativasAte ?? ''}
            onChange={(e) =>
              aoMudar({
                ...lente,
                tentativasAte: e.target.value === '' ? null : faixa(e.target.value, 0, 9, 0),
              })
            }
            className="numerico h-11 md:h-9"
          />
          <p className="text-xs text-muted-foreground">Tentativas somadas de lotes anteriores.</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lente-parado">Sem contato há pelo menos</Label>
          <Input
            id="lente-parado"
            type="number"
            inputMode="numeric"
            min={0}
            max={999}
            placeholder="tanto faz"
            value={lente.paradoHaDias ?? ''}
            onChange={(e) =>
              aoMudar({
                ...lente,
                paradoHaDias: e.target.value === '' ? null : faixa(e.target.value, 0, 999, 0),
              })
            }
            className="numerico h-11 md:h-9"
          />
          <p className="text-xs text-muted-foreground">
            Dias. Quem nunca teve contato nenhum entra sempre.
          </p>
        </div>
      </div>

      {!lenteEstaLimpa(lente) ? (
        <Button
          variant="ghost"
          className="toque h-11 self-start md:h-9"
          onClick={() => aoMudar(LENTE_LIMPA)}
        >
          Limpar a lente
        </Button>
      ) : null}
    </div>
  );
}

/**
 * O que o banco fez, com os números do banco.
 *
 * "25 pedidos, 18 entraram" é o que faz a pessoa aprender a montar o lote de amanhã;
 * "lote criado" não ensina nada.
 */
function ReciboDaMontagem({
  resumo,
  aoFechar,
}: {
  resumo: Extract<ResultadoDaMontagem, { montado: true }>;
  aoFechar: () => void;
}) {
  const excluidos = exclusoesEmFrases(resumo.excluidos);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto px-4 pb-4">
        <div className="rounded-xl border bg-card/50 p-4">
          <p className="flex items-baseline gap-2">
            <span className="numerico font-heading text-4xl leading-none font-semibold">
              {resumo.entraram}
            </span>
            <span className="text-sm text-muted-foreground">
              de <span className="numerico">{resumo.pedidos}</span> pedidos entraram no lote
            </span>
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Esses contatos estão reservados no seu nome: eles somem da montagem de todo mundo até o
            lote acabar ou ser encerrado.
          </p>
        </div>

        {excluidos.length > 0 ? (
          <div className="space-y-1.5 rounded-xl border p-4">
            <p className="text-sm font-medium">Ficaram de fora</p>
            <ul className="space-y-1">
              {excluidos.map((linha) => (
                <li key={linha.motivo} className="text-sm text-muted-foreground">
                  <span className="numerico text-foreground">{linha.quantos}</span> {linha.frase}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <footer className="flex items-center gap-2 border-t bg-popover px-4 pt-3 pb-4">
        <Button asChild className="toque h-12 flex-1 md:h-10">
          <Link href={`/ligar/${resumo.lote_id}`}>
            <PhoneOutgoing aria-hidden="true" />
            Abrir e ligar
          </Link>
        </Button>
        <Button variant="ghost" className="toque h-12 md:h-10" onClick={aoFechar}>
          Depois
        </Button>
      </footer>
    </div>
  );
}
