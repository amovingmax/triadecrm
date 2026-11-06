/**
 * "Já chegou ao portal?" — a pergunta que a tela responde no lugar de um
 * "publicado" na hora do clique (04/11/2026).
 *
 * O Grupo OLX baixa o arquivo a cada 12 horas. A Edge Function anota cada
 * leitura (`canal_pro_leituras`); se a última leitura do robô veio DEPOIS da
 * última mudança do anúncio, ele já foi levado. O portal ainda leva até 4 horas
 * (ZAP e Viva Real) ou 24 horas (OLX) para mostrar, e pode recusar por erro: o
 * relatório de integração do Canal Pro é quem diz.
 */

const QUANDO = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Fortaleza',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** "em 04/11 às 18:05", no fuso da operação. */
export function formatarQuando(iso: string): string {
  const partes = Object.fromEntries(
    QUANDO.formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  );
  return `em ${partes.day}/${partes.month} às ${partes.hour}:${partes.minute}`;
}

export function jaFoiLido(mudouEm: string, ultimaLeitura: { em: string } | null): boolean {
  return (
    ultimaLeitura !== null && new Date(ultimaLeitura.em).getTime() > new Date(mudouEm).getTime()
  );
}

export function SituacaoNoPortal({
  mudouEm,
  ultimaLeitura,
}: {
  mudouEm: string;
  ultimaLeitura: { em: string } | null;
}) {
  return jaFoiLido(mudouEm, ultimaLeitura) ? (
    <p className="text-xs text-muted-foreground">
      Levado pelo Grupo OLX {formatarQuando(ultimaLeitura!.em)}. Erros aparecem no relatório de
      integração do Canal Pro.
    </p>
  ) : (
    <p className="text-xs text-muted-foreground">
      Entra no portal na próxima leitura do Grupo OLX (a cada 12 horas).
    </p>
  );
}
