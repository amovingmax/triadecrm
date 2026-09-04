'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  quickCreateOrganizationInput,
  toQuickCreateOrganizationArgs,
  type OrgKind,
  type QuickCreateOrganization,
  type QuickCreateOrganizationFormInput,
  type QuickCreateOrganizationResult,
} from '@komune/schema';
import { motion } from 'motion/react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
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
import { useMovimento } from '@/components/movimento';

import { ROTULO_TIPO } from './formatos';
import { useEhCelular } from './usar-eh-celular';
import type { Catalogos, OpcaoCategoria } from './tipos';

/**
 * Cadastro rápido (RF-BAS-15): quatro campos e pronto, em menos de 30 segundos
 * no celular, ainda dentro da conversa que acabou de acontecer na rua.
 *
 * Entra pela lateral no desktop e por baixo no celular, com mola (a folha vem do
 * lugar de onde o botão foi tocado). Os campos têm 44px de altura no celular.
 *
 * A dedup por telefone é do banco (`quick_create_organization`): quando o número já
 * existe, a resposta traz o id da ficha e a folha vira um atalho para ela, em vez de
 * criar um segundo cartão para a mesma pessoa.
 */
export function FolhaCadastroRapido({
  aberta,
  aoFechar,
  catalogos,
  aoCriar,
}: {
  aberta: boolean;
  aoFechar: () => void;
  catalogos: Catalogos;
  /** Avisa a lista para recarregar depois de um cadastro. */
  aoCriar?: () => void;
}) {
  const ehCelular = useEhCelular();

  return (
    <Sheet open={aberta} onOpenChange={(v) => !v && aoFechar()}>
      {/* Elevação do Ocean Breeze: sombra TINGIDA pela base (`sombra-base-forte`),
          nunca preta pura. A ação principal da folha ("Salvar parceiro") é a
          variante `default` do Button, que já é o gradiente de ação. */}
      <SheetContent
        side={ehCelular ? 'bottom' : 'right'}
        className="sombra-base-forte max-h-[92dvh] overflow-y-auto pb-[calc(1rem+var(--area-segura-inferior))] max-md:rounded-t-xl sm:max-w-md md:max-h-none"
      >
        <SheetHeader>
          <SheetTitle>Novo parceiro</SheetTitle>
          <SheetDescription>
            Quatro campos agora; o resto da ficha pode ser preenchido depois.
          </SheetDescription>
        </SheetHeader>

        <Formulario catalogos={catalogos} aoFechar={aoFechar} aoCriar={aoCriar} />
      </SheetContent>
    </Sheet>
  );
}

/** O que a dedup do banco devolveu: uma ficha que já existe para este WhatsApp. */
type JaExiste = { id: string | null; nome: string | null; motivo: string };

function Formulario({
  catalogos,
  aoFechar,
  aoCriar,
}: {
  catalogos: Catalogos;
  aoFechar: () => void;
  aoCriar?: () => void;
}) {
  const router = useRouter();
  const { mola } = useMovimento();
  const [jaExiste, setJaExiste] = useState<JaExiste | null>(null);
  const [falha, setFalha] = useState<string | null>(null);

  const form = useForm<QuickCreateOrganizationFormInput, unknown, QuickCreateOrganization>({
    resolver: zodResolver(quickCreateOrganizationInput),
    defaultValues: { name: '', phone: '', kind: 'fornecedor' },
  });

  // `useWatch` em vez de `form.watch`: devolve valor, não uma função nova a cada
  // renderização, e o compilador do React consegue memoizar o formulário inteiro.
  const categoriaId = useWatch({ control: form.control, name: 'category_id' });
  const categoria = catalogos.categorias.find((c) => c.id === Number(categoriaId));
  const tipo = categoria ? tipoDaCategoria(categoria) : 'fornecedor';

  async function enviar(valores: QuickCreateOrganization) {
    setJaExiste(null);
    setFalha(null);

    const supabase = createClient();
    const { data, error } = await supabase.rpc(
      'quick_create_organization',
      toQuickCreateOrganizationArgs({ ...valores, kind: tipo }),
    );

    if (error) {
      setFalha(`Não deu para salvar (${error.message}). Confira a conexão e tente de novo.`);
      return;
    }

    const resultado = data as unknown as QuickCreateOrganizationResult;

    if (resultado.created) {
      // O rótulo do botão e o aviso de sucesso dizem a mesma coisa.
      toast.success('Parceiro salvo.', { description: valores.name });
      aoCriar?.();
      aoFechar();
      form.reset();
      router.push(`/parceiros/${resultado.organization_id}`);
      return;
    }

    switch (resultado.reason) {
      case 'telefone_ja_cadastrado':
      case 'telefone_de_contato_existente': {
        const nome = resultado.existing_id ? await nomeDaFicha(resultado.existing_id) : null;
        setJaExiste({
          id: resultado.existing_id ?? null,
          nome,
          motivo:
            resultado.reason === 'telefone_de_contato_existente'
              ? 'Esse WhatsApp já é o de uma pessoa ligada a um parceiro.'
              : 'Esse WhatsApp já está cadastrado.',
        });
        return;
      }
      case 'telefone_suprimido':
        form.setError('phone', {
          message: 'Esse número pediu para não ser contatado. Não dá para cadastrar (RF-ADM-04).',
        });
        return;
      case 'telefone_invalido':
        form.setError('phone', { message: 'WhatsApp inválido: use DDD + número.' });
        return;
      case 'nome_obrigatorio':
        form.setError('name', { message: 'Informe o nome do parceiro.' });
        return;
      case 'categoria_invalida':
        form.setError('category_id', {
          message: 'Essa categoria não está mais ativa. Escolha outra.',
        });
        return;
      case 'origem_invalida':
      case 'origem_desabilitada':
        form.setError('source_id', {
          message: 'Essa origem foi desligada pelo gestor. Escolha outra.',
        });
        return;
      default:
        setFalha('Não deu para salvar. Tente de novo.');
    }
  }

  return (
    <motion.form
      onSubmit={form.handleSubmit(enviar)}
      // A folha em si entra pelo Radix (translate + fade, na direção certa); a mola
      // fica no conteúdo, que é o que a pessoa vai tocar assim que ele assentar.
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={mola}
      className="flex flex-col gap-4 px-4 pb-4"
      noValidate
    >
      <Campo
        rotulo="Nome do parceiro"
        erro={form.formState.errors.name?.message}
        dica="Como o time chama esse parceiro."
      >
        {(id, invalido) => (
          <Input
            id={id}
            autoFocus
            autoComplete="organization"
            enterKeyHint="next"
            aria-invalid={invalido}
            className="h-11 md:h-9"
            {...form.register('name')}
          />
        )}
      </Campo>

      <Campo
        rotulo="Categoria"
        erro={form.formState.errors.category_id?.message}
        dica={categoria ? `Entra no funil como ${ROTULO_TIPO[tipo]?.toLowerCase()}.` : undefined}
      >
        {(id, invalido) => (
          <Controller
            control={form.control}
            name="category_id"
            render={({ field }) => (
              <Select
                value={field.value ? String(field.value) : undefined}
                onValueChange={(v) => field.onChange(Number(v))}
              >
                <SelectTrigger id={id} aria-invalid={invalido} className="h-11 w-full md:h-9">
                  <SelectValue placeholder="Escolha a categoria" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {catalogos.categorias.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        )}
      </Campo>

      <Campo
        rotulo="WhatsApp"
        erro={form.formState.errors.phone?.message}
        dica="Com DDD. Pode colar do jeito que estiver."
      >
        {(id, invalido) => (
          <Input
            id={id}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            enterKeyHint="done"
            placeholder="(84) 99999-1234"
            aria-invalid={invalido}
            className="numerico h-11 md:h-9"
            {...form.register('phone')}
          />
        )}
      </Campo>

      <Campo
        rotulo="Origem"
        erro={form.formState.errors.source_id?.message}
        dica="Como você chegou nesse parceiro. Indicação entra como prioridade A+."
      >
        {(id, invalido) => (
          <Controller
            control={form.control}
            name="source_id"
            render={({ field }) => (
              <Select
                value={field.value ? String(field.value) : undefined}
                onValueChange={(v) => field.onChange(Number(v))}
              >
                <SelectTrigger id={id} aria-invalid={invalido} className="h-11 w-full md:h-9">
                  <SelectValue placeholder="Escolha a origem" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {catalogos.origens.map((o) => (
                    <SelectItem key={o.id} value={String(o.id)}>
                      {o.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        )}
      </Campo>

      {jaExiste ? (
        <div className="rounded-xl border border-border bg-muted/40 p-3 text-sm">
          <p className="font-medium">
            Já existe{jaExiste.nome ? `: ${jaExiste.nome}` : ' um parceiro com esse número'}
          </p>
          <p className="mt-0.5 text-muted-foreground">{jaExiste.motivo}</p>
          {jaExiste.id ? (
            <Link
              href={`/parceiros/${jaExiste.id}`}
              onClick={aoFechar}
              className="mt-2 inline-flex h-9 items-center rounded-lg px-2 font-medium underline underline-offset-4"
            >
              Abrir a ficha
            </Link>
          ) : (
            <p className="mt-1 text-muted-foreground">
              A ficha está fora da sua carteira. Peça ao gestor para transferir.
            </p>
          )}
        </div>
      ) : null}

      {falha ? (
        <p role="alert" className="text-sm text-destructive">
          {falha}
        </p>
      ) : null}

      <div className="mt-1 flex flex-col-reverse gap-2 md:flex-row md:justify-end">
        <Button type="button" variant="ghost" onClick={aoFechar} className="toque h-11 md:h-9">
          Cancelar
        </Button>
        <Button type="submit" disabled={form.formState.isSubmitting} className="toque h-11 md:h-9">
          {form.formState.isSubmitting ? 'Salvando...' : 'Salvar parceiro'}
        </Button>
      </div>
    </motion.form>
  );
}

/** Rótulo, controle, dica e erro com a ligação de acessibilidade já feita. */
function Campo({
  rotulo,
  dica,
  erro,
  children,
}: {
  rotulo: string;
  dica?: string;
  erro?: string;
  children: (id: string, invalido: boolean) => React.ReactNode;
}) {
  const id = useId();

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{rotulo}</Label>
      {children(id, Boolean(erro))}
      {erro ? (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      ) : dica ? (
        <p className="text-xs text-muted-foreground">{dica}</p>
      ) : null}
    </div>
  );
}

/**
 * O tipo da organização sai da categoria, e não de um quinto campo: é ele que decide
 * em qual funil o negócio nasce (produtor e cerimonialista têm funil próprio).
 */
function tipoDaCategoria(categoria: OpcaoCategoria): OrgKind {
  if (categoria.slug === 'cerimonialistas_assessorias') return 'cerimonialista';
  if (categoria.grupo === 'producao') return 'produtor';
  if (categoria.grupo === 'locais') return 'espaco';
  return 'fornecedor';
}

/** Nome da ficha que a dedup apontou, para o aviso dizer de quem se trata. */
async function nomeDaFicha(id: string): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from('organizations_view')
    .select('name')
    .eq('id', id)
    .maybeSingle();
  return data?.name ?? null;
}
