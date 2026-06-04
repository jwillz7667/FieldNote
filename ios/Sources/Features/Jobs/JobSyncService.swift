import Foundation
import Observation

/// Coordinates the server and the local cache: pulls jobs, drives the
/// record → create → upload → process → poll pipeline, reconciles interrupted
/// uploads at launch, and pushes local edits (last-write-wins).
///
/// `@MainActor` because it mutates the SwiftData-backed `JobStore`; all network
/// work is awaited on the off-actor `APIClient`.
@MainActor
@Observable
final class JobSyncService {
    private let api: APIClient
    private let store: JobStore
    private let uploader: AudioUploader

    /// Job ids the app is actively driving (upload/process/poll) — drives spinners.
    private(set) var activeJobIds: Set<String> = []
    var errorMessage: String?

    private let pageLimit = 50
    private let maxPollAttempts = 60

    init(api: APIClient, store: JobStore, uploader: AudioUploader) {
        self.api = api
        self.store = store
        self.uploader = uploader
        configureUploaderReconciliation()
    }

    // MARK: - Pull

    /// Pulls all of the user's jobs (cursor-paginated) into the local cache, then
    /// resumes polling any that are still processing and re-drives stuck uploads.
    func refresh(now: Date = Date()) async {
        do {
            var cursor: String?
            var pulled: [JobDTO] = []
            repeat {
                let page = try await api.listJobs(cursor: cursor, limit: pageLimit)
                pulled.append(contentsOf: page.items)
                cursor = page.nextCursor
            } while cursor != nil

            store.mergePulled(pulled)
            resumeInFlight(now: now)
        } catch {
            setError(error)
        }
    }

    /// Resumes work for jobs left mid-pipeline (processing → poll, pendingUpload →
    /// re-drive if the cached presigned URL is still valid).
    private func resumeInFlight(now: Date) {
        for job in store.allJobs() where !activeJobIds.contains(job.id) {
            if job.pendingUpload, let path = job.localAudioPath,
               FileManager.default.fileExists(atPath: path),
               let urlString = job.uploadURL,
               let contentType = job.uploadContentType,
               let expiresAt = job.uploadExpiresAt, expiresAt > now {
                let presigned = PresignedUploadDTO(
                    url: urlString,
                    key: "",
                    contentType: contentType,
                    expiresInSeconds: Int(expiresAt.timeIntervalSince(now))
                )
                let fileURL = URL(fileURLWithPath: path)
                Task { await self.driveUploadThenProcess(jobId: job.id, fileURL: fileURL, presigned: presigned) }
            } else if job.status.isProcessing {
                Task { await self.poll(jobId: job.id) }
            }
        }
    }

    // MARK: - New report pipeline

    /// Creates a job for the recording and runs the full pipeline. Returns the new
    /// job id immediately after creation so the UI can navigate while it processes.
    @discardableResult
    func startReport(label: String, recording: RecordingResult, now: Date) async -> String? {
        let idempotencyKey = UUID().uuidString
        do {
            let created = try await api.createJob(label: label, idempotencyKey: idempotencyKey)
            let jobId = created.job.id
            store.registerCreated(
                created.job,
                localAudioPath: recording.fileURL.path,
                upload: created.audioUploadUrl,
                now: now
            )
            Task {
                await self.driveUploadThenProcess(
                    jobId: jobId,
                    fileURL: recording.fileURL,
                    presigned: created.audioUploadUrl
                )
            }
            return jobId
        } catch {
            setError(error)
            return nil
        }
    }

    /// Uploads the audio to the presigned URL, marks the job uploaded, triggers
    /// processing, then polls to completion.
    private func driveUploadThenProcess(jobId: String, fileURL: URL, presigned: PresignedUploadDTO) async {
        activeJobIds.insert(jobId)
        defer { activeJobIds.remove(jobId) }

        do {
            try await uploader.upload(jobId: jobId, fileURL: fileURL, presigned: presigned)
            store.markUploaded(id: jobId)
            cleanupAudio(at: fileURL)

            let processed = try await api.processJob(id: jobId)
            store.apply(processed)
            // This task already owns jobId's activeJobIds membership (inserted above),
            // so poll the loop directly — poll(_:)'s guard would see the id and bail.
            await pollUntilTerminal(jobId: jobId)
        } catch {
            setError(error)
        }
    }

    // MARK: - Polling

    /// Polls a job until it reaches a terminal state. No-op if this job is already
    /// being driven elsewhere; otherwise claims it for the duration so concurrent
    /// pollers don't pile up.
    func poll(jobId: String) async {
        guard !activeJobIds.contains(jobId) else { return }
        activeJobIds.insert(jobId)
        defer { activeJobIds.remove(jobId) }
        await pollUntilTerminal(jobId: jobId)
    }

    /// The polling loop with capped exponential backoff. The caller must already own
    /// this job's `activeJobIds` membership — `driveUploadThenProcess` holds it across
    /// the whole upload→process→poll sequence, so it calls this directly rather than
    /// `poll(_:)`, whose guard would otherwise short-circuit immediately.
    private func pollUntilTerminal(jobId: String) async {
        for attempt in 1...maxPollAttempts {
            do {
                let dto = try await api.getJob(id: jobId)
                store.apply(dto)
                if dto.status.isTerminal { return }
            } catch {
                setError(error)
            }
            let seconds = min(8.0, 1.0 * pow(1.4, Double(attempt - 1)))
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
        }
    }

    // MARK: - Edits (P10, last-write-wins)

    /// Persists edits locally (dirty) then pushes them; on success the server copy
    /// is re-applied. On failure the local dirty copy is retained for a later push.
    func saveEdits(jobId: String, label: String, sections: [SectionDTO], now: Date) async {
        store.applyLocalEdits(id: jobId, label: label, sections: sections, at: now)
        await pushEdits(jobId: jobId)
    }

    /// Pushes any locally-edited (dirty) jobs to the server.
    func pushPendingEdits() async {
        for job in store.allJobs() where job.syncState == .dirty {
            await pushEdits(jobId: job.id)
        }
    }

    private func pushEdits(jobId: String) async {
        guard let job = store.job(id: jobId) else { return }
        let body = UpdateJobRequest(
            label: job.label,
            sections: job.orderedSections.map { section in
                UpdateSectionDTO(
                    title: section.title,
                    sortOrder: section.sortOrder,
                    findings: section.orderedFindings.map { finding in
                        UpdateFindingDTO(
                            text: finding.text,
                            severity: finding.severity,
                            sortOrder: finding.sortOrder
                        )
                    }
                )
            }
        )
        do {
            let updated = try await api.updateJob(id: jobId, body: body)
            store.apply(updated)
        } catch {
            setError(error)
        }
    }

    // MARK: - Retry

    /// Re-enqueues processing for a failed job (the worker is idempotent/retriable)
    /// and resumes polling.
    func retry(jobId: String) async {
        do {
            let processed = try await api.processJob(id: jobId)
            store.apply(processed)
            await poll(jobId: jobId)
        } catch {
            setError(error)
        }
    }

    // MARK: - Delete

    func delete(jobId: String) async {
        do {
            try await api.deleteJob(id: jobId)
            store.delete(id: jobId)
        } catch {
            setError(error)
        }
    }

    // MARK: - PDF

    func pdfURL(jobId: String) async -> URL? {
        do {
            let dto = try await api.getPdfUrl(id: jobId)
            return URL(string: dto.url)
        } catch {
            setError(error)
            return nil
        }
    }

    // MARK: - Helpers

    private func configureUploaderReconciliation() {
        uploader.onUploadFinished = { [weak self] jobId, success in
            Task { @MainActor in
                guard let self else { return }
                guard success else { return }
                self.store.markUploaded(id: jobId)
                do {
                    let processed = try await self.api.processJob(id: jobId)
                    self.store.apply(processed)
                    await self.poll(jobId: jobId)
                } catch {
                    self.setError(error)
                }
            }
        }
    }

    private func cleanupAudio(at url: URL) {
        try? FileManager.default.removeItem(at: url)
    }

    private func setError(_ error: Error) {
        if error is CancellationError { return }
        errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }
}
