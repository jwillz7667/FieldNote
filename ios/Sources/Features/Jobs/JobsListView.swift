import SwiftData
import SwiftUI

/// The home dashboard: an at-a-glance overview of the user's reports (totals,
/// active processing, ready, and priority findings) above the report list, with a
/// floating glass "+" to start a new one, pull-to-refresh sync, and navigation
/// into each report.
struct JobsListView: View {
    @Environment(SessionStore.self) private var session
    @Environment(JobSyncService.self) private var sync
    @Query(sort: \Job.createdAt, order: .reverse) private var jobs: [Job]

    @State private var isRecording = false
    @State private var didInitialLoad = false

    var body: some View {
        NavigationStack {
            ZStack {
                AppTheme.background.ignoresSafeArea()

                if jobs.isEmpty {
                    EmptyReportsView()
                } else {
                    dashboard
                }

                NewReportButton { isRecording = true }
            }
            .navigationTitle("Dashboard")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Sign Out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
                            Task { await session.signOut() }
                        }
                    } label: {
                        Image(systemName: "person.crop.circle")
                            .accessibilityLabel("Account")
                    }
                }
            }
            .navigationDestination(for: Job.self) { job in
                ReportReviewView(job: job)
            }
            .refreshable { await sync.refresh() }
            .task {
                guard !didInitialLoad else { return }
                didInitialLoad = true
                await sync.refresh()
            }
            .fullScreenCover(isPresented: $isRecording) {
                RecordingView()
            }
            .alert(
                "Something went wrong",
                isPresented: Binding(
                    get: { sync.errorMessage != nil },
                    set: { if !$0 { sync.errorMessage = nil } }
                ),
                actions: { Button("OK", role: .cancel) {} },
                message: { Text(sync.errorMessage ?? "") }
            )
        }
    }

    private var dashboard: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: AppTheme.Spacing.lg) {
                DashboardOverview(jobs: jobs)

                VStack(alignment: .leading, spacing: AppTheme.Spacing.md) {
                    sectionHeader
                    reportList
                }
            }
            .padding(AppTheme.Spacing.md)
            .padding(.bottom, 96) // clear the floating button
        }
    }

    private var sectionHeader: some View {
        HStack(alignment: .firstTextBaseline) {
            Text("Reports")
                .font(.title3.bold())
            Spacer()
            Text("\(jobs.count)")
                .font(.subheadline.weight(.medium))
                .monospacedDigit()
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Reports, ^[\(jobs.count) total](inflect: true)")
    }

    private var reportList: some View {
        LazyVStack(spacing: AppTheme.Spacing.md) {
            ForEach(jobs) { job in
                NavigationLink(value: job) {
                    JobRowView(job: job)
                }
                .buttonStyle(.plain)
                .contextMenu {
                    Button("Delete", systemImage: "trash", role: .destructive) {
                        Task { await sync.delete(jobId: job.id) }
                    }
                }
            }
        }
    }
}

/// At-a-glance metric grid. Content-layer cards (solid surfaces, never glass), all
/// derived from the locally-cached jobs — no extra network or server surface.
private struct DashboardOverview: View {
    let jobs: [Job]

    @Environment(\.dynamicTypeSize) private var typeSize

    private var columns: [GridItem] {
        // Collapse to a single column at accessibility sizes so wrapped labels and
        // large digits stay legible (handoff §4.3 — full Dynamic Type).
        let count = typeSize >= .accessibility1 ? 1 : 2
        return Array(repeating: GridItem(.flexible(), spacing: AppTheme.Spacing.md), count: count)
    }

    private var processingCount: Int {
        jobs.filter { $0.status.isProcessing }.count
    }

    private var readyCount: Int {
        jobs.filter { $0.status == .ready }.count
    }

    /// Safety + repair findings across every ready report — the inspector's
    /// actionable signal, not just a job count.
    private var priorityCount: Int {
        jobs.reduce(0) { total, job in
            total + job.sections.reduce(0) { sectionTotal, section in
                sectionTotal + section.findings.reduce(0) { findingTotal, finding in
                    let isPriority = finding.severity == .safety || finding.severity == .repair
                    return findingTotal + (isPriority ? 1 : 0)
                }
            }
        }
    }

    private var metrics: [StatMetric] {
        [
            StatMetric(
                title: "Reports",
                value: jobs.count,
                systemImage: "tray.full.fill",
                tint: .primary
            ),
            StatMetric(
                title: "Processing",
                value: processingCount,
                systemImage: "arrow.triangle.2.circlepath",
                tint: AppTheme.accent
            ),
            StatMetric(
                title: "Ready",
                value: readyCount,
                systemImage: "checkmark.seal.fill",
                tint: JobStatus.ready.tint
            ),
            StatMetric(
                title: "Priority items",
                value: priorityCount,
                systemImage: "exclamationmark.triangle.fill",
                tint: Severity.safety.color
            ),
        ]
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: AppTheme.Spacing.md) {
            ForEach(metrics) { metric in
                StatCard(metric: metric)
            }
        }
    }
}

/// One metric tile on the dashboard.
private struct StatMetric: Identifiable {
    let title: String
    let value: Int
    let systemImage: String
    let tint: Color

    var id: String { title }
}

private struct StatCard: View {
    let metric: StatMetric

    var body: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.sm) {
            Image(systemName: metric.systemImage)
                .font(.title3)
                .foregroundStyle(metric.tint)
                .accessibilityHidden(true)

            Text("\(metric.value)")
                .font(.largeTitle.weight(.bold))
                .monospacedDigit()
                .contentTransition(.numericText())
                .foregroundStyle(.primary)

            Text(metric.title)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(AppTheme.Spacing.md)
        .background(AppTheme.card, in: RoundedRectangle(cornerRadius: AppTheme.Radius.card))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(metric.title), ^[\(metric.value) item](inflect: true)")
    }
}

/// Friendly empty state shown before the first report exists.
private struct EmptyReportsView: View {
    var body: some View {
        VStack(spacing: AppTheme.Spacing.md) {
            Image(systemName: "mic.badge.plus")
                .font(.system(size: 56, weight: .light))
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            Text("No reports yet")
                .font(.title3.bold())
            Text("Tap the button below, say the address, and walk the property while you talk.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, AppTheme.Spacing.xl)
        }
    }
}

/// Floating glass action button — part of the functional layer (glass allowed).
private struct NewReportButton: View {
    let action: () -> Void

    var body: some View {
        VStack {
            Spacer()
            HStack {
                Spacer()
                Button(action: action) {
                    Image(systemName: "plus")
                        .font(.title2.weight(.semibold))
                        .frame(width: 64, height: 64)
                }
                .buttonStyle(.glassProminent)
                .clipShape(Circle())
                .tint(AppTheme.accent)
                .accessibilityLabel("New report")
                .padding(AppTheme.Spacing.lg)
            }
        }
    }
}
