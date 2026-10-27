'use client';

import { useId, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  Camera,
  Check,
  Copy,
  Link2,
  RefreshCw,
  Send,
  Trash2,
  UserMinus,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { iniciaisDe } from '@/lib/iniciais';
import { fraseDoArquivo } from '@/lib/midia-dos-grupos';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { DialogoConfirmar } from '@/components/admin/confirmar';
import { DialogoExcluir } from '@/components/exclusao/dialogo-excluir';

import { ConvidarNumaConversa } from './convidar';
import {
  CHAVE_DOS_GRUPOS,
  chaveDasAcoes,
  chaveDoFio,
  nomeDoParceiro,
  pedir,
  urlDoArquivo,
  type FioDoGrupo,
} from './dados';
import { ErroDoArquivo, subirCapaDoGrupo } from './midia';
import {
  AVISO_DA_CONTA_OFICIAL,
  contarPessoas,
  fraseDaFila,
  nomeDoParticipante,
  participantesAtivos,
  situacaoDasAcoes,
  telefoneLegivel,
} from './regras';
import {
  TETO_DA_DESCRICAO,
  TETO_DE_PESSOAS,
  TETO_DO_NOME,
  type AcaoCrua,
  type GrupoCru,
  type ParticipanteCru,
} from './tipos';

/**
 * O painel do grupo: tudo o que não é mensagem. A capa, o nome e a descrição;
 * o link de convite (copiar, trocar, mandar numa conversa); quem está dentro
 * (x de 8) e quem pediu para entrar; "Atualizar do WhatsApp" e "Apagar grupo".
 *
 * Cada botão daqui é um pedido à Meta: o painel diz "Esperando a Meta…" até o
 * worker fazer, e o porquê quando a Meta recusa.
 */
export function PainelDoGrupo({
  grupo,
  fio,
  acoes,
  aberto,
  aoFechar,
}: {
  grupo: GrupoCru;
  fio: FioDoGrupo | undefined;
  acoes: readonly AcaoCrua[];
  aberto: boolean;
  aoFechar: () => void;
}) {
  return (
    <Sheet open={aberto} onOpenChange={(estado) => (estado ? null : aoFechar())}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md"
      >
        <SheetHeader className="border-b border-hairline px-4 py-4 pr-14">
          <SheetTitle className="truncate font-heading text-lg">{grupo.assunto}</SheetTitle>
          <SheetDescription>
            {grupo.estado === 'ativo'
              ? `${contarPessoas(fio?.participantes ?? [], grupo.participantes_total).pessoas} de ${TETO_DE_PESSOAS} pessoas, contando a empresa`
              : 'O grupo não está ativo no WhatsApp.'}
          </SheetDescription>
        </SheetHeader>
        {aberto ? <Conteudo grupo={grupo} fio={fio} acoes={acoes} aoFechar={aoFechar} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function Conteudo({
  grupo,
  fio,
  acoes,
  aoFechar,
}: {
  grupo: GrupoCru;
  fio: FioDoGrupo | undefined;
  acoes: readonly AcaoCrua[];
  aoFechar: () => void;
}) {
  const clientes = useQueryClient();
  const ativo = grupo.estado === 'ativo';
  const situacao = situacaoDasAcoes(acoes);
  const fila = fraseDaFila(situacao.pendentes);

  const recarregar = () => {
    void clientes.invalidateQueries({ queryKey: chaveDasAcoes(grupo.id) });
    void clientes.invalidateQueries({ queryKey: chaveDoFio(grupo.id) });
    void clientes.invalidateQueries({ queryKey: CHAVE_DOS_GRUPOS });
  };

  const sincronizar = useMutation({
    mutationFn: () => pedir('grupo_sincronizar', { p_grupo_id: grupo.id }),
    onSuccess: () => {
      toast.success('Pedido à Meta.', {
        description: 'Nome, pessoas e link chegam em alguns segundos.',
      });
      recarregar();
    },
    onError: (e: Error) => toast.error('Não deu.', { description: e.message }),
  });

  const [apagando, setApagando] = useState(false);
  const apagar = useMutation({
    mutationFn: () => pedir('grupo_apagar', { p_grupo_id: grupo.id }),
    onSuccess: () => {
      setApagando(false);
      toast.success(
        grupo.estado === 'ativo' ? 'Pedido para apagar feito à Meta.' : 'Grupo apagado.',
      );
      recarregar();
      aoFechar();
    },
    onError: (e: Error) => toast.error('Não apagou.', { description: e.message }),
  });

  return (
    <div className="flex flex-col gap-6 px-4 py-4">
      {/* O que está esperando a Meta, e o que ela recusou. */}
      {fila ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">{fila}</p>
      ) : null}
      {grupo.estado === 'falhou' ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs leading-relaxed">
          <p className="font-medium text-destructive-texto">A Meta não criou o grupo.</p>
          {grupo.erro ? <p className="mt-1 text-muted-foreground">{grupo.erro}</p> : null}
          <p className="mt-1">{AVISO_DA_CONTA_OFICIAL}</p>
        </div>
      ) : grupo.estado === 'suspenso' ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed">
          A Meta suspendeu este grupo. Ninguém manda mensagem até ela liberar.
        </p>
      ) : grupo.estado === 'criando' ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          A Meta está criando o grupo. O link aparece aqui quando ela terminar.
        </p>
      ) : situacao.falha ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs leading-relaxed">
          <span className="font-medium text-destructive-texto">
            A Meta recusou {situacao.falha.rotulo}:
          </span>{' '}
          {situacao.falha.erro}
        </p>
      ) : grupo.erro ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">
          {grupo.erro}
        </p>
      ) : null}

      {ativo ? <Capa grupo={grupo} aoMudar={recarregar} /> : null}
      {/* A chave recomeça o formulário quando o nome ou a descrição mudam no
          WhatsApp (sincronização, outra pessoa do time). */}
      {ativo ? (
        <NomeEDescricao
          key={`${grupo.assunto}|${grupo.descricao ?? ''}`}
          grupo={grupo}
          aoMudar={recarregar}
        />
      ) : null}
      {ativo ? <LinkDeConvite grupo={grupo} aoMudar={recarregar} /> : null}
      {ativo && grupo.aprovacao === 'approval_required' ? (
        <Pedidos grupo={grupo} fio={fio} aoMudar={recarregar} />
      ) : null}
      {grupo.estado !== 'criando' && grupo.estado !== 'falhou' ? (
        <Pessoas grupo={grupo} fio={fio} aoMudar={recarregar} />
      ) : null}
      {grupo.organization_id ? <Parceiro id={grupo.organization_id} /> : null}

      <section className="flex flex-col gap-2 border-t border-hairline pt-4">
        {grupo.estado !== 'apagado' && grupo.estado !== 'criando' && grupo.estado !== 'falhou' ? (
          <Button
            variant="outline"
            onClick={() => sincronizar.mutate()}
            disabled={sincronizar.isPending}
            className="toque h-11 justify-start md:h-9"
          >
            <RefreshCw aria-hidden="true" />
            Atualizar do WhatsApp
          </Button>
        ) : null}
        {grupo.estado !== 'apagado' ? (
          <Button
            variant="destructive"
            onClick={() => setApagando(true)}
            className="toque h-11 justify-start md:h-9"
          >
            <Trash2 aria-hidden="true" />
            Apagar grupo
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">
            Grupo apagado. O histórico continua aqui no CRM.
          </p>
        )}
      </section>

      <DialogoExcluir
        aberto={apagando}
        aoFechar={() => setApagando(false)}
        titulo="Apagar o grupo"
        descricao={
          grupo.estado === 'ativo' || grupo.estado === 'suspenso' ? (
            <>
              <p>
                O grupo deixa de existir no WhatsApp:{' '}
                <strong>todo mundo sai, inclusive a empresa</strong>. Não dá para desfazer.
              </p>
              <p>O histórico das mensagens continua aqui no CRM.</p>
            </>
          ) : (
            <p>A Meta nunca criou este grupo. Ele só sai da lista.</p>
          )
        }
        rotuloConfirmar="Apagar grupo"
        ocupado={apagar.isPending}
        aoConfirmar={() => apagar.mutate()}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// A capa
// ---------------------------------------------------------------------------

function Capa({ grupo, aoMudar }: { grupo: GrupoCru; aoMudar: () => void }) {
  const seletor = useRef<HTMLInputElement>(null);
  const url = useQuery({
    queryKey: ['grupos', 'capa', grupo.id, grupo.foto_path],
    queryFn: () => urlDoArquivo({ grupoId: grupo.id }),
    enabled: Boolean(grupo.foto_path),
    staleTime: 4 * 60_000,
    retry: false,
  });

  const trocar = useMutation({
    mutationFn: async (arquivo: File) => {
      const caminho = await subirCapaDoGrupo(grupo.id, arquivo);
      await pedir('grupo_atualizar', { p_grupo_id: grupo.id, p_foto_path: caminho });
    },
    onSuccess: () => {
      toast.success('Foto enviada à Meta.', {
        description: 'O WhatsApp troca em alguns segundos.',
      });
      aoMudar();
    },
    onError: (e: Error) =>
      toast.error('A foto não foi.', {
        description: e instanceof ErroDoArquivo ? fraseDoArquivo(e.motivo) : e.message,
      }),
  });

  return (
    <section className="flex items-center gap-4">
      <Avatar className="size-16 shrink-0">
        {url.data ? <AvatarImage src={url.data} alt="" /> : null}
        <AvatarFallback className="bg-muted text-base font-medium text-muted-foreground">
          {iniciaisDe(grupo.assunto)}
        </AvatarFallback>
      </Avatar>
      <div className="flex flex-col gap-1">
        <input
          ref={seletor}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const arquivo = e.target.files?.[0];
            e.target.value = '';
            if (arquivo) trocar.mutate(arquivo);
          }}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => seletor.current?.click()}
          disabled={trocar.isPending}
          className="toque h-10 w-fit md:h-8"
        >
          <Camera aria-hidden="true" />
          {trocar.isPending ? 'Enviando…' : 'Trocar a foto'}
        </Button>
        <p className="text-[11px] text-muted-foreground">
          Quadrada, o meio da foto que você escolher.
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Nome e descrição
// ---------------------------------------------------------------------------

function NomeEDescricao({ grupo, aoMudar }: { grupo: GrupoCru; aoMudar: () => void }) {
  const id = useId();
  const [nome, setNome] = useState(grupo.assunto);
  const [descricao, setDescricao] = useState(grupo.descricao ?? '');
  const mudouNome = nome.trim() !== grupo.assunto.trim();
  const mudouDescricao = descricao.trim() !== (grupo.descricao ?? '').trim();

  const salvar = useMutation({
    mutationFn: () =>
      pedir('grupo_atualizar', {
        p_grupo_id: grupo.id,
        p_assunto: mudouNome ? nome.trim() : null,
        p_descricao: mudouDescricao ? descricao.trim() : null,
      }),
    onSuccess: () => {
      toast.success('Enviado à Meta.', { description: 'O WhatsApp atualiza em alguns segundos.' });
      aoMudar();
    },
    onError: (e: Error) => toast.error('Não salvou.', { description: e.message }),
  });

  const pode = (mudouNome || mudouDescricao) && nome.trim().length > 0 && !salvar.isPending;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-nome`} className="text-sm font-medium">
          Nome
        </label>
        <Input
          id={`${id}-nome`}
          value={nome}
          maxLength={TETO_DO_NOME}
          onChange={(e) => setNome(e.target.value)}
          className="h-11 md:h-9"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-descricao`} className="text-sm font-medium">
          Descrição
        </label>
        <textarea
          id={`${id}-descricao`}
          value={descricao}
          maxLength={TETO_DA_DESCRICAO}
          rows={3}
          onChange={(e) => setDescricao(e.target.value)}
          className="w-full rounded-xl border border-input bg-background px-3 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
        />
      </div>
      {mudouNome || mudouDescricao ? (
        <Button
          onClick={() => salvar.mutate()}
          disabled={!pode}
          className="toque h-11 w-fit md:h-9"
        >
          {salvar.isPending ? 'Enviando…' : 'Salvar no WhatsApp'}
        </Button>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// O link de convite
// ---------------------------------------------------------------------------

function LinkDeConvite({ grupo, aoMudar }: { grupo: GrupoCru; aoMudar: () => void }) {
  const [trocando, setTrocando] = useState(false);
  const [convidando, setConvidando] = useState(false);

  const novo = useMutation({
    mutationFn: () => pedir('grupo_novo_link', { p_grupo_id: grupo.id }),
    onSuccess: () => {
      setTrocando(false);
      toast.success('Pedido feito à Meta.', {
        description: 'O link novo aparece em alguns segundos.',
      });
      aoMudar();
    },
    onError: (e: Error) => toast.error('Não trocou.', { description: e.message }),
  });

  const copiar = async () => {
    if (!grupo.link_convite) return;
    try {
      await navigator.clipboard.writeText(grupo.link_convite);
      toast.success('Link copiado.');
    } catch {
      toast.error('O navegador não deixou copiar.');
    }
  };

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Link de convite</h3>
      {grupo.link_convite ? (
        <>
          <p className="flex items-center gap-2 rounded-xl border border-hairline px-3 py-2 text-sm">
            <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{grupo.link_convite}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => void copiar()}
              className="toque size-9 shrink-0 md:size-7"
            >
              <Copy aria-hidden="true" />
              <span className="sr-only">Copiar o link</span>
            </Button>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setConvidando(true)} className="toque h-11 md:h-9">
              <Send aria-hidden="true" />
              Mandar convite numa conversa
            </Button>
            <Button
              variant="outline"
              onClick={() => setTrocando(true)}
              className="toque h-11 md:h-9"
            >
              <RefreshCw aria-hidden="true" />
              Gerar novo link
            </Button>
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          O grupo ainda não tem link. Toque em “Atualizar do WhatsApp”, lá embaixo.
        </p>
      )}

      <DialogoConfirmar
        aberto={trocando}
        aoFechar={() => setTrocando(false)}
        titulo="Gerar novo link"
        descricao={
          <p>
            O link de agora <strong>para de funcionar na hora</strong>. Quem recebeu e ainda não
            entrou vai precisar do novo.
          </p>
        }
        rotuloConfirmar="Gerar novo link"
        ocupado={novo.isPending}
        aoConfirmar={() => novo.mutate()}
      />
      <ConvidarNumaConversa
        grupo={grupo}
        aberto={convidando}
        aoFechar={() => setConvidando(false)}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Quem pediu para entrar
// ---------------------------------------------------------------------------

function Pedidos({
  grupo,
  fio,
  aoMudar,
}: {
  grupo: GrupoCru;
  fio: FioDoGrupo | undefined;
  aoMudar: () => void;
}) {
  const pedidos = fio?.pedidos ?? [];
  const { vagas } = contarPessoas(fio?.participantes ?? [], grupo.participantes_total);

  const decidir = useMutation({
    mutationFn: ({ ids, aprovar }: { ids: string[]; aprovar: boolean }) =>
      pedir('grupo_decidir', { p_grupo_id: grupo.id, p_pedidos: ids, p_aprovar: aprovar }),
    onSuccess: (_r, { aprovar }) => {
      toast.success(aprovar ? 'Aprovação enviada à Meta.' : 'Recusa enviada à Meta.');
      aoMudar();
    },
    onError: (e: Error) => toast.error('Não deu.', { description: e.message }),
  });

  if (pedidos.length === 0) {
    return (
      <section className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">Pedidos para entrar</h3>
        <p className="text-xs text-muted-foreground">Ninguém pediu para entrar agora.</p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">
          Pedidos para entrar{' '}
          <span className="numerico text-muted-foreground">{pedidos.length}</span>
        </h3>
        {pedidos.length > 1 && vagas >= pedidos.length ? (
          <Button
            size="sm"
            variant="outline"
            disabled={decidir.isPending}
            onClick={() => decidir.mutate({ ids: pedidos.map((p) => p.pedido_id), aprovar: true })}
            className="toque h-10 md:h-8"
          >
            Aprovar todos
          </Button>
        ) : null}
      </div>
      {vagas === 0 ? (
        <p className="text-xs text-destructive-texto">
          O grupo está cheio ({TETO_DE_PESSOAS} de {TETO_DE_PESSOAS}). Tire alguém para aprovar.
        </p>
      ) : null}
      <ul className="flex flex-col">
        {pedidos.map((p) => (
          <li
            key={p.pedido_id}
            className="flex items-center gap-2 border-b border-hairline py-2 last:border-b-0"
          >
            <span className="min-w-0 flex-1 truncate text-sm">
              {nomeDoParticipante(p.wa_id, fio?.participantes ?? [])}
            </span>
            <Button
              size="sm"
              disabled={decidir.isPending || vagas === 0}
              onClick={() => decidir.mutate({ ids: [p.pedido_id], aprovar: true })}
              className="toque h-10 md:h-8"
            >
              <Check aria-hidden="true" />
              Aprovar
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={decidir.isPending}
              onClick={() => decidir.mutate({ ids: [p.pedido_id], aprovar: false })}
              className="toque h-10 md:h-8"
            >
              <X aria-hidden="true" />
              Recusar
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Quem está no grupo
// ---------------------------------------------------------------------------

function Pessoas({
  grupo,
  fio,
  aoMudar,
}: {
  grupo: GrupoCru;
  fio: FioDoGrupo | undefined;
  aoMudar: () => void;
}) {
  const [tirando, setTirando] = useState<ParticipanteCru | null>(null);
  const todos = fio?.participantes ?? [];
  const ativos = participantesAtivos(todos);
  const { pessoas } = contarPessoas(todos, grupo.participantes_total);
  const ativo = grupo.estado === 'ativo';

  const remover = useMutation({
    mutationFn: (p: ParticipanteCru) =>
      pedir('grupo_remover', { p_grupo_id: grupo.id, p_wa_ids: [p.wa_id] }),
    onSuccess: () => {
      setTirando(null);
      toast.success('Pedido feito à Meta.');
      aoMudar();
    },
    onError: (e: Error) => toast.error('Não tirou.', { description: e.message }),
  });

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">
        Pessoas{' '}
        <span className="numerico text-muted-foreground">
          {pessoas} de {TETO_DE_PESSOAS}
        </span>
      </h3>
      <ul className="flex flex-col">
        <li className="flex items-center gap-2 border-b border-hairline py-2 text-sm text-muted-foreground">
          <Building2 className="size-4 shrink-0" aria-hidden="true" />O número da empresa
        </li>
        {ativos.map((p) => (
          <li
            key={p.wa_id}
            className="flex items-center gap-2 border-b border-hairline py-2 last:border-b-0"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm">{nomeDoParticipante(p.wa_id, todos)}</span>
              {p.nome ? (
                <span className="truncate text-[11px] text-muted-foreground">
                  {telefoneLegivel(p.wa_id)}
                </span>
              ) : null}
            </span>
            {ativo ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setTirando(p)}
                className="toque h-10 text-muted-foreground md:h-8"
              >
                <UserMinus aria-hidden="true" />
                Tirar
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {pessoas > ativos.length + 1 ? (
        <p className="text-[11px] text-muted-foreground">
          O CRM ainda não sabe o nome de todo mundo: quem não escreveu aparece depois de “Atualizar
          do WhatsApp”.
        </p>
      ) : null}

      <DialogoExcluir
        aberto={tirando !== null}
        aoFechar={() => setTirando(null)}
        titulo="Tirar do grupo"
        descricao={
          <p>
            {tirando ? nomeDoParticipante(tirando.wa_id, todos) : 'A pessoa'} sai do grupo e{' '}
            <strong>não consegue voltar pelo link</strong>: é regra da Meta.
          </p>
        }
        rotuloConfirmar="Tirar do grupo"
        ocupado={remover.isPending}
        aoConfirmar={() => tirando && remover.mutate(tirando)}
      />
    </section>
  );
}

function Parceiro({ id }: { id: string }) {
  const nome = useQuery({
    queryKey: ['grupos', 'parceiro', id],
    queryFn: () => nomeDoParceiro(id),
    staleTime: 5 * 60_000,
  });
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-sm font-medium">Parceiro</h3>
      <Link
        href={`/parceiros/${id}`}
        className="flex items-center gap-2 text-sm underline-offset-4 hover:underline"
      >
        <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        {nome.data ?? (nome.isPending ? 'Carregando…' : 'Abrir a ficha')}
      </Link>
    </section>
  );
}
