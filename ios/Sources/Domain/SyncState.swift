import Foundation

/// Local-only sync status for a cached `Job`. The server is the source of truth;
/// this tracks whether the local copy has unpushed edits (last-write-wins on push).
enum SyncState: String, Codable, Sendable {
    /// Local copy matches the server (as of the last successful pull/push).
    case synced
    /// Local edits (label / sections) not yet accepted by the server.
    case dirty
}
