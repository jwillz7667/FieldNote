import Foundation
import SwiftData

/// A titled group of findings (e.g. "Roof", "Electrical"). Empty sections are
/// never produced by the server; the app preserves whatever the server sends.
@Model
final class ReportSection {
    @Attribute(.unique) var id: String
    var title: String
    var sortOrder: Int

    var job: Job?

    @Relationship(deleteRule: .cascade, inverse: \Finding.section)
    var findings: [Finding] = []

    init(id: String, title: String, sortOrder: Int) {
        self.id = id
        self.title = title
        self.sortOrder = sortOrder
    }

    /// Findings in stable display order (severity-ranked by the server's sortOrder).
    var orderedFindings: [Finding] {
        findings.sorted { $0.sortOrder < $1.sortOrder }
    }
}
