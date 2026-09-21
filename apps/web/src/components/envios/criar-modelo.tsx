'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, MessageSquareReply, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

import { buscarModelosEmAnalise, criarModelo, ErroDoEnvio } from './dados';
import { fraseDaRecusa } from './formatos';
import type { Botao } from './tipos';

/**
 * Criar um modelo de mensagem com botões, em nome da Komune.
 *
 * O modelo nasce aqui e vai sozinho para a Meta: a sincronização do worker
 * passa de 30 em 30 minutos, e a aprovação costuma levar de minutos a um dia.
 * Até lá ele aparece na lista "esperando a Meta", e não no seletor do envio —
 * modelo não aprovado não sai.
 *
 * O botão de link não pede endereço: ele sempre aponta para o link rastreado
 * do CRM, e o destino é escolhido em cada envio. Assim o mesmo modelo leva a
 * lugares diferentes sem voltar à Meta.
 */
export function CriarModelo() {
  const [aberta, setAberta] = useState(false);
  const analise = useQuery({ queryKey: ['envios', 'modelos-em-analise'], queryFn: buscarModelosEmAnalise });

  return (
    <div className="space-y-1.5">
      <Button variant="outline" size="sm" className="toque h-11 md:h-8" onClick={() => setAberta(true)}>
        <Plus aria-hidden="true" />
        Criar modelo novo
      </Button>
      {(analise.data ?? []).length > 0 ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Esperando a Meta:{' '}
          {(analise.data ?? [])
            .map((m) => `${m.name}${m.meta_status === 'rejected' ? ' (recusado)' : ''}`)
            .join(' · ')}
        </p>
      ) : null}
      {aberta ? <Folha aoFechar={() => setAberta(false)} /> : null}
    </div>
  );
}

const BOTOES_INICIAIS: Botao[] = [
  { tipo: 'resposta', texto: 'Quero saber mais' },
  { tipo: 'resposta', texto: 'Agora não' },
];

function Folha({ aoFechar }: { aoFechar: () => void }) {
  const clientes = useQueryClient();
  const [nome, setNome] = useState('');
  const [categoria, setCategoria] = useState<'marketing' | 'utility'>('marketing');
  const [corpo, setCorpo] = useState('Oi, {{nome}}. ');
  const [botoes, setBotoes] = useState<Botao[]>(BOTOES_INICIAIS);

  const criar = useMutation({
    mutationFn: () => criarModelo({ nome, categoria, corpo, botoes }),
    onSuccess: () => {
      toast.success('Modelo criado e a caminho da Meta.', {
        description:
          'Ele aparece para escolha quando voltar aprovado. Costuma levar de minutos a um dia.',
      });
      void clientes.invalidateQueries({ queryKey: ['envios'] });
      aoFechar();
    },
    onError: (erro: Error) => {
      const motivo = erro instanceof ErroDoEnvio ? erro.motivo : '';
      toast.error('O modelo não foi criado.', {
        description: fraseDaRecusa(motivo === 'nome_invalido' ? 'nome_invalido_modelo' : motivo),
      });
    },
  });

  const temLink = botoes.some((b) => b.tipo === 'link');

  return (
    <Sheet open onOpenChange={(v) => !v && aoFechar()}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Novo modelo, em nome da Komune</SheetTitle>
          <SheetDescription>
            Uma mensagem, uma ação. Vai para a Meta aprovar antes de poder ser usado.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
          <div className="space-y-1">
            <label htmlFor="modelo-nome" className="text-xs text-muted-foreground">
              Nome (só para o time)
            </label>
            <Input
              id="modelo-nome"
              value={nome}
              maxLength={80}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex.: Convite para a feira de noivas"
              className="h-11 md:h-9"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="modelo-categoria" className="text-xs text-muted-foreground">
              Tipo
            </label>
            <Select value={categoria} onValueChange={(v) => setCategoria(v as 'marketing' | 'utility')}>
              <SelectTrigger id="modelo-categoria" className="toque h-11 w-full md:h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="marketing">Marketing: convite, novidade, oferta (≈ R$ 0,34)</SelectItem>
                <SelectItem value="utility">Utilidade: confirmação, lembrete (≈ R$ 0,035)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              A Meta reclassifica como marketing o que tiver cara de venda. Na dúvida, marketing.
            </p>
          </div>

          <div className="space-y-1">
            <label htmlFor="modelo-corpo" className="text-xs text-muted-foreground">
              Mensagem
            </label>
            <textarea
              id="modelo-corpo"
              value={corpo}
              maxLength={1024}
              rows={6}
              onChange={(e) => setCorpo(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Variáveis: {'{{nome}}'}, {'{{empresa}}'}, {'{{categoria}}'}, {'{{cidade}}'} ou uma sua, em
              minúsculas. Não comece nem termine com variável, e não ponha link no texto: o link vai no
              botão.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Botões (até 3)
            </h3>
            {botoes.map((b, i) => (
              <div key={i} className="flex items-center gap-2">
                {b.tipo === 'link' ? (
                  <Link2 className="size-4 shrink-0 text-muted-foreground" aria-label="Botão de link" />
                ) : (
                  <MessageSquareReply
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-label="Botão de resposta"
                  />
                )}
                <Input
                  value={b.texto}
                  maxLength={25}
                  onChange={(e) =>
                    setBotoes(botoes.map((x, j) => (j === i ? { ...x, texto: e.target.value } : x)))
                  }
                  aria-label={`Texto do botão ${i + 1}`}
                  className="h-11 md:h-8"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Tirar o botão ${i + 1}`}
                  onClick={() => setBotoes(botoes.filter((_, j) => j !== i))}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            ))}
            {botoes.length < 3 ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="toque h-11 md:h-7"
                  onClick={() => setBotoes([...botoes, { tipo: 'resposta', texto: '' }])}
                >
                  <MessageSquareReply aria-hidden="true" />
                  Botão de resposta
                </Button>
                {!temLink ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="toque h-11 md:h-7"
                    onClick={() => setBotoes([...botoes, { tipo: 'link', texto: 'Criar meu perfil' }])}
                  >
                    <Link2 aria-hidden="true" />
                    Botão de link
                  </Button>
                ) : null}
              </div>
            ) : null}
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Resposta: a pessoa toca e o CRM faz o que o envio mandar (mandar o link, tirar da lista).
              Link: abre o destino escolhido no envio, e o CRM conta o clique. Para quem nunca falou com
              a gente, prefira resposta: link de número desconhecido parece golpe.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-hairline p-4">
          <Button
            className="toque h-11 md:h-9"
            disabled={criar.isPending || nome.trim().length < 3 || corpo.trim().length === 0}
            onClick={() => criar.mutate()}
          >
            {criar.isPending ? 'Criando…' : 'Criar e mandar para a Meta'}
          </Button>
          <Button variant="ghost" className="toque h-11 md:h-9" onClick={aoFechar}>
            Cancelar
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
