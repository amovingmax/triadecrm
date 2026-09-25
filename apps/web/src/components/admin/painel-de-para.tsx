'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DialogoConfirmar } from '@/components/admin/confirmar';
import { formatarData, formatarNumero } from '@/components/parceiros/formatos';

import {
  carregarRegrasDoDePara,
  esquecerRegraDoDePara,
  type RegraDoDePara,
} from './dados';
import { ErroDoPainel, EsqueletoLista } from './estados';
import { mensagemDoErro } from './formatos';

/**
 * O que o CRM aprendeu a traduzir, e um botão que desfaz.
 *
 * POR QUÊ (desenho de 25/09/2026, §2(d), freio 4): o de-para de categoria é a
 * peça que decide se uma linha vira parceiro ou vira trabalho, e desde 25/09 ele
 * também APRENDE — com quem escolhe a categoria na fila e com quem responde a
 * tela de resolver da importação. Aprendizado sem tela é aprendizado que ninguém
 * audita.
 *
 * E o desfazer mostra QUANTAS FICHAS cada regra criou. Um desfazer que não
 * mostra o estrago é um botão, não um desfazer: é esse número que decide entre
 * "apaga isso" e "deixa, está certo".
 *
 * Regra SEMEADA não sai daqui, e a ausência do botão é a explicação: ela é
 * decisão de produto, sai por migração, e apagá-la pela tela faria a próxima
 * publicação trazê-la de volta sem aviso.
 */
export function PainelDePara({ podeEsquecer }: { podeEsquecer: boolean }) {
  const clienteDeConsultas = useQueryClient();
  const [emDuvida, setEmDuvida] = useState<RegraDoDePara | null>(null);

  const consulta = useQuery({
    queryKey: ['admin', 'de-para'],
    queryFn: carregarRegrasDoDePara,
  });

  const esquecer = useMutation({
    mutationFn: (r: RegraDoDePara) => esquecerRegraDoDePara(r.fonteId, r.nomeNaFonte),
    onSuccess: (_d, r) => {
      void clienteDeConsultas.invalidateQueries({ queryKey: ['admin'] });
      toast.success(`O CRM esqueceu “${r.nomeNaFonte}”.`, {
        description:
          r.fichas > 0
            ? `As ${formatarNumero(r.fichas)} fichas que essa regra criou continuam de pé: desfazer vale para frente, como a regra valia.`
            : 'Da próxima vez que esse nome aparecer, ele vai parar na fila.',
      });
      setEmDuvida(null);
    },
    onError: (erro) =>
      toast.error('Não deu para esquecer a regra.', { description: mensagemDoErro(erro) }),
  });

  if (consulta.isPending) return <EsqueletoLista linhas={8} colunas={5} />;
  if (consulta.isError) {
    return (
      <ErroDoPainel
        causa={mensagemDoErro(consulta.error)}
        aoTentar={() => void consulta.refetch()}
      />
    );
  }

  const regras = consulta.data;
  const aprendidas = regras.filter((r) => r.origem === 'aprendido').length;

  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-prose text-sm text-muted-foreground">
        Como o CRM traduz o nome de categoria que cada fonte usa. O que está como{' '}
        <span className="text-foreground">aprendido</span> veio de alguém escolhendo a categoria na
        fila ou respondendo a tela da importação —{' '}
        <span className="numerico">{formatarNumero(aprendidas)}</span>{' '}
        {aprendidas === 1 ? 'regra' : 'regras'} até agora. O que está como semeado é decisão de
        produto e só muda por publicação.
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>O que a fonte escreve</TableHead>
            <TableHead>Vira</TableHead>
            <TableHead>Fonte</TableHead>
            <TableHead>De onde veio</TableHead>
            <TableHead className="text-right">Fichas</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {regras.map((r) => (
            <TableRow key={`${r.fonteId}:${r.nomeNaFonte}`}>
              <TableCell className="font-medium">{r.nomeNaFonte}</TableCell>
              <TableCell>{r.categoria}</TableCell>
              <TableCell className="text-muted-foreground">{r.fonte}</TableCell>
              <TableCell>
                {r.origem === 'aprendido' ? (
                  <span className="text-sm">
                    {r.quem ?? 'alguém'}
                    {r.aprendidoEm ? (
                      <span className="text-muted-foreground">
                        {' '}
                        em <span className="numerico">{formatarData(r.aprendidoEm)}</span>
                      </span>
                    ) : null}
                    {r.vezes > 1 ? (
                      <span className="text-muted-foreground">
                        {' '}
                        · <span className="numerico">{r.vezes}</span> escolhas
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <Badge variant="pilula" className="font-normal">
                    semeado
                  </Badge>
                )}
              </TableCell>
              <TableCell className="numerico text-right">{formatarNumero(r.fichas)}</TableCell>
              <TableCell className="text-right">
                {podeEsquecer && r.origem === 'aprendido' ? (
                  <Button variant="ghost" size="sm" onClick={() => setEmDuvida(r)}>
                    Esquecer
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <DialogoConfirmar
        aberto={emDuvida !== null}
        titulo={`Esquecer “${emDuvida?.nomeNaFonte ?? ''}”?`}
        descricao={
          emDuvida
            ? `O CRM para de traduzir esse nome para ${emDuvida.categoria}. As ${formatarNumero(emDuvida.fichas)} ${emDuvida.fichas === 1 ? 'ficha que essa regra criou continua' : 'fichas que essa regra criou continuam'} de pé — desfazer vale para frente, como a regra valia. Da próxima vez, esse nome para na fila.`
            : ''
        }
        rotuloConfirmar="Esquecer a regra"
        ocupado={esquecer.isPending}
        aoConfirmar={() => emDuvida && esquecer.mutate(emDuvida)}
        aoFechar={() => setEmDuvida(null)}
      />
    </div>
  );
}
