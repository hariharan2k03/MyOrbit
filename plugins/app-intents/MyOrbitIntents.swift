import AppIntents
import Foundation

// Siri and Shortcuts actions for MyOrbit. Copied into the app target by
// plugins/withAppIntents.js on `expo prebuild`; edit this file, not ios/.
//
// Intents never touch the database themselves. They queue a small JSON action
// in the App Group; the app applies it (with its normal validation) as soon as
// it's opened. See src/services/intentActions.ts.

private enum ActionQueue {
  static let key = "myorbit.pendingActions"
  // Apple Pay purchases can pile up for days before MyOrbit is opened.
  static let limit = 300

  static func push(_ action: [String: Any]) throws {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "ExpoWidgetsAppGroupIdentifier") as? String,
          let defaults = UserDefaults(suiteName: group) else {
      throw QueueError.unavailable
    }
    var entry = action
    entry["queuedAt"] = Int(Date().timeIntervalSince1970 * 1000)
    let data = try JSONSerialization.data(withJSONObject: entry)
    guard let json = String(data: data, encoding: .utf8) else { throw QueueError.unavailable }
    var queue = defaults.stringArray(forKey: key) ?? []
    queue.append(json)
    defaults.set(Array(queue.suffix(limit)), forKey: key)
  }

  /// The last Apple Pay automation run, so MyOrbit can show whether it fired
  /// and what Wallet passed in (a run that fails otherwise leaves no trace).
  static func recordApplePayRun(_ info: [String: Any]) {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "ExpoWidgetsAppGroupIdentifier") as? String,
          let defaults = UserDefaults(suiteName: group) else { return }
    var entry = info
    entry["at"] = Int(Date().timeIntervalSince1970 * 1000)
    if let data = try? JSONSerialization.data(withJSONObject: entry), let json = String(data: data, encoding: .utf8) {
      defaults.set(json, forKey: "myorbit.applePayLastRun")
    }
  }

  static func today() -> String {
    let f = DateFormatter()
    f.calendar = Calendar(identifier: .gregorian)
    f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = .current
    f.dateFormat = "yyyy-MM-dd"
    return f.string(from: Date())
  }
}

private enum QueueError: Error, CustomLocalizedStringResourceConvertible {
  case unavailable
  var localizedStringResource: LocalizedStringResource { "MyOrbit couldn’t save that. Open the app and try again." }
}

enum TimerKind: String, AppEnum {
  case focus
  case breakTime = "break"

  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Timer"
  static let caseDisplayRepresentations: [TimerKind: DisplayRepresentation] = [
    .focus: "Focus",
    .breakTime: "Break",
  ]
}

struct StartTimerIntent: AppIntent {
  static let title: LocalizedStringResource = "Start Timer"
  static let description = IntentDescription("Starts a focus or break timer. It shows on the Lock Screen and in the Dynamic Island.")
  // The timer and its Live Activity are started by the app, so it opens.
  static let openAppWhenRun = true

  @Parameter(title: "Timer", default: .focus)
  var kind: TimerKind

  @Parameter(title: "Minutes", default: 25, inclusiveRange: (5, 180))
  var minutes: Int

  static var parameterSummary: some ParameterSummary {
    Summary("Start a \(\.$minutes)-minute \(\.$kind) timer")
  }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    try ActionQueue.push(["type": "startTimer", "kind": kind.rawValue, "minutes": minutes])
    return .result(dialog: "Starting a \(minutes)-minute \(kind == .focus ? "focus" : "break") timer.")
  }
}

struct AddExpenseIntent: AppIntent {
  static let title: LocalizedStringResource = "Add Expense"
  static let description = IntentDescription("Records money you spent today.")
  static let openAppWhenRun = false

  @Parameter(title: "Amount", description: "In Australian dollars", inclusiveRange: (0.01, 100_000))
  var amount: Double

  @Parameter(title: "What for", default: "Expense")
  var note: String

  static var parameterSummary: some ParameterSummary {
    Summary("Add \(\.$amount) for \(\.$note)")
  }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let cents = Int((amount * 100).rounded())
    try ActionQueue.push(["type": "addExpense", "amountCents": cents, "description": String(note.prefix(120)), "date": ActionQueue.today()])
    let dollars = String(format: "$%.2f", Double(cents) / 100)
    return .result(dialog: "Saved \(dollars) for \(note). It’ll show in MyOrbit next time you open it.")
  }
}

/// Run by a Shortcuts "Transaction" (Wallet) automation each time you pay
/// with Apple Pay, so purchases are logged without opening MyOrbit.
struct LogApplePayPurchaseIntent: AppIntent {
  static let title: LocalizedStringResource = "Log Apple Pay Purchase"
  static let description = IntentDescription(
    "Saves an Apple Pay purchase as an expense and picks a category from the store name. Use it in a Wallet transaction automation: set Merchant, Amount and Card from the Shortcut Input."
  )
  static let openAppWhenRun = false

  /// Optional: some transactions arrive without a store name, and a required
  /// parameter would stop a "Run Immediately" automation without saving anything.
  @Parameter(title: "Merchant")
  var merchant: String?

  /// Text, because the Wallet trigger gives a currency value like "A$12.50".
  /// Optional: Wallet sometimes sends no amount (it isn't final at the tap).
  @Parameter(title: "Amount")
  var amount: String?

  @Parameter(title: "Card")
  var card: String?

  static var parameterSummary: some ParameterSummary {
    Summary("Log \(\.$amount) at \(\.$merchant)") {
      \.$card
    }
  }

  func perform() async throws -> some IntentResult {
    let name = (merchant ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    let amountText = amount ?? ""
    let raw: [String: Any] = ["merchant": String(name.prefix(120)), "amount": String(amountText.prefix(40)), "card": String((card ?? "").prefix(60))]
    guard let cents = Self.cents(from: amountText), cents > 0 else {
      // No usable amount: keep the purchase anyway so MyOrbit can ask for it.
      ActionQueue.recordApplePayRun(raw.merging(["result": "noAmount"]) { $1 })
      try ActionQueue.push([
        "type": "pendingPurchase",
        "merchant": String((name.isEmpty ? "Apple Pay" : name).prefix(120)),
        "card": String((card ?? "").prefix(60)),
        "date": ActionQueue.today(),
      ])
      return .result()
    }
    ActionQueue.recordApplePayRun(raw.merging(["result": "saved", "amountCents": cents]) { $1 })
    try ActionQueue.push([
      "type": "logPurchase",
      "amountCents": cents,
      "merchant": String((name.isEmpty ? "Apple Pay" : name).prefix(120)),
      "card": String((card ?? "").prefix(60)),
      "date": ActionQueue.today(),
    ])
    return .result()
  }

  /// "A$12.50", "$1,234.5", "12.50 AUD" → cents. Refunds (negative) are ignored.
  static func cents(from text: String) -> Int? {
    if text.contains("-") { return nil }
    let cleaned = text.filter { "0123456789.,".contains($0) }.replacingOccurrences(of: ",", with: "")
    guard let value = Double(cleaned), value.isFinite, value <= 100_000 else { return nil }
    return Int((value * 100).rounded())
  }
}

struct AddTaskIntent: AppIntent {
  static let title: LocalizedStringResource = "Add Task"
  static let description = IntentDescription("Adds a task due today.")
  static let openAppWhenRun = false

  @Parameter(title: "Task")
  var title: String

  func perform() async throws -> some IntentResult & ProvidesDialog {
    try ActionQueue.push(["type": "addTask", "title": String(title.prefix(120)), "date": ActionQueue.today()])
    return .result(dialog: "Added “\(title)” for today. It’ll show in MyOrbit next time you open it.")
  }
}

struct MyOrbitShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: StartTimerIntent(),
      phrases: [
        "Start a focus timer in \(.applicationName)",
        "Start a \(\.$kind) timer in \(.applicationName)",
        "Focus with \(.applicationName)",
      ],
      shortTitle: "Start Timer",
      systemImageName: "timer"
    )
    AppShortcut(
      intent: AddExpenseIntent(),
      phrases: ["Add an expense in \(.applicationName)", "Log spending in \(.applicationName)"],
      shortTitle: "Add Expense",
      systemImageName: "dollarsign.circle"
    )
    AppShortcut(
      intent: AddTaskIntent(),
      phrases: ["Add a task in \(.applicationName)", "Remind me in \(.applicationName)"],
      shortTitle: "Add Task",
      systemImageName: "checklist"
    )
  }
}
