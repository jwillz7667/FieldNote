import Foundation
import SwiftData

/// Builds the app's SwiftData container. The schema is the local cache mirror of
/// the server's canonical data. In-memory variant backs previews and tests.
enum PersistenceController {
    static let schema = Schema([Job.self, ReportSection.self, Finding.self])

    static func makeContainer(inMemory: Bool = false) -> ModelContainer {
        let configuration = ModelConfiguration(
            schema: schema,
            isStoredInMemoryOnly: inMemory
        )
        do {
            return try ModelContainer(for: schema, configurations: [configuration])
        } catch {
            // A corrupt local cache must never brick the app; the server is the
            // source of truth, so fall back to a fresh in-memory store.
            assertionFailure("Failed to open SwiftData store: \(error)")
            let fallback = ModelConfiguration(schema: schema, isStoredInMemoryOnly: true)
            // Force-try is acceptable here: an in-memory store has no failure modes
            // beyond programmer error in the schema, which we want to surface loudly.
            return try! ModelContainer(for: schema, configurations: [fallback])
        }
    }
}
