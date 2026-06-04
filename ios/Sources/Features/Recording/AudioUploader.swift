import Foundation

/// Uploads recorded audio to R2 via the server-issued presigned PUT URL using a
/// background `URLSession`, so an in-progress upload survives the app being
/// backgrounded. No credentials are involved — only the short-lived presigned URL.
///
/// The class is `@unchecked Sendable`: its mutable continuation registry is guarded
/// by a lock, and delegate callbacks arrive on a dedicated serial queue.
final class AudioUploader: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    /// Invoked when a background task completes (including after app relaunch),
    /// so the sync layer can mark the job uploaded and trigger processing. Set on
    /// the main actor at wiring time but read on the delegate queue, so access is
    /// lock-guarded to keep it data-race-free under strict concurrency.
    var onUploadFinished: (@Sendable (_ jobId: String, _ success: Bool) -> Void)? {
        get { lock.lock(); defer { lock.unlock() }; return _onUploadFinished }
        set { lock.lock(); defer { lock.unlock() }; _onUploadFinished = newValue }
    }
    private var _onUploadFinished: (@Sendable (_ jobId: String, _ success: Bool) -> Void)?

    private let lock = NSLock()
    private var continuations: [Int: CheckedContinuation<Void, Error>] = [:]
    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.background(
            withIdentifier: "com.viralventures.fieldnote.upload"
        )
        configuration.isDiscretionary = false
        configuration.sessionSendsLaunchEvents = true
        configuration.waitsForConnectivity = true
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        return URLSession(configuration: configuration, delegate: self, delegateQueue: queue)
    }()

    /// PUTs the file at `fileURL` to the presigned URL, awaiting completion.
    func upload(jobId: String, fileURL: URL, presigned: PresignedUploadDTO) async throws {
        guard let url = URL(string: presigned.url) else { throw APIError.invalidURL }

        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue(presigned.contentType, forHTTPHeaderField: "Content-Type")

        let task = session.uploadTask(with: request, fromFile: fileURL)
        task.taskDescription = jobId

        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                lock.lock()
                continuations[task.taskIdentifier] = continuation
                lock.unlock()
                task.resume()
            }
        } onCancel: {
            task.cancel()
        }
    }

    // MARK: - URLSessionTaskDelegate

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let jobId = task.taskDescription ?? ""

        lock.lock()
        let continuation = continuations.removeValue(forKey: task.taskIdentifier)
        lock.unlock()

        let result: Result<Void, Error>
        if let error {
            result = .failure(APIError.transport(error.localizedDescription))
        } else if let http = task.response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            result = .failure(APIError.server(status: http.statusCode, detail: "Audio upload rejected."))
        } else {
            result = .success(())
        }

        if let continuation {
            // Foreground path: the awaiting caller drives mark-uploaded + process.
            switch result {
            case .success:
                continuation.resume()
            case let .failure(error):
                continuation.resume(throwing: error)
            }
        } else if !jobId.isEmpty {
            // Orphaned task (completed after the app was suspended/relaunched):
            // reconcile through the callback so processing still gets triggered.
            onUploadFinished?(jobId, (try? result.get()) != nil)
        }
    }
}
