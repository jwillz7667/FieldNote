import SwiftUI

/// Top-level auth gate. Shows a brief splash while restoring the session, the
/// sign-in screen when signed out, and the jobs list when authenticated.
struct RootView: View {
    @Environment(SessionStore.self) private var session

    var body: some View {
        Group {
            switch session.phase {
            case .loading:
                SplashView()
            case .signedOut:
                SignInView()
            case .signedIn:
                JobsListView()
                    .transition(.opacity)
            }
        }
        .animation(.smooth, value: session.phase)
        .task {
            await session.bootstrap()
        }
    }
}

/// Minimal launch placeholder shown only for the brief keychain restore.
private struct SplashView: View {
    var body: some View {
        ZStack {
            AppTheme.background.ignoresSafeArea()
            Image(systemName: "waveform")
                .font(.system(size: 44, weight: .semibold))
                .foregroundStyle(AppTheme.accent)
                .accessibilityHidden(true)
        }
    }
}
