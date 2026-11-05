import { estouNoApp } from '@/lib/auth/entrada-pelo-app';

/**
 * Entrega um arquivo gerado na página (planilha, CSV, exportação) a quem pediu.
 *
 * No navegador, é o download de sempre: um link para o arquivo, clicado na hora.
 *
 * No app de celular (05/11/2026), esse download não acontece: a WebView do iPhone
 * ignora o link de arquivo gerado na página, e o botão parecia não fazer nada. Lá o
 * arquivo vai inteiro para a casca, como texto em base64, e a casca abre a folha de
 * compartilhar do aparelho (Salvar em Arquivos, WhatsApp, e-mail, Numbers): ver
 * `apps/app/src/arquivo.ts`. Fora do app nada disso existe, e o navegador segue igual.
 */

/** O nome do recado que a casca reconhece (`apps/app/src/arquivo.ts`). */
export const RECADO_DE_ARQUIVO = 'baixar-arquivo';

type PonteDoApp = { postMessage: (mensagem: string) => void };

/** A ponte que o react-native-webview põe na página, só dentro do app. */
function ponteDoApp(): PonteDoApp | null {
  const ponte = (window as { ReactNativeWebView?: PonteDoApp }).ReactNativeWebView;
  return ponte && estouNoApp(navigator.userAgent) ? ponte : null;
}

/** Só roda no cliente, a partir de um clique. */
export function entregarArquivo(nome: string, arquivo: Blob): void {
  const ponte = ponteDoApp();
  if (ponte) {
    void mandarParaOApp(ponte, nome, arquivo);
    return;
  }
  const endereco = URL.createObjectURL(arquivo);
  const ancora = document.createElement('a');
  ancora.href = endereco;
  ancora.download = nome;
  document.body.append(ancora);
  ancora.click();
  ancora.remove();
  URL.revokeObjectURL(endereco);
}

async function mandarParaOApp(ponte: PonteDoApp, nome: string, arquivo: Blob): Promise<void> {
  const base64 = await emBase64(arquivo);
  ponte.postMessage(JSON.stringify({ tipo: RECADO_DE_ARQUIVO, nome, base64 }));
}

/** O conteúdo do arquivo em base64, sem o prefixo `data:...;base64,`. */
function emBase64(arquivo: Blob): Promise<string> {
  return new Promise((resolver, recusar) => {
    const leitor = new FileReader();
    leitor.onload = () => {
      const url = String(leitor.result);
      resolver(url.slice(url.indexOf(',') + 1));
    };
    leitor.onerror = () => recusar(leitor.error ?? new Error('leitura do arquivo falhou'));
    leitor.readAsDataURL(arquivo);
  });
}
