'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, Check, CircleHelp, Copy, ExternalLink, Import, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { CHAVE_DOS_ANUNCIOS, marcarExcluidoNoCanalPro, trazerParaOCrm } from './dados';
import { formatarQuando } from './no-portal';
import { ativoNoCanalPro } from './relatorio-canal-pro';
import {
  type AnuncioNaLista,
  type AnuncioNoCanalPro,
  fraseDaRecusa,
  precoDoAnuncio,
  SITUACOES,
  tipoDeImovel,
  URL_DO_CANAL_PRO,
} from './tipos';

/**
 * Um anúncio que está no Canal Pro por fora do CRM, na lista de Anúncios
 * (04/11/2026, à noite; decisão do usuário: "mostrar todos, migrar aos poucos").
 *
 * A PREMISSA CORRIGIDA (05/11/2026). Achávamos que eram todos cadastrados à mão.
 * Não: os da Imova vêm "Via Integração", do sistema que publica hoje, e só esse
 * sistema os tira do ar; no Canal Pro, só os "Via CanalPro" (manuais) se
 * excluem. O CRM não tira nenhum dos dois, então o botão GUIA ("Como tirar do
 * ar": os dois casos, o código e o caminho) e a gestão confirma que saiu.
 *
 * O REPETIDO (06/11/2026). A linha que parece o mesmo imóvel de um anúncio do
 * CRM ganha "Excluir duplicado": o Grupo OLX não deixa o CRM excluir no Canal
 * Pro, então o botão copia o código e abre o Canal Pro, a exclusão é um clique
 * lá, e o próximo relatório confere. Se ele ainda vier, a linha volta com o
 * aviso de que a exclusão não pegou (`marcado_excluido_em`).
 *
 * "Trazer para o CRM" cria o rascunho com o que o relatório tem e com o MESMO
 * código (`public.canal_pro_trazer`): quando o Canal Pro passar a ler o arquivo
 * do CRM, o anúncio continua o mesmo no portal. Só quando o código sai diferente
 * o original precisa sair do ar antes (o banco põe isso na lista do que falta).
 */
export function LinhaDoCanalPro({
  anuncio,
  trazido,
  pareceCom = null,
  podePublicar,
}: {
  anuncio: AnuncioNoCanalPro;
  /** O anúncio do CRM que veio deste, se alguém já o trouxe. */
  trazido: AnuncioNaLista | null;
  /**
   * O anúncio do CRM que parece o mesmo imóvel, com outro código (mesma cidade e
   * área): este é um anúncio antigo dele, e trazer criaria outro.
   */
  pareceCom?: AnuncioNaLista | null;
  podePublicar: boolean;
}) {
  const router = useRouter();
  const cliente = useQueryClient();
  const [comoTirar, setComoTirar] = useState(false);
  const [excluirDuplicado, setExcluirDuplicado] = useState(false);
  const [trazendo, setTrazendo] = useState(false);

  async function trazer() {
    setTrazendo(true);
    const r = await trazerParaOCrm(anuncio.id);
    setTrazendo(false);
    if (!r.ok) {
      toast.error('Não deu para trazer para o CRM.', { description: fraseDaRecusa(r.motivo) });
      return;
    }
    void cliente.invalidateQueries({ queryKey: CHAVE_DOS_ANUNCIOS });
    const mesmoCodigo = r.codigo === anuncio.codigo;
    toast.success(
      r.ja_existia
        ? `Ele já estava no CRM como ${r.codigo}.`
        : `Rascunho ${r.codigo} criado com o que o relatório tinha.`,
      {
        description: r.ja_existia
          ? undefined
          : mesmoCodigo
            ? 'Veio com o mesmo código. Complete as fotos, a descrição e o CEP.'
            : `Veio com outro código. Complete as fotos, a descrição e o CEP, e tire o original (${anuncio.codigo}) do ar antes de pôr este.`,
      },
    );
    router.push(`/anuncios/${r.anuncio_id}`);
  }

  const tipo = anuncio.tipo ?? (anuncio.tipo_crm ? tipoDeImovel(anuncio.tipo_crm).rotulo : null);

  return (
    <li className="flex flex-wrap items-start gap-3 px-3 py-3 md:px-4">
      <div className="flex min-w-0 flex-1 basis-72 items-start gap-3">
        <div className="flex h-[68px] w-[92px] shrink-0 items-center justify-center rounded-lg bg-muted">
          <Building2 className="size-5 text-muted-foreground" aria-hidden="true" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="truncate text-[15px] font-medium tracking-tight">
              {anuncio.titulo || <span className="text-muted-foreground">Sem título</span>}
            </p>
            <Badge variant="pilula">No Canal Pro</Badge>
            {anuncio.situacao ? <Badge variant="outline">{anuncio.situacao}</Badge> : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            Código <span className="numerico">{anuncio.codigo}</span>
            {tipo ? ` · ${tipo}` : ''}
            {anuncio.bairro ? ` · ${anuncio.bairro}` : ''}
            {anuncio.link ? (
              <>
                {' · '}
                <a
                  href={anuncio.link}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-4"
                >
                  ver no portal
                </a>
              </>
            ) : null}
          </p>
          <p className="text-sm numerico">
            {precoDoAnuncio({
              negocio: anuncio.negocio ?? 'venda',
              preco_venda: anuncio.preco_venda,
              preco_aluguel: anuncio.preco_aluguel,
              periodo_aluguel: 'mensal',
            })}
          </p>
          <p className="text-xs text-muted-foreground">
            {trazido ? (
              <>
                No CRM como{' '}
                <Link href={`/anuncios/${trazido.id}`} className="underline underline-offset-4">
                  {trazido.codigo}
                </Link>{' '}
                ({SITUACOES[trazido.situacao].toLowerCase()})
                {trazido.codigo === anuncio.codigo
                  ? ', com o mesmo código. Quando o Canal Pro passar a ler o arquivo do CRM, é o do CRM que vale.'
                  : '. Tire este original do ar antes de pôr o do CRM, senão o Grupo OLX recusa por duplicidade.'}
              </>
            ) : pareceCom ? (
              <>
                Anúncio repetido de{' '}
                <Link href={`/anuncios/${pareceCom.id}`} className="underline underline-offset-4">
                  {pareceCom.codigo}
                </Link>{' '}
                (mesma cidade e mesma área), mais antigo.
                {ativoNoCanalPro(anuncio.situacao)
                  ? ' Ocupa uma vaga do plano com o mesmo imóvel.'
                  : ' Está inativo e não ocupa vaga, mas continua na lista do Canal Pro.'}
              </>
            ) : ativoNoCanalPro(anuncio.situacao) ? (
              'O CRM ainda não mexe neste: ele sai do ar por onde entrou.'
            ) : (
              'Inativo no Canal Pro: não aparece no portal e não ocupa vaga do plano.'
            )}
          </p>
          {anuncio.marcado_excluido_em ? (
            <p className="text-xs font-medium">
              Marcado como excluído {formatarQuando(anuncio.marcado_excluido_em)}, mas o relatório
              importado {formatarQuando(anuncio.visto_em)} ainda o traz: a exclusão não pegou no
              Canal Pro.
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2 self-center">
        {podePublicar && pareceCom && !trazido ? (
          <Button
            type="button"
            variant="outline"
            className="toque h-11 md:h-9"
            onClick={() => setExcluirDuplicado(true)}
          >
            <Trash2 aria-hidden="true" />
            Excluir duplicado
          </Button>
        ) : null}
        {trazido || pareceCom ? null : (
          <Button
            type="button"
            variant="outline"
            className="toque h-11 md:h-9"
            disabled={trazendo}
            onClick={() => void trazer()}
          >
            <Import aria-hidden="true" />
            {trazendo ? 'Trazendo...' : 'Trazer para o CRM'}
          </Button>
        )}
        {podePublicar && !pareceCom && ativoNoCanalPro(anuncio.situacao) ? (
          <Button
            type="button"
            variant="ghost"
            className="toque h-11 md:h-9"
            onClick={() => setComoTirar(true)}
          >
            <CircleHelp aria-hidden="true" />
            Como tirar do ar
          </Button>
        ) : null}
      </div>
      <DialogoComoTirarDoAr
        anuncio={anuncio}
        aberto={comoTirar}
        aoFechar={() => setComoTirar(false)}
      />
      {pareceCom ? (
        <DialogoExcluirDuplicado
          anuncio={anuncio}
          original={pareceCom}
          aberto={excluirDuplicado}
          aoFechar={() => setExcluirDuplicado(false)}
        />
      ) : null}
    </li>
  );
}

/**
 * Como tirar do ar um anúncio que o CRM não controla. Depende de onde ele veio,
 * e o Canal Pro diz isso na coluna de origem da lista de anúncios: "Via
 * Integração" (do sistema que publica hoje) ou "Via CanalPro" (cadastrado à
 * mão). O diálogo explica os dois, dá o código e o caminho, e a gestão confirma
 * quando tiver saído; a confirmação tira o anúncio desta lista.
 */
function DialogoComoTirarDoAr({
  anuncio,
  aberto,
  aoFechar,
}: {
  anuncio: AnuncioNoCanalPro;
  aberto: boolean;
  aoFechar: () => void;
}) {
  const cliente = useQueryClient();
  const [marcando, setMarcando] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(anuncio.codigo);
      toast.success('Código copiado.');
    } catch {
      toast.error('Não consegui copiar. Selecione o código e copie à mão.');
    }
  }

  async function marcar(excluido: boolean) {
    setMarcando(true);
    const r = await marcarExcluidoNoCanalPro(anuncio.id, excluido);
    setMarcando(false);
    if (!r.ok) {
      toast.error('Não deu para marcar.', { description: fraseDaRecusa(r.motivo) });
      return;
    }
    void cliente.invalidateQueries({ queryKey: CHAVE_DOS_ANUNCIOS });
    if (excluido) {
      aoFechar();
      toast.success(`${anuncio.codigo} saiu da lista.`, {
        description: 'Se ele ainda aparecer no próximo relatório do Canal Pro, volta para a lista.',
        action: { label: 'Desfazer', onClick: () => void marcar(false) },
      });
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(estado) => !estado && !marcando && aoFechar()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Como tirar do ar</DialogTitle>
          <DialogDescription>
            O CRM ainda não tira este anúncio do ar. Por onde ele sai depende de como entrou no
            Canal Pro: a lista de anúncios de lá mostra a origem de cada um.
          </DialogDescription>
        </DialogHeader>

        <p className="flex flex-wrap items-center gap-2 text-sm">
          Código: <span className="numerico font-medium">{anuncio.codigo}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void copiar()}>
            <Copy aria-hidden="true" />
            Copiar
          </Button>
        </p>

        <div className="flex flex-col gap-3 text-sm">
          <section className="flex flex-col gap-1 rounded-lg border border-hairline p-3">
            <h3 className="font-medium">&ldquo;Via Integração&rdquo;</h3>
            <p className="text-muted-foreground">
              Veio do sistema que publica os anúncios da Imova hoje. Tire do ar por esse sistema.
              Ou, depois que o Canal Pro passar a ler o arquivo do CRM, traga o anúncio para cá e
              tire do ar pelo CRM.
            </p>
          </section>
          <section className="flex flex-col gap-1 rounded-lg border border-hairline p-3">
            <h3 className="font-medium">&ldquo;Via CanalPro&rdquo;</h3>
            <p className="text-muted-foreground">
              Foi cadastrado à mão. Abra o{' '}
              <a
                href={URL_DO_CANAL_PRO}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-foreground underline underline-offset-4"
              >
                Canal Pro
                <ExternalLink className="size-3.5" aria-hidden="true" />
              </a>
              , vá em Anúncios, busque pelo código e exclua pelos três pontinhos.
            </p>
          </section>
          <p className="text-muted-foreground">Saiu do ar? Confirme aqui e ele sai desta lista.</p>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={aoFechar} disabled={marcando}>
            Voltar
          </Button>
          <Button type="button" onClick={() => void marcar(true)} disabled={marcando}>
            {marcando ? 'Marcando...' : 'Já saiu do ar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Excluir o anúncio repetido (06/11/2026; escolha do usuário: "botão + 1 clique
 * lá"). O Grupo OLX não deixa o CRM excluir no Canal Pro: o botão copia o código
 * e abre o Canal Pro, onde a exclusão é um clique, e a gestão confirma aqui. A
 * confirmação tira a linha da lista e libera a vaga na conta do CRM; o próximo
 * relatório confere (se ainda vier, volta com o aviso). Também abre do caminho
 * até o primeiro lead (11/11/2026), que só tem o id, o código e a situação.
 */
export function DialogoExcluirDuplicado({
  anuncio,
  original,
  aberto,
  aoFechar,
}: {
  anuncio: Pick<AnuncioNoCanalPro, 'id' | 'codigo' | 'situacao'>;
  original: Pick<AnuncioNaLista, 'codigo'>;
  aberto: boolean;
  aoFechar: () => void;
}) {
  const cliente = useQueryClient();
  const [abriu, setAbriu] = useState(false);
  const [copiou, setCopiou] = useState(false);
  const [marcando, setMarcando] = useState(false);
  const ativo = ativoNoCanalPro(anuncio.situacao);

  async function abrirOCanalPro() {
    setAbriu(true);
    try {
      await navigator.clipboard.writeText(anuncio.codigo);
      setCopiou(true);
    } catch {
      setCopiou(false);
    }
  }

  async function marcar(excluido: boolean) {
    setMarcando(true);
    const r = await marcarExcluidoNoCanalPro(anuncio.id, excluido);
    setMarcando(false);
    if (!r.ok) {
      toast.error('Não deu para marcar.', { description: fraseDaRecusa(r.motivo) });
      return;
    }
    // A chave dos anúncios cobre a lista de baixo e a conta de vagas do plano.
    void cliente.invalidateQueries({ queryKey: CHAVE_DOS_ANUNCIOS });
    if (excluido) {
      fechar();
      toast.success(`${anuncio.codigo} saiu da lista.`, {
        description: `${ativo ? 'A vaga do plano voltou para a conta do CRM. ' : ''}O próximo relatório do Canal Pro confere: se ele ainda estiver lá, volta com um aviso.`,
        action: { label: 'Desfazer', onClick: () => void marcar(false) },
      });
    }
  }

  function fechar() {
    setAbriu(false);
    setCopiou(false);
    aoFechar();
  }

  return (
    <Dialog open={aberto} onOpenChange={(estado) => !estado && !marcando && fechar()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Excluir o anúncio repetido</DialogTitle>
          <DialogDescription>
            <span className="numerico">{anuncio.codigo}</span> é um anúncio antigo do mesmo imóvel
            de <span className="numerico">{original.codigo}</span>
            {ativo ? ' e ocupa uma vaga do plano' : ''}. O Grupo OLX não deixa o CRM excluir anúncio
            no Canal Pro: a exclusão é um clique lá.
          </DialogDescription>
        </DialogHeader>

        <ol className="flex flex-col gap-4 text-sm">
          <li className="flex flex-col gap-2">
            <span>
              <span className="font-medium">1.</span> Abra o Canal Pro. O CRM copia o código para
              você.
            </span>
            <Button
              asChild
              variant={abriu ? 'outline' : 'default'}
              className="toque h-11 w-fit md:h-9"
            >
              <a
                href={URL_DO_CANAL_PRO}
                target="_blank"
                rel="noreferrer"
                onClick={() => void abrirOCanalPro()}
              >
                <ExternalLink aria-hidden="true" />
                Copiar o código e abrir o Canal Pro
              </a>
            </Button>
            {abriu ? (
              <span
                className="flex items-center gap-1.5 text-xs text-muted-foreground"
                role="status"
              >
                {copiou ? (
                  <>
                    <Check className="size-3.5" aria-hidden="true" />
                    Código copiado: <span className="numerico">{anuncio.codigo}</span>
                  </>
                ) : (
                  <>
                    Não consegui copiar. O código é{' '}
                    <span className="numerico text-foreground">{anuncio.codigo}</span>.
                  </>
                )}
              </span>
            ) : null}
          </li>
          <li>
            <span className="font-medium">2.</span> No Canal Pro, em Anúncios, cole o código na
            busca. Nos três pontinhos do anúncio, clique em Excluir.
            <span className="mt-1 block text-xs text-muted-foreground">
              Se lá ele aparecer como &ldquo;Via Integração&rdquo; e não houver Excluir, deixe como
              está: ele sai quando o Canal Pro passar a ler o arquivo do CRM.
            </span>
          </li>
          <li>
            <span className="font-medium">3.</span> Volte aqui e confirme. O próximo relatório do
            Canal Pro confere.
          </li>
        </ol>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={fechar} disabled={marcando}>
            Voltar
          </Button>
          <Button type="button" onClick={() => void marcar(true)} disabled={marcando}>
            {marcando ? 'Marcando...' : 'Pronto, excluí'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
