'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArchiveRestore,
  Camera,
  CircleCheck,
  CirclePlus,
  CloudOff,
  CloudUpload,
  Copy,
  EllipsisVertical,
  Eye,
  Flame,
  ImageOff,
  Layers,
  MapPin,
  MessageSquare,
  Pencil,
  Trash2,
  TriangleAlert,
  UserRound,
} from 'lucide-react';
import { toast } from 'sonner';

import { DialogoExcluir } from '@/components/exclusao/dialogo-excluir';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

import {
  copiaAtiva,
  type DoCanalPro,
  estadoDoCartao,
  type EstadoDoCartao,
  fotosQueFaltam,
  type TomDoEstado,
} from './aba-dos-anuncios';
import {
  CarrosselDeFotos,
  contagemDasFotos,
  SeloDasFotos,
  SeloDoDestaque,
} from './carrossel-de-fotos';
import {
  CHAVE_DOS_ANUNCIOS,
  escolherDestaque,
  excluirAnuncio,
  publicarAnuncio,
  restaurarAnuncio,
  tirarDoAr,
  urlDaFoto,
} from './dados';
import {
  DESTACADOR_AUTOMATICO,
  ehTerreno,
  faixaDaNota,
  type FaixaDaNota,
  foraDoArquivo,
  formatarNota,
  type ItemDaNota,
  ocupaVagaPeloRelatorio,
  situacaoForaDoCrm,
  travasDoPlano,
} from './regras-do-cartao';
import {
  type AnuncioNaLista,
  type Destaque,
  DESTAQUES,
  fraseDaRecusa,
  precoDoAnuncio,
  rotuloDoDestaque,
  type SituacaoDoCanalPro,
  tipoDeImovel,
} from './tipos';

type Agindo = null | 'publicar' | 'tirar' | 'destaque' | 'excluir' | 'restaurar';

/** Grade (foto 4:3 em cima) ou lista (foto pequena à esquerda), 24/11/2026. */
export type ModoDaLista = 'grade' | 'lista';

/** As cores de cada situação: quem publica muda a tinta, o resto fica neutro. */
export const TOM_DA_SITUACAO: Record<TomDoEstado, string> = {
  arbo: 'bg-cliente-fundo text-cliente-texto',
  espera: 'bg-primary/12 text-primary',
  crm: 'bg-primary text-primary-foreground',
  fora: 'border border-border text-muted-foreground',
  rascunho: 'bg-morno-fundo text-morno-texto',
  alerta: 'bg-destructive/10 text-destructive-texto',
  excluido: 'bg-destructive/10 text-destructive-texto',
};

export function EtiquetaDaSituacao({ estado }: { estado: EstadoDoCartao }) {
  return (
    <span
      title={estado.dica}
      className={cn(
        'inline-flex h-6 max-w-full items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap',
        TOM_DA_SITUACAO[estado.tom],
      )}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
      <span className="truncate">{estado.rotulo}</span>
    </span>
  );
}

/** O preço com o "/mês" (ou "/dia") menor, como no protótipo. */
function Preco({ texto, className }: { texto: string; className?: string }) {
  const partes = texto.split(/(\/\S+)/);
  return (
    <p
      className={cn('font-heading leading-tight font-bold tracking-[-0.01em] numerico', className)}
    >
      {partes.map((p, i) =>
        p.startsWith('/') ? (
          <small key={i} className="font-sans text-[13px] font-medium text-muted-foreground">
            {p}
          </small>
        ) : (
          p
        ),
      )}
    </p>
  );
}

/**
 * Um anúncio da lista (18/11/2026; redesenhado em 24/11/2026 pelo protótipo
 * responsivo): um cartão por imóvel, em grade ou em lista. A foto, o título (é
 * por ele que o time reconhece o imóvel), o código, o tipo, a área e o bairro, o
 * preço, UMA etiqueta de situação, os números do Canal Pro e dos leads, e uma
 * ação só, a que o anúncio pede agora. O resto mora na ficha (que abre por cima,
 * ao clicar) e no menu ⋮. As cópias antigas do mesmo imóvel no Canal Pro ficam
 * dentro do cartão, numa linha.
 *
 * Saíram do cartão (estão na ficha): a origem, as datas de criação e atualização
 * e a nota de qualidade.
 *
 * Os alvos pequenos (código, leads, cópia antiga) têm caixa de 40px com margem
 * negativa: o desenho fica o mesmo e o dedo acerta.
 */
export function CartaoDoAnuncio({
  anuncio: a,
  doCanalPro,
  caminhosDasFotos,
  podePublicar,
  plano,
  modo,
  aoAbrir,
  aoAbrirNaFoto,
  aoSincronizar,
}: {
  anuncio: AnuncioNaLista;
  doCanalPro: DoCanalPro | undefined;
  /** As fotos para o carrossel da grade (`undefined` carregando, `null` sem leitura). */
  caminhosDasFotos: string[] | null | undefined;
  podePublicar: boolean;
  plano: SituacaoDoCanalPro['plano'] | null;
  modo: ModoDaLista;
  aoAbrir: () => void;
  /** Abre a ficha com o carrossel na foto que estava à vista no cartão. */
  aoAbrirNaFoto: (foto: number) => void;
  aoSincronizar: () => void;
}) {
  const cliente = useQueryClient();
  const [agindo, setAgindo] = useState<Agindo>(null);
  const [excluir, setExcluir] = useState(false);

  const excluido = a.excluido_em !== null;
  const estado = estadoDoCartao(a);
  const linkDoAnuncio = `/anuncios/${a.id}`;
  const linkDosLeads = `/anuncios/leads?anuncio=${encodeURIComponent(a.codigo)}`;
  const propria = doCanalPro?.propria ?? null;
  const copias = doCanalPro?.copias ?? [];
  const ativas = copias.filter(copiaAtiva);
  const faltamFotos = fotosQueFaltam(a, doCanalPro);
  const visualizacoes = a.no_canal_pro_visualizacoes ?? propria?.visualizacoes ?? null;
  const contatos = a.no_canal_pro_contatos ?? propria?.contatos ?? null;
  const tipo = tipoDeImovel(a.tipo).rotulo;
  // Terreno se mede pela área total; o resto, pela útil (como o Canal Pro mostra).
  const area = ehTerreno(a.tipo) ? (a.area_total ?? a.area_util) : (a.area_util ?? a.area_total);
  const medidas = [
    tipo,
    area ? `${area.toLocaleString('pt-BR')} m²` : null,
    a.quartos ? `${a.quartos} ${a.quartos === 1 ? 'quarto' : 'quartos'}` : null,
  ]
    .filter((x): x is string => !!x)
    .join(' · ');
  const lugar = [a.bairro, a.cidade].filter(Boolean).join(', ');
  const destaque = a.destaque !== 'padrao' && !excluido ? rotuloDoDestaque(a.destaque) : null;

  function atualizar() {
    void cliente.invalidateQueries({ queryKey: CHAVE_DOS_ANUNCIOS });
  }

  async function copiarCodigo() {
    try {
      await navigator.clipboard.writeText(a.codigo);
      toast.success('Código copiado', { description: a.codigo });
    } catch {
      toast.error('Não deu para copiar.', { description: `O código é ${a.codigo}.` });
    }
  }

  async function publicar() {
    setAgindo('publicar');
    const r = await publicarAnuncio(a.id);
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
    toast.success(
      a.ultima_leitura_do_portal
        ? 'No ar. Entra no portal na próxima leitura do Grupo OLX (a cada 12 horas).'
        : 'No ar pelo CRM. Vai ao portal depois da troca da URL no Canal Pro.',
    );
  }

  async function tirar() {
    setAgindo('tirar');
    const r = await tirarDoAr(a.id);
    setAgindo(null);
    atualizar();
    if (!r.ok) {
      toast.error('Não deu para tirar do ar.', { description: fraseDaRecusa(r.motivo) });
      return;
    }
    toast.success(`${a.codigo} fora do ar.`, {
      description: 'Sai do portal na próxima leitura do Grupo OLX (a cada 12 horas).',
      action: {
        label: 'Desfazer',
        onClick: () => void publicarAnuncio(a.id).then(atualizar),
      },
    });
  }

  async function trocarDestaque(destaque: Destaque) {
    if (destaque === a.destaque) return;
    setAgindo('destaque');
    const r = await escolherDestaque(a.id, destaque);
    setAgindo(null);
    atualizar();
    if (!r.ok) toast.error('O destaque não mudou.', { description: fraseDaRecusa(r.motivo) });
  }

  async function confirmarExclusao(motivo: string) {
    setAgindo('excluir');
    const r = await excluirAnuncio(a.id, motivo);
    setAgindo(null);
    if (!r.ok) {
      toast.error('Não deu para excluir.', { description: fraseDaRecusa(r.motivo) });
      return;
    }
    setExcluir(false);
    atualizar();
    toast.success(`${a.codigo} excluído. Ele está em Anúncios → Excluídos.`);
  }

  async function restaurar() {
    setAgindo('restaurar');
    const r = await restaurarAnuncio(a.id);
    setAgindo(null);
    if (!r.ok) {
      toast.error('Não deu para restaurar.', { description: fraseDaRecusa(r.motivo) });
      return;
    }
    toast.success(`${a.codigo} voltou para a lista, fora do ar.`);
    atualizar();
  }

  // A ação que o anúncio pede agora (uma só). Na grade ela ocupa a largura do
  // cartão; na lista fica do tamanho do texto, embaixo dos números.
  const { semVaga } = travasDoPlano(plano, {
    situacao: a.situacao,
    destaque: a.destaque,
    ocupaVagaPeloRelatorio: ocupaVagaPeloRelatorio(a),
    destaqueNoRelatorio: a.no_canal_pro_com_destaque === true,
  });
  const pendencias = a.pendencias ?? [];
  const soFaltaFoto = pendencias.length > 0 && pendencias.every((p) => /foto/i.test(p));
  const larguraDaAcao = modo === 'grade' ? 'w-full' : 'w-fit';
  let acao: React.ReactNode = null;
  if (podePublicar) {
    if (excluido) {
      acao = (
        <Button
          variant="outline"
          className={cn('toque h-11 md:h-9', larguraDaAcao)}
          disabled={agindo !== null}
          onClick={() => void restaurar()}
        >
          <ArchiveRestore aria-hidden="true" />
          {agindo === 'restaurar' ? 'Restaurando...' : 'Restaurar'}
        </Button>
      );
    } else if (faltamFotos > 0 && a.fotos === 0) {
      acao = (
        <Button className={cn('toque h-11 md:h-9', larguraDaAcao)} onClick={aoSincronizar}>
          <Camera aria-hidden="true" />
          Trazer fotos
        </Button>
      );
    } else if (
      foraDoArquivo(a) ||
      (a.situacao === 'rascunho' && pendencias.length > 0 && !soFaltaFoto)
    ) {
      acao = (
        <Button
          asChild
          variant={foraDoArquivo(a) ? 'default' : 'outline'}
          className={cn('toque h-11 md:h-9', larguraDaAcao)}
        >
          <Link href={linkDoAnuncio}>
            <Pencil aria-hidden="true" />
            {foraDoArquivo(a) ? 'Corrigir' : 'Completar'}
          </Link>
        </Button>
      );
    } else if (
      a.situacao !== 'no_ar' &&
      pendencias.length === 0 &&
      situacaoForaDoCrm(a) !== 'ativo'
    ) {
      acao = (
        <Button
          variant="outline"
          className={cn('toque h-11 md:h-9', larguraDaAcao)}
          disabled={agindo !== null || semVaga}
          title={semVaga ? 'Plano cheio: tire outro do ar antes' : undefined}
          onClick={() => void publicar()}
        >
          <CloudUpload aria-hidden="true" />
          {agindo === 'publicar' ? 'Pondo no ar...' : semVaga ? 'Sem vaga' : 'Pôr no ar'}
        </Button>
      );
    }
  }

  const menu = (
    <MenuDoAnuncio
      anuncio={a}
      podePublicar={podePublicar}
      plano={plano}
      agindo={agindo}
      linkDoAnuncio={linkDoAnuncio}
      linkDosLeads={linkDosLeads}
      aoCopiar={() => void copiarCodigo()}
      aoPublicar={() => void publicar()}
      aoTirar={() => void tirar()}
      aoDestacar={(d) => void trocarDestaque(d)}
      aoExcluir={() => setExcluir(true)}
      aoRestaurar={() => void restaurar()}
    />
  );

  const titulo = (
    <h2
      className={cn(
        'min-w-0 flex-1 leading-[1.35] font-semibold tracking-tight',
        modo === 'grade' ? 'text-[15px]' : 'text-sm',
      )}
    >
      <button
        type="button"
        onClick={aoAbrir}
        className={cn(
          'line-clamp-2 rounded-sm text-left outline-none hover:underline hover:underline-offset-4 focus-visible:ring-3 focus-visible:ring-ring/50',
          modo === 'grade' ? 'min-h-10' : 'min-h-9',
          !a.titulo.trim() && 'font-normal text-muted-foreground italic',
        )}
      >
        {a.titulo.trim() || 'Sem título'}
      </button>
    </h2>
  );

  const leads = (
    <Link
      href={linkDosLeads}
      title="Leads deste anúncio no CRM"
      className="toque -mx-1.5 -my-2 inline-flex h-10 items-center gap-1 rounded-full px-1.5 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <UserRound className="size-3.5" aria-hidden="true" />
      <span className="numerico">{a.leads}</span>
      <span className="sr-only">{a.leads === 1 ? 'lead' : 'leads'} no CRM</span>
    </Link>
  );

  const visualizacoesNoCanalPro =
    visualizacoes !== null ? (
      <span className="inline-flex items-center gap-1" title="Visualizações no Canal Pro">
        <Eye className="size-3.5" aria-hidden="true" />
        <span className="numerico">{visualizacoes.toLocaleString('pt-BR')}</span>
        <span className="sr-only">visualizações no Canal Pro</span>
      </span>
    ) : null;

  const linhaDasCopias = copias.length ? (
    <button
      type="button"
      onClick={aoAbrir}
      className={cn(
        '-my-2 inline-flex min-h-10 w-fit items-center gap-1 rounded-sm text-left text-xs outline-none hover:underline hover:underline-offset-4 focus-visible:ring-3 focus-visible:ring-ring/50',
        ativas.length ? 'font-medium text-morno-texto' : 'text-muted-foreground',
      )}
    >
      {ativas.length ? (
        <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <Layers className="size-3.5 shrink-0" aria-hidden="true" />
      )}
      {ativas.length
        ? ativas.length === 1
          ? 'Cópia antiga ainda ativa no Canal Pro'
          : `${ativas.length} cópias antigas ainda ativas no Canal Pro`
        : copias.length === 1
          ? '1 cópia antiga juntada'
          : `${copias.length} cópias antigas juntadas`}
    </button>
  ) : null;

  return (
    <li className="min-w-0">
      {modo === 'grade' ? (
        <article
          aria-label={`Anúncio ${a.codigo}`}
          className="sombra-base flex h-full min-w-0 flex-col overflow-hidden rounded-xl bg-card"
        >
          {a.fotos > 1 ? (
            <CarrosselDeFotos
              codigo={a.codigo}
              capa={a.capa}
              caminhos={caminhosDasFotos}
              fotos={a.fotos}
              noCanalPro={propria?.fotos ?? null}
              apagada={excluido || estado.tom === 'fora'}
              destaque={destaque}
              aoAbrir={aoAbrirNaFoto}
            />
          ) : (
            <Foto
              modo="grade"
              caminho={a.capa}
              fotos={a.fotos}
              noCanalPro={propria?.fotos ?? null}
              apagada={excluido || estado.tom === 'fora'}
              destaque={destaque}
              aoAbrir={aoAbrir}
              codigo={a.codigo}
            />
          )}

          <div className="flex min-w-0 flex-1 flex-col gap-1.5 px-3.5 pt-3 pb-3.5">
            <div className="flex items-start gap-1.5">
              {titulo}
              <div className="-mt-1.5 -mr-2">{menu}</div>
            </div>

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted-foreground">
              <button
                type="button"
                onClick={() => void copiarCodigo()}
                title="Copiar o código"
                aria-label={`Copiar o código ${a.codigo}`}
                className="toque group -my-[7px] inline-flex h-10 max-w-full items-center rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="inline-flex h-[26px] max-w-full items-center gap-1 rounded-lg border border-border bg-card px-2 text-xs font-semibold text-foreground group-hover:bg-muted">
                  <Copy className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="numerico truncate">{a.codigo}</span>
                </span>
              </button>
              {medidas ? <span className="numerico">{medidas}</span> : null}
            </div>

            {lugar ? (
              <p className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted-foreground">
                <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{lugar}</span>
              </p>
            ) : null}

            <Preco texto={precoDoAnuncio(a)} className="text-[19px]" />
            {linhaDasCopias}

            <div className="mt-auto flex flex-wrap items-center justify-between gap-x-2.5 gap-y-2 border-t border-hairline pt-2.5">
              <EtiquetaDaSituacao estado={estado} />
              <span className="flex items-center gap-2.5 text-[12.5px] text-muted-foreground">
                {visualizacoesNoCanalPro}
                {contatos !== null ? (
                  <span className="inline-flex items-center gap-1" title="Contatos no Canal Pro">
                    <MessageSquare className="size-3.5" aria-hidden="true" />
                    <span className="numerico">{contatos}</span>
                    <span className="sr-only">contatos no Canal Pro</span>
                  </span>
                ) : null}
                {leads}
              </span>
            </div>
            {acao ? <div className="pt-1">{acao}</div> : null}
          </div>
        </article>
      ) : (
        <article
          aria-label={`Anúncio ${a.codigo}`}
          className="sombra-base grid min-w-0 grid-cols-[6.5rem_minmax(0,1fr)_auto] items-start gap-3 rounded-xl bg-card p-2.5"
        >
          <Foto
            modo="lista"
            caminho={a.capa}
            fotos={a.fotos}
            noCanalPro={propria?.fotos ?? null}
            apagada={excluido || estado.tom === 'fora'}
            destaque={null}
            aoAbrir={aoAbrir}
            codigo={a.codigo}
          />
          <div className="flex min-w-0 flex-col gap-1">
            {titulo}
            <Preco texto={precoDoAnuncio(a)} className="text-base" />
            <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <span className="numerico shrink-0 font-semibold text-foreground">{a.codigo}</span>
              {a.bairro || a.cidade ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="truncate">{a.bairro || a.cidade}</span>
                </>
              ) : null}
            </p>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-muted-foreground">
              <EtiquetaDaSituacao estado={estado} />
              {destaque ? (
                <span className="inline-flex h-6 items-center gap-1 rounded-full bg-menta-fundo px-2 font-semibold text-menta-texto">
                  <Flame className="size-3.5" aria-hidden="true" />
                  {destaque}
                </span>
              ) : null}
              <span className="flex items-center gap-2.5">
                {visualizacoesNoCanalPro}
                {leads}
              </span>
            </div>
            {linhaDasCopias}
            {acao ? <div className="pt-1">{acao}</div> : null}
          </div>
          <div className="-mt-1 -mr-1">{menu}</div>
        </article>
      )}

      {podePublicar && !excluido ? (
        <DialogoExcluir
          aberto={excluir}
          aoFechar={() => setExcluir(false)}
          titulo={`Excluir ${a.codigo}`}
          descricao={
            <>
              {a.situacao !== 'no_ar' && situacaoForaDoCrm(a) === 'ativo' ? (
                <p>
                  Ele está no portal pelo sistema atual, não pelo CRM: excluir aqui não o tira de lá
                  enquanto o Canal Pro ler o arquivo do sistema atual. Para tirar agora, tire por
                  esse sistema.
                </p>
              ) : (
                <p>
                  O anúncio sai da lista e do arquivo do Canal Pro; se estiver no ar, sai do portal
                  na próxima leitura do Grupo OLX.
                </p>
              )}
              <p>
                Nada é apagado: ele fica em Anúncios → Excluídos e volta, fora do ar, pelo
                Restaurar.
              </p>
            </>
          }
          rotuloConfirmar="Excluir"
          motivo="obrigatorio"
          exemploDeMotivo="Imóvel vendido"
          ocupado={agindo === 'excluir'}
          aoConfirmar={(m) => void confirmarExclusao(m)}
        />
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Pedaços do cartão
// ---------------------------------------------------------------------------

function Foto({
  modo,
  caminho,
  fotos,
  noCanalPro,
  apagada,
  destaque,
  aoAbrir,
  codigo,
}: {
  modo: ModoDaLista;
  caminho: string | null;
  fotos: number;
  /** Quantas o Canal Pro tem (do último relatório ou sincronização). */
  noCanalPro: number | null;
  apagada: boolean;
  /** O nome do destaque no portal, quando há (só na grade). */
  destaque: string | null;
  aoAbrir: () => void;
  codigo: string;
}) {
  const grade = modo === 'grade';
  return (
    <button
      type="button"
      onClick={aoAbrir}
      aria-label={`Abrir a ficha de ${codigo}`}
      className={cn(
        'relative block shrink-0 overflow-hidden bg-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        grade ? 'aspect-[4/3] w-full' : 'h-[5.5rem] w-[6.5rem] rounded-lg',
      )}
    >
      {caminho ? (
        // eslint-disable-next-line @next/next/no-img-element -- foto do balde público, sem otimizador do Next
        <img
          src={urlDaFoto(caminho)}
          alt=""
          loading="lazy"
          className={cn(
            'absolute inset-0 size-full object-cover',
            apagada && 'opacity-60 grayscale',
          )}
        />
      ) : (
        <span
          className={cn(
            'absolute inset-0 flex flex-col items-center justify-center bg-[repeating-linear-gradient(135deg,var(--muted)_0_10px,transparent_10px_20px)] text-center text-muted-foreground',
            grade ? 'gap-1 px-3 text-xs' : 'gap-0.5 px-1.5 text-[11px] leading-tight',
          )}
        >
          <ImageOff className={grade ? 'size-6' : 'size-4'} aria-hidden="true" />
          <span className="font-medium text-foreground">Sem fotos no CRM</span>
          {noCanalPro ? (
            <span>
              {grade ? 'o Canal Pro tem ' : 'Canal Pro: '}
              <span className="numerico font-medium">{noCanalPro}</span>
            </span>
          ) : null}
        </span>
      )}
      {fotos > 0 ? (
        <SeloDasFotos grade={grade}>{contagemDasFotos(fotos, noCanalPro)}</SeloDasFotos>
      ) : null}
      {grade && destaque ? <SeloDoDestaque>{destaque}</SeloDoDestaque> : null}
    </button>
  );
}

function MenuDoAnuncio({
  anuncio: a,
  podePublicar,
  plano,
  agindo,
  linkDoAnuncio,
  linkDosLeads,
  aoCopiar,
  aoPublicar,
  aoTirar,
  aoDestacar,
  aoExcluir,
  aoRestaurar,
}: {
  anuncio: AnuncioNaLista;
  podePublicar: boolean;
  plano: SituacaoDoCanalPro['plano'] | null;
  agindo: Agindo;
  linkDoAnuncio: string;
  linkDosLeads: string;
  aoCopiar: () => void;
  aoPublicar: () => void;
  aoTirar: () => void;
  aoDestacar: (d: Destaque) => void;
  aoExcluir: () => void;
  aoRestaurar: () => void;
}) {
  const excluido = a.excluido_em !== null;
  const noAr = a.situacao === 'no_ar';
  const pendente = (a.pendencias?.length ?? 0) > 0;
  // O plano do Canal Pro, com a mesma conta do editor: quem recusa é o banco
  // (migrações 20261104180000 e 20261111203000); o menu só avisa antes do clique.
  // O anúncio que o relatório já conta não é barrado: só ocuparia a própria vaga,
  // e o próprio destaque, quando a linha dele é destaque (19/11/2026).
  const { semVaga, semDestaque, destaqueBarrado } = travasDoPlano(plano, {
    situacao: a.situacao,
    destaque: a.destaque,
    ocupaVagaPeloRelatorio: ocupaVagaPeloRelatorio(a),
    destaqueNoRelatorio: a.no_canal_pro_com_destaque === true,
  });
  const motivoParaNaoPublicar = pendente
    ? 'falta preencher'
    : semVaga
      ? 'plano cheio'
      : destaqueBarrado
        ? 'sem vaga de destaque'
        : null;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="toque size-11 shrink-0 rounded-full md:size-10"
          title="Ações do anúncio"
        >
          <EllipsisVertical aria-hidden="true" />
          <span className="sr-only">Ações do anúncio {a.codigo}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-64 rounded-2xl p-1.5 [&_[role=menuitem]]:min-h-10 [&_[role=menuitem]]:rounded-[10px] [&_[role=menuitem]]:px-3 [&_[role=menuitemradio]]:min-h-10 [&_[role=menuitemradio]]:rounded-[10px] [&_[role=menuitemradio]]:pl-3"
      >
        <DropdownMenuItem asChild>
          <Link href={linkDoAnuncio}>
            <Pencil aria-hidden="true" />
            {excluido ? 'Abrir o anúncio' : 'Editar o anúncio'}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={aoCopiar}>
          <Copy aria-hidden="true" />
          Copiar código
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={linkDosLeads}>
            <UserRound aria-hidden="true" />
            Ver os leads
          </Link>
        </DropdownMenuItem>

        {podePublicar && excluido ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={agindo !== null} onSelect={aoRestaurar}>
              <ArchiveRestore aria-hidden="true" />
              {agindo === 'restaurar' ? 'Restaurando...' : 'Restaurar'}
            </DropdownMenuItem>
          </>
        ) : null}

        {podePublicar && !excluido ? (
          <>
            <DropdownMenuSeparator />
            {noAr ? (
              <DropdownMenuItem disabled={agindo !== null} onSelect={aoTirar}>
                <CloudOff aria-hidden="true" />
                {agindo === 'tirar' ? 'Tirando...' : 'Tirar do ar'}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                disabled={agindo !== null || motivoParaNaoPublicar !== null}
                onSelect={aoPublicar}
              >
                <CloudUpload aria-hidden="true" />
                {agindo === 'publicar'
                  ? 'Pondo no ar...'
                  : motivoParaNaoPublicar
                    ? `Pôr no ar (${motivoParaNaoPublicar})`
                    : 'Pôr no ar'}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="px-3 text-xs font-normal text-muted-foreground">
              Destaque no portal
              {plano?.destaques != null
                ? ` · ${plano.destaquesEmUso} de ${plano.destaques} em uso`
                : ''}
              {plano?.destaques != null ? (
                <span className="mt-0.5 block text-[11px] leading-snug">
                  {DESTACADOR_AUTOMATICO}
                </span>
              ) : null}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={a.destaque}
              onValueChange={(d) => aoDestacar(d as Destaque)}
            >
              {DESTAQUES.filter((d) => !d.zapMais || d.id === a.destaque).map((d) => (
                <DropdownMenuRadioItem
                  key={d.id}
                  value={d.id}
                  disabled={
                    agindo !== null || (semDestaque && d.id !== 'padrao' && d.id !== a.destaque)
                  }
                >
                  {d.rotulo}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" disabled={agindo !== null} onSelect={aoExcluir}>
              <Trash2 aria-hidden="true" />
              Excluir anúncio
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const COR_DA_FAIXA: Record<FaixaDaNota, string> = {
  boa: 'bg-cliente',
  media: 'bg-morno',
  baixa: 'bg-destructive',
};

export function BotaoDaNota({ nota, aoAbrir }: { nota: number; aoAbrir: () => void }) {
  return (
    <button
      type="button"
      onClick={aoAbrir}
      aria-haspopup="dialog"
      aria-label={`Qualidade do anúncio: ${formatarNota(nota)} de 10. Ver o que sobe a nota.`}
      className="toque -mx-1.5 flex min-h-9 items-center gap-3 rounded-lg px-1.5 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span className="text-sm">Qualidade do anúncio</span>
      <span className="h-2 w-24 overflow-hidden rounded-full bg-foreground/10 sm:w-36">
        <span
          className={cn('block h-full rounded-full', COR_DA_FAIXA[faixaDaNota(nota)])}
          style={{ width: `${Math.min(100, Math.max(0, nota * 10))}%` }}
        />
      </span>
      <span className="text-sm numerico">
        <span className="font-semibold underline decoration-dotted underline-offset-4">
          {formatarNota(nota)}
        </span>
        <span className="text-muted-foreground">/10</span>
      </span>
    </button>
  );
}

const PONTOS = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

export function DialogoDaNota({
  aberto,
  aoMudar,
  nota,
  itens,
  linkDoAnuncio,
}: {
  aberto: boolean;
  aoMudar: (aberto: boolean) => void;
  nota: number;
  itens: ItemDaNota[];
  linkDoAnuncio: string | null;
}) {
  const faltam = itens
    .filter((i) => i.pontos < i.maximo)
    .sort((x, y) => y.maximo - y.pontos - (x.maximo - x.pontos));
  const cheios = itens.filter((i) => i.pontos >= i.maximo);
  return (
    <Dialog open={aberto} onOpenChange={aoMudar}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Qualidade do anúncio: <span className="numerico">{formatarNota(nota)}</span>/10
          </DialogTitle>
          <DialogDescription>
            A nota é calculada pelo CRM com as regras do portal e pode ser diferente da nota que
            aparece no Canal Pro.
          </DialogDescription>
        </DialogHeader>
        {faltam.length ? (
          <section className="flex flex-col gap-1">
            <h3 className="text-sm font-medium">O que sobe a nota</h3>
            <ul className="flex flex-col divide-y divide-hairline">
              {faltam.map((i) => (
                <ItemDoDialogo key={i.id} item={i} />
              ))}
            </ul>
          </section>
        ) : (
          <p className="text-sm">Tudo no máximo.</p>
        )}
        {cheios.length ? (
          <section className="flex flex-col gap-1">
            <h3 className="text-sm font-medium">Já no máximo</h3>
            <ul className="flex flex-col divide-y divide-hairline">
              {cheios.map((i) => (
                <ItemDoDialogo key={i.id} item={i} />
              ))}
            </ul>
          </section>
        ) : null}
        <DialogFooter>
          <Button variant="outline" className="toque h-11 md:h-9" onClick={() => aoMudar(false)}>
            Fechar
          </Button>
          {linkDoAnuncio ? (
            <Button asChild className="toque h-11 md:h-9">
              <Link href={linkDoAnuncio}>
                <Pencil aria-hidden="true" />
                Completar o anúncio
              </Link>
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ItemDoDialogo({ item }: { item: ItemDaNota }) {
  const cheio = item.pontos >= item.maximo;
  return (
    <li className="flex items-start gap-2.5 py-2">
      {cheio ? (
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-cliente-texto" aria-hidden="true" />
      ) : (
        <CirclePlus className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{item.rotulo}</p>
        <p className="text-xs text-muted-foreground">{item.dica}</p>
      </div>
      <span className="shrink-0 text-sm whitespace-nowrap numerico">
        {formatarNota(item.pontos)}
        <span className="text-muted-foreground"> de {PONTOS.format(item.maximo)}</span>
      </span>
    </li>
  );
}
