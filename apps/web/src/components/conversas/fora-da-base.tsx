'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Link2, Phone, UserPlus } from 'lucide-react';
import { toast } from 'sonner';

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
import { buscarAlvos } from '@/components/registro/alvos';
import { DEBOUNCE_BUSCA_MS, type SugestaoDeAlvo } from '@/components/registro/tipos';

import { ErroDaConversa } from './acoes';
import { CHAVE_CONVERSAS } from './dados';
import {
  carregarMensagensDoFio,
  chaveDasMensagensDoFio,
  criarFichaDaConversa,
  finalDoNumero,
  fraseDoResultado,
  vincularConversa,
  type ResultadoDaFicha,
} from './fora-da-base-dados';
import { rotuloDoDia } from './formatos';
import { Mensagem } from './mensagem-do-fio';
import { montarMensagens, type FioCru } from './mensagens';
import type { CatalogosConversas } from './montagem';

/**
 * A aba "Fora da base": quem escreveu para o número da KOMUNE e não é ficha.
 *
 * À esquerda, uma linha por conversa (o final do número e a última mensagem). À
 * direita, as mensagens e as duas saídas — ligar a uma ficha que já existe ou criar a
 * ficha. Ligada, a conversa sai daqui e abre na aba Conversas, na ficha.
 */
export function ListaForaDaBase({
  fios,
  selecionadoId,
  aoEscolher,
}: {
  fios: FioCru[];
  selecionadoId: string | null;
  aoEscolher: (id: string) => void;
}) {
  if (fios.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
        <p className="font-heading font-medium">Ninguém de fora da base escreveu</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          Quando um número que não é ficha mandar mensagem para a KOMUNE, a conversa aparece aqui
          para você criar a ficha ou ligar a uma que já existe.
        </p>
      </div>
    );
  }
  return (
    <ul className="flex flex-col">
      {fios.map((fio) => {
        const selecionado = fio.id === selecionadoId;
        return (
          <li key={fio.id} className="border-b border-hairline last:border-b-0">
            <button
              type="button"
              onClick={() => aoEscolher(fio.id)}
              aria-current={selecionado ? 'true' : undefined}
              className={cn(
                'flex min-h-[4.25rem] w-full items-center gap-3 px-4 py-3 text-left outline-none',
                'hover:bg-muted/50 focus-visible:bg-muted/60',
                selecionado && 'bg-muted',
              )}
            >
              <Phone className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 space-y-1">
                <span
                  className={cn(
                    'block truncate text-sm',
                    fio.unread_count > 0 ? 'font-semibold' : 'font-medium',
                  )}
                >
                  Número {finalDoNumero(fio.peer_phone_e164)}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {fio.unread_count > 0
                    ? `${fio.unread_count} ${fio.unread_count === 1 ? 'mensagem por ler' : 'mensagens por ler'}`
                    : 'Sem ficha'}
                </span>
              </span>
              {fio.last_message_at ? (
                <span className="numerico shrink-0 text-xs text-muted-foreground">
                  {rotuloDoDia(fio.last_message_at).palavra}
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function ConversaForaDaBase({
  fio,
  catalogos,
  aoVoltar,
  aoLigar,
}: {
  fio: FioCru;
  catalogos: CatalogosConversas;
  aoVoltar: () => void;
  /** A conversa virou ficha: a tela abre a ficha na aba Conversas. */
  aoLigar: (organizacaoId: string) => void;
}) {
  const nomeDaPessoa = useMemo(
    () => new Map(catalogos.pessoas.map((p) => [p.id, p.nome])),
    [catalogos.pessoas],
  );
  const mensagens = useQuery({
    queryKey: chaveDasMensagensDoFio(fio.id),
    queryFn: () => carregarMensagensDoFio(fio.id),
  });
  const [modo, setModo] = useState<'criar' | 'ligar'>('criar');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-hairline px-4 py-3">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="toque md:hidden"
          onClick={aoVoltar}
          aria-label="Voltar para a lista"
        >
          <ArrowLeft aria-hidden="true" />
        </Button>
        <div className="min-w-0">
          <p className="truncate font-heading font-medium">
            Número {finalDoNumero(fio.peer_phone_e164)}
          </p>
          <p className="text-xs text-muted-foreground">
            Escreveu para a KOMUNE e ainda não é ficha.
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {mensagens.isPending ? (
          <p className="text-sm text-muted-foreground">Carregando as mensagens...</p>
        ) : mensagens.isError ? (
          <p className="text-sm text-muted-foreground">
            {mensagens.error instanceof ErroDaConversa
              ? mensagens.error.message
              : 'Não deu para ler as mensagens.'}
          </p>
        ) : (
          montarMensagens(mensagens.data, nomeDaPessoa).map((m) => (
            <Mensagem key={m.id} mensagem={m} />
          ))
        )}
      </div>

      <section
        aria-label="Criar ou ligar a ficha"
        className="space-y-3 border-t border-hairline px-4 py-4"
      >
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={modo === 'criar' ? 'default' : 'outline'}
            className="toque h-11 md:h-9"
            onClick={() => setModo('criar')}
          >
            <UserPlus aria-hidden="true" />
            Criar ficha
          </Button>
          <Button
            type="button"
            variant={modo === 'ligar' ? 'default' : 'outline'}
            className="toque h-11 md:h-9"
            onClick={() => setModo('ligar')}
          >
            <Link2 aria-hidden="true" />
            Ligar a uma ficha
          </Button>
        </div>
        {modo === 'criar' ? (
          <CriarFicha fio={fio} catalogos={catalogos} aoLigar={aoLigar} />
        ) : (
          <LigarFicha fio={fio} aoLigar={aoLigar} />
        )}
      </section>
    </div>
  );
}

const TIPOS = [
  { id: 'fornecedor', rotulo: 'Fornecedor' },
  { id: 'produtor', rotulo: 'Produtor' },
  { id: 'cerimonialista', rotulo: 'Cerimonialista' },
] as const;

function useDepoisDeLigar(aoLigar: (organizacaoId: string) => void) {
  const clientes = useQueryClient();
  return (r: ResultadoDaFicha, sucesso: string) => {
    if (r.ok && r.organization_id) {
      toast.success(sucesso);
      void clientes.invalidateQueries({ queryKey: CHAVE_CONVERSAS });
      aoLigar(r.organization_id);
      return true;
    }
    return false;
  };
}

function CriarFicha({
  fio,
  catalogos,
  aoLigar,
}: {
  fio: FioCru;
  catalogos: CatalogosConversas;
  aoLigar: (organizacaoId: string) => void;
}) {
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState<(typeof TIPOS)[number]['id']>('fornecedor');
  const [categoriaId, setCategoriaId] = useState<number | null>(null);
  const [recusa, setRecusa] = useState<ResultadoDaFicha | null>(null);
  const depois = useDepoisDeLigar(aoLigar);

  const criar = useMutation({
    mutationFn: () =>
      criarFichaDaConversa({ fioId: fio.id, nome, categoriaId: categoriaId ?? 0, tipo }),
    onSuccess: (r) => {
      if (!depois(r, 'Ficha criada. A conversa agora está nela.')) setRecusa(r);
    },
    onError: (erro) =>
      toast.error(erro instanceof ErroDaConversa ? erro.message : 'Não deu para criar a ficha.'),
  });
  const ligarAExistente = useMutation({
    mutationFn: (organizacaoId: string) => vincularConversa(fio.id, organizacaoId),
    onSuccess: (r) => {
      if (!depois(r, 'Conversa ligada à ficha que já existia.')) setRecusa(r);
    },
  });

  const pode = nome.trim().length > 0 && categoriaId !== null && !criar.isPending;

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        setRecusa(null);
        if (pode) criar.mutate();
      }}
    >
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor={`nome-${fio.id}`}>Nome da empresa ou do profissional</Label>
        <Input
          id={`nome-${fio.id}`}
          value={nome}
          maxLength={120}
          onChange={(e) => setNome(e.target.value)}
          className="h-11 md:h-9"
          placeholder="Como aparece na conversa"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`tipo-${fio.id}`}>Tipo</Label>
        <Select value={tipo} onValueChange={(v) => setTipo(v as typeof tipo)}>
          <SelectTrigger id={`tipo-${fio.id}`} className="toque h-11 w-full md:h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIPOS.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.rotulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`categoria-${fio.id}`}>Categoria</Label>
        <Select
          value={categoriaId === null ? undefined : String(categoriaId)}
          onValueChange={(v) => setCategoriaId(Number(v))}
        >
          <SelectTrigger id={`categoria-${fio.id}`} className="toque h-11 w-full md:h-9">
            <SelectValue placeholder="Escolha" />
          </SelectTrigger>
          <SelectContent>
            {(catalogos.categorias ?? []).map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {recusa ? (
        <div className="space-y-2 sm:col-span-2">
          <p className="text-sm text-destructive-texto">{fraseDoResultado(recusa)}</p>
          {recusa.organization_id &&
          (recusa.motivo === 'telefone_ja_cadastrado' ||
            recusa.motivo === 'telefone_de_contato_existente') ? (
            <Button
              type="button"
              variant="outline"
              className="toque h-11 md:h-9"
              disabled={ligarAExistente.isPending}
              onClick={() => ligarAExistente.mutate(recusa.organization_id!)}
            >
              <Link2 aria-hidden="true" />
              Ligar a essa ficha
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="sm:col-span-2">
        <Button type="submit" className="toque h-11 md:h-9" disabled={!pode}>
          {criar.isPending ? 'Criando...' : 'Criar ficha com este número'}
        </Button>
      </div>
    </form>
  );
}

function LigarFicha({ fio, aoLigar }: { fio: FioCru; aoLigar: (organizacaoId: string) => void }) {
  const [texto, setTexto] = useState('');
  const [busca, setBusca] = useState('');
  const [recusa, setRecusa] = useState<string | null>(null);
  const depois = useDepoisDeLigar(aoLigar);

  useEffect(() => {
    const id = window.setTimeout(() => setBusca(texto.trim()), DEBOUNCE_BUSCA_MS);
    return () => window.clearTimeout(id);
  }, [texto]);

  const resultados = useQuery({
    queryKey: ['conversas', 'fora-da-base', 'busca', busca],
    queryFn: () => buscarAlvos(busca),
    enabled: busca.length >= 2,
  });

  const ligar = useMutation({
    mutationFn: (alvo: SugestaoDeAlvo) => vincularConversa(fio.id, alvo.id),
    onSuccess: (r) => {
      if (!depois(r, 'Conversa ligada à ficha.')) setRecusa(fraseDoResultado(r));
    },
    onError: (erro) =>
      toast.error(erro instanceof ErroDaConversa ? erro.message : 'Não deu para ligar a ficha.'),
  });

  return (
    <div className="space-y-2">
      <Label htmlFor={`busca-${fio.id}`}>Procurar a ficha</Label>
      <Input
        id={`busca-${fio.id}`}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Nome, bairro, @instagram ou CNPJ"
        className="h-11 md:h-9"
      />
      {recusa ? <p className="text-sm text-destructive-texto">{recusa}</p> : null}
      {busca.length >= 2 ? (
        resultados.isPending ? (
          <p className="text-xs text-muted-foreground">Procurando...</p>
        ) : (resultados.data ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma ficha com esse nome.</p>
        ) : (
          <ul className="max-h-56 divide-y divide-hairline overflow-y-auto rounded-lg border border-hairline">
            {(resultados.data ?? []).map((alvo) => (
              <li key={alvo.id}>
                <button
                  type="button"
                  disabled={ligar.isPending}
                  onClick={() => {
                    setRecusa(null);
                    ligar.mutate(alvo);
                  }}
                  className="flex min-h-11 w-full flex-col items-start px-3 py-2 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted/60"
                >
                  <span className="text-sm font-medium">{alvo.nome}</span>
                  <span className="text-xs text-muted-foreground">
                    {[alvo.categoria, alvo.bairro, alvo.etapa].filter(Boolean).join(' · ') ||
                      'Sem categoria'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
