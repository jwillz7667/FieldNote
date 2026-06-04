import Foundation

/// The credentials the app persists between launches. Never logged, never sent
/// anywhere except the `Authorization` header / refresh endpoint.
struct TokenPair: Codable, Sendable, Equatable {
    var accessToken: String
    var refreshToken: String
    var userId: String
}

/// Abstraction over persistent token storage so the client can be tested with an
/// in-memory double. Implementations must be safe to call from any thread.
protocol TokenStorage: Sendable {
    func load() -> TokenPair?
    func save(_ pair: TokenPair)
    func clear()
}
