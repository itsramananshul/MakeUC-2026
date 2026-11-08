import SwiftUI

@main
struct AftermapApp: App {
    @StateObject private var store = WorldMapStore()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .task { await store.run() }
                .onChange(of: scenePhase) { _, phase in
                    guard phase == .active else { return }
                    Task { await store.refreshIncidents() }
                }
        }
    }
}
