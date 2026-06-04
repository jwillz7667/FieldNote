import XCTest
@testable import FieldNote

/// Verifies the hand-written wire DTOs decode the server contract exactly, including
/// the enum raw-value mappings (lowercase severity, uppercase status).
final class DTODecodingTests: XCTestCase {
    private let decoder = JSONDecoder()

    func testDecodesReadyJobWithSections() throws {
        let json = """
        {
          "id": "11111111-1111-1111-1111-111111111111",
          "label": "123 Main St",
          "status": "READY",
          "transcript": "The roof has missing shingles.",
          "errorMessage": null,
          "sections": [
            {
              "id": "22222222-2222-2222-2222-222222222222",
              "title": "Roof",
              "sortOrder": 0,
              "findings": [
                { "id": "33333333-3333-3333-3333-333333333333", "text": "Missing shingles", "severity": "repair", "sortOrder": 0 }
              ]
            }
          ],
          "pdfUrl": "https://r2.example/report.pdf",
          "createdAt": "2026-06-04T12:00:00.000Z",
          "updatedAt": "2026-06-04T12:05:00.000Z"
        }
        """

        let job = try decoder.decode(JobDTO.self, from: Data(json.utf8))

        XCTAssertEqual(job.label, "123 Main St")
        XCTAssertEqual(job.status, .ready)
        XCTAssertEqual(job.sections.count, 1)
        XCTAssertEqual(job.sections[0].findings.first?.severity, .repair)
        XCTAssertNil(job.errorMessage)
    }

    func testDecodesCreateJobResponse() throws {
        let json = """
        {
          "job": {
            "id": "11111111-1111-1111-1111-111111111111",
            "label": "Draft",
            "status": "CREATED",
            "transcript": null,
            "errorMessage": null,
            "sections": [],
            "pdfUrl": null,
            "createdAt": "2026-06-04T12:00:00.000Z",
            "updatedAt": "2026-06-04T12:00:00.000Z"
          },
          "audioUploadUrl": {
            "url": "https://r2.example/upload",
            "key": "audio/u/j.m4a",
            "contentType": "audio/m4a",
            "expiresInSeconds": 900
          }
        }
        """

        let response = try decoder.decode(CreateJobResponse.self, from: Data(json.utf8))

        XCTAssertEqual(response.job.status, .created)
        XCTAssertEqual(response.audioUploadUrl.contentType, "audio/m4a")
        XCTAssertEqual(response.audioUploadUrl.expiresInSeconds, 900)
    }

    func testSeverityRawValuesMatchWireContract() {
        XCTAssertEqual(Severity.safety.rawValue, "safety")
        XCTAssertEqual(Severity.repair.rawValue, "repair")
        XCTAssertEqual(Severity.maintenance.rawValue, "maintenance")
        XCTAssertEqual(Severity.info.rawValue, "info")
    }
}
