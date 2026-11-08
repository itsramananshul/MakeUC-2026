import SwiftUI

@main
struct AftermapApp: App {
    @StateObject private var store = WorldMapStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .task { await store.run() }
        }
    }
}
