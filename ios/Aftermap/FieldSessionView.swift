import SwiftUI

struct FieldSessionView: View {
    @EnvironmentObject private var store: SessionStore
    @State private var showingReport = false
    @State private var showingSettings = false

    var body: some View {
        ZStack(alignment: .bottom) {
            Group {
                if let snapshot = store.snapshot {
                    LiveMapView(snapshot: snapshot, observerId: store.observerId, serverURL: store.serverURL)
                } else {
                    AftermapTheme.navy
                        .overlay {
                            ContentUnavailableView("Waiting for field model", systemImage: "map", description: Text("Check the server URL and local network."))
                        }
                }
            }
            .ignoresSafeArea()

            VStack(spacing: 0) {
                fieldHeader
                Spacer()
                bottomCard
            }
        }
        .sheet(isPresented: $showingReport) { ReportFlowView() }
        .sheet(isPresented: $showingSettings) { LegacyDrillSettingsView() }
        .onAppear {
#if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-aftermapReport") || ProcessInfo.processInfo.environment["AFTERMAP_REPORT"] == "1" { showingReport = true }
#endif
        }
    }

    private var fieldHeader: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 7) {
                    Circle().fill(connectionColor).frame(width: 8, height: 8)
                    Text(connectionLabel).font(.caption2.weight(.black)).foregroundStyle(connectionColor)
                }
                Text(store.snapshot?.session.name ?? "AFTERMAP")
                    .font(.headline).lineLimit(1)
                Text(store.snapshot?.session.code ?? store.sessionCode)
                    .font(.caption2.monospaced().weight(.bold)).foregroundStyle(AftermapTheme.muted)
            }
            Spacer()
            DrillBadge()
            Button { showingSettings = true } label: {
                Image(systemName: "gearshape.fill").frame(width: 38, height: 38)
                    .background(.ultraThinMaterial, in: Circle())
            }
        }
        .padding(12)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .padding(.horizontal, 12)
        .padding(.top, 5)
    }

    @ViewBuilder private var bottomCard: some View {
        if let snapshot = store.snapshot {
            VStack(spacing: 11) {
                Capsule().fill(Color.white.opacity(0.25)).frame(width: 36, height: 4)
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Label("CANDIDATE ROUTE", systemImage: "location.north.line.fill")
                            .font(.caption2.weight(.black)).foregroundStyle(AftermapTheme.mint)
                        if let route = snapshot.route {
                            Text(route.nodeIds.compactMap { id in snapshot.nodes.first(where: { $0.id == id })?.label }.joined(separator: " → "))
                                .font(.headline).lineLimit(2)
                        } else {
                            Text("No candidate route from confirmed evidence")
                                .font(.headline).foregroundStyle(AftermapTheme.amber)
                        }
                    }
                    Spacer()
                    if let distance = snapshot.route?.distance {
                        Text("\(distance, specifier: "%.0f")\nunits")
                            .font(.caption.monospacedDigit().weight(.bold)).multilineTextAlignment(.trailing)
                    }
                }
                if let change = snapshot.routeChange {
                    Label(change.reason, systemImage: "arrow.triangle.2.circlepath")
                        .font(.caption).foregroundStyle(AftermapTheme.amber).frame(maxWidth: .infinity, alignment: .leading).lineLimit(2)
                }
                HStack(spacing: 8) {
                    Label("\(snapshot.participants.count) field devices", systemImage: "iphone.gen3.radiowaves.left.and.right")
                    Spacer()
                    Text("v\(snapshot.version)").monospacedDigit()
                }
                .font(.caption2.weight(.semibold)).foregroundStyle(AftermapTheme.muted)
                Button { showingReport = true } label: {
                    Label("Add confirmed field report", systemImage: "plus.viewfinder")
                        .font(.headline).frame(maxWidth: .infinity).padding(.vertical, 14)
                        .foregroundStyle(AftermapTheme.navy)
                        .background(AftermapTheme.mint, in: RoundedRectangle(cornerRadius: 14))
                }
                .accessibilityIdentifier("map.addReport")
                Text("DRILL ONLY • Candidate route is not a safety assurance.")
                    .font(.caption2.weight(.bold)).foregroundStyle(AftermapTheme.amber)
            }
            .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 10)
            .background(.ultraThinMaterial, in: UnevenRoundedRectangle(topLeadingRadius: 24, topTrailingRadius: 24))
        } else {
            HStack { ProgressView(); Text("Connecting to field session…") }
                .padding().frame(maxWidth: .infinity).background(.ultraThinMaterial)
        }
    }

    private var connectionLabel: String {
        switch store.connection {
        case .idle: "OFFLINE"
        case .connecting: "CONNECTING"
        case .live: "LIVE • 1s SYNC"
        case .stale: "STALE • RETRYING"
        case .failed: "CONNECTION ERROR"
        }
    }
    private var connectionColor: Color {
        switch store.connection {
        case .live: AftermapTheme.mint
        case .connecting: AftermapTheme.cyan
        case .stale: AftermapTheme.amber
        case .failed: AftermapTheme.red
        case .idle: AftermapTheme.muted
        }
    }
}

private struct LegacyDrillSettingsView: View {
    @EnvironmentObject private var store: SessionStore
    @Environment(\.dismiss) private var dismiss
    @State private var serverURL = ""
    @State private var sessionCode = ""

    var body: some View {
        NavigationStack {
            Form {
                TextField("Server URL", text: $serverURL)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                TextField("Session code", text: $sessionCode)
                    .textInputAutocapitalization(.characters)
            }
            .navigationTitle("Legacy Drill")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        store.updateConfiguration(serverURL: serverURL, sessionCode: sessionCode)
                        dismiss()
                    }
                }
            }
            .onAppear {
                serverURL = store.serverURL
                sessionCode = store.sessionCode
            }
        }
    }
}
