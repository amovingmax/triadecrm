/**
 * Data e hora entre o `<input type="datetime-local">` e o banco.
 *
 * O campo nativo é o certo para o celular: ele abre o seletor do aparelho, respeita
 * o idioma do sistema e não pede biblioteca nenhuma. Em compensação ele fala um
 * dialeto próprio — `"2026-09-05T14:00"`, sem fuso — enquanto o `move_deal` espera
 * ISO 8601 com deslocamento (é o que `proximaAcaoSchema` valida em tipos.ts).
 * A tradução mora aqui, num lugar só.
 *
 * Sobre fuso: o navegador da Heloísa está em `America/Fortaleza`, o mesmo fuso em que
 * o banco reaplica a regra do "hoje" (CLAUDE.md). Convertemos com o fuso do aparelho
 * de propósito — "14:00" tem de significar duas da tarde onde a pessoa está — e o
 * Postgres continua sendo a autoridade sobre qual DIA é esse instante.
 */

/** Dois dígitos com zero à esquerda, para montar o valor do campo nativo. */
function doisDigitos(n: number): string {
  return String(n).padStart(2, '0');
}

/** `Date` → `"AAAA-MM-DDTHH:mm"` no fuso do aparelho (o que o campo nativo aceita). */
export function paraEntradaDataHora(data: Date): string {
  return (
    `${data.getFullYear()}-${doisDigitos(data.getMonth() + 1)}-${doisDigitos(data.getDate())}` +
    `T${doisDigitos(data.getHours())}:${doisDigitos(data.getMinutes())}`
  );
}

/** ISO do banco → valor do campo nativo; string vazia quando não há data. */
export function isoParaEntrada(iso: string | null | undefined): string {
  if (!iso) return '';
  const data = new Date(iso);
  return Number.isNaN(data.getTime()) ? '' : paraEntradaDataHora(data);
}

/**
 * Valor do campo nativo → ISO com deslocamento (`toISOString` devolve em Z, que o
 * `z.iso.datetime({ offset: true })` do contrato aceita). `null` quando está vazio
 * ou o navegador entregou algo que não é data.
 */
export function entradaParaIso(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
}

/** Meia-noite de hoje no aparelho: o piso de "hoje em diante" (RF-FUN-03). */
export function inicioDeHoje(): Date {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return hoje;
}

/** Valor mínimo do campo nativo: hoje às 00:00 — o seletor já nasce sem o passado. */
export function minimoDoCampoDeData(): string {
  return paraEntradaDataHora(inicioDeHoje());
}

/** `true` quando o valor do campo nativo cai antes de hoje (mesma regra do banco, por DIA). */
export function ehAntesDeHoje(valor: string): boolean {
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return false;
  return data.getTime() < inicioDeHoje().getTime();
}

/**
 * Sugestão de data para a próxima ação: amanhã às 9h.
 *
 * Não é "agora": quem acabou de mover o cartão está registrando o que já fez, e a
 * próxima ação é o próximo passo. Nove da manhã é quando o time começa a ligar.
 */
export function proximoDiaUtilAsNove(): Date {
  const alvo = new Date();
  alvo.setDate(alvo.getDate() + 1);
  alvo.setHours(9, 0, 0, 0);
  // Domingo não se trabalha (CLAUDE.md): empurra para segunda.
  if (alvo.getDay() === 0) alvo.setDate(alvo.getDate() + 1);
  return alvo;
}

const FORMATO_DATA_HORA = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const FORMATO_DATA_COMPLETA = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** `"05/09, 14:00"` — para cartão e linha do histórico, onde o ano é ruído. */
export function formatarDataHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  const data = new Date(iso);
  return Number.isNaN(data.getTime()) ? '—' : FORMATO_DATA_HORA.format(data);
}

/** `"05/09/2026, 14:00"` — quando a data pode ser de outro ano (histórico antigo). */
export function formatarDataHoraCompleta(iso: string | null | undefined): string {
  if (!iso) return '—';
  const data = new Date(iso);
  return Number.isNaN(data.getTime()) ? '—' : FORMATO_DATA_COMPLETA.format(data);
}
