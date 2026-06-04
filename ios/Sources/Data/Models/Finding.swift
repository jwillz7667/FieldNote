import Foundation
import SwiftData

/// A single inspection observation within a section. One severity per finding.
@Model
final class Finding {
    @Attribute(.unique) var id: String
    var text: String
    var severityRaw: String
    var sortOrder: Int

    var section: ReportSection?

    init(id: String, text: String, severity: Severity, sortOrder: Int) {
        self.id = id
        self.text = text
        self.severityRaw = severity.rawValue
        self.sortOrder = sortOrder
    }

    var severity: Severity {
        get { Severity(rawValue: severityRaw) ?? .info }
        set { severityRaw = newValue.rawValue }
    }
}
