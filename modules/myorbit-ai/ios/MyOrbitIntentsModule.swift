import ExpoModulesCore

/// Hands actions queued by Siri / Shortcuts (see plugins/app-intents/MyOrbitIntents.swift)
/// to the JS app. Both sides use the App Group's UserDefaults, so an action
/// saved while MyOrbit was closed is picked up on the next launch.
public class MyOrbitIntentsModule: Module {
  static let key = "myorbit.pendingActions"

  public func definition() -> ModuleDefinition {
    Name("MyOrbitIntents")

    /// Returns queued actions (JSON strings, oldest first) and clears the queue.
    Function("takePendingActions") { () -> [String] in
      guard let group = Bundle.main.object(forInfoDictionaryKey: "ExpoWidgetsAppGroupIdentifier") as? String,
            let defaults = UserDefaults(suiteName: group) else {
        return []
      }
      let actions = defaults.stringArray(forKey: Self.key) ?? []
      defaults.removeObject(forKey: Self.key)
      return actions
    }
  }
}
