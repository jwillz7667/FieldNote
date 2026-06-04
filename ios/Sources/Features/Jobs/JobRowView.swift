import SwiftUI

/// A single job in the list. Content-layer card: solid surface, never glass.
struct JobRowView: View {
    let job: Job

    private var findingCount: Int {
        job.sections.reduce(0) { $0 + $1.findings.count }
    }

    var body: some View {
        HStack(spacing: AppTheme.Spacing.md) {
            VStack(alignment: .leading, spacing: AppTheme.Spacing.xs) {
                Text(job.label)
                    .font(.headline)
                    .lineLimit(1)

                HStack(spacing: AppTheme.Spacing.sm) {
                    Text(job.createdAt, format: .dateTime.month().day().hour().minute())
                        .font(.subheadline)
                        .foregroundStyle(.secondary)

                    if job.isReady, findingCount > 0 {
                        Text("·")
                            .foregroundStyle(.secondary)
                        Text("^[\(findingCount) finding](inflect: true)")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Spacer()

            StatusBadge(status: job.status)
        }
        .padding(AppTheme.Spacing.md)
        .background(AppTheme.card, in: RoundedRectangle(cornerRadius: AppTheme.Radius.card))
        .accessibilityElement(children: .combine)
    }
}
