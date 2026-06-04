import SwiftData
import SwiftUI

/// The home screen: the user's reports, a floating glass "+" to start a new one,
/// pull-to-refresh sync, and navigation into each report.
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
                    reportList
                }

                NewReportButton { isRecording = true }
            }
            .navigationTitle("Reports")
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

    private var reportList: some View {
        ScrollView {
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
            .padding(AppTheme.Spacing.md)
            .padding(.bottom, 96) // clear the floating button
        }
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
