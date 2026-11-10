import { EMPRESA } from '@/lib/empresa';
import { cn } from '@/lib/utils';

/**
 * A Imova tem marca própria dentro do CRM desde 10/11/2026 (o "Maré"); a KOMUNE
 * continua com a do Tríade. Quem desenha a marca pergunta aqui, e nunca à empresa.
 */
const MARCA_DA_IMOVA = EMPRESA.slug === 'imova';

/** O nome que o leitor de tela diz no link da marca ("Tríade, ir para Meu dia"). */
export const NOME_DA_MARCA = MARCA_DA_IMOVA ? 'Imova' : 'Tríade';

/**
 * Marca do CRM. O produto se chama **Tríade**; Komune é a empresa dona dele.
 * O desenho são três pontos ligados — os três lados que o CRM conecta
 * (fornecedor, produtor e a Komune) e o próprio nome.
 *
 * Na Imova, o logo dela (o "IMOVA" com o "O" em alvo), nos dois tamanhos.
 */
export function Logo({
  className,
  somenteIcone = false,
}: {
  className?: string;
  somenteIcone?: boolean;
}) {
  if (MARCA_DA_IMOVA) {
    return <LogoImova className={cn('text-[19px]', className)} />;
  }
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold', className)}>
      <MarcaTriade className="size-7 shrink-0" />
      {!somenteIcone && (
        <span className="leading-none">
          Tríade <span className="font-normal text-muted-foreground">CRM</span>
        </span>
      )}
    </span>
  );
}

/** Ícone da marca, mesmo desenho dos ícones da PWA. */
export function MarcaTriade({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" aria-hidden="true" className={className}>
      <rect width="512" height="512" rx="112" className="fill-primary" />
      <g
        fill="none"
        stroke="var(--primary-foreground)"
        strokeWidth="30"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M256 154 366 350 146 350Z" />
      </g>
      <g fill="var(--primary-foreground)">
        <circle cx="256" cy="154" r="46" />
        <circle cx="366" cy="350" r="46" />
        <circle cx="146" cy="350" r="46" />
      </g>
    </svg>
  );
}

/** O símbolo da empresa: o alvo da Imova ou os três pontos do Tríade. */
export function MarcaDaEmpresa({ className }: { className?: string }) {
  return MARCA_DA_IMOVA ? (
    <AlvoImova className={className} />
  ) : (
    <MarcaTriade className={className} />
  );
}

/**
 * O "O" do logo da Imova: anel laranja, fresta e o ponto no meio, nas proporções do
 * arquivo dela (`public/marca/imova.png`). A cor vem de `--marca-alvo`, que só existe
 * no bloco da Imova do `globals.css`.
 */
export function AlvoImova({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" className={className}>
      <circle cx="50" cy="50" r="39" fill="none" stroke="var(--marca-alvo)" strokeWidth="22" />
      <circle cx="50" cy="50" r="15" fill="var(--marca-alvo)" />
    </svg>
  );
}

/**
 * O logotipo da Imova desenhado em código, e não a imagem: ele troca de cor com o
 * tema (petróleo no claro, claro sobre o petróleo do menu) e fica nítido em qualquer
 * tamanho. As letras são a Urbanist, que o layout só carrega na Imova. O tamanho vem
 * do `font-size` de quem usa (`text-[26px]`).
 */
export function LogoImova({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex items-center leading-none font-[family-name:var(--font-titulo)] font-extrabold tracking-[0.015em] text-[color:var(--marca-letra)]',
        className,
      )}
    >
      IM
      <AlvoImova className="mx-[0.03em] size-[0.74em] shrink-0" />
      VA
    </span>
  );
}
