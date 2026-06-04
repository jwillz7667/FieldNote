import AuthenticationServices
import SwiftUI

/// Sign-in gate. The only authentication path is Sign in with Apple → app JWT.
struct SignInView: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        ZStack {
            AppTheme.background.ignoresSafeArea()

            VStack(spacing: AppTheme.Spacing.xl) {
                Spacer()

                VStack(spacing: AppTheme.Spacing.md) {
                    Image(systemName: "waveform.circle.fill")
                        .font(.system(size: 72, weight: .semibold))
                        .foregroundStyle(AppTheme.accent)
                        .accessibilityHidden(true)

                    Text("FieldNote")
                        .font(.largeTitle.bold())

                    Text("Speak your walkthrough. Get a branded inspection report.")
                        .font(.headline)
                        .fontWeight(.regular)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, AppTheme.Spacing.lg)
                }

                Spacer()

                VStack(spacing: AppTheme.Spacing.md) {
                    SignInWithAppleButton(.signIn) { request in
                        session.prepareRequest(request)
                    } onCompletion: { result in
                        Task { await session.completeSignIn(with: result) }
                    }
                    .signInWithAppleButtonStyle(colorScheme == .dark ? .white : .black)
                    .frame(height: 52)
                    .clipShape(RoundedRectangle(cornerRadius: AppTheme.Radius.control))
                    .accessibilityLabel("Sign in with Apple")

                    if session.isAuthenticating {
                        ProgressView()
                    }

                    if let message = session.errorMessage {
                        Text(message)
                            .font(.footnote)
                            .foregroundStyle(.red)
                            .multilineTextAlignment(.center)
                    }
                }
                .padding(.horizontal, AppTheme.Spacing.lg)
                .padding(.bottom, AppTheme.Spacing.xl)
            }
        }
    }
}
