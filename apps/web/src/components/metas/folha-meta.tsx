'use client';

import { useId, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Trash2 } from 'lucide-react';
import { Controller, useForm, useWatch } from 'react-hook-form';
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

import { mensagemDoErro, removerMeta, salvarMeta } from './dados';
import type { Periodo, Segmento } from './periodo';
import { METRICA_DESTAQUE, type LinhaProgresso, type Pessoa } from './tipos';

/**
 * Folha de definição de meta (RF-MET-02). Só gestor e admin chegam aqui: a RLS de
 * `public.goals` recusa insert, update e delete de quem não é, e a tela nem oferece
 * o botão para os outros papéis — pedir uma coisa que vai ser negada é pior do que
 * não oferecer.
 *
 * A folha define a meta do período que está aberto na tela, e diz isso por escrito:
 * "meta de HOJE" e "meta desta SEMANA" são linhas diferentes na tabela, e a confusão
 * entre as duas é o erro mais fácil de cometer aqui.
 */

const esquemaMeta = z.object({
  metrica: z.string().min(1, { error: 'Escolha a métrica.' }),
  alvo: z
    .string()
    .trim()
    .regex(/^\d{1,5}$/, { error: 'Informe um número inteiro, sem ponto nem vírgula.' })
    .transform(Number)
    .refine((n) => n <= 10000, { error: 'O alvo máximo é 10000.' }),
  nota: z.string().max(280, { error: 'No máximo 280 caracteres.' }),
});

type EntradaMeta = z.input<typeof esquemaMeta>;
type SaidaMeta = z.output<typeof esquemaMeta>;

export function FolhaMeta({
  aberta,
  aoFechar,
  pessoa,
  periodo,
  inicio,
  rotuloPeriodo,
  linhas,
  metricaInicial,
  aoGravar,
}: {
  aberta: boolean;
  aoFechar: () => void;
  pessoa: Pessoa;
  periodo: Periodo;
  inicio: string;
  rotuloPeriodo: Segmento[];
  /** As linhas de `goal_progress` da pessoa: dão as opções e os alvos atuais. */
  linhas: LinhaProgresso[];
  /** Métrica que a pessoa tocou; `null` abre no destaque. */
  metricaInicial: string | null;
  aoGravar: () => void;
}) {
  const ehCelular = useEhCelular();

  return (
    <Sheet open={aberta} onOpenChange={(v) => !v && aoFechar()}>
      <SheetContent
        side={ehCelular ? 'bottom' : 'right'}
        className="sombra-base-forte max-h-[92dvh] overflow-y-auto pb-[calc(1rem+var(--area-segura-inferior))] max-md:rounded-t-xl sm:max-w-md md:max-h-none"
      >
        <SheetHeader>
          <SheetTitle>Meta de {pessoa.nome}</SheetTitle>
          <SheetDescription>
            Vale só para{' '}
            {rotuloPeriodo.map((parte, i) => (
              <span key={i} className={parte.mono ? 'numerico' : undefined}>
                {parte.texto}
              </span>
            ))}
            . Outro período tem meta própria.
          </SheetDescription>
        </SheetHeader>

        {aberta ? (
          <Formulario
            pessoa={pessoa}
            periodo={periodo}
            inicio={inicio}
            linhas={linhas}
            metricaInicial={metricaInicial}
            aoFechar={aoFechar}
            aoGravar={aoGravar}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Formulario({
  pessoa,
  periodo,
  inicio,
  linhas,
  metricaInicial,
  aoFechar,
  aoGravar,
}: {
  pessoa: Pessoa;
  periodo: Periodo;
  inicio: string;
  linhas: LinhaProgresso[];
  metricaInicial: string | null;
  aoFechar: () => void;
  aoGravar: () => void;
}) {
  const idAlvo = useId();
  const idNota = useId();
  const [falha, setFalha] = useState<string | null>(null);
  const [removendo, setRemovendo] = useState(false);

  // Só o que o banco sabe medir entra no seletor: oferecer "Respostas recebidas"
  // antes de o inbox existir seria combinar uma meta que ninguém consegue apurar.
  const opcoes = linhas.filter((l) => l.mensuravel);
  // Sem métrica escolhida (o botão do cabeçalho do cartão), abre nas portas abertas:
  // é a meta do plano (3 por dia) e a que o gestor define em quase toda conversa.
  const padrao = opcoes.find((l) => l.metrica === METRICA_DESTAQUE)?.metrica;
  const primeira = metricaInicial ?? padrao ?? opcoes[0]?.metrica ?? '';
  const atual = (metrica: string) => linhas.find((l) => l.metrica === metrica) ?? null;
  const inicial = atual(primeira);

  const form = useForm<EntradaMeta, unknown, SaidaMeta>({
    resolver: zodResolver(esquemaMeta),
    defaultValues: {
      metrica: primeira,
      alvo: inicial?.meta !== null && inicial?.meta !== undefined ? String(inicial.meta) : '',
      nota: '',
    },
  });

  const metricaEscolhida = useWatch({ control: form.control, name: 'metrica' });
  const linhaEscolhida = atual(metricaEscolhida ?? '');
  const jaTemMeta = linhaEscolhida?.meta !== null && linhaEscolhida?.meta !== undefined;
  const salvando = form.formState.isSubmitting;

  async function enviar(valores: SaidaMeta) {
    setFalha(null);
    try {
      await salvarMeta({
        pessoaId: pessoa.id,
        metrica: valores.metrica,
        periodo,
        inicio,
        alvo: valores.alvo,
        nota: valores.nota,
      });
      toast.success('Meta salva.', {
        description: `${linhaEscolhida?.metrica_rotulo ?? valores.metrica} de ${pessoa.nome}.`,
      });
      aoGravar();
      aoFechar();
    } catch (erro) {
      setFalha(mensagemDoErro(erro));
    }
  }

  async function remover() {
    setFalha(null);
    setRemovendo(true);
    try {
      await removerMeta({ pessoaId: pessoa.id, metrica: metricaEscolhida ?? '', periodo, inicio });
      toast.success('Meta removida.', {
        description: `${linhaEscolhida?.metrica_rotulo ?? ''} de ${pessoa.nome}.`.trim(),
      });
      aoGravar();
      aoFechar();
    } catch (erro) {
      setFalha(mensagemDoErro(erro));
    } finally {
      setRemovendo(false);
    }
  }

  return (
    <form
      onSubmit={(evento) => void form.handleSubmit(enviar)(evento)}
      className="flex flex-col gap-4 px-4"
      noValidate
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="metrica-meta">Métrica</Label>
        <Controller
          control={form.control}
          name="metrica"
          render={({ field }) => (
            <Select
              value={field.value}
              onValueChange={(valor) => {
                field.onChange(valor);
                // O alvo acompanha a métrica escolhida: se já existe meta, ela
                // aparece no campo para ser ajustada em vez de redigitada.
                const meta = atual(valor)?.meta;
                form.setValue('alvo', meta === null || meta === undefined ? '' : String(meta));
                form.clearErrors('alvo');
              }}
            >
              <SelectTrigger id="metrica-meta" className="h-11 w-full md:h-9">
                <SelectValue placeholder="Escolha a métrica" />
              </SelectTrigger>
              <SelectContent>
                {opcoes.map((opcao) => (
                  <SelectItem key={opcao.metrica} value={opcao.metrica}>
                    {opcao.metrica_rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        {linhaEscolhida ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Como é contado: {linhaEscolhida.fonte}.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={idAlvo}>Alvo do período</Label>
        <Input
          id={idAlvo}
          inputMode="numeric"
          autoComplete="off"
          placeholder="3"
          className="numerico h-11 md:h-9"
          aria-invalid={form.formState.errors.alvo ? true : undefined}
          {...form.register('alvo')}
        />
        {form.formState.errors.alvo ? (
          <p className="text-xs text-destructive-texto">{form.formState.errors.alvo.message}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Quanto a pessoa precisa fazer no período inteiro. Zero desliga a cobrança sem apagar a
            métrica.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={idNota}>Por que essa meta (opcional)</Label>
        <Input
          id={idNota}
          autoComplete="off"
          placeholder="Dedicação parcial, semana de férias"
          className="h-11 md:h-9"
          {...form.register('nota')}
        />
      </div>

      {falha ? (
        <p role="alert" className="text-sm text-destructive-texto">
          {falha}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 pt-1 pb-4">
        <Button type="submit" disabled={salvando || removendo} className="toque h-11 md:h-9">
          {salvando ? 'Salvando...' : 'Salvar meta'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={aoFechar}
          disabled={salvando || removendo}
          className="toque h-11 md:h-9"
        >
          Cancelar
        </Button>
        {jaTemMeta ? (
          <Button
            type="button"
            variant="destructive"
            onClick={() => void remover()}
            disabled={salvando || removendo}
            className="toque ml-auto h-11 md:h-9"
          >
            <Trash2 aria-hidden="true" />
            {removendo ? 'Removendo...' : 'Remover'}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
