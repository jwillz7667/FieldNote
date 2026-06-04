import SwiftUI

/// Edit a report's label, sections, and findings. On save the whole edited tree is
/// pushed (server replaces the report, last-write-wins). Empty titles/findings are
/// dropped so the server never receives invalid or empty content.
struct ReportEditView: View {
    @Environment(JobSyncService.self) private var sync
    @Environment(\.dismiss) private var dismiss

    private let jobId: String
    @State private var label: String
    @State private var sections: [EditableSection]
    @State private var isSaving = false

    init(job: Job) {
        self.jobId = job.id
        _label = State(initialValue: job.label)
        _sections = State(initialValue: job.orderedSections.map(EditableSection.init(from:)))
    }

    var body: some View {
        NavigationStack {
            List {
                Section("Property") {
                    TextField("Address", text: $label)
                        .textInputAutocapitalization(.words)
                }

                ForEach($sections) { $section in
                    Section {
                        ForEach($section.findings) { $finding in
                            FindingEditor(finding: $finding)
                        }
                        .onDelete { section.findings.remove(atOffsets: $0) }
                        .onMove { section.findings.move(fromOffsets: $0, toOffset: $1) }

                        Button("Add Finding", systemImage: "plus.circle") {
                            section.findings.append(EditableFinding.empty())
                        }
                        .font(.callout)
                    } header: {
                        HStack {
                            TextField("Section title", text: $section.title)
                                .textInputAutocapitalization(.words)
                                .font(.headline)
                            Spacer()
                            Button(role: .destructive) {
                                sections.removeAll { $0.id == section.id }
                            } label: {
                                Image(systemName: "trash")
                            }
                            .accessibilityLabel("Delete section \(section.title)")
                        }
                    }
                }

                Section {
                    Button("Add Section", systemImage: "plus.circle.fill") {
                        sections.append(EditableSection.empty())
                    }
                }
            }
            .environment(\.editMode, .constant(.active))
            .navigationTitle("Edit Report")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(isSaving || label.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .overlay {
                if isSaving {
                    ProgressView().controlSize(.large)
                }
            }
        }
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }

        let dtos = Self.toDTOs(sections)
        let trimmedLabel = label.trimmingCharacters(in: .whitespacesAndNewlines)
        await sync.saveEdits(jobId: jobId, label: trimmedLabel, sections: dtos, now: Date())
        dismiss()
    }

    /// Normalises the edit buffer into wire DTOs: trims, drops empty findings and
    /// empty sections, and recomputes sortOrder from array position.
    static func toDTOs(_ sections: [EditableSection]) -> [SectionDTO] {
        sections.enumerated().compactMap { sectionIndex, section in
            let title = section.title.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !title.isEmpty else { return nil }

            let findings = section.findings.enumerated().compactMap { findingIndex, finding -> FindingDTO? in
                let text = finding.text.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !text.isEmpty else { return nil }
                return FindingDTO(id: finding.id, text: text, severity: finding.severity, sortOrder: findingIndex)
            }
            guard !findings.isEmpty else { return nil }

            return SectionDTO(id: section.id, title: title, sortOrder: sectionIndex, findings: findings)
        }
    }
}

private struct FindingEditor: View {
    @Binding var finding: EditableFinding

    var body: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.sm) {
            TextField("Describe the finding", text: $finding.text, axis: .vertical)
                .lineLimit(1...6)

            Picker("Severity", selection: $finding.severity) {
                ForEach(Severity.allCases) { severity in
                    Text(severity.label).tag(severity)
                }
            }
            .pickerStyle(.segmented)
        }
        .padding(.vertical, AppTheme.Spacing.xs)
    }
}

// MARK: - Edit buffer value types

struct EditableFinding: Identifiable, Hashable {
    let id: String
    var text: String
    var severity: Severity

    init(from finding: Finding) {
        id = finding.id
        text = finding.text
        severity = finding.severity
    }

    private init(id: String, text: String, severity: Severity) {
        self.id = id
        self.text = text
        self.severity = severity
    }

    static func empty() -> EditableFinding {
        EditableFinding(id: UUID().uuidString, text: "", severity: .maintenance)
    }
}

struct EditableSection: Identifiable, Hashable {
    let id: String
    var title: String
    var findings: [EditableFinding]

    init(from section: ReportSection) {
        id = section.id
        title = section.title
        findings = section.orderedFindings.map(EditableFinding.init(from:))
    }

    private init(id: String, title: String, findings: [EditableFinding]) {
        self.id = id
        self.title = title
        self.findings = findings
    }

    static func empty() -> EditableSection {
        EditableSection(id: UUID().uuidString, title: "", findings: [EditableFinding.empty()])
    }
}
