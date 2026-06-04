import SwiftUI

/// Severity indicator for a finding. Content layer — solid color, never glass.
struct SeverityBadge: View {
    let severity: Severity

    var body: some View {
        Text(severity.label)
            .font(.caption2.weight(.bold))
            .textCase(.uppercase)
            .foregroundStyle(.white)
            .padding(.horizontal, AppTheme.Spacing.sm)
            .padding(.vertical, 3)
            .background(severity.color, in: Capsule())
            .accessibilityLabel("Severity: \(severity.label)")
    }
}
