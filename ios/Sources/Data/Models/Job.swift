import Foundation
import SwiftData

/// Offline-first cache of a server job. The server is canonical; `syncState`
/// tracks local edits awaiting push, `pendingUpload` tracks audio not yet uploaded.
@Model
final class Job {
    @Attribute(.unique) var id: String
    var label: String
    var statusRaw: String
    var transcript: String?
    var errorMessage: String?
    var pdfUrl: String?
    var createdAt: Date
    var updatedAt: Date

    // Local-only bookkeeping (never sent to the server as-is).
    var syncStateRaw: String
    var pendingUpload: Bool
    /// File URL (path) of the locally recorded audio awaiting/ during upload.
    var localAudioPath: String?
    /// Cached presigned PUT URL so an interrupted upload can resume within its TTL.
    var uploadURL: String?
    var uploadContentType: String?
    var uploadExpiresAt: Date?

    @Relationship(deleteRule: .cascade, inverse: \ReportSection.job)
    var sections: [ReportSection] = []

    init(
        id: String,
        label: String,
        status: JobStatus,
        createdAt: Date,
        updatedAt: Date,
        syncState: SyncState = .synced,
        pendingUpload: Bool = false
    ) {
        self.id = id
        self.label = label
        self.statusRaw = status.rawValue
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.syncStateRaw = syncState.rawValue
        self.pendingUpload = pendingUpload
    }

    var status: JobStatus {
        get { JobStatus(rawValue: statusRaw) ?? .created }
        set { statusRaw = newValue.rawValue }
    }

    var syncState: SyncState {
        get { SyncState(rawValue: syncStateRaw) ?? .synced }
        set { syncStateRaw = newValue.rawValue }
    }

    /// Sections in stable display order (server-provided sortOrder).
    var orderedSections: [ReportSection] {
        sections.sorted { $0.sortOrder < $1.sortOrder }
    }

    var isReady: Bool { status == .ready }
}
