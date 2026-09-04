import { Construction } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type Props = {
  titulo: string;
  /** Dia do calendário do PRD §11.2 (ex.: "D3", "D1/D2"). */
  dia: string;
  descricao?: string;
};

/** Placeholder das telas ainda não construídas, com o dia previsto no calendário do MVP. */
export function EmConstrucao({ titulo, dia, descricao }: Props) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{titulo}</h1>
        <Badge variant="outline">chega no {dia}</Badge>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Construction className="size-5 text-muted-foreground" aria-hidden="true" />
            Em construção — chega no {dia}
          </CardTitle>
          {descricao ? <CardDescription>{descricao}</CardDescription> : null}
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          O calendário do MVP está no PRD §11.2 (D1 sex 04/09 → D10 sex 18/09/2026). Enquanto esta
          tela não chega, o registro segue na planilha-ponte.
        </CardContent>
      </Card>
    </div>
  );
}
