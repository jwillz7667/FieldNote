import SwiftData
import SwiftUI

/// Review screen for a single report. Adapts to the job's lifecycle: a calm
/// progress state while the server pipeline runs, a failure state with retry, and
/// the full editable report with a glass Share control when READY.
struct ReportReviewView: View {
    @Environment(JobSyncService.self) private var sync
    @Bindable var job: Job

    @State private var isEditing = false
    @State private var isPreparingPDF = false
    @State private var previewURL: URL?
    @State private var showTranscript = false

    var body: some View {
        ZStack {
            AppTheme.background.ignoresSafeArea()

            switch job.status {
            case .ready:
                readyReport
            case .failed:
                FailureView(job: job) { Task { await sync.retry(jobId: job.id) } }
            default:
                ProcessingView(status: job.status)
            }
        }
        .navigationTitle(job.label)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if job.isReady {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Edit", systemImage: "pencil") { isEditing = true }
                }
            }
        }
        .task {
            if job.status.isProcessing { await sync.poll(jobId: job.id) }
        }
        .sheet(isPresented: $isEditing) {
            ReportEditView(job: job)
        }
        .sheet(item: $previewURL) { url in
            NavigationStack {
                PDFPreviewView(fileURL: url)
                    .ignoresSafeArea()
                    .toolbar {
                        ToolbarItem(placement: .topBarLeading) {
                            Button("Done") { previewURL = nil }
                        }
                        ToolbarItem(placement: .topBarTrailing) {
                            ShareLink(item: url) { Image(systemName: "square.and.arrow.up") }
                                .accessibilityLabel("Share PDF")
                        }
                    }
            }
        }
    }

    // MARK: - Ready report

    private var readyReport: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: AppTheme.Spacing.lg) {
                ReportSummaryHeader(job: job)

                ForEach(job.orderedSections) { section in
                    SectionCard(section: section)
                }

                if let transcript = job.transcript, !transcript.isEmpty {
                    TranscriptCard(transcript: transcript, isExpanded: $showTranscript)
                }
            }
            .padding(AppTheme.Spacing.md)
            .padding(.bottom, 96) // clear the floating Share control
        }
        .overlay(alignment: .bottom) {
            shareButton
        }
    }

    private var shareButton: some View {
        Button {
            Task { await prepareAndPreviewPDF() }
        } label: {
            HStack(spacing: AppTheme.Spacing.sm) {
                if isPreparingPDF {
                    ProgressView().tint(.white)
                } else {
                    Image(systemName: "square.and.arrow.up")
                }
                Text(isPreparingPDF ? "Preparing…" : "Share PDF")
                    .fontWeight(.semibold)
            }
            .frame(maxWidth: .infinity)
            .frame(minHeight: 28)
            .padding(.vertical, AppTheme.Spacing.sm)
            .padding(.horizontal, AppTheme.Spacing.lg)
        }
        .buttonStyle(.glassProminent)
        .tint(AppTheme.accent)
        .disabled(isPreparingPDF)
        .padding(.horizontal, AppTheme.Spacing.xl)
        .padding(.bottom, AppTheme.Spacing.md)
        .accessibilityLabel("Share report as PDF")
    }

    private func prepareAndPreviewPDF() async {
        isPreparingPDF = true
        defer { isPreparingPDF = false }
        guard let remote = await sync.pdfURL(jobId: job.id) else { return }
        do {
            let local = try await PDFExporter.download(from: remote, label: job.label)
            previewURL = local
        } catch {
            sync.errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }
}

// MARK: - Subviews

/// Summary chips: total findings + a count per severity (most severe first).
private struct ReportSummaryHeader: View {
    let job: Job

    private var allFindings: [Finding] {
        job.sections.flatMap(\.findings)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.sm) {
            Text("^[\(allFindings.count) finding](inflect: true) across ^[\(job.sections.count) section](inflect: true)")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            let counts = severityCounts
            if !counts.isEmpty {
                HStack(spacing: AppTheme.Spacing.sm) {
                    ForEach(counts, id: \.0) { severity, count in
                        HStack(spacing: AppTheme.Spacing.xs) {
                            Circle().fill(severity.color).frame(width: 8, height: 8)
                            Text("\(count) \(severity.label)")
                                .font(.caption.weight(.medium))
                        }
                        .padding(.horizontal, AppTheme.Spacing.sm)
                        .padding(.vertical, AppTheme.Spacing.xs)
                        .background(AppTheme.card, in: Capsule())
                    }
                }
            }
        }
    }

    private var severityCounts: [(Severity, Int)] {
        Severity.allCases
            .map { severity in (severity, allFindings.filter { $0.severity == severity }.count) }
            .filter { $0.1 > 0 }
    }
}

/// A report section and its findings (content layer — solid card, never glass).
private struct SectionCard: View {
    let section: ReportSection

    var body: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.sm) {
            Text(section.title)
                .font(.title3.bold())

            VStack(spacing: AppTheme.Spacing.sm) {
                ForEach(section.orderedFindings) { finding in
                    FindingRow(finding: finding)
                }
            }
        }
    }
}

private struct FindingRow: View {
    let finding: Finding

    var body: some View {
        HStack(alignment: .top, spacing: AppTheme.Spacing.md) {
            SeverityBadge(severity: finding.severity)
                .frame(width: 96, alignment: .leading)
            Text(finding.text)
                .font(.body)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(AppTheme.Spacing.md)
        .background(AppTheme.card, in: RoundedRectangle(cornerRadius: AppTheme.Radius.card))
        .accessibilityElement(children: .combine)
    }
}

private struct TranscriptCard: View {
    let transcript: String
    @Binding var isExpanded: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.sm) {
            Button {
                withAnimation(.smooth) { isExpanded.toggle() }
            } label: {
                HStack {
                    Text("Transcript")
                        .font(.headline)
                    Spacer()
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Transcript")
            .accessibilityValue(isExpanded ? "Expanded" : "Collapsed")
            .accessibilityHint(isExpanded ? "Double tap to hide the transcript" : "Double tap to show the transcript")

            if isExpanded {
                Text(transcript)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
        }
        .padding(AppTheme.Spacing.md)
        .background(AppTheme.card, in: RoundedRectangle(cornerRadius: AppTheme.Radius.card))
    }
}

/// Calm progress state shown while the server pipeline runs.
private struct ProcessingView: View {
    let status: JobStatus

    var body: some View {
        VStack(spacing: AppTheme.Spacing.lg) {
            ProgressView()
                .controlSize(.large)
            Text(status.calmDescription)
                .font(.headline)
            Text("You can leave this screen — we'll keep working and it'll be ready when you come back.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, AppTheme.Spacing.xl)
        }
        .padding(AppTheme.Spacing.xl)
    }
}

/// Failure state with a retry affordance.
private struct FailureView: View {
    let job: Job
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: AppTheme.Spacing.lg) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 44))
                .foregroundStyle(.orange)
                .accessibilityHidden(true)
            Text("Processing failed")
                .font(.title3.bold())
            Text(job.errorMessage ?? "Something went wrong while building this report.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, AppTheme.Spacing.xl)

            Button("Try Again", systemImage: "arrow.clockwise", action: onRetry)
                .buttonStyle(.glassProminent)
                .tint(AppTheme.accent)
        }
        .padding(AppTheme.Spacing.xl)
    }
}

extension URL: @retroactive Identifiable {
    public var id: String { absoluteString }
}
