import AuthenticationServices
import Foundation
import Observation

/// Observable authentication state for the app's auth gate. Owns the `APIClient`
/// and the lifecycle of the signed-in session. All UI observes `phase`.
@MainActor
@Observable
final class SessionStore {
    enum Phase: Equatable {
        case loading
        case signedOut
        case signedIn(userId: String)
    }

    private(set) var phase: Phase = .loading
    var errorMessage: String?
    private(set) var isAuthenticating = false

    let api: APIClient
    private var currentNonce: String?

    init(api: APIClient) {
        self.api = api
    }

    /// Restores any persisted session and wires the auth-expiry handler.
    func bootstrap() async {
        await api.setAuthExpiredHandler { [weak self] in
            Task { @MainActor in self?.handleAuthExpired() }
        }
        if let userId = await api.currentUserId {
            phase = .signedIn(userId: userId)
        } else {
            phase = .signedOut
        }
    }

    /// Configures the Apple authorization request with a fresh hashed nonce.
    func prepareRequest(_ request: ASAuthorizationAppleIDRequest) {
        let nonce = Nonce.random()
        currentNonce = nonce
        request.requestedScopes = [.fullName, .email]
        request.nonce = Nonce.sha256(nonce)
    }

    /// Handles the result delivered by `SignInWithAppleButton`.
    func completeSignIn(with result: Result<ASAuthorization, Error>) async {
        switch result {
        case let .success(authorization):
            await exchange(authorization)
        case let .failure(error):
            if (error as? ASAuthorizationError)?.code == .canceled { return }
            errorMessage = error.localizedDescription
        }
    }

    func signOut() async {
        await api.signOut()
        phase = .signedOut
    }

    private func exchange(_ authorization: ASAuthorization) async {
        guard
            let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
            let tokenData = credential.identityToken,
            let identityToken = String(data: tokenData, encoding: .utf8)
        else {
            errorMessage = "Apple sign-in did not return a valid token."
            return
        }

        let email = credential.email
        let nonce = currentNonce
        isAuthenticating = true
        defer { isAuthenticating = false }

        do {
            let pair = try await api.signInWithApple(
                identityToken: identityToken,
                nonce: nonce,
                email: email
            )
            currentNonce = nil
            errorMessage = nil
            phase = .signedIn(userId: pair.userId)
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func handleAuthExpired() {
        phase = .signedOut
        errorMessage = "Your session expired. Please sign in again."
    }
}
