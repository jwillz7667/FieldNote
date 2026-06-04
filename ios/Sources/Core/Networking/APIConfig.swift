import Foundation

/// Resolves the backend base URL from the bundle's `FNAPIBaseURL` Info.plist key,
/// which is populated per-configuration from the `FN_API_BASE_URL` build setting
/// (Debug → localhost, Release → production). No secrets live here — only a URL.
struct APIConfig: Sendable {
    let baseURL: URL

    init(baseURL: URL) {
        self.baseURL = baseURL
    }

    /// Reads the configured base URL from the main bundle, failing fast in debug
    /// if it is missing or malformed so the misconfiguration is caught immediately.
    static func fromBundle(_ bundle: Bundle = .main) -> APIConfig {
        guard let raw = bundle.object(forInfoDictionaryKey: "FNAPIBaseURL") as? String,
              !raw.trimmingCharacters(in: .whitespaces).isEmpty,
              let url = URL(string: raw.trimmingCharacters(in: .whitespaces))
        else {
            assertionFailure("FNAPIBaseURL missing or malformed in Info.plist")
            return APIConfig(baseURL: URL(string: "http://localhost:8080")!)
        }
        return APIConfig(baseURL: url)
    }
}
