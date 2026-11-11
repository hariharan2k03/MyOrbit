import ExpoModulesCore
#if canImport(FoundationModels)
import FoundationModels
#endif

/// Bridges Apple's on-device language model (Foundation Models, iOS 26+) to
/// MyOrbit. Only `SystemLanguageModel` is used — it runs entirely on the
/// iPhone, works offline and costs nothing. Apple's Private Cloud Compute
/// model is deliberately never used, so no data leaves the device.
public class MyOrbitAIModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MyOrbitAI")

    /// "available", or why not: "deviceNotEligible", "appleIntelligenceNotEnabled",
    /// "modelNotReady", "unavailable" or "unsupportedOS".
    Function("availability") { () -> String in
      #if canImport(FoundationModels)
      if #available(iOS 26.0, *) {
        switch SystemLanguageModel.default.availability {
        case .available:
          return "available"
        case .unavailable(.deviceNotEligible):
          return "deviceNotEligible"
        case .unavailable(.appleIntelligenceNotEnabled):
          return "appleIntelligenceNotEnabled"
        case .unavailable(.modelNotReady):
          return "modelNotReady"
        case .unavailable:
          return "unavailable"
        }
      }
      #endif
      return "unsupportedOS"
    }

    /// Plain-text answer. `instructions` carries the facts the model may use.
    AsyncFunction("respond") { (instructions: String, prompt: String) async throws -> String in
      #if canImport(FoundationModels)
      if #available(iOS 26.0, *) {
        let session = LanguageModelSession(model: SystemLanguageModel.default, instructions: instructions)
        do {
          let response = try await session.respond(to: prompt, options: GenerationOptions(temperature: 0.3, maximumResponseTokens: 400))
          return response.content
        } catch {
          throw AIError(describe(error))
        }
      }
      #endif
      throw AIError("Apple Intelligence isn’t available on this device.")
    }

    /// Pulls the fields out of a quick-add sentence. Dates and times come back
    /// as written; MyOrbit resolves and validates them before anything is saved.
    AsyncFunction("parseQuickAdd") { (instructions: String, text: String) async throws -> [String: Any] in
      #if canImport(FoundationModels)
      if #available(iOS 26.0, *) {
        let session = LanguageModelSession(model: SystemLanguageModel.default, instructions: instructions)
        do {
          let draft = try await session.respond(to: text, generating: QuickAddDraft.self, options: GenerationOptions(temperature: 0)).content
          return [
            "kind": draft.kind,
            "title": draft.title,
            "dateText": draft.dateText,
            "startTime": draft.startTime,
            "endTime": draft.endTime,
            "amount": draft.amount,
            "category": draft.category,
          ]
        } catch {
          throw AIError(describe(error))
        }
      }
      #endif
      throw AIError("Apple Intelligence isn’t available on this device.")
    }
  }
}

final class AIError: GenericException<String>, @unchecked Sendable {
  override var reason: String { param }
}

#if canImport(FoundationModels)
@available(iOS 26.0, *)
private func describe(_ error: Error) -> String {
  if let e = error as? LanguageModelSession.GenerationError {
    switch e {
    case .exceededContextWindowSize:
      return "That was too much to handle at once. Try a shorter question."
    case .guardrailViolation:
      return "Apple Intelligence couldn’t answer that one."
    case .unsupportedLanguageOrLocale:
      return "Apple Intelligence doesn’t support this language yet."
    default:
      return "Apple Intelligence couldn’t answer right now. Please try again."
    }
  }
  return "Apple Intelligence couldn’t answer right now. Please try again."
}

@available(iOS 26.0, *)
@Generable
struct QuickAddDraft {
  @Guide(description: "What to add: a work shift, a to-do task, money spent (expense) or money received (income)", .anyOf(["shift", "task", "expense", "income", "unknown"]))
  var kind: String

  @Guide(description: "For a shift, the workplace name. For a task, the task itself. For money, what it was for. Keep the user's words.")
  var title: String

  @Guide(description: "The date exactly as the user wrote it, e.g. 'Sat', 'tomorrow', '12 Nov'. Empty if not given.")
  var dateText: String

  @Guide(description: "Start time in 24-hour HH:mm, e.g. 09:00. For shifts, '9-5' means 09:00 to 17:00. Empty if not given.")
  var startTime: String

  @Guide(description: "End time in 24-hour HH:mm, e.g. 17:00. Empty if not given.")
  var endTime: String

  @Guide(description: "Amount of money in dollars for an expense or income, otherwise 0.")
  var amount: Double

  @Guide(description: "For an expense, the best matching category from the list in the instructions. Empty otherwise.")
  var category: String
}
#endif
