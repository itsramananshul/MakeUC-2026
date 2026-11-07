import SwiftUI

struct RootView: View {
    @EnvironmentObject private var store: SessionStore

    var body: some View {
        ZStack {
            AftermapTheme.navy.ignoresSafeArea()
            if store.isJoined {
                FieldSessionView()
            } else {
                JoinView()
            }
        }
        .tint(AftermapTheme.mint)
        .alert("AFTERMAP", isPresented: Binding(
            get: { store.bannerMessage != nil },
            set: { if !$0 { store.bannerMessage = nil } }
        )) {
            Button("OK") { store.bannerMessage = nil }
        } message: {
            Text(store.bannerMessage ?? "")
        }
    }
}

struct JoinView: View {
    @EnvironmentObject private var store: SessionStore
    @State private var serverURL = ""
    @State private var sessionCode = "WESTHALL"
    @State private var displayName = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Spacer(minLength: 34)
                VStack(alignment: .leading, spacing: 10) {
                    DrillBadge()
                    Text("AFTERMAP")
                        .font(.system(size: 43, weight: .black, design: .rounded))
                        .foregroundStyle(.white)
                    Text("A live, collaborative map for when the world breaks.")
                        .font(.title3.weight(.medium))
                        .foregroundStyle(AftermapTheme.muted)
                }

                VStack(alignment: .leading, spacing: 16) {
                    Text("JOIN FIELD SESSION")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(AftermapTheme.cyan)
                    LabeledField(label: "Display name", icon: "person.fill", text: $displayName, capitalization: .words)
                    LabeledField(label: "Session code", icon: "number", text: $sessionCode, capitalization: .characters)
                    LabeledField(label: "Server URL", icon: "server.rack", text: $serverURL, capitalization: .never, keyboard: .URL)

                    Button {
                        Task { _ = await store.join(serverURL: serverURL, sessionCode: sessionCode, displayName: displayName) }
                    } label: {
                        HStack {
                            if store.isBusy { ProgressView().tint(AftermapTheme.navy) }
                            Text(store.isBusy ? "Connecting…" : "Join \(sessionCode.uppercased()) drill")
                                .fontWeight(.bold)
                            Spacer()
                            Image(systemName: "arrow.right")
                        }
                        .padding()
                        .foregroundStyle(AftermapTheme.navy)
                        .background(AftermapTheme.mint, in: RoundedRectangle(cornerRadius: 14))
                    }
                    .accessibilityIdentifier("join.submit")
                    .disabled(store.isBusy || displayName.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                .aftermapPanel()

                Label("Simulated field-drill prototype. It cannot certify passage safety or direct a real evacuation.", systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(AftermapTheme.amber)
            }
            .padding(20)
        }
        .onAppear {
            serverURL = store.serverURL
            sessionCode = store.sessionCode
            displayName = store.displayName
        }
    }
}

private struct LabeledField: View {
    var label: String
    var icon: String
    @Binding var text: String
    var capitalization: TextInputAutocapitalization = .sentences
    var keyboard: UIKeyboardType = .default

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Label(label, systemImage: icon)
                .font(.caption.weight(.semibold))
                .foregroundStyle(AftermapTheme.muted)
            TextField(label, text: $text)
                .textInputAutocapitalization(capitalization)
                .keyboardType(keyboard)
                .autocorrectionDisabled(keyboard == .URL)
                .padding(13)
                .background(AftermapTheme.navy.opacity(0.7), in: RoundedRectangle(cornerRadius: 12))
                .foregroundStyle(.white)
        }
    }
}

struct SessionView: View {
    @EnvironmentObject private var store: SessionStore
    @State private var showingReport = false
    @State private var showingSettings = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    statusBar
                    if let snapshot = store.snapshot {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(snapshot.session.name).font(.headline)
                                Text(snapshot.session.code).font(.caption.monospaced().weight(.bold)).foregroundStyle(AftermapTheme.muted)
                            }
                            Spacer()
                            Label("FIELD VIEW", systemImage: "map.fill").font(.caption2.weight(.bold)).foregroundStyle(AftermapTheme.cyan)
                        }
                        .padding(.horizontal, 6)
                        LiveMapView(snapshot: snapshot, observerId: store.observerId, serverURL: store.serverURL)
                            .frame(height: 360)
                            .aftermapPanel()
                        routeCard(snapshot)
                        participantStrip(snapshot)
                    } else {
                        ContentUnavailableView("Waiting for world model", systemImage: "point.3.connected.trianglepath.dotted", description: Text("Check the server URL and keep this phone on the same network."))
                            .frame(minHeight: 360)
                            .aftermapPanel()
                    }
                    safetyNotice
                }
                .padding(14)
            }
            .background(AftermapTheme.navy)
            .navigationTitle("AFTERMAP")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { DrillBadge() }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showingSettings = true } label: { Image(systemName: "gearshape.fill") }
                }
            }
            .safeAreaInset(edge: .bottom) {
                Button { showingReport = true } label: {
                    Label("Add confirmed report", systemImage: "plus.viewfinder")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 15)
                        .foregroundStyle(AftermapTheme.navy)
                        .background(AftermapTheme.mint, in: RoundedRectangle(cornerRadius: 16))
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .background(.ultraThinMaterial)
                .disabled(store.snapshot == nil)
            }
            .sheet(isPresented: $showingReport) { ReportFlowView() }
            .sheet(isPresented: $showingSettings) { SettingsView() }
        }
    }

    private var statusBar: some View {
        HStack(spacing: 8) {
            Circle().fill(connectionColor).frame(width: 8, height: 8)
            Text(connectionLabel).font(.caption.weight(.bold))
            Spacer()
            if let version = store.snapshot?.version { Text("WORLD MODEL v\(version)").font(.caption2.monospaced().weight(.bold)) }
        }
        .foregroundStyle(connectionColor)
        .padding(.horizontal, 6)
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

    private func routeCard(_ snapshot: SessionSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                Label("CANDIDATE ROUTE", systemImage: "arrow.triangle.turn.up.right.diamond.fill")
                    .font(.caption.weight(.bold)).foregroundStyle(AftermapTheme.mint)
                Spacer()
                if let distance = snapshot.route?.distance { Text("\(distance, specifier: "%.0f") units").font(.caption.monospacedDigit()) }
            }
            if let route = snapshot.route {
                Text(route.nodeIds.compactMap { id in snapshot.nodes.first(where: { $0.id == id })?.label }.joined(separator: "  →  "))
                    .font(.headline)
                Text("Based only on the current shared drill model. Verify conditions in person.")
                    .font(.caption).foregroundStyle(AftermapTheme.muted)
            } else {
                Text("No candidate route is available from confirmed map evidence.")
                    .foregroundStyle(AftermapTheme.amber)
            }
            if let change = snapshot.routeChange {
                Label(change.reason, systemImage: "arrow.triangle.2.circlepath")
                    .font(.caption).foregroundStyle(AftermapTheme.amber)
            }
        }
        .aftermapPanel()
    }

    private func participantStrip(_ snapshot: SessionSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("PARTICIPANTS • \(snapshot.participants.count)")
                .font(.caption.weight(.bold)).foregroundStyle(AftermapTheme.cyan)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    ForEach(snapshot.participants) { person in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(person.displayName).font(.subheadline.weight(.semibold))
                            Text(snapshot.nodes.first(where: { $0.id == person.checkpointId })?.label ?? "Position unknown")
                                .font(.caption2).foregroundStyle(AftermapTheme.muted)
                        }
                        .padding(10).background(AftermapTheme.panelRaised, in: RoundedRectangle(cornerRadius: 12))
                    }
                }
            }
        }
        .aftermapPanel()
    }

    private var safetyNotice: some View {
        Text("DRILL ONLY • Not a safety system, emergency service, or assurance that any route is physically safe.")
            .font(.caption2.weight(.bold)).foregroundStyle(AftermapTheme.amber).multilineTextAlignment(.center).padding(.vertical, 10)
    }
}

struct SettingsView: View {
    @EnvironmentObject private var store: SessionStore
    @Environment(\.dismiss) private var dismiss
    @State private var serverURL = ""
    @State private var sessionCode = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Connection") {
                    TextField("Server URL", text: $serverURL).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField("Session code", text: $sessionCode).textInputAutocapitalization(.characters).autocorrectionDisabled()
                    Button("Save and reconnect") {
                        store.updateConfiguration(serverURL: serverURL, sessionCode: sessionCode)
                        Task { await store.refresh() }
                        dismiss()
                    }
                }
                Section("Device identity") {
                    LabeledContent("Name", value: store.displayName)
                    LabeledContent("Observer ID", value: store.observerId ?? "None")
                    Button("Leave session on this device", role: .destructive) { store.leaveDeviceIdentity(); dismiss() }
                }
                Section { Text("Use the Mac's LAN address, not localhost, on physical iPhones. Example: http://192.168.1.42:3000") }
            }
            .navigationTitle("Drill settings")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .onAppear { serverURL = store.serverURL; sessionCode = store.sessionCode }
        }
    }
}

#Preview("Join") { JoinView().environmentObject(SessionStore()) }
