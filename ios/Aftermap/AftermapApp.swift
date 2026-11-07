import SwiftUI

@main
struct AftermapApp: App {
    @StateObject private var store = WorldMapStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .preferredColorScheme(.dark)
                .task { await store.run() }
        }
    }
}
