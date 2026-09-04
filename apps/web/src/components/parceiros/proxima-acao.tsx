import { cn } from '@/lib/utils';

import { formatarProximaAcao } from './formatos';

/**
 * Próxima ação de um negócio: "hoje", "amanhã", "em 4 d", "2 d atrás".
 *
 * Existe como componente único porque a tabela, o cartão do celular e a ficha
 * escreviam a mesma frase de três jeitos, e os três aplicavam a fonte mono na frase
 * inteira. Aqui só o DÍGITO recebe o utilitário `numerico`: "em" e "d" são palavra,
 * ficam em Poppins, e a linha volta a ter uma família só.
 *
 * `atrasada` pesa a fonte em vez de gastar cor: cor cromática nesta interface é da
 * escala térmica, e só dela.
 */
export function ProximaAcao({
  iso,
  className,
}: {
  iso: string | null | undefined;
  className?: string;
}) {
  const acao = formatarProximaAcao(iso);
  if (!acao) return null;

  return (
    <span
      title={acao.detalhe}
      className={cn('whitespace-nowrap', acao.atrasada && 'font-medium text-foreground', className)}
    >
      {acao.prefixo}
      {acao.numero ? <span className="numerico">{acao.numero}</span> : null}
      {acao.sufixo}
    </span>
  );
}
