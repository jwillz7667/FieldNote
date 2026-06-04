import XCTest
@testable import FieldNote

/// Exercises the `APIClient` transport contract against a `URLProtocol` stub:
/// single-flight 401 refresh-and-retry, session teardown when refresh fails,
/// transient-5xx retry, and surfacing the server's problem-JSON message.
final class APIClientTests: XCTestCase {
    override func setUp() {
        super.setUp()
        MockURLProtocol.reset()
    }

    override func tearDown() {
        MockURLProtocol.reset()
        super.tearDown()
    }

    // MARK: - Helpers

    private func makeClient(
        storage: TokenStorage,
        onAuthExpired: (@Sendable () -> Void)? = nil
    ) async -> APIClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let client = APIClient(
            config: APIConfig(baseURL: URL(string: "http://test.local")!),
            storage: storage,
            session: session
        )
        if let onAuthExpired {
            await client.setAuthExpiredHandler(onAuthExpired)
        }
        return client
    }

    private func tokenJSON(access: String, refresh: String, userId: String = "u1") -> Data {
        Data(#"{"accessToken":"\#(access)","refreshToken":"\#(refresh)","tokenType":"Bearer","expiresIn":900,"userId":"\#(userId)"}"#.utf8)
    }

    private let emptyPage = Data(#"{"items":[],"nextCursor":null}"#.utf8)

    // MARK: - Tests

    func testRefreshesOnceOn401ThenRetriesSuccessfully() async throws {
        let storage = FakeTokenStorage(
            TokenPair(accessToken: "old-access", refreshToken: "old-refresh", userId: "u1")
        )
        let refreshed = tokenJSON(access: "new-access", refresh: "new-refresh")
        MockURLProtocol.setResponder { [emptyPage, refreshed] path, occurrence in
            switch (path, occurrence) {
            case ("/jobs", 1): return (401, Data())
            case ("/auth/refresh", _): return (200, refreshed)
            case ("/jobs", 2): return (200, emptyPage)
            default: return (500, Data())
            }
        }
        let client = await makeClient(storage: storage)

        let page = try await client.listJobs(cursor: nil)

        XCTAssertEqual(page.items.count, 0)
        // The refresh result must have been persisted for subsequent requests.
        XCTAssertEqual(storage.load()?.accessToken, "new-access")
        XCTAssertEqual(storage.load()?.refreshToken, "new-refresh")
        // Exactly: GET(401) → refresh → GET(200).
        XCTAssertEqual(MockURLProtocol.count(for: "/jobs"), 2)
        XCTAssertEqual(MockURLProtocol.count(for: "/auth/refresh"), 1)
    }

    func testFailedRefreshClearsSessionAndSignalsExpiry() async throws {
        let storage = FakeTokenStorage(
            TokenPair(accessToken: "old-access", refreshToken: "old-refresh", userId: "u1")
        )
        let expired = AtomicFlag()
        MockURLProtocol.setResponder { path, _ in
            switch path {
            case "/jobs": return (401, Data())
            case "/auth/refresh": return (401, Data())
            default: return (500, Data())
            }
        }
        let client = await makeClient(storage: storage, onAuthExpired: { expired.set() })

        do {
            _ = try await client.listJobs(cursor: nil)
            XCTFail("Expected unauthorized error")
        } catch let error as APIError {
            guard case .unauthorized = error else {
                return XCTFail("Expected .unauthorized, got \(error)")
            }
        }

        XCTAssertNil(storage.load(), "Session must be cleared when refresh fails")
        XCTAssertTrue(expired.value, "Auth-expired handler must fire so the app signs out")
    }

    func testRetriesTransientServerErrorThenSucceeds() async throws {
        let storage = FakeTokenStorage(
            TokenPair(accessToken: "a", refreshToken: "r", userId: "u1")
        )
        MockURLProtocol.setResponder { [emptyPage] path, occurrence in
            switch (path, occurrence) {
            case ("/jobs", 1): return (503, Data())
            case ("/jobs", 2): return (200, emptyPage)
            default: return (500, Data())
            }
        }
        let client = await makeClient(storage: storage)

        let page = try await client.listJobs(cursor: nil)

        XCTAssertEqual(page.items.count, 0)
        XCTAssertEqual(MockURLProtocol.count(for: "/jobs"), 2)
    }

    func testSurfacesServerProblemMessageAsDetail() async throws {
        let storage = FakeTokenStorage(
            TokenPair(accessToken: "a", refreshToken: "r", userId: "u1")
        )
        let body = Data(#"{"statusCode":409,"error":"Conflict","message":"PDF is not ready for this job.","path":"/jobs/x/pdf"}"#.utf8)
        MockURLProtocol.setResponder { _, _ in (409, body) }
        let client = await makeClient(storage: storage)

        do {
            _ = try await client.getPdfUrl(id: "x")
            XCTFail("Expected server error")
        } catch let error as APIError {
            guard case let .server(status, detail) = error else {
                return XCTFail("Expected .server, got \(error)")
            }
            XCTAssertEqual(status, 409)
            XCTAssertEqual(detail, "PDF is not ready for this job.")
        }
    }

    func testFlattensValidationArrayMessage() async throws {
        let storage = FakeTokenStorage(
            TokenPair(accessToken: "a", refreshToken: "r", userId: "u1")
        )
        let body = Data(#"{"statusCode":400,"error":"Bad Request","message":["label should not be empty","label must be a string"]}"#.utf8)
        MockURLProtocol.setResponder { _, _ in (400, body) }
        let client = await makeClient(storage: storage)

        do {
            _ = try await client.getJob(id: "x")
            XCTFail("Expected server error")
        } catch let error as APIError {
            guard case let .server(status, detail) = error else {
                return XCTFail("Expected .server, got \(error)")
            }
            XCTAssertEqual(status, 400)
            XCTAssertEqual(detail, "label should not be empty label must be a string")
        }
    }
}

// MARK: - Test doubles

/// In-memory `TokenStorage`. `@unchecked Sendable` is justified: all access is
/// serialised behind the lock, matching the protocol's any-thread contract.
private final class FakeTokenStorage: TokenStorage, @unchecked Sendable {
    private let lock = NSLock()
    private var pair: TokenPair?

    init(_ initial: TokenPair?) { self.pair = initial }

    func load() -> TokenPair? {
        lock.lock(); defer { lock.unlock() }
        return pair
    }

    func save(_ pair: TokenPair) {
        lock.lock(); self.pair = pair; lock.unlock()
    }

    func clear() {
        lock.lock(); pair = nil; lock.unlock()
    }
}

/// Thread-safe boolean for asserting a `@Sendable` callback fired.
private final class AtomicFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var flag = false

    func set() { lock.lock(); flag = true; lock.unlock() }
    var value: Bool { lock.lock(); defer { lock.unlock() }; return flag }
}

/// `URLProtocol` stub that answers requests from a per-path responder. The
/// responder receives the request path and the 1-based occurrence count for that
/// path, so a test can return 401-then-200 for the same endpoint.
final class MockURLProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var responder: (@Sendable (String, Int) -> (Int, Data))?
    nonisolated(unsafe) private static var perPathCounts: [String: Int] = [:]

    static func setResponder(_ responder: @escaping @Sendable (String, Int) -> (Int, Data)) {
        lock.lock(); self.responder = responder; perPathCounts = [:]; lock.unlock()
    }

    static func reset() {
        lock.lock(); responder = nil; perPathCounts = [:]; lock.unlock()
    }

    static func count(for path: String) -> Int {
        lock.lock(); defer { lock.unlock() }
        return perPathCounts[path] ?? 0
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let path = request.url?.path ?? ""
        MockURLProtocol.lock.lock()
        MockURLProtocol.perPathCounts[path, default: 0] += 1
        let occurrence = MockURLProtocol.perPathCounts[path] ?? 1
        let responder = MockURLProtocol.responder
        MockURLProtocol.lock.unlock()

        let (status, body) = responder?(path, occurrence) ?? (500, Data())
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: status,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
