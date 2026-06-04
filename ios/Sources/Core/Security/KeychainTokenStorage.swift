import Foundation
import Security

/// Stores the `TokenPair` as a single JSON blob in the keychain under one generic
/// password item. The keychain API is thread-safe, so the synchronous protocol is
/// honoured directly; the class is `@unchecked Sendable` for that reason.
final class KeychainTokenStorage: TokenStorage, @unchecked Sendable {
    private let service: String
    private let account: String

    init(service: String = "com.viralventures.fieldnote.tokens", account: String = "session") {
        self.service = service
        self.account = account
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    func load() -> TokenPair? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else { return nil }
        return try? JSONDecoder().decode(TokenPair.self, from: data)
    }

    func save(_ pair: TokenPair) {
        guard let data = try? JSONEncoder().encode(pair) else { return }

        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]

        let updateStatus = SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecItemNotFound {
            var insert = baseQuery
            insert.merge(attributes) { _, new in new }
            SecItemAdd(insert as CFDictionary, nil)
        }
    }

    func clear() {
        SecItemDelete(baseQuery as CFDictionary)
    }
}

/// In-memory storage for previews and unit tests. Guarded by a lock so it satisfies
/// the `Sendable` contract without an actor hop.
final class InMemoryTokenStorage: TokenStorage, @unchecked Sendable {
    private let lock = NSLock()
    private var pair: TokenPair?

    init(_ initial: TokenPair? = nil) {
        self.pair = initial
    }

    func load() -> TokenPair? {
        lock.lock(); defer { lock.unlock() }
        return pair
    }

    func save(_ pair: TokenPair) {
        lock.lock(); defer { lock.unlock() }
        self.pair = pair
    }

    func clear() {
        lock.lock(); defer { lock.unlock() }
        pair = nil
    }
}
