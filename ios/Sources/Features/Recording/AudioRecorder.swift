import AVFoundation
import Foundation

/// Outcome of a finished recording. Value type so it can cross actor boundaries.
struct RecordingResult: Sendable {
    let fileURL: URL
    let duration: TimeInterval
}

/// Actor-isolated microphone capture. Writes mono AAC into an `.m4a` container that
/// matches the server's expected `audio/m4a` upload content type. Files live under
/// Documents/recordings so they survive app relaunch for background upload.
actor AudioRecorder {
    enum RecorderError: LocalizedError {
        case permissionDenied
        case sessionFailed(String)
        case notRecording

        var errorDescription: String? {
            switch self {
            case .permissionDenied:
                return "Microphone access is needed to record a walkthrough. Enable it in Settings."
            case let .sessionFailed(reason):
                return "Couldn't start recording. \(reason)"
            case .notRecording:
                return "No recording is in progress."
            }
        }
    }

    private var recorder: AVAudioRecorder?
    private var currentURL: URL?
    private var startedAt: Date?

    var isRecording: Bool { recorder?.isRecording ?? false }

    func requestPermission() async -> Bool {
        switch AVAudioApplication.shared.recordPermission {
        case .granted:
            return true
        case .denied:
            return false
        case .undetermined:
            return await withCheckedContinuation { continuation in
                AVAudioApplication.requestRecordPermission { granted in
                    continuation.resume(returning: granted)
                }
            }
        @unknown default:
            return false
        }
    }

    /// Begins recording; returns the destination file URL. Throws if permission is
    /// denied or the audio session/encoder cannot be configured.
    func start(now: Date) async throws -> URL {
        guard await requestPermission() else { throw RecorderError.permissionDenied }
        try configureSession()

        let url = try makeFileURL()
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 44_100.0,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
            AVEncoderBitRateKey: 64_000,
        ]

        do {
            let recorder = try AVAudioRecorder(url: url, settings: settings)
            recorder.isMeteringEnabled = true
            guard recorder.record() else {
                throw RecorderError.sessionFailed("Recorder failed to start.")
            }
            self.recorder = recorder
            self.currentURL = url
            self.startedAt = now
            return url
        } catch let error as RecorderError {
            throw error
        } catch {
            throw RecorderError.sessionFailed(error.localizedDescription)
        }
    }

    /// Stops recording and returns the file + measured duration.
    func stop(now: Date) throws -> RecordingResult {
        guard let recorder, let url = currentURL, let startedAt else {
            throw RecorderError.notRecording
        }
        recorder.stop()
        let duration = max(0, now.timeIntervalSince(startedAt))
        reset()
        deactivateSession()
        return RecordingResult(fileURL: url, duration: duration)
    }

    /// Aborts the current recording and deletes the partial file.
    func cancel() {
        recorder?.stop()
        if let url = currentURL {
            try? FileManager.default.removeItem(at: url)
        }
        reset()
        deactivateSession()
    }

    /// Normalised input level in 0…1 for the waveform/level UI.
    func currentLevel() -> Float {
        guard let recorder, recorder.isRecording else { return 0 }
        recorder.updateMeters()
        let power = recorder.averagePower(forChannel: 0) // dBFS, roughly -160…0
        let clamped = max(-60, power)
        return (clamped + 60) / 60
    }

    private func reset() {
        recorder = nil
        currentURL = nil
        startedAt = nil
    }

    private func configureSession() throws {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .default, options: [.allowBluetooth, .defaultToSpeaker])
            try session.setActive(true)
        } catch {
            throw RecorderError.sessionFailed(error.localizedDescription)
        }
    }

    private func deactivateSession() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func makeFileURL() throws -> URL {
        let fileManager = FileManager.default
        let documents = try fileManager.url(
            for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true
        )
        let directory = documents.appendingPathComponent("recordings", isDirectory: true)
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent("\(UUID().uuidString).m4a")
    }
}
