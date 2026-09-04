'use client';

import { useId, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { motion } from 'motion/react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

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
import { useEhCelular } from '@/components/parceiros/usar-eh-celular';
import { useMovimento } from '@/components/movimento';

import { criarCandidato, mensagemDoErro, MOTIVO_DA_CRIACAO } from './dados';
import { EXPLICACAO_DA_MARCA, type CatalogosDoRadar } from './tipos';

/**
 * Entrada manual de candidato — o que o Radar sabe fazer hoje.
 *
 * Não é um atalho para a base: o que entra aqui passa pela MESMA esteira do
 * coletor (ADR-08) — higiene do dado, consulta à lista de supressão, dedup contra
 * `organizations` — e só vira parceiro depois de aprovado na fila. É por isso que
 * este formulário aceita um alvo sem telefone: no Radar, achar o alvo e achar o
 * contato dele são dois passos.
 */
const formulario = z.object({
  nome: z.string().trim().min(2, 'Escreva o nome do candidato.'),
  fonteId: z.number({ error: 'Escolha de onde veio esse alvo.' }).int().positive(),
  categoriaId: z.number().int().positive().nullable(),
  telefone: z.string().trim(),
  instagram: z.string().trim(),
  bairro: z.string().trim(),
  cidadeId: z.number().int().positive().nullable(),
  site: z.string().trim(),
  cnpj: z.string().trim(),
  origemUrl: z.string().trim(),
  observacao: z.string().trim(),
});

type Formulario = z.infer<typeof formulario>;

export function FolhaDeCandidato({
  aberta,
  aoFechar,
  catalogos,
  aoCriar,
}: {
  aberta: boolean;
  aoFechar: () => void;
  catalogos: CatalogosDoRadar;
  aoCriar: () => void;
}) {
  const ehCelular = useEhCelular();

  return (
    <Sheet open={aberta} onOpenChange={(v) => !v && aoFechar()}>
      <SheetContent
        side={ehCelular ? 'bottom' : 'right'}
        className="sombra-base-forte max-h-[92dvh] overflow-y-auto pb-[calc(1rem+var(--area-segura-inferior))] max-md:rounded-t-xl sm:max-w-md md:max-h-none"
      >
        <SheetHeader>
          <SheetTitle>Novo candidato</SheetTitle>
          <SheetDescription>
            Entra na fila de revisão, não na base. Nome e origem bastam; o resto pode vir depois.
          </SheetDescription>
        </SheetHeader>

        <Corpo catalogos={catalogos} aoFechar={aoFechar} aoCriar={aoCriar} />
      </SheetContent>
    </Sheet>
  );
}

function Corpo({
  catalogos,
  aoFechar,
  aoCriar,
}: {
  catalogos: CatalogosDoRadar;
  aoFechar: () => void;
  aoCriar: () => void;
}) {
  const { mola } = useMovimento();
  const [falha, setFalha] = useState<string | null>(null);
  const [maisDados, setMaisDados] = useState(false);

  const form = useForm<Formulario>({
    resolver: zodResolver(formulario),
    defaultValues: {
      nome: '',
      categoriaId: null,
      telefone: '',
      instagram: '',
      bairro: '',
      cidadeId: catalogos.cidades.find((c) => c.nome === 'Natal')?.id ?? null,
      site: '',
      cnpj: '',
      origemUrl: '',
      observacao: '',
    },
  });

  async function enviar(valores: Formulario) {
    setFalha(null);
    try {
      const resposta = await criarCandidato(valores);

      if (!resposta.criado) {
        const recado = MOTIVO_DA_CRIACAO[resposta.motivo];
        if (resposta.motivo === 'nome_obrigatorio') {
          form.setError('nome', { message: recado });
        } else if (resposta.motivo === 'cnpj_invalido') {
          form.setError('cnpj', { message: recado });
          setMaisDados(true);
        } else if (resposta.motivo === 'categoria_invalida') {
          form.setError('categoriaId', { message: recado });
        } else if (
          resposta.motivo === 'origem_invalida' ||
          resposta.motivo === 'origem_desabilitada'
        ) {
          form.setError('fonteId', { message: recado });
        } else {
          setFalha(recado ?? 'Não deu para cadastrar. Tente de novo.');
        }
        return;
      }

      // As marcas da higiene são a informação mais útil do sucesso: o candidato
      // entrou, mas alguma coisa nele precisa de olho na revisão.
      const marca = resposta.marcas[0];
      toast.success('Candidato na fila de revisão.', {
        description: resposta.naoContatar
          ? 'Atenção: esse contato está na lista de supressão e não poderá ser aprovado.'
          : marca
            ? (EXPLICACAO_DA_MARCA[marca]?.explicacao ?? valores.nome)
            : valores.nome,
      });

      form.reset({ ...form.getValues(), nome: '', telefone: '', instagram: '', cnpj: '' });
      aoCriar();
      aoFechar();
    } catch (erro) {
      setFalha(`${mensagemDoErro(erro)} Tente de novo.`);
    }
  }

  return (
    <motion.form
      onSubmit={form.handleSubmit(enviar)}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={mola}
      className="flex flex-col gap-4 px-4 pb-4"
      noValidate
    >
      <Campo
        rotulo="Nome do candidato"
        erro={form.formState.errors.nome?.message}
        dica="Como o negócio se apresenta: o nome da fachada, do perfil ou do anúncio."
      >
        {(id, invalido) => (
          <Input
            id={id}
            autoFocus
            autoComplete="organization"
            enterKeyHint="next"
            aria-invalid={invalido}
            className="h-11 md:h-9"
            {...form.register('nome')}
          />
        )}
      </Campo>

      <Campo
        rotulo="Onde você achou"
        erro={form.formState.errors.fonteId?.message}
        dica="A fonte fica gravada em cada dado (RF-BAS-10). Indicação e contato pessoal entram como prioridade A+."
      >
        {(id, invalido) => (
          <Controller
            control={form.control}
            name="fonteId"
            render={({ field }) => (
              <Select
                value={field.value ? String(field.value) : undefined}
                onValueChange={(v) => field.onChange(Number(v))}
              >
                <SelectTrigger id={id} aria-invalid={invalido} className="h-11 w-full md:h-9">
                  <SelectValue placeholder="Escolha a fonte" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {catalogos.origens.map((o) => (
                    <SelectItem key={o.id} value={String(o.id)} disabled={!o.ligada}>
                      {o.nome}
                      {o.ligada ? '' : ' (desligada)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        )}
      </Campo>

      <Campo
        rotulo="Categoria"
        erro={form.formState.errors.categoriaId?.message}
        dica="Pode ficar em branco: quem revisa escolhe na hora de aprovar."
      >
        {(id, invalido) => (
          <Controller
            control={form.control}
            name="categoriaId"
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

      <Campo rotulo="WhatsApp" dica="Com DDD. Pode colar do jeito que estiver.">
        {(id) => (
          <Input
            id={id}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="(84) 99999-1234"
            className="numerico h-11 md:h-9"
            {...form.register('telefone')}
          />
        )}
      </Campo>

      <Campo rotulo="@ no Instagram" dica="Pode colar o link do perfil.">
        {(id) => (
          <Input
            id={id}
            autoCapitalize="none"
            autoCorrect="off"
            placeholder="@buffetdanatal"
            className="h-11 md:h-9"
            {...form.register('instagram')}
          />
        )}
      </Campo>

      <Campo rotulo="Bairro" dica="Ajuda a achar duplicata e a montar rota de visita.">
        {(id) => (
          <Input
            id={id}
            placeholder="Ponta Negra"
            className="h-11 md:h-9"
            {...form.register('bairro')}
          />
        )}
      </Campo>

      {maisDados ? (
        <>
          <Campo rotulo="Cidade">
            {(id) => (
              <Controller
                control={form.control}
                name="cidadeId"
                render={({ field }) => (
                  <Select
                    value={field.value ? String(field.value) : undefined}
                    onValueChange={(v) => field.onChange(Number(v))}
                  >
                    <SelectTrigger id={id} className="h-11 w-full md:h-9">
                      <SelectValue placeholder="Escolha a cidade" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {catalogos.cidades.map((c) => (
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

          <Campo rotulo="Site">
            {(id) => (
              <Input
                id={id}
                inputMode="url"
                placeholder="buffetdanatal.com.br"
                className="h-11 md:h-9"
                {...form.register('site')}
              />
            )}
          </Campo>

          <Campo rotulo="CNPJ" erro={form.formState.errors.cnpj?.message}>
            {(id, invalido) => (
              <Input
                id={id}
                inputMode="numeric"
                placeholder="00.000.000/0001-00"
                aria-invalid={invalido}
                className="numerico h-11 md:h-9"
                {...form.register('cnpj')}
              />
            )}
          </Campo>

          <Campo
            rotulo="Link de onde você achou"
            dica="Fica guardado como prova de origem do dado."
          >
            {(id) => (
              <Input
                id={id}
                inputMode="url"
                placeholder="https://..."
                className="h-11 md:h-9"
                {...form.register('origemUrl')}
              />
            )}
          </Campo>

          <Campo rotulo="Observação" dica="O que quem revisar precisa saber.">
            {(id) => (
              <Input
                id={id}
                placeholder="Fez o casamento da prima da Bárbara"
                className="h-11 md:h-9"
                {...form.register('observacao')}
              />
            )}
          </Campo>
        </>
      ) : (
        <Button
          type="button"
          variant="ghost"
          onClick={() => setMaisDados(true)}
          className="toque h-11 self-start text-muted-foreground md:h-9"
        >
          Mais dados (cidade, site, CNPJ, link, observação)
        </Button>
      )}

      {falha ? (
        <p role="alert" className="text-sm text-destructive-texto">
          {falha}
        </p>
      ) : null}

      <div className="mt-1 flex flex-col-reverse gap-2 md:flex-row md:justify-end">
        <Button type="button" variant="ghost" onClick={aoFechar} className="toque h-11 md:h-9">
          Cancelar
        </Button>
        <Button type="submit" disabled={form.formState.isSubmitting} className="toque h-11 md:h-9">
          {form.formState.isSubmitting ? 'Salvando...' : 'Pôr na fila'}
        </Button>
      </div>
    </motion.form>
  );
}

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
        <p role="alert" className="text-sm text-destructive-texto">
          {erro}
        </p>
      ) : dica ? (
        <p className="text-xs text-muted-foreground">{dica}</p>
      ) : null}
    </div>
  );
}
