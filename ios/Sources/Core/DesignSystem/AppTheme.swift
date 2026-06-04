import SwiftUI

/// Content-layer design tokens. Per the Liquid Glass discipline, these back the
/// *content* surfaces (rows, cards, backgrounds) and never carry a glass effect —
/// glass is reserved for the floating functional controls in the views themselves.
enum AppTheme {
    /// App-wide grouped background.
    static let background = Color(.systemGroupedBackground)
    /// Elevated content surface (job rows, report/finding cards, transcript card).
    static let card = Color(.secondarySystemGroupedBackground)
    /// Hairline separators / strokes.
    static let separator = Color(.separator)

    /// Brand accent used for primary actions and active status.
    static let accent = Color(red: 0.15, green: 0.39, blue: 0.85)

    enum Spacing {
        static let xs: CGFloat = 4
        static let sm: CGFloat = 8
        static let md: CGFloat = 16
        static let lg: CGFloat = 24
        static let xl: CGFloat = 32
    }

    enum Radius {
        static let card: CGFloat = 16
        static let control: CGFloat = 12
    }
}
