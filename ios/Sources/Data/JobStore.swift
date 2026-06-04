import Foundation
import SwiftData

/// Reconciles the server's canonical jobs with the local SwiftData cache.
///
/// All access is `@MainActor` because `ModelContext` is not `Sendable`; networking
/// happens off-actor inside `APIClient` and only the resulting value types cross
/// back here to be persisted. Conflict resolution is last-write-wins by `updatedAt`,
/// with server-owned fields (status / transcript / pdfUrl) always adopting the
/// server value even when the local copy has unpushed label/section edits.
@MainActor
final class JobStore {
    private let context: ModelContext

    init(context: ModelContext) {
        self.context = context
    }

    // MARK: - Queries

    func allJobs() -> [Job] {
        let descriptor = FetchDescriptor<Job>(
            sortBy: [SortDescriptor(\.createdAt, order: .reverse)]
        )
        return (try? context.fetch(descriptor)) ?? []
    }

    func job(id: String) -> Job? {
        var descriptor = FetchDescriptor<Job>(predicate: #Predicate { $0.id == id })
        descriptor.fetchLimit = 1
        return (try? context.fetch(descriptor))?.first
    }

    // MARK: - Server → local

    /// Upserts a page of jobs pulled from the server.
    func mergePulled(_ dtos: [JobDTO]) {
        for dto in dtos { upsert(dto) }
        save()
    }

    /// Upserts a single server job and persists immediately.
    @discardableResult
    func apply(_ dto: JobDTO) -> Job? {
        let job = upsert(dto)
        save()
        return job
    }

    @discardableResult
    private func upsert(_ dto: JobDTO) -> Job {
        let serverUpdated = ISO8601.date(from: dto.updatedAt)

        if let existing = job(id: dto.id) {
            // Server-owned fields are never edited on-device → always adopt them.
            existing.status = dto.status
            existing.transcript = dto.transcript
            existing.errorMessage = dto.errorMessage
            existing.pdfUrl = dto.pdfUrl

            let localWins = existing.syncState == .dirty && existing.updatedAt > serverUpdated
            if !localWins {
                existing.label = dto.label
                existing.updatedAt = serverUpdated
                syncSections(existing, dto.sections)
                existing.syncState = .synced
            }
            return existing
        }

        let job = Job(
            id: dto.id,
            label: dto.label,
            status: dto.status,
            createdAt: ISO8601.date(from: dto.createdAt),
            updatedAt: serverUpdated
        )
        job.transcript = dto.transcript
        job.errorMessage = dto.errorMessage
        job.pdfUrl = dto.pdfUrl
        context.insert(job)
        syncSections(job, dto.sections)
        return job
    }

    private func syncSections(_ job: Job, _ dtos: [SectionDTO]) {
        var existing = Dictionary(job.sections.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var keep = Set<String>()

        for dto in dtos {
            keep.insert(dto.id)
            let section: ReportSection
            if let found = existing[dto.id] {
                section = found
            } else {
                section = ReportSection(id: dto.id, title: dto.title, sortOrder: dto.sortOrder)
                section.job = job
                job.sections.append(section)
                context.insert(section)
                existing[dto.id] = section
            }
            section.title = dto.title
            section.sortOrder = dto.sortOrder
            syncFindings(section, dto.findings)
        }

        for section in job.sections where !keep.contains(section.id) {
            context.delete(section)
        }
    }

    private func syncFindings(_ section: ReportSection, _ dtos: [FindingDTO]) {
        var existing = Dictionary(section.findings.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var keep = Set<String>()

        for dto in dtos {
            keep.insert(dto.id)
            let finding: Finding
            if let found = existing[dto.id] {
                finding = found
            } else {
                finding = Finding(id: dto.id, text: dto.text, severity: dto.severity, sortOrder: dto.sortOrder)
                finding.section = section
                section.findings.append(finding)
                context.insert(finding)
                existing[dto.id] = finding
            }
            finding.text = dto.text
            finding.severity = dto.severity
            finding.sortOrder = dto.sortOrder
        }

        for finding in section.findings where !keep.contains(finding.id) {
            context.delete(finding)
        }
    }

    // MARK: - Local mutations

    /// Records a freshly created job plus the local audio file awaiting upload and
    /// the presigned PUT URL (so an interrupted upload can resume within its TTL).
    @discardableResult
    func registerCreated(
        _ dto: JobDTO,
        localAudioPath: String,
        upload: PresignedUploadDTO,
        now: Date
    ) -> Job {
        let job = upsert(dto)
        job.pendingUpload = true
        job.localAudioPath = localAudioPath
        job.uploadURL = upload.url
        job.uploadContentType = upload.contentType
        job.uploadExpiresAt = now.addingTimeInterval(TimeInterval(upload.expiresInSeconds))
        save()
        return job
    }

    func markUploaded(id: String) {
        guard let job = job(id: id) else { return }
        job.pendingUpload = false
        job.localAudioPath = nil
        job.uploadURL = nil
        job.uploadContentType = nil
        job.uploadExpiresAt = nil
        save()
    }

    /// Applies on-device edits (label / sections) and marks the job dirty so the
    /// next sync pushes it. `updatedAt` is bumped to now so LWW favours the edit.
    func applyLocalEdits(id: String, label: String, sections: [SectionDTO], at now: Date) {
        guard let job = job(id: id) else { return }
        job.label = label
        job.updatedAt = now
        job.syncState = .dirty
        syncSections(job, sections)
        save()
    }

    func delete(id: String) {
        guard let job = job(id: id) else { return }
        context.delete(job)
        save()
    }

    private func save() {
        guard context.hasChanges else { return }
        do {
            try context.save()
        } catch {
            // A failed local save is non-fatal: the server remains the source of
            // truth and the next pull will reconcile. Surface loudly in debug.
            assertionFailure("SwiftData save failed: \(error)")
        }
    }
}
