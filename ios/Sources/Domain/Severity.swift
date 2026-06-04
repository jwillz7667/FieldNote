import SwiftUI

/// Finding severity. Raw values are the lowercase wire contract the API uses
/// (`info|maintenance|repair|safety`). Ordered most → least severe for sorting.
enum Severity: String, Codable, CaseIterable, Sendable, Identifiable {
    case safety
    case repair
    case maintenance
    case info

    var id: String { rawValue }

    /// Sort rank — lower is more severe (safety first), matching the server.
    var rank: Int {
        switch self {
        case .safety: return 0
        case .repair: return 1
        case .maintenance: return 2
        case .info: return 3
        }
    }

    var label: String {
        switch self {
        case .safety: return "Safety"
        case .repair: return "Repair"
        case .maintenance: return "Maintenance"
        case .info: return "Info"
        }
    }

    /// Content-layer accent (text/badge), never a glass tint.
    var color: Color {
        switch self {
        case .safety: return Color(red: 0.83, green: 0.18, blue: 0.18)
        case .repair: return Color(red: 0.85, green: 0.42, blue: 0.10)
        case .maintenance: return Color(red: 0.71, green: 0.55, blue: 0.05)
        case .info: return Color(red: 0.15, green: 0.39, blue: 0.85)
        }
    }
}
