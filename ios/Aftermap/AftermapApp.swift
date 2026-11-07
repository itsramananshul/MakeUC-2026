import SwiftUI

@main
struct AftermapApp: App {
    @StateObject private var store = SessionStore()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .preferredColorScheme(.dark)
                .task { await store.start() }
                .onChange(of: scenePhase) { _, phase in
                    store.setForegrounded(phase == .active)
                }
        }
    }
}

