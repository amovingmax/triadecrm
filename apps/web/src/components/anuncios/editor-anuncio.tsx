'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, CircleCheck, CloudUpload, CloudOff, Trash2, X } from 'lucide-react';
import { Controller, useForm, type UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { DialogoExcluir } from '@/components/exclusao/dialogo-excluir';

import {
  carregarAnuncio,
  carregarCanalPro,
  CHAVE_DO_CANAL_PRO,
  CHAVE_DOS_ANUNCIOS,
  escolherDestaque,
  excluirAnuncio,
  procurarProprietarios,
  publicarAnuncio,
  salvarAnuncio,
  tirarDoAr,
} from './dados';
import { FotosDoAnuncio } from './fotos-do-anuncio';
import { SituacaoNoPortal } from './no-portal';
import {
  type Anuncio,
  CARACTERISTICAS,
  type DadosDoAnuncio,
  type Destaque,
  DESTAQUES,
  formatarCep,
  formatarPreco,
  fraseDaRecusa,
  lerInteiro,
  lerValor,
  MOSTRAR_ENDERECO,
  type MostrarEndereco,
  type Negocio,
  NEGOCIOS,
  PERIODOS,
  type PeriodoAluguel,
  SITUACOES,
  TIPOS_DE_IMOVEL,
  tipoDeImovel,
} from './tipos';

/**
 * Um anúncio: o formulário, as fotos e o que falta para ir ao ar (04/11/2026).
 *
 * O formulário é salvo inteiro (`public.anuncio_salvar`), e o banco devolve o
 * que falta para o portal aceitar — a lista do cartão ao lado é a dele, não uma
 * cópia das regras. Rascunho e fora do ar a equipe toda edita; no ar, só admin
 * e gestor, e o banco recusa salvar o que deixaria o anúncio incompleto no ar.
 *
 * Anúncio novo ainda não tem onde guardar foto: o primeiro salvar cria o
 * rascunho e troca o endereço para o dele, e as fotos abrem.
 */
type Valores = {
  tipo: string;
  negocio: Negocio;
  titulo: string;
  descricao: string;
  preco_venda: string;
  preco_aluguel: string;
  periodo_aluguel: PeriodoAluguel;
  condominio: string;
  iptu: string;
  iptu_periodo: 'anual' | 'mensal';
  area_util: string;
  area_total: string;
  quartos: string;
  suites: string;
  banheiros: string;
  vagas: string;
  caracteristicas: string[];
  cep: string;
  estado: string;
  cidade: string;
  bairro: string;
  endereco: string;
  numero: string;
  complemento: string;
  mostrar_endereco: MostrarEndereco;
  video_youtube: string;
  proprietario: { id: string; nome: string } | null;
};

const VAZIO: Valores = {
  tipo: 'apartamento',
  negocio: 'venda',
  titulo: '',
  descricao: '',
  preco_venda: '',
  preco_aluguel: '',
  periodo_aluguel: 'mensal',
  condominio: '',
  iptu: '',
  iptu_periodo: 'anual',
  area_util: '',
  area_total: '',
  quartos: '',
  suites: '',
  banheiros: '',
  vagas: '',
  caracteristicas: [],
  cep: '',
  estado: 'RN',
  cidade: 'Natal',
  bairro: '',
  endereco: '',
  numero: '',
  complemento: '',
  mostrar_endereco: 'rua',
  video_youtube: '',
  proprietario: null,
};

const texto = (n: number | null) => (n === null ? '' : String(n));
const ouNulo = (s: string) => (s.trim() === '' ? null : s.trim());

function valoresDe(a: Anuncio): Valores {
  return {
    tipo: a.tipo,
    negocio: a.negocio,
    titulo: a.titulo,
    descricao: a.descricao,
    preco_venda: texto(a.preco_venda),
    preco_aluguel: texto(a.preco_aluguel),
    periodo_aluguel: a.periodo_aluguel,
    condominio: texto(a.condominio),
    iptu: texto(a.iptu),
    iptu_periodo: a.iptu_periodo,
    area_util: texto(a.area_util),
    area_total: texto(a.area_total),
    quartos: texto(a.quartos),
    suites: texto(a.suites),
    banheiros: texto(a.banheiros),
    vagas: texto(a.vagas),
    caracteristicas: a.caracteristicas ?? [],
    cep: formatarCep(a.cep),
    estado: a.estado ?? '',
    cidade: a.cidade ?? '',
    bairro: a.bairro ?? '',
    endereco: a.endereco ?? '',
    numero: a.numero ?? '',
    complemento: a.complemento ?? '',
    mostrar_endereco: a.mostrar_endereco,
    video_youtube: a.video_youtube ?? '',
    proprietario: a.proprietario_id
      ? { id: a.proprietario_id, nome: a.proprietario_nome ?? 'Proprietário' }
      : null,
  };
}

function dadosDe(v: Valores): DadosDoAnuncio {
  return {
    tipo: v.tipo,
    negocio: v.negocio,
    titulo: v.titulo.trim(),
    descricao: v.descricao.trim(),
    preco_venda: lerValor(v.preco_venda),
    preco_aluguel: lerValor(v.preco_aluguel),
    periodo_aluguel: v.periodo_aluguel,
    condominio: lerValor(v.condominio, true),
    iptu: lerValor(v.iptu, true),
    iptu_periodo: v.iptu_periodo,
    area_util: lerInteiro(v.area_util) || null,
    area_total: lerInteiro(v.area_total) || null,
    quartos: lerInteiro(v.quartos),
    suites: lerInteiro(v.suites),
    banheiros: lerInteiro(v.banheiros),
    vagas: lerInteiro(v.vagas),
    caracteristicas: v.caracteristicas,
    cep: ouNulo(v.cep.replace(/\D/g, '')),
    estado: ouNulo(v.estado.toUpperCase()),
    cidade: ouNulo(v.cidade),
    bairro: ouNulo(v.bairro),
    endereco: ouNulo(v.endereco),
    numero: ouNulo(v.numero),
    complemento: ouNulo(v.complemento),
    mostrar_endereco: v.mostrar_endereco,
    video_youtube: ouNulo(v.video_youtube),
    proprietario_id: v.proprietario?.id ?? null,
  };
}

/** O que o formulário confere antes de mandar: só o que o banco recusaria com erro, e não com pendência. */
function conferir(v: Valores): { campo: keyof Valores; mensagem: string } | null {
  const cep = v.cep.replace(/\D/g, '');
  if (cep !== '' && cep.length !== 8) return { campo: 'cep', mensagem: 'O CEP tem 8 números.' };
  if (v.estado.trim() !== '' && !/^[A-Za-z]{2}$/.test(v.estado.trim()))
    return { campo: 'estado', mensagem: 'Use a sigla do estado, como RN.' };
  if (v.titulo.length > 100)
    return { campo: 'titulo', mensagem: 'O título vai até 100 caracteres.' };
  if (v.descricao.length > 3000)
    return { campo: 'descricao', mensagem: 'A descrição vai até 3.000 caracteres.' };
  return null;
}

export function EditorDeAnuncio({
  id,
  podePublicar,
}: {
  id: string | null;
  podePublicar: boolean;
}) {
  const router = useRouter();
  const cliente = useQueryClient();
  const consulta = useQuery({
    queryKey: [...CHAVE_DOS_ANUNCIOS, 'um', id],
    queryFn: () => carregarAnuncio(id!),
    enabled: id !== null,
  });
  const canalPro = useQuery({ queryKey: CHAVE_DO_CANAL_PRO, queryFn: carregarCanalPro });
  const form = useForm<Valores>({ defaultValues: VAZIO });
  const [salvando, setSalvando] = useState(false);
  const [agindo, setAgindo] = useState<null | 'publicar' | 'tirar' | 'destaque' | 'excluir'>(null);
  const [excluir, setExcluir] = useState(false);

  // O formulário segue o banco enquanto a pessoa não mexeu; depois de mexer,
  // só um salvar o realinha (`reset` no fim de `salvar`).
  const { reset, formState } = form;
  const dados = consulta.data;
  useEffect(() => {
    if (dados && !formState.isDirty) reset(valoresDe(dados.anuncio));
  }, [dados, formState.isDirty, reset]);

  if (id !== null && consulta.isPending) {
    return (
      <div className="flex w-full max-w-5xl flex-col gap-4" aria-busy="true">
        <Skeleton className="h-10 w-64 rounded-lg" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }
  if (id !== null && (consulta.isError || !dados)) {
    return (
      <div className="flex w-full max-w-3xl flex-col gap-3">
        <Voltar />
        <p className="text-sm text-muted-foreground">
          {consulta.isError
            ? 'O anúncio não carregou. Recarregue a página.'
            : 'Não achei este anúncio.'}
        </p>
      </div>
    );
  }

  const anuncio = dados?.anuncio ?? null;
  const pendencias = dados?.pendencias ?? [];
  const excluido = anuncio?.excluido_em != null;
  const editavel = !excluido && (anuncio?.situacao !== 'no_ar' || podePublicar);

  // O plano do Canal Pro (migração 20261104180000): quem recusa é o banco; a
  // tela só avisa antes do clique. No ar, este anúncio já está na conta.
  const plano = canalPro.data?.plano ?? null;
  const noAr = anuncio?.situacao === 'no_ar';
  const semVaga = !noAr && plano?.anuncios != null && plano.anunciosEmUso >= plano.anuncios;
  const destaquesDosOutros =
    (plano?.destaquesEmUso ?? 0) - (noAr && anuncio?.destaque !== 'padrao' ? 1 : 0);
  const semDestaque = plano?.destaques != null && destaquesDosOutros >= plano.destaques;
  const destaqueBarrado = !noAr && anuncio?.destaque !== 'padrao' && semDestaque;

  function atualizar() {
    void cliente.invalidateQueries({ queryKey: CHAVE_DOS_ANUNCIOS });
  }

  async function salvar(v: Valores): Promise<boolean> {
    const erro = conferir(v);
    if (erro) {
      form.setError(erro.campo, { message: erro.mensagem });
      form.setFocus(erro.campo);
      return false;
    }
    setSalvando(true);
    const r = await salvarAnuncio(id, dadosDe(v));
    setSalvando(false);
    if (!r.ok) {
      toast.error('Não deu para salvar.', {
        description:
          r.pendencias && r.pendencias.length
            ? `${fraseDaRecusa(r.motivo)} Falta: ${r.pendencias.join(', ')}.`
            : fraseDaRecusa(r.motivo),
        duration: 10_000,
      });
      return false;
    }
    reset(v);
    atualizar();
    if (id === null) {
      toast.success(`Rascunho ${r.codigo} criado. Agora ponha as fotos.`);
      router.replace(`/anuncios/${r.id}`);
    } else {
      toast.success(r.pendencias.length ? 'Salvo. Ainda falta o que está na lista.' : 'Salvo.');
    }
    return true;
  }

  async function publicar() {
    if (!anuncio) return;
    if (formState.isDirty) {
      const ok = await salvar(form.getValues());
      if (!ok) return;
    }
    setAgindo('publicar');
    const r = await publicarAnuncio(anuncio.id);
    setAgindo(null);
    atualizar();
    if (!r.ok) {
      toast.error('Ainda não dá para pôr no ar.', {
        description: r.pendencias?.length
          ? `Falta: ${r.pendencias.join(', ')}.`
          : fraseDaRecusa(r.motivo),
      });
      return;
    }
    toast.success('No ar. Entra no portal na próxima leitura do Grupo OLX (a cada 12 horas).');
  }

  async function tirar() {
    if (!anuncio) return;
    setAgindo('tirar');
    const r = await tirarDoAr(anuncio.id);
    setAgindo(null);
    atualizar();
    if (!r.ok) toast.error('Não deu para tirar do ar.', { description: fraseDaRecusa(r.motivo) });
    else toast.success('Fora do ar. Sai do portal na próxima leitura do Grupo OLX.');
  }

  async function trocarDestaque(destaque: Destaque) {
    if (!anuncio) return;
    setAgindo('destaque');
    const r = await escolherDestaque(anuncio.id, destaque);
    setAgindo(null);
    atualizar();
    if (!r.ok) toast.error('O destaque não mudou.', { description: fraseDaRecusa(r.motivo) });
  }

  async function confirmarExclusao(motivo: string) {
    if (!anuncio) return;
    setAgindo('excluir');
    const r = await excluirAnuncio(anuncio.id, motivo);
    setAgindo(null);
    if (!r.ok) {
      toast.error('Não deu para excluir.', { description: fraseDaRecusa(r.motivo) });
      return;
    }
    setExcluir(false);
    atualizar();
    toast.success(`${anuncio.codigo} excluído. Ele está em Anúncios → Excluídos.`);
    router.push('/anuncios');
  }

  return (
    <div className="flex w-full max-w-5xl flex-col gap-5">
      <header className="flex flex-col gap-3">
        <Voltar />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="font-heading text-[28px] leading-tight font-normal tracking-[-0.02em]">
            {anuncio ? anuncio.titulo.trim() || 'Anúncio sem título' : 'Novo anúncio'}
          </h1>
          {anuncio ? (
            <>
              <Badge variant={anuncio.situacao === 'no_ar' ? 'default' : 'outline'}>
                {excluido ? 'Excluído' : SITUACOES[anuncio.situacao]}
              </Badge>
              <span className="text-sm text-muted-foreground numerico">{anuncio.codigo}</span>
            </>
          ) : null}
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <form
          onSubmit={form.handleSubmit((v) => void salvar(v))}
          className="order-2 flex min-w-0 flex-col gap-5 lg:order-1"
        >
          <fieldset disabled={!editavel || salvando} className="flex min-w-0 flex-col gap-5">
            <Formulario form={form} />
          </fieldset>

          <Secao titulo="Fotos">
            {anuncio ? (
              <FotosDoAnuncio
                anuncioId={anuncio.id}
                fotos={dados?.fotos ?? []}
                editavel={editavel}
                aoMudar={atualizar}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                As fotos entram depois do primeiro salvar: é ele que cria o rascunho.
              </p>
            )}
          </Secao>

          {editavel ? (
            <div className="sticky bottom-0 z-10 -mx-1 flex gap-2 bg-background/90 px-1 py-3 backdrop-blur">
              <Button type="submit" disabled={salvando} className="toque h-11 md:h-9">
                {salvando ? 'Salvando...' : anuncio ? 'Salvar' : 'Salvar e pôr as fotos'}
              </Button>
              {formState.isDirty && anuncio ? (
                <Button
                  type="button"
                  variant="outline"
                  className="toque h-11 md:h-9"
                  onClick={() => reset(valoresDe(anuncio))}
                >
                  Desfazer
                </Button>
              ) : null}
            </div>
          ) : null}
        </form>

        <aside className="order-1 flex flex-col gap-4 lg:order-2">
          <div className="sombra-base flex flex-col gap-3 rounded-xl bg-card p-5 lg:sticky lg:top-4">
            {!anuncio ? (
              <p className="text-sm text-muted-foreground">
                Preencha o que souber e salve. O rascunho fica guardado, e daqui o CRM diz o que
                falta para o portal aceitar.
              </p>
            ) : excluido ? (
              <p className="text-sm text-muted-foreground">
                Este anúncio foi excluído e saiu do arquivo do Canal Pro. Para voltar, restaure em
                Anúncios → Excluídos.
              </p>
            ) : (
              <>
                {pendencias.length ? (
                  <div className="flex flex-col gap-1.5">
                    <p className="text-sm font-medium">Para ir ao ar, falta:</p>
                    <ul className="flex list-disc flex-col gap-0.5 pl-5 text-sm text-muted-foreground">
                      {pendencias.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  </div>
                ) : anuncio.situacao === 'no_ar' ? (
                  <SituacaoNoPortal
                    mudouEm={anuncio.updated_at}
                    ultimaLeitura={canalPro.data?.ultimaLeitura ?? null}
                  />
                ) : (
                  <p className="flex items-center gap-1.5 text-sm">
                    <CircleCheck className="size-4" aria-hidden="true" />
                    Pronto para ir ao ar.
                  </p>
                )}
                {formState.isDirty ? (
                  <p className="text-xs text-muted-foreground">Há mudanças ainda não salvas.</p>
                ) : null}
                {anuncio.codigo_no_canal_pro === anuncio.codigo ? (
                  <p className="text-xs text-muted-foreground">
                    Trazido do Canal Pro com o mesmo código. O relatório não traz fotos, descrição
                    nem CEP: complete aqui. Quando o Canal Pro passar a ler o arquivo do CRM, é este
                    que vale no portal.
                  </p>
                ) : anuncio.codigo_no_canal_pro ? (
                  <p className="text-xs text-muted-foreground">
                    Trazido do anúncio{' '}
                    <span className="numerico">{anuncio.codigo_no_canal_pro}</span> do Canal Pro,
                    com outro código. O relatório não traz fotos, descrição nem CEP: complete aqui.
                    Para ir ao ar, o original precisa sair do ar antes (em Anúncios, &ldquo;Como
                    tirar do ar&rdquo;), senão o Grupo OLX recusa por duplicidade.
                  </p>
                ) : null}

                {podePublicar ? (
                  <div className="flex flex-col gap-3 border-t border-hairline pt-3">
                    {anuncio.situacao === 'no_ar' ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="toque h-11 md:h-9"
                        disabled={agindo !== null}
                        onClick={() => void tirar()}
                      >
                        <CloudOff aria-hidden="true" />
                        {agindo === 'tirar' ? 'Tirando...' : 'Tirar do ar'}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        className="toque h-11 md:h-9"
                        disabled={
                          agindo !== null ||
                          salvando ||
                          semVaga ||
                          destaqueBarrado ||
                          (pendencias.length > 0 && !formState.isDirty)
                        }
                        onClick={() => void publicar()}
                      >
                        <CloudUpload aria-hidden="true" />
                        {agindo === 'publicar'
                          ? 'Pondo no ar...'
                          : formState.isDirty
                            ? 'Salvar e pôr no ar'
                            : 'Pôr no ar'}
                      </Button>
                    )}
                    {!noAr && plano?.anuncios != null ? (
                      <p className="text-xs text-muted-foreground">
                        {semVaga
                          ? `Plano cheio: ${plano.anunciosEmUso} de ${plano.anuncios} anúncios no ar. Para pôr este, tire outro do ar (no CRM ou um dos que estão no Canal Pro por fora dele).`
                          : destaqueBarrado
                            ? `Os destaques do plano estão em uso (${plano.destaquesEmUso} de ${plano.destaques}). Ponha este como Padrão para ir ao ar.`
                            : `Vagas do plano em uso: ${plano.anunciosEmUso} de ${plano.anuncios}.`}
                      </p>
                    ) : null}
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="destaque-do-anuncio">Destaque no portal</Label>
                      <Select
                        value={anuncio.destaque}
                        onValueChange={(d) => void trocarDestaque(d as Destaque)}
                        disabled={agindo !== null}
                      >
                        <SelectTrigger id="destaque-do-anuncio" className="h-11 w-full md:h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DESTAQUES.filter((d) => !d.zapMais || d.id === anuncio.destaque).map(
                            (d) => (
                              <SelectItem
                                key={d.id}
                                value={d.id}
                                disabled={
                                  semDestaque && d.id !== 'padrao' && d.id !== anuncio.destaque
                                }
                              >
                                {d.rotulo}
                              </SelectItem>
                            ),
                          )}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        {DESTAQUES.find((d) => d.id === anuncio.destaque)?.dica}{' '}
                        {plano?.destaques != null
                          ? `Destaques do plano em uso: ${plano.destaquesEmUso} de ${plano.destaques}.`
                          : 'O destaque gasta a cota do plano do Canal Pro.'}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      className="toque h-11 w-fit md:h-9"
                      disabled={agindo !== null}
                      onClick={() => setExcluir(true)}
                    >
                      <Trash2 aria-hidden="true" />
                      Excluir anúncio
                    </Button>
                  </div>
                ) : (
                  <p className="border-t border-hairline pt-3 text-xs text-muted-foreground">
                    {anuncio.situacao === 'no_ar'
                      ? 'Este anúncio está no ar: só admin e gestor mexem nele.'
                      : 'Quem põe no ar e escolhe o destaque é a gestão. Quando estiver pronto, avise um gestor.'}
                  </p>
                )}
              </>
            )}
          </div>
        </aside>
      </div>

      <DialogoExcluir
        aberto={excluir}
        aoFechar={() => setExcluir(false)}
        titulo={`Excluir ${anuncio?.codigo ?? 'o anúncio'}`}
        descricao={
          <>
            <p>
              O anúncio sai da lista e do arquivo do Canal Pro; se estiver no ar, sai do portal na
              próxima leitura do Grupo OLX.
            </p>
            <p>
              Nada é apagado: ele fica em Anúncios → Excluídos e volta, fora do ar, pelo Restaurar.
            </p>
          </>
        }
        rotuloConfirmar="Excluir"
        motivo="obrigatorio"
        exemploDeMotivo="Imóvel vendido"
        ocupado={agindo === 'excluir'}
        aoConfirmar={(m) => void confirmarExclusao(m)}
      />
    </div>
  );
}

function Voltar() {
  return (
    <Link
      href="/anuncios"
      className="toque inline-flex min-h-11 w-fit items-center gap-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 md:min-h-0"
    >
      <ChevronLeft className="size-4" aria-hidden="true" />
      Anúncios
    </Link>
  );
}

function Secao({
  titulo,
  dica,
  children,
}: {
  titulo: string;
  dica?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="sombra-base flex min-w-0 flex-col gap-4 rounded-xl bg-card p-5 md:p-6">
      <div>
        <h2 className="text-base font-medium">{titulo}</h2>
        {dica ? <p className="text-sm text-muted-foreground">{dica}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Campo({
  id,
  rotulo,
  dica,
  erro,
  className,
  children,
}: {
  id: string;
  rotulo: string;
  dica?: React.ReactNode;
  erro?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{rotulo}</Label>
      {children}
      {erro ? (
        <p className="text-xs text-destructive-texto" role="alert">
          {erro}
        </p>
      ) : dica ? (
        <p className="text-xs text-muted-foreground">{dica}</p>
      ) : null}
    </div>
  );
}

const ENTRADA = 'h-11 md:h-9';
const CAIXA_DE_TEXTO =
  'w-full rounded-lg border border-input bg-transparent px-3 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 md:text-sm';

/** Os campos, em blocos na ordem em que a pessoa pensa o anúncio. */
function Formulario({ form }: { form: UseFormReturn<Valores> }) {
  const id = useId();
  const { register, control, watch, formState, setValue, getValues } = form;
  const tipo = tipoDeImovel(watch('tipo'));
  const negocio = watch('negocio');
  const titulo = watch('titulo');
  const descricao = watch('descricao');
  const erros = formState.errors;
  const precoVenda = formatarPreco(lerValor(watch('preco_venda')));
  const precoAluguel = formatarPreco(lerValor(watch('preco_aluguel')));

  // O CEP preenche rua, bairro, cidade e estado pelo ViaCEP (serviço público dos
  // Correios, só com o CEP), sem apagar o que a pessoa já escreveu.
  async function completarPeloCep() {
    const cep = getValues('cep').replace(/\D/g, '');
    if (cep.length !== 8) return;
    try {
      const resposta = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const r = (await resposta.json()) as {
        erro?: boolean;
        logradouro?: string;
        bairro?: string;
        localidade?: string;
        uf?: string;
      };
      if (r.erro) return;
      const preencher = (campo: 'endereco' | 'bairro' | 'cidade' | 'estado', valor?: string) => {
        if (valor && getValues(campo).trim() === '') setValue(campo, valor, { shouldDirty: true });
      };
      if (r.localidade && r.localidade !== getValues('cidade'))
        setValue('cidade', r.localidade, { shouldDirty: true });
      if (r.uf && r.uf !== getValues('estado')) setValue('estado', r.uf, { shouldDirty: true });
      preencher('endereco', r.logradouro);
      preencher('bairro', r.bairro);
    } catch {
      // Sem internet ou sem o serviço: a pessoa preenche à mão.
    }
  }

  return (
    <>
      <Secao titulo="O imóvel">
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo id={`${id}-tipo`} rotulo="Tipo">
            <Controller
              control={control}
              name="tipo"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id={`${id}-tipo`} className="h-11 w-full md:h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['Residencial', 'Comercial'] as const).map((grupo) => (
                      <SelectGroup key={grupo}>
                        <SelectLabel>{grupo}</SelectLabel>
                        {TIPOS_DE_IMOVEL.filter((t) => t.grupo === grupo).map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.rotulo}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Campo>
          <Campo id={`${id}-negocio`} rotulo="Para">
            <Controller
              control={control}
              name="negocio"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id={`${id}-negocio`} className="h-11 w-full md:h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NEGOCIOS.map((n) => (
                      <SelectItem key={n.id} value={n.id}>
                        {n.rotulo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Campo>
        </div>
        <Proprietario form={form} />
      </Secao>

      <Secao titulo="Valores" dica="Em reais, sem centavos: é como o portal aceita.">
        <div className="grid gap-4 sm:grid-cols-2">
          {negocio !== 'aluguel' ? (
            <Campo id={`${id}-venda`} rotulo="Preço de venda" dica={precoVenda ?? undefined}>
              <Input
                id={`${id}-venda`}
                inputMode="numeric"
                placeholder="450000"
                className={ENTRADA}
                {...register('preco_venda')}
              />
            </Campo>
          ) : null}
          {negocio !== 'venda' ? (
            <div className="flex min-w-0 gap-2">
              <Campo
                id={`${id}-aluguel`}
                rotulo="Aluguel"
                dica={precoAluguel ?? undefined}
                className="flex-1"
              >
                <Input
                  id={`${id}-aluguel`}
                  inputMode="numeric"
                  placeholder="3200"
                  className={ENTRADA}
                  {...register('preco_aluguel')}
                />
              </Campo>
              <Campo id={`${id}-periodo`} rotulo="Cobrado" className="w-36">
                <Controller
                  control={control}
                  name="periodo_aluguel"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id={`${id}-periodo`} className="h-11 w-full md:h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PERIODOS.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.rotulo}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Campo>
            </div>
          ) : null}
          <Campo
            id={`${id}-cond`}
            rotulo="Condomínio por mês"
            dica="0 se for isento; vazio se não houver."
          >
            <Input
              id={`${id}-cond`}
              inputMode="numeric"
              className={ENTRADA}
              {...register('condominio')}
            />
          </Campo>
          <div className="flex min-w-0 gap-2">
            <Campo id={`${id}-iptu`} rotulo="IPTU" className="flex-1">
              <Input
                id={`${id}-iptu`}
                inputMode="numeric"
                className={ENTRADA}
                {...register('iptu')}
              />
            </Campo>
            <Campo id={`${id}-iptu-p`} rotulo="Por" className="w-28">
              <Controller
                control={control}
                name="iptu_periodo"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id={`${id}-iptu-p`} className="h-11 w-full md:h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="anual">Ano</SelectItem>
                      <SelectItem value="mensal">Mês</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </Campo>
          </div>
        </div>
      </Secao>

      <Secao titulo="Tamanho">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Campo
            id={`${id}-util`}
            rotulo="Área útil (m²)"
            dica={tipo.area === 'util' ? 'O portal pede.' : 'Opcional neste tipo.'}
          >
            <Input
              id={`${id}-util`}
              inputMode="numeric"
              className={ENTRADA}
              {...register('area_util')}
            />
          </Campo>
          <Campo
            id={`${id}-total`}
            rotulo="Área total (m²)"
            dica={tipo.area === 'total' ? 'O portal pede.' : 'Opcional.'}
          >
            <Input
              id={`${id}-total`}
              inputMode="numeric"
              className={ENTRADA}
              {...register('area_total')}
            />
          </Campo>
          {tipo.id !== 'kitnet' ? (
            <Campo
              id={`${id}-quartos`}
              rotulo="Quartos"
              dica={tipo.pedeQuartos ? 'O portal pede.' : undefined}
            >
              <Input
                id={`${id}-quartos`}
                inputMode="numeric"
                className={ENTRADA}
                {...register('quartos')}
              />
            </Campo>
          ) : null}
          <Campo id={`${id}-suites`} rotulo="Suítes">
            <Input
              id={`${id}-suites`}
              inputMode="numeric"
              className={ENTRADA}
              {...register('suites')}
            />
          </Campo>
          <Campo
            id={`${id}-banheiros`}
            rotulo="Banheiros"
            dica={tipo.pedeBanheiros ? 'O portal pede.' : undefined}
          >
            <Input
              id={`${id}-banheiros`}
              inputMode="numeric"
              className={ENTRADA}
              {...register('banheiros')}
            />
          </Campo>
          <Campo id={`${id}-vagas`} rotulo="Vagas">
            <Input
              id={`${id}-vagas`}
              inputMode="numeric"
              className={ENTRADA}
              {...register('vagas')}
            />
          </Campo>
        </div>
      </Secao>

      <Secao titulo="Endereço" dica="O portal pede CEP, estado, cidade e bairro.">
        <div className="grid gap-4 sm:grid-cols-6">
          <Campo
            id={`${id}-cep`}
            rotulo="CEP"
            erro={erros.cep?.message}
            dica="Preenche a rua e o bairro."
            className="sm:col-span-2"
          >
            <Input
              id={`${id}-cep`}
              inputMode="numeric"
              placeholder="59090-000"
              className={ENTRADA}
              {...register('cep', { onBlur: () => void completarPeloCep() })}
            />
          </Campo>
          <Campo id={`${id}-cidade`} rotulo="Cidade" className="sm:col-span-3">
            <Input id={`${id}-cidade`} className={ENTRADA} {...register('cidade')} />
          </Campo>
          <Campo
            id={`${id}-uf`}
            rotulo="Estado"
            erro={erros.estado?.message}
            className="sm:col-span-1"
          >
            <Input
              id={`${id}-uf`}
              maxLength={2}
              autoCapitalize="characters"
              className={ENTRADA}
              {...register('estado')}
            />
          </Campo>
          <Campo id={`${id}-bairro`} rotulo="Bairro" className="sm:col-span-3">
            <Input id={`${id}-bairro`} className={ENTRADA} {...register('bairro')} />
          </Campo>
          <Campo id={`${id}-rua`} rotulo="Rua" className="sm:col-span-3">
            <Input id={`${id}-rua`} className={ENTRADA} {...register('endereco')} />
          </Campo>
          <Campo id={`${id}-numero`} rotulo="Número" className="sm:col-span-2">
            <Input id={`${id}-numero`} className={ENTRADA} {...register('numero')} />
          </Campo>
          <Campo
            id={`${id}-compl`}
            rotulo="Complemento"
            dica="Não aparece no portal."
            className="sm:col-span-4"
          >
            <Input
              id={`${id}-compl`}
              placeholder="Apto 1201, bloco B"
              className={ENTRADA}
              {...register('complemento')}
            />
          </Campo>
          <Campo id={`${id}-mostrar`} rotulo="O portal mostra" className="sm:col-span-6">
            <Controller
              control={control}
              name="mostrar_endereco"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id={`${id}-mostrar`} className="h-11 w-full md:h-9 sm:w-72">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MOSTRAR_ENDERECO.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.rotulo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Campo>
        </div>
      </Secao>

      <Secao titulo="O texto do anúncio">
        <Campo
          id={`${id}-titulo`}
          rotulo="Título"
          erro={erros.titulo?.message}
          dica={<Contador valor={titulo.trim().length} minimo={10} maximo={100} />}
        >
          <Input
            id={`${id}-titulo`}
            maxLength={100}
            placeholder="Apartamento de 3 quartos com vista para o mar em Ponta Negra"
            className={ENTRADA}
            {...register('titulo')}
          />
        </Campo>
        <Campo
          id={`${id}-desc`}
          rotulo="Descrição"
          erro={erros.descricao?.message}
          dica={<Contador valor={descricao.trim().length} minimo={50} maximo={3000} />}
        >
          <textarea
            id={`${id}-desc`}
            rows={8}
            maxLength={3000}
            className={CAIXA_DE_TEXTO}
            {...register('descricao')}
          />
        </Campo>
        <Campo
          id={`${id}-video`}
          rotulo="Vídeo"
          dica="Só link do YouTube: é o único que o portal aceita."
        >
          <Input
            id={`${id}-video`}
            inputMode="url"
            autoCapitalize="none"
            placeholder="https://www.youtube.com/watch?v=..."
            className={ENTRADA}
            {...register('video_youtube')}
          />
        </Campo>
      </Secao>

      <Secao titulo="Características" dica="O que o portal usa nos filtros de busca.">
        <Controller
          control={control}
          name="caracteristicas"
          render={({ field }) => (
            <div className="flex flex-col gap-4">
              {CARACTERISTICAS.map((grupo) => (
                <fieldset key={grupo.grupo} className="flex flex-col gap-2">
                  <legend className="mb-2 text-sm text-muted-foreground">{grupo.grupo}</legend>
                  <div className="flex flex-wrap gap-2">
                    {grupo.itens.map((item) => {
                      const marcada = field.value.includes(item.valor);
                      return (
                        <button
                          key={item.valor}
                          type="button"
                          aria-pressed={marcada}
                          onClick={() =>
                            field.onChange(
                              marcada
                                ? field.value.filter((v) => v !== item.valor)
                                : [...field.value, item.valor],
                            )
                          }
                          className={cn(
                            'toque h-11 rounded-full border px-3.5 text-sm transition-colors md:h-8',
                            'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50',
                            marcada
                              ? 'border-transparent bg-foreground text-background'
                              : 'border-hairline text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {item.rotulo}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              ))}
            </div>
          )}
        />
      </Secao>
    </>
  );
}

function Contador({ valor, minimo, maximo }: { valor: number; minimo: number; maximo: number }) {
  return (
    <span className={cn('numerico', valor > 0 && valor < minimo ? 'text-foreground' : undefined)}>
      {valor} de {minimo} a {maximo.toLocaleString('pt-BR')} caracteres
      {valor > 0 && valor < minimo ? `: faltam ${minimo - valor}` : ''}
    </span>
  );
}

/** O proprietário do imóvel, da base de Prospectados. Opcional: liga o anúncio à ficha. */
function Proprietario({ form }: { form: UseFormReturn<Valores> }) {
  const id = useId();
  const [busca, setBusca] = useState('');
  const atual = form.watch('proprietario');
  const resultados = useQuery({
    queryKey: ['anuncios', 'proprietarios', busca.trim()],
    queryFn: () => procurarProprietarios(busca),
    enabled: busca.trim().length >= 2,
  });

  if (atual) {
    return (
      <div className="flex flex-col gap-1.5">
        <Label>Proprietário</Label>
        <div className="flex items-center gap-2">
          <Link href={`/parceiros/${atual.id}`} className="text-sm underline underline-offset-4">
            {atual.nome}
          </Link>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Tirar o proprietário"
            className="toque"
            onClick={() => form.setValue('proprietario', null, { shouldDirty: true })}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`${id}-busca`}>Proprietário</Label>
      <Input
        id={`${id}-busca`}
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Procure pelo nome (opcional)"
        className={cn(ENTRADA, 'sm:max-w-sm')}
        autoComplete="off"
      />
      {busca.trim().length >= 2 ? (
        <ul className="flex flex-col gap-1 sm:max-w-sm">
          {resultados.isPending ? (
            <li className="text-xs text-muted-foreground">Procurando...</li>
          ) : (resultados.data ?? []).length === 0 ? (
            <li className="text-xs text-muted-foreground">Nenhum proprietário com esse nome.</li>
          ) : (
            resultados.data!.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="toque w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    form.setValue('proprietario', p, { shouldDirty: true });
                    setBusca('');
                  }}
                >
                  {p.nome}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
