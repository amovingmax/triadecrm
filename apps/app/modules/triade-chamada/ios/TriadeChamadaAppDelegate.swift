import ExpoModulesCore
import UIKit

/// Liga o aviso de voz da Apple na abertura do app, antes da primeira tela: quando o
/// iPhone abre o app fechado por causa de uma ligação, o aviso só é entregue a quem já
/// estiver registrado (`CentralDeChamadas.iniciar`).
///
/// Desde 24/11/2026 o registro sai já no `willFinishLaunching`, o primeiro ponto em que
/// o app roda código seu (a Apple pede o PushKit e o CallKit "o mais cedo possível"), e o
/// diário anota cada abertura: com ele dá para ver se o iPhone abriu o app fechado.
public class TriadeChamadaAppDelegate: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    willFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // Aberto pelo aviso de voz, o app nasce em segundo plano; pela pessoa, "inativo".
    let jeito = application.applicationState == .background ? "em segundo plano" : "pela pessoa"
    Diario.anotar("app abriu \(jeito)")
    CentralDeChamadas.shared.iniciar()
    return true
  }

  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    CentralDeChamadas.shared.iniciar()
    return true
  }
}
