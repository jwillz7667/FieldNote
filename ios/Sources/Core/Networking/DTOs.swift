import Foundation

/// Wire DTOs mirroring the NestJS contract (openapi.json at the repo root is the
/// shared source of truth). Hand-written rather than generated to keep the Xcode
/// build free of a codegen step; they must stay in lockstep with the server DTOs.

struct TokenResponse: Codable, Sendable {
    let accessToken: String
    let refreshToken: String
    let tokenType: String
    let expiresIn: Int
    let userId: String
}

struct FindingDTO: Codable, Sendable {
    let id: String
    let text: String
    let severity: Severity
    let sortOrder: Int
}

struct SectionDTO: Codable, Sendable {
    let id: String
    let title: String
    let sortOrder: Int
    let findings: [FindingDTO]
}

struct JobDTO: Codable, Sendable {
    let id: String
    let label: String
    let status: JobStatus
    let transcript: String?
    let errorMessage: String?
    let sections: [SectionDTO]
    let pdfUrl: String?
    let createdAt: String
    let updatedAt: String
}

struct PresignedUploadDTO: Codable, Sendable {
    let url: String
    let key: String
    let contentType: String
    let expiresInSeconds: Int
}

struct CreateJobResponse: Codable, Sendable {
    let job: JobDTO
    let audioUploadUrl: PresignedUploadDTO
}

struct PdfUrlDTO: Codable, Sendable {
    let url: String
    let expiresInSeconds: Int
}

struct JobsPage: Codable, Sendable {
    let items: [JobDTO]
    let nextCursor: String?
}

// MARK: - Request bodies

struct AppleSignInRequest: Codable, Sendable {
    let identityToken: String
    let nonce: String?
    let email: String?
}

struct RefreshRequest: Codable, Sendable {
    let refreshToken: String
}

struct CreateJobRequest: Codable, Sendable {
    let label: String
}

struct UpdateFindingDTO: Codable, Sendable {
    let text: String
    let severity: Severity
    let sortOrder: Int
}

struct UpdateSectionDTO: Codable, Sendable {
    let title: String
    let sortOrder: Int
    let findings: [UpdateFindingDTO]
}

struct UpdateJobRequest: Codable, Sendable {
    let label: String?
    let sections: [UpdateSectionDTO]?
}

/// Problem JSON returned by the server's exception filter. The shape is
/// `{ statusCode, error, message, requestId?, timestamp, path }` — `message` is a
/// string for most errors but an array of strings for validation failures.
struct ProblemResponse: Codable, Sendable {
    let statusCode: Int?
    let error: String?
    let message: ProblemMessage?
    let path: String?
}

/// `message` may arrive as a single string or an array (class-validator emits the
/// latter). Decodes either and flattens to displayable text.
enum ProblemMessage: Codable, Sendable {
    case single(String)
    case many([String])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let value = try? container.decode(String.self) {
            self = .single(value)
        } else {
            self = .many(try container.decode([String].self))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case let .single(value): try container.encode(value)
        case let .many(values): try container.encode(values)
        }
    }

    var text: String {
        switch self {
        case let .single(value): return value
        case let .many(values): return values.joined(separator: " ")
        }
    }
}
