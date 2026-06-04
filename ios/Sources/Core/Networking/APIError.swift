import Foundation

/// Typed networking failures surfaced to the UI. `unauthorized` means refresh
/// also failed — the app should sign the user out and return to the gate.
enum APIError: Error, LocalizedError, Sendable {
    case invalidURL
    case unauthorized
    case server(status: Int, detail: String?)
    case decoding(String)
    case transport(String)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "The request address was invalid."
        case .unauthorized:
            return "Your session expired. Please sign in again."
        case let .server(status, detail):
            return detail ?? "The server returned an error (\(status))."
        case let .decoding(message):
            return "Unexpected response from the server. \(message)"
        case let .transport(message):
            return "Network problem: \(message)"
        }
    }

    /// Whether retrying the same request could plausibly succeed (5xx / transport).
    var isRetryable: Bool {
        switch self {
        case let .server(status, _):
            return status >= 500
        case .transport:
            return true
        case .invalidURL, .unauthorized, .decoding:
            return false
        }
    }
}
