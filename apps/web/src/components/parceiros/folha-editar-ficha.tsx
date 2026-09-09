'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
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
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

import type { Catalogos } from './tipos';

/**
 * Editar a ficha de um parceiro.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTA TELA NÃO EXISTIA, E O QUE A FALTA DELA CUSTAVA
 * ---------------------------------------------------------------------------
 * A ficha era só leitura. O único caminho do produto que aceitava um telefone
 * era o cadastro rápido — e ele CRIA UM PARCEIRO NOVO. Então "achei o número do
 * buffet, vou pôr na ficha" terminava, invariavelmente, numa segunda ficha do
 * mesmo buffet: exatamente a duplicata que o resto do sistema gasta índice
 * único parcial, dedup por trigrama e fila de revisão para evitar.
 *
 * ---------------------------------------------------------------------------
 * ESTA TELA NÃO TEM REGRA NENHUMA, E ISSO É O DESENHO
 * ---------------------------------------------------------------------------
 * Ela escreve em `public.organizations_view`, e o gatilho `INSTEAD OF`
 * (`app.organizations_view_write`) é quem decide tudo:
 *
 *   quem pode          `app.can_write()` mais `app.org_is_editable` — gestor,
 *                      admin, ou o responsável pela ficha;
 *   o que é válido     `app.organizations_normalize` põe o telefone em E.164,
 *                      confere os dígitos do CNPJ, tira o @ do instagram e o
 *                      esquema do site;
 *   o que colide       os índices únicos parciais em telefone, CNPJ e
 *                      @instagram — que são a defesa contra duplicata;
 *   o que fica gravado o gatilho de auditoria registra quem mudou o quê.
 *
 * Reimplementar qualquer uma dessas quatro coisas aqui seria criar uma segunda
 * verdade que diverge da primeira no dia em que alguém mexer só num lado
 * (ADR-03). O que esta tela faz é montar o formulário, mandar, e traduzir a
 * recusa do banco para uma frase que diz o que fazer.
 *
 * ---------------------------------------------------------------------------
 * A CATEGORIA VAI POR FORA, E POR ISSO É UM SEGUNDO PASSO
 * ---------------------------------------------------------------------------
 * Categoria não é coluna de `organizations`: é linha em
 * `organization_categories`, com sua própria RLS (a mesma guarda, conferida). A
 * troca é apagar a primária e inserir a nova — duas escritas que NÃO estão na
 * mesma transação da ficha. Se a segunda falhar, a ficha fica salva e a
 * categoria não, e a tela precisa dizer isso em vez de fingir que deu tudo
 * certo. É o que o bloco no fim faz.
 */

type Valores = {
  name: string;
  legal_name: string;
  phone_e164: string;
  email: string;
  instagram_handle: string;
  website: string;
  cnpj: string;
  neighborhood: string;
  address: string;
  description: string;
  city_id: string;
  category_id: string;
};

export type FichaParaEditar = {
  id: string;
  name: string;
  legalName: string | null;
  telefone: string | null;
  telefoneMascarado: boolean;
  email: string | null;
  instagram: string | null;
  site: string | null;
  cnpj: string | null;
  bairro: string | null;
  endereco: string | null;
  descricao: string | null;
  cidadeId: number | null;
  categoriaId: number | null;
};

/** O que o banco recusa, dito para quem está editando. */
const RECUSA: Record<string, string> = {
  '42501': 'O seu acesso não edita esta ficha. Fale com um gestor.',
  '23505': 'Já existe outro parceiro com esse telefone, CNPJ ou @instagram.',
  '23514': 'Algum campo não passou na conferência do banco. Revise e tente de novo.',
};

function frase(codigo: string | undefined, mensagem: string): string {
  if (codigo && RECUSA[codigo]) return RECUSA[codigo];
  // O texto do banco vem em português e costuma nomear o campo — melhor mostrá-lo
  // que trocá-lo por "algo deu errado", que não deixa ninguém consertar nada.
  return mensagem || 'Não deu para salvar. Tente de novo.';
}

/** Campo vazio vira `null`: string vazia gravaria "" e furaria o índice parcial. */
function ouNulo(v: string): string | null {
  const limpo = v.trim();
  return limpo === '' ? null : limpo;
}

export function FolhaEditarFicha({
  ficha,
  catalogos,
}: {
  ficha: FichaParaEditar;
  catalogos: Catalogos;
}) {
  const router = useRouter();
  const id = useId();
  const [aberta, setAberta] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const form = useForm<Valores>({
    defaultValues: {
      name: ficha.name,
      legal_name: ficha.legalName ?? '',
      // Telefone mascarado não entra: o campo mostraria "+55 84 •••••-•63" e
      // salvar gravaria a máscara por cima do número. Quem precisa editar o
      // telefone revela primeiro, e a revelação fica registrada.
      phone_e164: ficha.telefoneMascarado ? '' : (ficha.telefone ?? ''),
      email: ficha.email ?? '',
      instagram_handle: ficha.instagram ?? '',
      website: ficha.site ?? '',
      cnpj: ficha.cnpj ?? '',
      neighborhood: ficha.bairro ?? '',
      address: ficha.endereco ?? '',
      description: ficha.descricao ?? '',
      city_id: ficha.cidadeId ? String(ficha.cidadeId) : '',
      category_id: ficha.categoriaId ? String(ficha.categoriaId) : '',
    },
  });

  async function salvar(v: Valores) {
    if (v.name.trim() === '') {
      form.setError('name', { message: 'A ficha precisa de um nome.' });
      return;
    }

    setSalvando(true);
    const supabase = createClient();

    const { error } = await supabase
      .from('organizations_view')
      .update({
        name: v.name.trim(),
        legal_name: ouNulo(v.legal_name),
        // Só manda o telefone quando há o que mandar: com a máscara na tela o
        // campo nasce vazio, e mandar `null` apagaria um número que existe.
        ...(ficha.telefoneMascarado && v.phone_e164.trim() === ''
          ? {}
          : { phone_e164: ouNulo(v.phone_e164) }),
        email: ouNulo(v.email),
        instagram_handle: ouNulo(v.instagram_handle),
        website: ouNulo(v.website),
        cnpj: ouNulo(v.cnpj),
        neighborhood: ouNulo(v.neighborhood),
        address: ouNulo(v.address),
        description: ouNulo(v.description),
        city_id: v.city_id === '' ? null : Number(v.city_id),
      })
      .eq('id', ficha.id);

    if (error) {
      setSalvando(false);
      toast.error('Não deu para salvar a ficha.', {
        description: frase(error.code, error.message),
      });
      return;
    }

    // A categoria é a segunda escrita, fora da transação da ficha. Só mexe se
    // mudou — e se falhar, o aviso diz exatamente o que ficou salvo e o que não.
    const categoriaNova = v.category_id === '' ? null : Number(v.category_id);
    if (categoriaNova !== ficha.categoriaId) {
      const trocou = await trocarCategoria(ficha.id, categoriaNova);
      if (!trocou.ok) {
        setSalvando(false);
        setAberta(false);
        router.refresh();
        toast.warning('A ficha foi salva, mas a categoria não mudou.', {
          description: trocou.motivo,
          duration: 10_000,
        });
        return;
      }
    }

    setSalvando(false);
    setAberta(false);
    router.refresh();
    toast.success('Ficha salva.');
  }

  return (
    <Sheet open={aberta} onOpenChange={setAberta}>
      <SheetTrigger asChild>
        <Button variant="outline" className="toque h-11 md:h-9">
          <Pencil aria-hidden="true" />
          Editar ficha
        </Button>
      </SheetTrigger>

      <SheetContent side="right" className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Editar {ficha.name}</SheetTitle>
          <SheetDescription>
            O telefone, o CNPJ e o @instagram passam pela mesma conferência do cadastro: se já
            forem de outra ficha, o banco recusa e diz qual.
          </SheetDescription>
        </SheetHeader>

        <form
          onSubmit={form.handleSubmit(salvar)}
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4"
        >
          <Campo id={`${id}-nome`} rotulo="Nome" erro={form.formState.errors.name?.message}>
            <Input id={`${id}-nome`} className="h-11 md:h-9" {...form.register('name')} />
          </Campo>

          <Campo id={`${id}-razao`} rotulo="Razão social">
            <Input id={`${id}-razao`} className="h-11 md:h-9" {...form.register('legal_name')} />
          </Campo>

          <Campo
            id={`${id}-tel`}
            rotulo="WhatsApp"
            dica={
              ficha.telefoneMascarado
                ? 'O número está mascarado para o seu papel. Deixe em branco para não mexer nele.'
                : 'Com DDD. O banco põe no formato certo.'
            }
          >
            <Input
              id={`${id}-tel`}
              inputMode="tel"
              placeholder={ficha.telefoneMascarado ? ficha.telefone ?? '' : '(84) 99999-0000'}
              className="h-11 md:h-9"
              {...form.register('phone_e164')}
            />
          </Campo>

          <Campo id={`${id}-cat`} rotulo="Categoria">
            <Controller
              control={form.control}
              name="category_id"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id={`${id}-cat`} className="h-11 w-full md:h-9">
                    <SelectValue placeholder="Sem categoria" />
                  </SelectTrigger>
                  <SelectContent>
                    {catalogos.categorias.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Campo>

          <Campo id={`${id}-cidade`} rotulo="Cidade">
            <Controller
              control={form.control}
              name="city_id"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id={`${id}-cidade`} className="h-11 w-full md:h-9">
                    <SelectValue placeholder="Sem cidade" />
                  </SelectTrigger>
                  <SelectContent>
                    {catalogos.cidades.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Campo>

          <Campo id={`${id}-bairro`} rotulo="Bairro">
            <Input id={`${id}-bairro`} className="h-11 md:h-9" {...form.register('neighborhood')} />
          </Campo>

          <Campo id={`${id}-end`} rotulo="Endereço" dica="Rua e número, quando houver.">
            <Input id={`${id}-end`} className="h-11 md:h-9" {...form.register('address')} />
          </Campo>

          <Campo id={`${id}-insta`} rotulo="Instagram" dica="Só o nome, sem o @.">
            <Input
              id={`${id}-insta`}
              autoCapitalize="none"
              className="h-11 md:h-9"
              {...form.register('instagram_handle')}
            />
          </Campo>

          <Campo id={`${id}-site`} rotulo="Site">
            <Input
              id={`${id}-site`}
              inputMode="url"
              autoCapitalize="none"
              className="h-11 md:h-9"
              {...form.register('website')}
            />
          </Campo>

          <Campo id={`${id}-email`} rotulo="E-mail">
            <Input
              id={`${id}-email`}
              inputMode="email"
              autoCapitalize="none"
              className="h-11 md:h-9"
              {...form.register('email')}
            />
          </Campo>

          <Campo id={`${id}-cnpj`} rotulo="CNPJ" dica="Só os números; os dígitos são conferidos.">
            <Input
              id={`${id}-cnpj`}
              inputMode="numeric"
              className="h-11 md:h-9"
              {...form.register('cnpj')}
            />
          </Campo>

          <Campo id={`${id}-desc`} rotulo="Descrição">
            <Input id={`${id}-desc`} className="h-11 md:h-9" {...form.register('description')} />
          </Campo>

          <SheetFooter className="px-0">
            <Button type="submit" disabled={salvando} className="toque h-11 md:h-9">
              {salvando ? 'Salvando...' : 'Salvar'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAberta(false)}
              className="toque h-11 md:h-9"
            >
              Cancelar
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function Campo({
  id,
  rotulo,
  dica,
  erro,
  children,
}: {
  id: string;
  rotulo: string;
  dica?: string;
  erro?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{rotulo}</Label>
      {children}
      {erro ? (
        <p className="text-destructive-texto text-xs" role="alert">
          {erro}
        </p>
      ) : dica ? (
        <p className="text-xs text-muted-foreground">{dica}</p>
      ) : null}
    </div>
  );
}

/**
 * Troca a categoria primária.
 *
 * Apagar e inserir, e não `update`: a chave primária de
 * `organization_categories` é o par (organização, categoria), então mudar a
 * categoria é mudar a própria chave. As duas escritas passam pela mesma RLS que
 * a ficha, e a ordem importa — apagar primeiro evita esbarrar no índice único
 * parcial que garante UMA primária por organização.
 */
async function trocarCategoria(
  organizationId: string,
  categoriaId: number | null,
): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const supabase = createClient();

  const apagou = await supabase
    .from('organization_categories')
    .delete()
    .eq('organization_id', organizationId)
    .eq('is_primary', true);
  if (apagou.error) {
    return { ok: false, motivo: frase(apagou.error.code, apagou.error.message) };
  }

  if (categoriaId === null) return { ok: true };

  const inseriu = await supabase
    .from('organization_categories')
    .insert({ organization_id: organizationId, category_id: categoriaId, is_primary: true });
  if (inseriu.error) {
    return {
      ok: false,
      motivo: `${frase(inseriu.error.code, inseriu.error.message)} A ficha ficou sem categoria primária — escolha uma de novo.`,
    };
  }
  return { ok: true };
}
