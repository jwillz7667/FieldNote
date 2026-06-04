import Foundation

/// Actor-isolated HTTP client for the FieldNote backend.
///
/// Responsibilities:
/// - Attaches the `Authorization: Bearer` header from keychain-backed tokens.
/// - On `401`, performs a single-flight token refresh and retries once; if refresh
///   itself fails the session is cleared and `onAuthExpired` fires (sign-out).
/// - Retries transient failures (5xx / transport) with exponential backoff + jitter.
/// - Maps non-2xx bodies (RFC 7807 problem JSON) into typed `APIError`s.
///
/// All mutable token state lives on this actor, so concurrent callers never race
/// on the refresh path.
actor APIClient {
    private let config: APIConfig
    private let session: URLSession
    private let storage: TokenStorage
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    private var tokens: TokenPair?
    private var refreshTask: Task<TokenPair, Error>?
    private var authExpiredHandler: (@Sendable () -> Void)?

    private let maxAttempts = 4

    init(
        config: APIConfig = .fromBundle(),
        storage: TokenStorage = KeychainTokenStorage(),
        session: URLSession = APIClient.makeSession()
    ) {
        self.config = config
        self.storage = storage
        self.session = session
        self.decoder = JSONDecoder()
        self.encoder = JSONEncoder()
        self.tokens = storage.load()
    }

    private static func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 120
        configuration.waitsForConnectivity = true
        return URLSession(configuration: configuration)
    }

    // MARK: - Session lifecycle

    /// Whether a persisted session exists (used by the app's auth gate at launch).
    var hasSession: Bool { tokens != nil }

    /// The signed-in user's id, if any.
    var currentUserId: String? { tokens?.userId }

    /// Registers a handler invoked when the session can no longer be refreshed.
    func setAuthExpiredHandler(_ handler: @escaping @Sendable () -> Void) {
        authExpiredHandler = handler
    }

    private func applyTokens(_ pair: TokenPair) {
        tokens = pair
        storage.save(pair)
    }

    private func clearTokens() {
        tokens = nil
        storage.clear()
    }

    private func notifyAuthExpired() {
        authExpiredHandler?()
    }

    // MARK: - Public auth API

    @discardableResult
    func signInWithApple(identityToken: String, nonce: String?, email: String?) async throws -> TokenPair {
        let body = try encoder.encode(
            AppleSignInRequest(identityToken: identityToken, nonce: nonce, email: email)
        )
        let request = Request(method: "POST", path: "/auth/apple", body: body, authorized: false)
        let token: TokenResponse = try await perform(request)
        let pair = TokenPair(
            accessToken: token.accessToken,
            refreshToken: token.refreshToken,
            userId: token.userId
        )
        applyTokens(pair)
        return pair
    }

    /// Clears the local session. The server's refresh tokens expire on their own TTL.
    func signOut() {
        refreshTask?.cancel()
        refreshTask = nil
        clearTokens()
    }

    // MARK: - Public jobs API

    func listJobs(cursor: String?, limit: Int = 20) async throws -> JobsPage {
        var query = [URLQueryItem(name: "limit", value: String(limit))]
        if let cursor, !cursor.isEmpty {
            query.append(URLQueryItem(name: "cursor", value: cursor))
        }
        let request = Request(method: "GET", path: "/jobs", query: query)
        return try await perform(request)
    }

    func createJob(label: String, idempotencyKey: String) async throws -> CreateJobResponse {
        let body = try encoder.encode(CreateJobRequest(label: label))
        let request = Request(
            method: "POST",
            path: "/jobs",
            body: body,
            idempotencyKey: idempotencyKey
        )
        return try await perform(request)
    }

    func getJob(id: String) async throws -> JobDTO {
        try await perform(Request(method: "GET", path: "/jobs/\(id)"))
    }

    func updateJob(id: String, body: UpdateJobRequest) async throws -> JobDTO {
        let data = try encoder.encode(body)
        return try await perform(Request(method: "PATCH", path: "/jobs/\(id)", body: data))
    }

    func processJob(id: String) async throws -> JobDTO {
        try await perform(Request(method: "POST", path: "/jobs/\(id)/process"))
    }

    func getPdfUrl(id: String) async throws -> PdfUrlDTO {
        try await perform(Request(method: "GET", path: "/jobs/\(id)/pdf"))
    }

    func deleteJob(id: String) async throws {
        _ = try await performData(Request(method: "DELETE", path: "/jobs/\(id)"))
    }

    // MARK: - Request modelling

    private struct Request {
        let method: String
        let path: String
        var query: [URLQueryItem] = []
        var body: Data?
        var authorized: Bool = true
        var idempotencyKey: String?
    }

    private func buildURLRequest(_ request: Request) throws -> URLRequest {
        guard var components = URLComponents(
            url: config.baseURL.appendingPathComponent(request.path),
            resolvingAgainstBaseURL: false
        ) else {
            throw APIError.invalidURL
        }
        if !request.query.isEmpty {
            components.queryItems = request.query
        }
        guard let url = components.url else { throw APIError.invalidURL }

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = request.method
        urlRequest.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body = request.body {
            urlRequest.httpBody = body
            urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let key = request.idempotencyKey {
            urlRequest.setValue(key, forHTTPHeaderField: "Idempotency-Key")
        }
        return urlRequest
    }

    // MARK: - Core transport

    private func perform<Response: Decodable>(_ request: Request) async throws -> Response {
        let (data, _) = try await performData(request)
        do {
            return try decoder.decode(Response.self, from: data)
        } catch {
            throw APIError.decoding(String(describing: error))
        }
    }

    private func performData(_ request: Request) async throws -> (Data, HTTPURLResponse) {
        var attempt = 0
        var didRefresh = false

        while true {
            attempt += 1
            var urlRequest = try buildURLRequest(request)
            if request.authorized {
                urlRequest.setValue("Bearer \(try currentAccessToken())", forHTTPHeaderField: "Authorization")
            }

            do {
                let (data, response) = try await session.data(for: urlRequest)
                guard let http = response as? HTTPURLResponse else {
                    throw APIError.transport("Non-HTTP response")
                }

                if http.statusCode == 401, request.authorized, !didRefresh {
                    didRefresh = true
                    try await refreshTokens()
                    continue
                }

                if (200..<300).contains(http.statusCode) {
                    return (data, http)
                }

                let apiError = APIError.server(status: http.statusCode, detail: problemDetail(from: data))
                if apiError.isRetryable, attempt < maxAttempts {
                    try await backoff(attempt)
                    continue
                }
                throw apiError
            } catch let error as APIError {
                throw error
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                if attempt < maxAttempts {
                    try await backoff(attempt)
                    continue
                }
                throw APIError.transport(error.localizedDescription)
            }
        }
    }

    private func currentAccessToken() throws -> String {
        if let tokens { return tokens.accessToken }
        if let loaded = storage.load() {
            tokens = loaded
            return loaded.accessToken
        }
        throw APIError.unauthorized
    }

    // MARK: - Refresh (single-flight)

    private func refreshTokens() async throws {
        if let task = refreshTask {
            _ = try await task.value
            return
        }

        guard let current = tokens ?? storage.load() else {
            throw APIError.unauthorized
        }

        let task = Task<TokenPair, Error> { [refreshToken = current.refreshToken] in
            try await self.requestRefresh(refreshToken: refreshToken)
        }
        refreshTask = task
        defer { refreshTask = nil }

        do {
            let newPair = try await task.value
            applyTokens(newPair)
        } catch {
            clearTokens()
            notifyAuthExpired()
            throw APIError.unauthorized
        }
    }

    private func requestRefresh(refreshToken: String) async throws -> TokenPair {
        let body = try encoder.encode(RefreshRequest(refreshToken: refreshToken))
        let request = Request(method: "POST", path: "/auth/refresh", body: body, authorized: false)
        let token: TokenResponse = try await perform(request)
        return TokenPair(
            accessToken: token.accessToken,
            refreshToken: token.refreshToken,
            userId: token.userId
        )
    }

    // MARK: - Backoff

    private func backoff(_ attempt: Int) async throws {
        // Exponential (250ms, 500ms, 1s …) with up to ±30% jitter from the attempt index.
        let base = 0.25 * pow(2.0, Double(attempt - 1))
        let jitterFraction = Double((attempt &* 2_654_435_761) % 1_000) / 1_000.0
        let delay = base * (0.85 + 0.3 * jitterFraction)
        try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
    }

    private func problemDetail(from data: Data) -> String? {
        guard let problem = try? decoder.decode(ProblemResponse.self, from: data) else { return nil }
        return problem.message?.text ?? problem.error
    }
}
