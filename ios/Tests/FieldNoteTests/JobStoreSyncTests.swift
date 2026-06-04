import XCTest
import SwiftData
@testable import FieldNote

/// Covers the offline-first reconciliation in `JobStore`: DTO → SwiftData model
/// mapping, the last-write-wins conflict rule (server-owned fields always adopted,
/// local label/section edits preserved only when strictly newer + dirty), and
/// section/finding tree reconciliation (insert / update / prune).
@MainActor
final class JobStoreSyncTests: XCTestCase {
    // The container MUST be retained: `ModelContext` does not keep its
    // `ModelContainer` alive, so letting it go out of scope tears down the store
    // mid-test and traps the next fetch. (In the app the container lives for the
    // process via SwiftUI's `.modelContainer`.) A unique on-disk store per test
    // exercises the same SQLite backend production uses and isolates each case.
    private var container: ModelContainer!
    private var store: JobStore!
    private var storeURL: URL!

    override func setUp() {
        super.setUp()
        storeURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("FieldNoteTest-\(UUID().uuidString).store")
        let configuration = ModelConfiguration(schema: PersistenceController.schema, url: storeURL)
        container = try! ModelContainer(
            for: PersistenceController.schema,
            configurations: [configuration]
        )
        store = JobStore(context: container.mainContext)
    }

    override func tearDown() {
        store = nil
        container = nil
        if let storeURL {
            let fileManager = FileManager.default
            for suffix in ["", "-shm", "-wal"] {
                try? fileManager.removeItem(at: URL(fileURLWithPath: storeURL.path + suffix))
            }
        }
        storeURL = nil
        super.tearDown()
    }

    // MARK: - Fixtures

    private let tEarly = "2026-06-01T00:00:00.000Z"
    private let tMid = "2026-06-05T00:00:00.000Z"
    private let tLate = "2026-06-10T00:00:00.000Z"

    private func finding(_ id: String, _ text: String, _ severity: Severity, _ sortOrder: Int) -> FindingDTO {
        FindingDTO(id: id, text: text, severity: severity, sortOrder: sortOrder)
    }

    private func section(_ id: String, _ title: String, _ sortOrder: Int, _ findings: [FindingDTO]) -> SectionDTO {
        SectionDTO(id: id, title: title, sortOrder: sortOrder, findings: findings)
    }

    private func job(
        id: String = "job-1",
        label: String,
        status: JobStatus = .ready,
        transcript: String? = nil,
        errorMessage: String? = nil,
        sections: [SectionDTO] = [],
        pdfUrl: String? = nil,
        createdAt: String = "2026-06-01T00:00:00.000Z",
        updatedAt: String
    ) -> JobDTO {
        JobDTO(
            id: id,
            label: label,
            status: status,
            transcript: transcript,
            errorMessage: errorMessage,
            sections: sections,
            pdfUrl: pdfUrl,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
    }

    // MARK: - Mapping

    func testMapsServerJobIntoOrderedReportTree() {
        let dto = job(
            label: "123 Main St",
            status: .ready,
            transcript: "raw transcript",
            sections: [
                // Intentionally out of order to prove sortOrder drives display order.
                section("s2", "Electrical", 1, [finding("f2", "Open junction box", .safety, 0)]),
                section("s1", "Roof", 0, [
                    finding("f1", "Missing shingles", .repair, 0),
                    finding("f0", "Worn sealant", .info, 1),
                ]),
            ],
            pdfUrl: "https://r2.example/report.pdf",
            updatedAt: tMid
        )

        store.apply(dto)

        let saved = try! XCTUnwrap(store.job(id: "job-1"))
        XCTAssertEqual(saved.label, "123 Main St")
        XCTAssertEqual(saved.status, .ready)
        XCTAssertEqual(saved.transcript, "raw transcript")
        XCTAssertEqual(saved.pdfUrl, "https://r2.example/report.pdf")
        XCTAssertEqual(saved.syncState, .synced)

        XCTAssertEqual(saved.orderedSections.map(\.title), ["Roof", "Electrical"])
        let roof = saved.orderedSections[0]
        XCTAssertEqual(roof.orderedFindings.map(\.text), ["Missing shingles", "Worn sealant"])
        XCTAssertEqual(roof.orderedFindings.map(\.severity), [.repair, .info])
    }

    // MARK: - Last-write-wins

    func testServerOwnedFieldsAdoptedEvenWhenLocalEditIsNewer() {
        store.apply(job(label: "Original", status: .compiling, updatedAt: tEarly))

        // Local edit bumps updatedAt to the far future and marks dirty.
        store.applyLocalEdits(
            id: "job-1",
            label: "My local label",
            sections: [section("s1", "Local section", 0, [])],
            at: ISO8601.date(from: tLate)
        )

        // Server reports the pipeline finished, but its updatedAt is OLDER than the edit.
        store.apply(job(
            id: "job-1",
            label: "Server label",
            status: .ready,
            transcript: "final transcript",
            sections: [section("s9", "Server section", 0, [])],
            pdfUrl: "https://r2.example/done.pdf",
            updatedAt: tMid
        ))

        let saved = try! XCTUnwrap(store.job(id: "job-1"))
        // Server-owned fields always adopted.
        XCTAssertEqual(saved.status, .ready)
        XCTAssertEqual(saved.transcript, "final transcript")
        XCTAssertEqual(saved.pdfUrl, "https://r2.example/done.pdf")
        // User-owned fields preserved because the local edit is newer + dirty.
        XCTAssertEqual(saved.label, "My local label")
        XCTAssertEqual(saved.orderedSections.map(\.title), ["Local section"])
        XCTAssertEqual(saved.syncState, .dirty)
    }

    func testServerWinsWhenServerIsNewerThanLocalEdit() {
        store.apply(job(label: "Original", updatedAt: tEarly))

        // Local edit is older than the incoming server change.
        store.applyLocalEdits(
            id: "job-1",
            label: "Stale local label",
            sections: [section("s1", "Stale", 0, [])],
            at: ISO8601.date(from: tMid)
        )

        store.apply(job(
            label: "Authoritative server label",
            sections: [section("s2", "Fresh", 0, [])],
            updatedAt: tLate
        ))

        let saved = try! XCTUnwrap(store.job(id: "job-1"))
        XCTAssertEqual(saved.label, "Authoritative server label")
        XCTAssertEqual(saved.orderedSections.map(\.title), ["Fresh"])
        XCTAssertEqual(saved.syncState, .synced)
        XCTAssertEqual(saved.updatedAt, ISO8601.date(from: tLate))
    }

    func testLocalWinsRequiresDirtyState() {
        // A synced (not dirty) job never wins LWW even if its timestamp is newer:
        // there are no local edits to protect.
        store.apply(job(label: "Server v1", updatedAt: tLate))

        store.apply(job(label: "Server v2 (older stamp)", updatedAt: tEarly))

        let saved = try! XCTUnwrap(store.job(id: "job-1"))
        XCTAssertEqual(saved.label, "Server v2 (older stamp)")
        XCTAssertEqual(saved.syncState, .synced)
    }

    // MARK: - Tree reconciliation

    func testReconcilesPrunedSectionsAndFindings() {
        store.apply(job(
            label: "Report",
            sections: [
                section("s1", "Roof", 0, [
                    finding("f1", "Keep me", .repair, 0),
                    finding("f2", "Remove me", .info, 1),
                ]),
                section("s2", "Remove section", 1, [finding("f3", "gone", .info, 0)]),
            ],
            updatedAt: tEarly
        ))

        // Newer server state: section s2 deleted, finding f2 deleted, f1 retitled.
        store.apply(job(
            label: "Report",
            sections: [
                section("s1", "Roof (renamed)", 0, [finding("f1", "Updated text", .safety, 0)]),
            ],
            updatedAt: tMid
        ))

        let saved = try! XCTUnwrap(store.job(id: "job-1"))
        XCTAssertEqual(saved.orderedSections.count, 1)
        let roof = saved.orderedSections[0]
        XCTAssertEqual(roof.title, "Roof (renamed)")
        XCTAssertEqual(roof.orderedFindings.count, 1)
        XCTAssertEqual(roof.orderedFindings[0].text, "Updated text")
        XCTAssertEqual(roof.orderedFindings[0].severity, .safety)
    }

    func testEmptyServerSectionsClearTheTree() {
        store.apply(job(
            label: "Report",
            sections: [section("s1", "Roof", 0, [finding("f1", "x", .info, 0)])],
            updatedAt: tEarly
        ))

        store.apply(job(label: "Report", sections: [], updatedAt: tMid))

        let saved = try! XCTUnwrap(store.job(id: "job-1"))
        XCTAssertTrue(saved.sections.isEmpty)
    }
}
