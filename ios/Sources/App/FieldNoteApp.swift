import SwiftData
import SwiftUI

@main
struct FieldNoteApp: App {
    private let container: ModelContainer
    @State private var session: SessionStore
    @State private var sync: JobSyncService

    init() {
        let container = PersistenceController.makeContainer()
        let api = APIClient()
        let store = JobStore(context: container.mainContext)
        let uploader = AudioUploader()

        self.container = container
        _session = State(initialValue: SessionStore(api: api))
        _sync = State(initialValue: JobSyncService(api: api, store: store, uploader: uploader))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .environment(sync)
        }
        .modelContainer(container)
    }
}
