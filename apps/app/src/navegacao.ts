import { partesDoEndereco, type RegrasDaCasca } from './ambiente';

/**
 * Para onde vai cada endereço que o site tenta abrir na janela principal:
 *   · `app`    abre dentro da casca (as duas empresas e, no teste, o site do Mac);
 *   · `fora`   vai para o aparelho: Safari/Chrome para outros sites, e o app certo
 *              para `tel:`, `mailto:`, `whatsapp:`. O login com Google não passa por
 *              aqui: a casca o abre na janela segura antes (`entrada.ts`);
 *   · `nenhum` não abre (endereço quebrado, `javascript:`, `file:`, `data:`).
 *
 * Só a janela principal passa por aqui: um iframe do site (um mapa, um vídeo)
 * carrega dentro do próprio quadro, como no navegador.
 */
export type Destino = 'app' | 'fora' | 'nenhum';

export function destinoDoEndereco(
  endereco: string,
  regras: Pick<RegrasDaCasca, 'hosts' | 'soHttps'>,
): Destino {
  const partes = partesDoEndereco(endereco);
  if (!partes) return 'nenhum';
  switch (partes.esquema) {
    // about:blank e os downloads por blob nascem do próprio site.
    case 'about':
    case 'blob':
      return 'app';
    case 'javascript':
    case 'file':
    case 'data':
      return 'nenhum';
    case 'http':
    case 'https': {
      const daCasa = regras.hosts.includes(partes.host);
      const seguro = partes.esquema === 'https' || !regras.soHttps;
      return daCasa && seguro ? 'app' : 'fora';
    }
    default:
      return 'fora';
  }
}
