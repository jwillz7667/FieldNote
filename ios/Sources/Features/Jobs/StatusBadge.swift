import SwiftUI

/// Compact status pill for a job. Content-layer — solid tint, never glass.
struct StatusBadge: View {
    let status: JobStatus

    var body: some View {
        HStack(spacing: AppTheme.Spacing.xs) {
            if status.isProcessing {
                ProgressView()
                    .controlSize(.mini)
                    .tint(status.tint)
            }
            Text(status.displayName)
                .font(.caption.weight(.semibold))
        }
        .foregroundStyle(status.tint)
        .padding(.horizontal, AppTheme.Spacing.sm)
        .padding(.vertical, AppTheme.Spacing.xs)
        .background(status.tint.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Status: \(status.displayName)")
    }
}
