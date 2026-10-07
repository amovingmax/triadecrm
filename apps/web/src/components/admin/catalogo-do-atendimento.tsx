'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { DialogoConfirmar } from './confirmar';

/**
 * Respostas prontas e etiquetas — os dois CATÁLOGOS que moravam em Atendimento.
 *
 * Rafael, 29/09/2026: "ta muito complexo as telas desse CRM", com o print de
 * Ajustes → Atendimento. Estas duas listas eram metade daquela tela e não têm
 * nada a ver com o que a aba promete: Atendimento é sobre o que o CRM FAZ
 * SOZINHO (os interruptores, os freios, os textos automáticos). Resposta pronta
 * é o que uma PESSOA digita com `/atalho` na caixa da conversa; etiqueta é o que
 * uma pessoa põe na ficha. São catálogos, e a aba Catálogos existe ao lado.
 *
 * Cada uma busca os próprios dados, em vez de receber por prop: assim mudaram de
 * aba sem que nenhum dos dois painéis precise saber o que o outro carrega.
 *
 * APAGAR PERGUNTA ANTES (07/10/2026). As duas lixeiras apagavam no clique, sem
 * confirmação — e são as duas únicas exclusões do Ajustes que não têm volta: a
 * linha sai do banco. A da etiqueta, pior, sai junto de TODOS os parceiros que
 * a tinham (`organization_tags` cascateia), e o aviso de erro dizia o contrário
 * ("ainda está em uso"), descrevendo uma trava que nunca existiu.
 */

type Resposta = { id: number; atalho: string; titulo: string; texto: string; ativo: boolean };
type Etiqueta = { id: number; name: string; color: string | null };

const CORES = ['#24705c', '#2563eb', '#7c3aed', '#db2777', '#d97706', '#64748b'];

const CHAVE_RESPOSTAS = ['admin', 'respostas-rapidas'] as const;
const CHAVE_ETIQUETAS = ['admin', 'etiquetas'] as const;

async function carregarRespostas(): Promise<Resposta[]> {
  const { data, error } = await createClient()
    .from('respostas_rapidas')
    .select('id, atalho, titulo, texto, ativo')
    .order('atalho');
  if (error) throw new Error(error.message);
  return (data ?? []) as Resposta[];
}

async function carregarEtiquetas(): Promise<Etiqueta[]> {
  const { data, error } = await createClient()
    .from('tags')
    .select('id, name, color')
    .order('name');
  if (error) throw new Error(error.message);
  return (data ?? []) as Etiqueta[];
}

export function SecaoRespostasProntas({ podeEditar }: { podeEditar: boolean }) {
  const clientes = useQueryClient();
  const consulta = useQuery({ queryKey: CHAVE_RESPOSTAS, queryFn: carregarRespostas });
  const aoMudar = () => void clientes.invalidateQueries({ queryKey: CHAVE_RESPOSTAS });
  const respostas = consulta.data ?? [];
  const [atalho, setAtalho] = useState('');
  const [titulo, setTitulo] = useState('');
  const [texto, setTexto] = useState('');

  const criar = useMutation({
    mutationFn: async () => {
      const { error } = await createClient()
        .from('respostas_rapidas')
        .insert({ atalho: atalho.trim().toLowerCase().replace(/^\//, ''), titulo: titulo.trim(), texto: texto.trim() });
      if (error) throw new Error(error.code === '23505' ? 'Já existe um atalho com esse nome.' : 'Use só letras minúsculas, números e hífen no atalho.');
    },
    onSuccess: () => {
      setAtalho('');
      setTitulo('');
      setTexto('');
      toast.success('Resposta pronta criada.');
      aoMudar();
    },
    onError: (e: Error) => toast.error('Não criou.', { description: e.message }),
  });
  const [paraApagar, setParaApagar] = useState<Resposta | null>(null);
  const apagar = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await createClient().from('respostas_rapidas').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setParaApagar(null);
      toast.success('Resposta pronta apagada.');
      aoMudar();
    },
    onError: () => toast.error('Não apagou.', { description: 'Tente de novo.' }),
  });

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="font-heading text-base font-medium">Respostas prontas</h2>
        <p className="text-sm text-muted-foreground">
          Na caixa de resposta das Conversas, digite <code>/</code> e escolha. O texto entra na hora.
        </p>
      </div>
      <ul className="divide-y divide-hairline sombra-base rounded-xl bg-card">
        {respostas.map((r) => (
          <li key={r.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
            <code className="shrink-0 text-primary">/{r.atalho}</code>
            <span className="min-w-0 flex-1">
              <span className="font-medium">{r.titulo}</span>
              <span className="block truncate text-xs text-muted-foreground">{r.texto}</span>
            </span>
            {podeEditar ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Apagar /${r.atalho}`}
                onClick={() => setParaApagar(r)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {podeEditar ? (
        <form
          className="grid gap-2 sm:grid-cols-[9rem_12rem_minmax(0,1fr)_auto] sm:items-start"
          onSubmit={(e) => {
            e.preventDefault();
            criar.mutate();
          }}
        >
          <Input aria-label="Atalho" placeholder="/preco" value={atalho} maxLength={31} onChange={(e) => setAtalho(e.target.value)} className="h-11 md:h-9" />
          <Input aria-label="Nome" placeholder="Nome" value={titulo} maxLength={60} onChange={(e) => setTitulo(e.target.value)} className="h-11 md:h-9" />
          <Input aria-label="Texto" placeholder="O texto que entra na mensagem" value={texto} maxLength={1000} onChange={(e) => setTexto(e.target.value)} className="h-11 md:h-9" />
          <Button type="submit" className="toque h-11 md:h-9" disabled={!atalho.trim() || !titulo.trim() || !texto.trim() || criar.isPending}>
            <Plus aria-hidden="true" />
            Criar
          </Button>
        </form>
      ) : null}

      <DialogoConfirmar
        aberto={paraApagar !== null}
        aoFechar={() => setParaApagar(null)}
        titulo={paraApagar ? `Apagar /${paraApagar.atalho}?` : ''}
        descricao={
          <>
            <p>
              “{paraApagar?.titulo}” some da lista de respostas prontas de todo o time. Quem
              digitar <code>/{paraApagar?.atalho}</code> na conversa não encontra mais nada.
            </p>
            <p>As mensagens já enviadas com ela não mudam. Não dá para desfazer: é criar de novo.</p>
          </>
        }
        rotuloConfirmar="Apagar resposta"
        perigo
        ocupado={apagar.isPending}
        aoConfirmar={() => paraApagar && apagar.mutate(paraApagar.id)}
      />
    </section>
  );
}

export function SecaoEtiquetas({ podeEditar }: { podeEditar: boolean }) {
  const clientes = useQueryClient();
  const consulta = useQuery({ queryKey: CHAVE_ETIQUETAS, queryFn: carregarEtiquetas });
  const aoMudar = () => void clientes.invalidateQueries({ queryKey: CHAVE_ETIQUETAS });
  const etiquetas = consulta.data ?? [];
  const [nome, setNome] = useState('');
  const [cor, setCor] = useState(CORES[0] ?? '#24705c');
  const criar = useMutation({
    mutationFn: async () => {
      const { error } = await createClient().from('tags').insert({ name: nome.trim().toLowerCase(), color: cor });
      if (error) throw new Error(error.code === '23505' ? 'Essa etiqueta já existe.' : error.message);
    },
    onSuccess: () => {
      setNome('');
      aoMudar();
    },
    onError: (e: Error) => toast.error('Não criou.', { description: e.message }),
  });
  const [paraApagar, setParaApagar] = useState<Etiqueta | null>(null);
  const apagar = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await createClient().from('tags').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setParaApagar(null);
      toast.success('Etiqueta apagada.');
      aoMudar();
    },
    // Não existe trava de "em uso": apagar tira a etiqueta de quem a tinha. Se
    // falhou, foi a rede ou a permissão.
    onError: () => toast.error('Não apagou.', { description: 'Tente de novo.' }),
  });

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="font-heading text-base font-medium">Etiquetas</h2>
        <p className="text-sm text-muted-foreground">
          Marcam o parceiro. Aparecem no topo da conversa, e qualquer pessoa do time põe e tira.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {etiquetas.map((e) => (
          <span
            key={e.id}
            className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-card py-1 pr-1 pl-2.5 text-sm"
          >
            <span className="size-2.5 rounded-full" style={{ background: e.color ?? '#64748b' }} aria-hidden="true" />
            {e.name}
            {podeEditar ? (
              <button
                type="button"
                aria-label={`Apagar a etiqueta ${e.name}`}
                onClick={() => setParaApagar(e)}
                className="rounded-full p-1 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </button>
            ) : null}
          </span>
        ))}
      </div>
      {podeEditar ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (nome.trim()) criar.mutate();
          }}
        >
          <Input aria-label="Nome da etiqueta" placeholder="Nova etiqueta" value={nome} maxLength={40} onChange={(e) => setNome(e.target.value)} className="h-11 w-48 md:h-9" />
          <span className="flex items-center gap-1" role="radiogroup" aria-label="Cor">
            {CORES.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={cor === c}
                aria-label={`Cor ${c}`}
                onClick={() => setCor(c)}
                className={cn('size-7 rounded-full border-2', cor === c ? 'border-foreground' : 'border-transparent')}
                style={{ background: c }}
              />
            ))}
          </span>
          <Button type="submit" className="toque h-11 md:h-9" disabled={!nome.trim() || criar.isPending}>
            <Plus aria-hidden="true" />
            Criar
          </Button>
        </form>
      ) : null}

      <DialogoConfirmar
        aberto={paraApagar !== null}
        aoFechar={() => setParaApagar(null)}
        titulo={paraApagar ? `Apagar a etiqueta “${paraApagar.name}”?` : ''}
        descricao={
          <>
            <p>
              Ela sai de <strong>todos os parceiros</strong> que a têm, e some do topo das
              conversas deles.
            </p>
            <p>
              Não dá para desfazer: criar outra com o mesmo nome não devolve a marca a quem a
              tinha.
            </p>
          </>
        }
        rotuloConfirmar="Apagar etiqueta"
        perigo
        ocupado={apagar.isPending}
        aoConfirmar={() => paraApagar && apagar.mutate(paraApagar.id)}
      />
    </section>
  );
}
