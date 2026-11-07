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
  static let limit = 50

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
