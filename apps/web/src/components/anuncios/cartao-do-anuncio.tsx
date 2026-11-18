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
  ImageOff,
  Layers,
  MessagesSquare,
  Pencil,
  Star,
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
  CHAVE_DOS_ANUNCIOS,
  escolherDestaque,
  excluirAnuncio,
  publicarAnuncio,
  restaurarAnuncio,
  tirarDoAr,
  urlDaFoto,
} from './dados';
import {
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

/** As cores de cada situação: quem publica muda a tinta, o resto fica neutro. */
export const TOM_DA_SITUACAO: Record<TomDoEstado, string> = {
  arbo: 'border border-primary/45 text-primary',
  espera: 'bg-primary/12 text-primary',
  crm: 'bg-primary text-primary-foreground',
  fora: 'bg-muted text-muted-foreground',
  rascunho: 'bg-morno-fundo text-morno-texto',
  alerta: 'bg-destructive/10 text-destructive-texto',
  excluido: 'bg-destructive/10 text-destructive-texto',
};

export function EtiquetaDaSituacao({ estado }: { estado: EstadoDoCartao }) {
  return (
    <span
      title={estado.dica}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap',
        TOM_DA_SITUACAO[estado.tom],
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {estado.rotulo}
    </span>
  );
}

/**
 * Um anúncio da lista (18/11/2026): um cartão por imóvel. A foto, o título (é por
 * ele que o time reconhece o imóvel), o código, o tipo, a área e o bairro, o
 * preço, UMA etiqueta de situação, os números do Canal Pro e dos leads, e uma
 * ação só, a que o anúncio pede agora. O resto mora na ficha (que abre por cima,
 * ao clicar) e no menu ⋮. As cópias antigas do mesmo imóvel no Canal Pro ficam
 * dentro do cartão, numa linha.
 *
 * Saíram do cartão (estão na ficha): a origem, as datas de criação e atualização
 * e a nota de qualidade. Até 18/11 o pé do cartão repetia a situação em três
 * lugares ("Publicado", "No portal pelo sistema atual · No Canal Pro: Ativo · no
 * CRM: rascunho").
 */
export function CartaoDoAnuncio({
  anuncio: a,
  doCanalPro,
  podePublicar,
  plano,
  aoAbrir,
  aoSincronizar,
}: {
  anuncio: AnuncioNaLista;
  doCanalPro: DoCanalPro | undefined;
  podePublicar: boolean;
  plano: SituacaoDoCanalPro['plano'] | null;
  aoAbrir: () => void;
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
  const meta = [
    tipo,
    area ? `${area.toLocaleString('pt-BR')} m²` : null,
    a.quartos ? `${a.quartos} ${a.quartos === 1 ? 'quarto' : 'quartos'}` : null,
    [a.bairro, a.cidade].filter(Boolean).join(', ') || null,
  ].filter((x): x is string => !!x);

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

  // A ação que o anúncio pede agora (uma só).
  const { semVaga } = travasDoPlano(plano, {
    situacao: a.situacao,
    destaque: a.destaque,
    ocupaVagaPeloRelatorio: ocupaVagaPeloRelatorio(a),
  });
  const pendencias = a.pendencias ?? [];
  const soFaltaFoto = pendencias.length > 0 && pendencias.every((p) => /foto/i.test(p));
  let acao: React.ReactNode = null;
  if (podePublicar) {
    if (excluido) {
      acao = (
        <Button
          variant="outline"
          className="toque h-11 md:h-9"
          disabled={agindo !== null}
          onClick={() => void restaurar()}
        >
          <ArchiveRestore aria-hidden="true" />
          {agindo === 'restaurar' ? 'Restaurando...' : 'Restaurar'}
        </Button>
      );
    } else if (faltamFotos > 0 && a.fotos === 0) {
      acao = (
        <Button className="toque h-11 md:h-9" onClick={aoSincronizar}>
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
          className="toque h-11 md:h-9"
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
          className="toque h-11 md:h-9"
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

  return (
    <li>
      <article
        aria-label={`Anúncio ${a.codigo}`}
        className="sombra-base flex flex-col overflow-hidden rounded-xl bg-card md:flex-row"
      >
        <Foto
          caminho={a.capa}
          fotos={a.fotos}
          noCanalPro={propria?.fotos ?? null}
          apagada={excluido || estado.tom === 'fora'}
          aoAbrir={aoAbrir}
          codigo={a.codigo}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-4 md:py-4 md:pr-4 md:pl-5">
          <div className="flex items-start gap-2">
            <h2 className="min-w-0 flex-1 text-[15px] leading-snug font-medium tracking-tight">
              <button
                type="button"
                onClick={aoAbrir}
                className={cn(
                  'line-clamp-2 rounded-sm text-left outline-none hover:underline hover:underline-offset-4 focus-visible:ring-3 focus-visible:ring-ring/50',
                  !a.titulo.trim() && 'text-muted-foreground italic',
                )}
              >
                {a.titulo.trim() || 'Sem título'}
              </button>
            </h2>
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
          </div>

          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-muted-foreground">
            <button
              type="button"
              onClick={() => void copiarCodigo()}
              title="Copiar o código"
              aria-label={`Copiar o código ${a.codigo}`}
              className="toque inline-flex h-6 max-w-full items-center gap-1 rounded-full border border-hairline px-2 text-xs font-medium text-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <Copy className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="numerico truncate">{a.codigo}</span>
            </button>
            {meta.map((m, i) => (
              <span key={m} className="inline-flex items-center gap-2.5">
                {i > 0 ? (
                  <span className="size-1 rounded-full bg-current opacity-50" aria-hidden="true" />
                ) : null}
                <span className="numerico">{m}</span>
              </span>
            ))}
          </div>

          <p className="text-xl leading-tight font-semibold tracking-tight numerico">
            {precoDoAnuncio(a)}
          </p>

          <div className="mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 border-t border-hairline pt-3">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-2">
              <EtiquetaDaSituacao estado={estado} />
              {a.destaque !== 'padrao' && !excluido ? (
                <span className="inline-flex h-7 items-center gap-1 rounded-full border border-menta/60 px-2.5 text-xs font-medium text-menta-texto">
                  <Star className="size-3.5" aria-hidden="true" />
                  {rotuloDoDestaque(a.destaque)}
                </span>
              ) : null}
              <span className="flex items-center gap-3 text-sm">
                {visualizacoes !== null ? (
                  <span
                    className="inline-flex items-center gap-1"
                    title="Visualizações no Canal Pro"
                  >
                    <Eye className="size-4 text-muted-foreground" aria-hidden="true" />
                    <span className="numerico font-medium">
                      {visualizacoes.toLocaleString('pt-BR')}
                    </span>
                    <span className="sr-only">visualizações no Canal Pro</span>
                  </span>
                ) : null}
                {contatos !== null ? (
                  <span className="inline-flex items-center gap-1" title="Contatos no Canal Pro">
                    <MessagesSquare className="size-4 text-muted-foreground" aria-hidden="true" />
                    <span className="numerico font-medium">{contatos}</span>
                    <span className="sr-only">contatos no Canal Pro</span>
                  </span>
                ) : null}
                <Link
                  href={linkDosLeads}
                  title="Leads deste anúncio no CRM"
                  className="toque inline-flex h-8 items-center gap-1 rounded-full px-1.5 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <UserRound className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span className="numerico font-medium">{a.leads}</span>
                  <span className="sr-only">{a.leads === 1 ? 'lead' : 'leads'} no CRM</span>
                </Link>
              </span>
              {copias.length ? (
                <button
                  type="button"
                  onClick={aoAbrir}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-sm text-xs outline-none hover:underline hover:underline-offset-4 focus-visible:ring-3 focus-visible:ring-ring/50',
                    ativas.length ? 'font-medium text-morno-texto' : 'text-muted-foreground',
                  )}
                >
                  {ativas.length ? (
                    <TriangleAlert className="size-3.5" aria-hidden="true" />
                  ) : (
                    <Layers className="size-3.5" aria-hidden="true" />
                  )}
                  {ativas.length
                    ? ativas.length === 1
                      ? 'Cópia antiga ainda ativa no Canal Pro'
                      : `${ativas.length} cópias antigas ainda ativas no Canal Pro`
                    : copias.length === 1
                      ? '1 cópia antiga juntada'
                      : `${copias.length} cópias antigas juntadas`}
                </button>
              ) : null}
            </div>
            {acao}
          </div>
        </div>
      </article>

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
  caminho,
  fotos,
  noCanalPro,
  apagada,
  aoAbrir,
  codigo,
}: {
  caminho: string | null;
  fotos: number;
  /** Quantas o Canal Pro tem (do último relatório ou sincronização). */
  noCanalPro: number | null;
  apagada: boolean;
  aoAbrir: () => void;
  codigo: string;
}) {
  return (
    <button
      type="button"
      onClick={aoAbrir}
      aria-label={`Abrir a ficha de ${codigo}`}
      className="relative block aspect-[16/9] w-full shrink-0 overflow-hidden bg-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:aspect-auto md:min-h-[176px] md:w-[30%] md:max-w-[260px]"
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
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-[repeating-linear-gradient(135deg,var(--muted)_0_12px,transparent_12px_24px)] px-3 text-center text-xs text-muted-foreground">
          <ImageOff className="size-6" aria-hidden="true" />
          <span className="font-medium text-foreground">Sem fotos no CRM</span>
          {noCanalPro ? (
            <span>
              o Canal Pro tem <span className="numerico font-medium">{noCanalPro}</span>
            </span>
          ) : null}
        </span>
      )}
      {fotos > 0 ? (
        <span className="absolute bottom-2 left-2 inline-flex h-6 items-center gap-1 rounded-full bg-background/85 px-2 text-xs font-medium text-foreground backdrop-blur-sm">
          <Camera className="size-3.5" aria-hidden="true" />
          <span className="numerico">
            {fotos}
            {noCanalPro !== null && noCanalPro > fotos ? ` de ${noCanalPro}` : ''}
          </span>
        </span>
      ) : null}
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
  // O anúncio que o relatório já conta não é barrado: só ocuparia a própria vaga.
  const { semVaga, semDestaque, destaqueBarrado } = travasDoPlano(plano, {
    situacao: a.situacao,
    destaque: a.destaque,
    ocupaVagaPeloRelatorio: ocupaVagaPeloRelatorio(a),
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
          variant="outline"
          size="icon"
          className="toque -mt-1 size-11 shrink-0 md:size-9"
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
