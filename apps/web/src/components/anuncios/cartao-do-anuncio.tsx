'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArchiveRestore,
  BedDouble,
  Camera,
  Car,
  CircleCheck,
  CircleDashed,
  CircleOff,
  CirclePlus,
  Clock,
  CloudOff,
  CloudUpload,
  Copy,
  EllipsisVertical,
  Eye,
  ImageOff,
  MessagesSquare,
  Pencil,
  Ruler,
  ShowerHead,
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
  CHAVE_DOS_ANUNCIOS,
  escolherDestaque,
  excluirAnuncio,
  publicarAnuncio,
  restaurarAnuncio,
  tirarDoAr,
  urlDaFoto,
} from './dados';
import { formatarQuando } from './no-portal';
import {
  type Comodo,
  comodosDoCartao,
  enderecoDoCartao,
  faixaDaNota,
  type FaixaDaNota,
  diaDeCriacao,
  foraDoArquivo,
  formatarDia,
  fraseForaDoArquivo,
  formatarNota,
  type ItemDaNota,
  negociosDoCartao,
  noPortalPeloSistemaAtual,
  ocupaVagaPeloRelatorio,
  saiuDoSistemaAtual,
  situacaoForaDoCrm,
  qualidadeDoAnuncio,
  rotuloDaOrigem,
  seloDoAnuncio,
  type SeloDoAnuncio,
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

/**
 * Um anúncio da lista, no desenho do cartão do Canal Pro (05/11/2026): a foto
 * grande à esquerda (em cima, no celular), o endereço como título, os chips, a
 * área e os cômodos, o preço, as datas e, depois da linha, a nota de qualidade,
 * a situação, as visualizações e os leads. As ações moram no menu ⋮, com as
 * mesmas confirmações e avisos que tinham na linha e no editor.
 */
export function CartaoDoAnuncio({
  anuncio: a,
  podePublicar,
  plano,
}: {
  anuncio: AnuncioNaLista;
  podePublicar: boolean;
  plano: SituacaoDoCanalPro['plano'] | null;
}) {
  const cliente = useQueryClient();
  const [agindo, setAgindo] = useState<Agindo>(null);
  const [excluir, setExcluir] = useState(false);
  const [notaAberta, setNotaAberta] = useState(false);

  const excluido = a.excluido_em !== null;
  const endereco = enderecoDoCartao(a);
  const qualidade = useMemo(() => qualidadeDoAnuncio(a), [a]);
  const criacao = diaDeCriacao(a);
  const selo = seloDoAnuncio(a);
  const comodos = comodosDoCartao(a);
  const linkDoAnuncio = `/anuncios/${a.id}`;
  const linkDosLeads = `/anuncios/leads?anuncio=${encodeURIComponent(a.codigo)}`;

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
    toast.success('No ar. Entra no portal na próxima leitura do Grupo OLX (a cada 12 horas).');
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

  return (
    <li>
      <article
        aria-label={`Anúncio ${a.codigo}`}
        className="sombra-base flex flex-col overflow-hidden rounded-xl bg-card md:flex-row"
      >
        <Foto
          caminho={a.capa}
          fotos={a.fotos}
          href={linkDoAnuncio}
          apagada={excluido || a.situacao === 'pausado'}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-2 p-4 md:py-4 md:pr-4 md:pl-5">
          {/* Endereço, chips e o menu */}
          <div className="flex items-start gap-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5">
              <h2 className="mr-1 min-w-0 text-[15px] leading-snug font-medium tracking-tight break-words">
                <Link
                  href={linkDoAnuncio}
                  className="rounded-sm outline-none hover:underline hover:underline-offset-4 focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {endereco ?? (
                    <span className="text-muted-foreground">Endereço por preencher</span>
                  )}
                </Link>
              </h2>
              {negociosDoCartao(a.negocio).map((n) => (
                <Chip key={n} forte>
                  {n}
                </Chip>
              ))}
              <Chip>{rotuloDaOrigem(a)}</Chip>
              <button
                type="button"
                onClick={() => void copiarCodigo()}
                title="Copiar o código"
                aria-label={`Copiar o código ${a.codigo}`}
                className="toque inline-flex h-6 max-w-full items-center gap-1 rounded-full border border-hairline px-2 text-xs font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <Copy className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="numerico truncate">{a.codigo}</span>
              </button>
            </div>
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

          {/* O título do anúncio: é por ele que o time reconhece o imóvel */}
          <p className="-mt-0.5 line-clamp-2 text-sm text-muted-foreground sm:line-clamp-1">
            {a.titulo.trim() || 'Sem título'}
          </p>

          <LinhaDeComodos tipo={tipoDeImovel(a.tipo).rotulo} comodos={comodos} />

          <p className="text-xl leading-tight font-semibold tracking-tight numerico">
            {precoDoAnuncio(a)}
          </p>

          <p className="text-xs text-muted-foreground">
            <span
              className="whitespace-nowrap"
              title={
                criacao.doCanalPro
                  ? 'Data em que o anúncio foi criado no Canal Pro, do último relatório importado'
                  : 'Data em que o anúncio entrou no CRM'
              }
            >
              Criado em <span className="numerico">{criacao.dia}</span>
            </span>
            <span aria-hidden="true"> · </span>
            <span className="whitespace-nowrap">
              Atualizado em <span className="numerico">{formatarDia(a.updated_at)}</span>
            </span>
            {a.proprietario_nome ? (
              <>
                <span aria-hidden="true"> · </span>
                <span>Proprietário: {a.proprietario_nome}</span>
              </>
            ) : null}
          </p>

          {/* Depois da linha: qualidade, situação e números */}
          <div className="mt-auto flex flex-col gap-2 border-t border-hairline pt-3">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
              <BotaoDaNota nota={qualidade.nota} aoAbrir={() => setNotaAberta(true)} />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                {a.destaque !== 'padrao' && !excluido ? (
                  <span className="inline-flex h-7 items-center rounded-full border border-hairline px-2.5 text-xs font-medium">
                    {rotuloDoDestaque(a.destaque)}
                  </span>
                ) : null}
                <Selo selo={selo} />
                {a.no_canal_pro_visualizacoes !== null ? (
                  <span
                    className="inline-flex items-center gap-1 text-sm"
                    title="Visualizações no Canal Pro, do último relatório importado"
                  >
                    <Eye className="size-4 text-muted-foreground" aria-hidden="true" />
                    <span className="numerico">{a.no_canal_pro_visualizacoes}</span>
                    <span className="sr-only">
                      {a.no_canal_pro_visualizacoes === 1 ? 'visualização' : 'visualizações'} no
                      Canal Pro
                    </span>
                  </span>
                ) : null}
                {a.no_canal_pro_contatos !== null ? (
                  <span
                    className="inline-flex items-center gap-1 text-sm"
                    title="Contatos no Canal Pro (por qualquer meio), do último relatório importado"
                  >
                    <MessagesSquare className="size-4 text-muted-foreground" aria-hidden="true" />
                    <span className="numerico">{a.no_canal_pro_contatos}</span>
                    <span className="sr-only">
                      {a.no_canal_pro_contatos === 1 ? 'contato' : 'contatos'} no Canal Pro
                    </span>
                  </span>
                ) : null}
                <Link
                  href={linkDosLeads}
                  title="Ver os leads deste anúncio no CRM"
                  className="toque inline-flex h-8 items-center gap-1 rounded-full px-1.5 text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <UserRound className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span className="numerico">{a.leads}</span>
                  <span className="sr-only">{a.leads === 1 ? 'lead' : 'leads'}</span>
                </Link>
              </div>
            </div>
            <Avisos anuncio={a} podePublicar={podePublicar} />
          </div>
        </div>
      </article>

      <DialogoDaNota
        aberto={notaAberta}
        aoMudar={setNotaAberta}
        nota={qualidade.nota}
        itens={qualidade.itens}
        linkDoAnuncio={excluido ? null : linkDoAnuncio}
      />

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
  href,
  apagada,
}: {
  caminho: string | null;
  fotos: number;
  href: string;
  apagada: boolean;
}) {
  return (
    <Link
      href={href}
      tabIndex={-1}
      aria-hidden="true"
      className="relative block aspect-[16/9] w-full shrink-0 overflow-hidden bg-muted md:aspect-auto md:min-h-[212px] md:w-[34%]"
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
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
          <ImageOff className="size-6" />
          Sem fotos
        </span>
      )}
      {fotos > 0 ? (
        <span className="absolute bottom-2 left-2 inline-flex h-6 items-center gap-1 rounded-full bg-background/85 px-2 text-xs font-medium text-foreground backdrop-blur-sm">
          <Camera className="size-3.5" />
          <span className="numerico">{fotos}</span>
        </span>
      ) : null}
    </Link>
  );
}

function Chip({ children, forte = false }: { children: React.ReactNode; forte?: boolean }) {
  return (
    <span
      className={cn(
        'inline-block h-6 max-w-full truncate rounded-full px-2 text-xs leading-6 font-medium',
        forte ? 'bg-secondary text-secondary-foreground' : 'border border-hairline text-foreground',
      )}
    >
      {children}
    </span>
  );
}

const ICONE_DO_COMODO: Record<Comodo['id'], typeof Ruler> = {
  area: Ruler,
  quartos: BedDouble,
  banheiros: ShowerHead,
  vagas: Car,
};

function LinhaDeComodos({ tipo, comodos }: { tipo: string; comodos: Comodo[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-sm">
      <li className="text-muted-foreground">{tipo}</li>
      {comodos.map((c) => {
        const Icone = ICONE_DO_COMODO[c.id];
        return (
          <li key={c.id} className="inline-flex items-center gap-1" title={c.descricao}>
            <Icone className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="numerico" aria-hidden="true">
              {c.texto}
            </span>
            <span className="sr-only">{c.descricao}</span>
          </li>
        );
      })}
    </ul>
  );
}

const COR_DA_FAIXA: Record<FaixaDaNota, string> = {
  boa: 'bg-cliente',
  media: 'bg-morno',
  baixa: 'bg-destructive',
};

function BotaoDaNota({ nota, aoAbrir }: { nota: number; aoAbrir: () => void }) {
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

const TOM_DO_SELO: Record<SeloDoAnuncio['tom'], { classe: string; Icone: typeof Clock }> = {
  publicado: { classe: 'bg-cliente-fundo text-cliente-texto', Icone: CircleCheck },
  processando: { classe: 'bg-morno-fundo text-morno-texto', Icone: Clock },
  rascunho: { classe: 'border border-border text-foreground', Icone: CircleDashed },
  apagado: { classe: 'bg-muted text-muted-foreground', Icone: CircleOff },
  // No ar no CRM, mas fora do arquivo (11/11/2026): sai do portal sem ninguém pedir.
  alerta: { classe: 'bg-destructive/10 text-destructive-texto', Icone: TriangleAlert },
};

function Selo({ selo }: { selo: SeloDoAnuncio }) {
  const { classe, Icone } = TOM_DO_SELO[selo.tom];
  return (
    <span
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold',
        classe,
      )}
    >
      <Icone className="size-3.5" aria-hidden="true" />
      {selo.rotulo}
    </span>
  );
}

/**
 * As linhas pequenas do pé do cartão: à esquerda, o próximo passo (o que falta
 * para ir ao ar, ou se o Grupo OLX já levou); à direita, o que o portal diz do
 * anúncio por fora do CRM.
 */
function Avisos({ anuncio: a, podePublicar }: { anuncio: AnuncioNaLista; podePublicar: boolean }) {
  const excluido = a.excluido_em !== null;
  const leitura = a.ultima_leitura_do_portal;
  const fora = foraDoArquivo(a);
  let passo: string;
  if (excluido) {
    passo = `Excluído ${a.excluido_em ? formatarQuando(a.excluido_em) : ''}${
      a.motivo_exclusao ? `: “${a.motivo_exclusao}”` : '.'
    }`;
  } else if (fora) {
    // O arquivo só leva o que está no ar SEM pendência: este é pulado (11/11/2026).
    passo = fraseForaDoArquivo(a.pendencias ?? [], leitura);
  } else if (a.situacao === 'no_ar') {
    const lido = (iso: string | null) =>
      iso !== null && leitura !== null && new Date(leitura).getTime() > new Date(iso).getTime();
    passo = !lido(a.publicado_em)
      ? 'Entra no portal na próxima leitura do Grupo OLX (a cada 12 horas).'
      : !lido(a.updated_at)
        ? 'A última mudança chega ao portal na próxima leitura do Grupo OLX.'
        : `Levado pelo Grupo OLX ${formatarQuando(leitura!)}. Erros aparecem no relatório de integração do Canal Pro.`;
  } else if ((a.pendencias?.length ?? 0) > 0) {
    const p = a.pendencias!;
    passo = `Para ir ao ar falta: ${p.slice(0, 4).join(', ')}${p.length > 4 ? ` e mais ${p.length - 4}` : ''}.`;
  } else {
    passo = podePublicar ? 'Pronto para pôr no ar.' : 'Pronto: avise um gestor para pôr no ar.';
  }

  const saiu = saiuDoSistemaAtual(a) && !a.excluido_em;
  const portal = [
    saiu && a.sistema_atual_em
      ? `Saiu do sistema atual ${formatarQuando(a.sistema_atual_em)}`
      : noPortalPeloSistemaAtual(a) && situacaoForaDoCrm(a) === 'ativo'
        ? 'No portal pelo sistema atual'
        : null,
    a.no_canal_pro_situacao ? `No Canal Pro: ${a.no_canal_pro_situacao}` : null,
    a.situacao === 'rascunho' && (saiu || noPortalPeloSistemaAtual(a)) ? 'no CRM: rascunho' : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <p className={cn('min-w-0 flex-1 basis-64', fora && 'font-medium text-destructive-texto')}>
        {passo}
      </p>
      {portal.length ? (
        <p className="font-medium text-foreground sm:text-right">{portal.join(' · ')}</p>
      ) : null}
    </div>
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

const PONTOS = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

function DialogoDaNota({
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
