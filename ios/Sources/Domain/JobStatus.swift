import SwiftUI

/// Server-authoritative job lifecycle. Raw values are the uppercase wire contract
/// (`CREATED … READY/FAILED`). The app maps these to a calm, user-facing phase.
enum JobStatus: String, Codable, Sendable, CaseIterable {
    case created = "CREATED"
    case uploading = "UPLOADING"
    case queued = "QUEUED"
    case transcribing = "TRANSCRIBING"
    case compiling = "COMPILING"
    case rendering = "RENDERING"
    case ready = "READY"
    case failed = "FAILED"

    /// True while the server pipeline is actively working — drives polling.
    var isProcessing: Bool {
        switch self {
        case .queued, .transcribing, .compiling, .rendering:
            return true
        case .created, .uploading, .ready, .failed:
            return false
        }
    }

    var isTerminal: Bool { self == .ready || self == .failed }

    /// Short label for job rows / status pills.
    var displayName: String {
        switch self {
        case .created: return "Draft"
        case .uploading: return "Uploading"
        case .queued: return "Queued"
        case .transcribing: return "Transcribing"
        case .compiling: return "Compiling"
        case .rendering: return "Rendering"
        case .ready: return "Ready"
        case .failed: return "Failed"
        }
    }

    /// Longer, reassuring copy for the recording/processing screen.
    var calmDescription: String {
        switch self {
        case .created: return "Draft saved."
        case .uploading: return "Uploading your recording…"
        case .queued: return "Queued for processing…"
        case .transcribing: return "Transcribing your walkthrough…"
        case .compiling: return "Compiling the report…"
        case .rendering: return "Rendering the PDF…"
        case .ready: return "Your report is ready."
        case .failed: return "Something went wrong."
        }
    }

    var tint: Color {
        switch self {
        case .ready: return Color(red: 0.13, green: 0.55, blue: 0.30)
        case .failed: return Color(red: 0.83, green: 0.18, blue: 0.18)
        case .created: return .secondary
        default: return Color(red: 0.15, green: 0.39, blue: 0.85)
        }
    }
}
