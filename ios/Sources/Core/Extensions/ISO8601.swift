import Foundation

/// Parsing for the server's ISO-8601 timestamps (Prisma serialises with fractional
/// seconds, e.g. `2026-06-04T12:34:56.789Z`, but plain second precision also occurs).
enum ISO8601 {
    nonisolated(unsafe) private static let withFractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    nonisolated(unsafe) private static let plain: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    /// Parses a server timestamp, tolerating presence/absence of fractional seconds.
    /// Falls back to the distant past so an unparseable value never "wins" LWW.
    static func date(from string: String) -> Date {
        withFractional.date(from: string)
            ?? plain.date(from: string)
            ?? Date(timeIntervalSince1970: 0)
    }
}
