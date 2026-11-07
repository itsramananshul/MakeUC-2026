import SwiftUI

struct RootView: View {
    @EnvironmentObject private var store: WorldMapStore
    @State private var showingSettings = false
    @State private var showingIncident = false
    @State private var showingReport = false

    var body: some View {
        ZStack {
            MapLibreWorldMap(store: store)
                .ignoresSafeArea()
                .accessibilityIdentifier("world.map")

            VStack(spacing: 10) {
                searchPanel
                if let mode = store.selectionMode {
                    selectionBanner(mode)
                } else if case let .stale(message) = store.connection {
                    staleBanner(message)
                }
                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.top, 4)

            VStack {
                Spacer()
                HStack {
                    Spacer()
                    Button { store.requestCurrentLocationAsOrigin() } label: {
                        Image(systemName: store.userCoordinate == nil ? "location" : "location.fill")
                            .font(.title3.weight(.semibold))
                            .frame(width: 48, height: 48)
                            .background(.regularMaterial, in: Circle())
                            .shadow(color: .black.opacity(0.22), radius: 8, y: 3)
                    }
                    .accessibilityLabel("Use my location as start")
                    .accessibilityIdentifier("map.useCurrentLocation")
                }
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 8)
        }
        .tint(AftermapTheme.mint)
        .safeAreaInset(edge: .bottom) { bottomPanel }
        .sheet(isPresented: $showingSettings) { SettingsSheet(store: store) }
        .sheet(isPresented: $showingIncident) { IncidentSheet(store: store, showingReport: $showingReport) }
        .sheet(isPresented: $showingReport) { ReportSheet(store: store) }
        .alert("AFTERMAP", isPresented: Binding(
            get: { store.notice != nil },
            set: { if !$0 { store.notice = nil } }
        )) {
            Button("OK") { store.notice = nil }
        } message: {
            Text(store.notice ?? "")
        }
        .onChange(of: store.selectedIncident?.id) { _, id in
            if id != nil { showingIncident = true }
        }
        .task(id: store.query) { await store.search() }
    }

    private var searchPanel: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                TextField("Search any place", text: $store.query)
                    .textInputAutocapitalization(.words)
                    .submitLabel(.search)
                    .accessibilityIdentifier("place.search")
                if store.isSearching {
                    ProgressView().controlSize(.small)
                } else if !store.query.isEmpty {
                    Button { store.query = "" } label: { Image(systemName: "xmark.circle.fill") }
                        .foregroundStyle(.secondary)
                }
                Divider().frame(height: 22)
                Button { showingSettings = true } label: { Image(systemName: "slider.horizontal.3") }
                    .accessibilityLabel("Settings")
            }
            .padding(.horizontal, 14)
            .frame(height: 50)

            if !store.places.isEmpty {
                Divider()
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(store.places.prefix(6))) { place in
                            Button { store.choosePlace(place) } label: {
                                HStack(spacing: 12) {
                                    Image(systemName: "mappin.circle.fill")
                                        .font(.title3)
                                        .foregroundStyle(AftermapTheme.cyan)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(place.name).font(.subheadline.weight(.semibold))
                                        Text(place.detail).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                    }
                                    Spacer()
                                }
                                .padding(.horizontal, 14)
                                .padding(.vertical, 10)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            if place.id != store.places.prefix(6).last?.id { Divider().padding(.leading, 50) }
                        }
                    }
                }
                .frame(maxHeight: 290)
            }
        }
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .shadow(color: .black.opacity(0.2), radius: 12, y: 4)
    }

    private func selectionBanner(_ mode: WorldMapStore.SelectionMode) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "scope").foregroundStyle(AftermapTheme.cyan)
            Text(mode.instruction).font(.subheadline.weight(.semibold))
            Spacer()
            Button("Cancel") { store.selectionMode = nil }.font(.caption.weight(.bold))
        }
        .padding(12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
        .accessibilityIdentifier("map.selectionInstruction")
    }

    private func staleBanner(_ message: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "wifi.exclamationmark")
            Text("Updates unavailable — showing the last map").font(.caption.weight(.semibold))
            Spacer()
            Button("Retry") { Task { await store.refreshIncidents() } }.font(.caption.weight(.bold))
        }
        .foregroundStyle(AftermapTheme.amber)
        .padding(11)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
        .accessibilityHint(message)
    }

    private var bottomPanel: some View {
        VStack(spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("AFTERMAP").font(.caption.weight(.black)).tracking(1.4)
                    switch store.connection {
                    case .loading:
                        Text("Loading the world map…")
                    case .live:
                        Text(store.incidents.isEmpty ? "World map live • No active incidents" : "World map live • \(store.incidents.count) active incident\(store.incidents.count == 1 ? "" : "s")")
                    case .stale:
                        Text("Map data may be stale")
                    }
                }
                .font(.caption)
                Spacer()
                if !store.incidents.isEmpty {
                    Menu {
                        ForEach(store.incidents) { incident in
                            Button(incident.name) { Task { await store.loadIncident(incident) } }
                        }
                    } label: {
                        Label("Incidents", systemImage: "exclamationmark.triangle.fill")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(AftermapTheme.red)
                    }
                    .accessibilityIdentifier("incidents.menu")
                }
            }

            HStack(spacing: 8) {
                endpointButton(title: "Start", coordinate: store.origin, mode: .origin, icon: "location.fill")
                Image(systemName: "arrow.right").font(.caption).foregroundStyle(.secondary)
                endpointButton(title: "Destination", coordinate: store.destination, mode: .destination, icon: "mappin.and.ellipse")
            }

            routeStatus

            Button {
                Task { await store.previewRoute() }
            } label: {
                HStack {
                    if case .calculating = store.routeState { ProgressView().tint(.white) }
                    Image(systemName: "figure.walk")
                    Text(routeButtonTitle).fontWeight(.bold)
                    Spacer()
                    Image(systemName: "chevron.right")
                }
                .padding(.horizontal, 14)
                .frame(height: 48)
                .foregroundStyle(.white)
                .background(Color.blue, in: RoundedRectangle(cornerRadius: 14))
            }
            .disabled(store.origin == nil || store.destination == nil || store.routeState == .calculating)
            .accessibilityIdentifier("route.preview")
        }
        .padding(14)
        .background(.ultraThinMaterial)
    }

    private func endpointButton(title: String, coordinate: IncidentCoordinate?, mode: WorldMapStore.SelectionMode, icon: String) -> some View {
        Button { store.setSelectionMode(mode) } label: {
            HStack(spacing: 7) {
                Image(systemName: icon).foregroundStyle(coordinate == nil ? .secondary : AftermapTheme.mint)
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(.caption2).foregroundStyle(.secondary)
                    Text(coordinate == nil ? "Choose on map" : coordinateLabel(coordinate!))
                        .font(.caption.weight(.semibold)).lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(Color.primary.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(mode == .origin ? "route.origin" : "route.destination")
    }

    @ViewBuilder private var routeStatus: some View {
        switch store.routeState {
        case .idle, .calculating:
            EmptyView()
        case let .unavailable(reason):
            Label(reason, systemImage: "exclamationmark.octagon.fill")
                .font(.caption.weight(.semibold)).foregroundStyle(AftermapTheme.red)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityIdentifier("route.unavailable")
        case let .route(response, affected):
            VStack(alignment: .leading, spacing: 3) {
                Label(routeStatusTitle(response), systemImage: response.status == .complete ? "checkmark.shield.fill" : "exclamationmark.shield.fill")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(response.status == .complete ? AftermapTheme.mint : AftermapTheme.amber)
                if let affected { Text("Checked against \(affected)").font(.caption2).foregroundStyle(.secondary) }
                if !response.reason.isEmpty { Text(response.reason).font(.caption2).foregroundStyle(.secondary) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityIdentifier("route.status")
        }
    }

    private var routeButtonTitle: String {
        switch store.routeState {
        case .calculating: "Checking evidence…"
        default: "Preview evidence-aware route"
        }
    }

    private func routeStatusTitle(_ response: IncidentRouteResponse) -> String {
        let distance = Measurement(value: response.distanceMeters, unit: UnitLength.meters)
        let formatted = distance.formatted(.measurement(width: .abbreviated, usage: .road))
        return switch response.status {
        case .complete: "Evidence-aware route • \(formatted)"
        case .partial: "Partial route only • \(formatted)"
        case .unavailable: "No verified route"
        }
    }

    private func coordinateLabel(_ value: IncidentCoordinate) -> String {
        String(format: "%.4f, %.4f", value.latitude, value.longitude)
    }
}

private struct SettingsSheet: View {
    @ObservedObject var store: WorldMapStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Connection") {
                    TextField("Server URL", text: $store.serverURL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                Section("Evidence identity") {
                    TextField("Display name", text: $store.displayName)
                    SecureField("Incident report key", text: $store.reportKey)
                    Text("The report key stays in memory and is not saved on this device.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Section {
                    Button("Refresh incident data") { Task { await store.refreshIncidents() } }
                }
            }
            .navigationTitle("AFTERMAP Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { store.saveSettings(); dismiss() }
                }
            }
        }
    }
}

private struct IncidentSheet: View {
    @ObservedObject var store: WorldMapStore
    @Binding var showingReport: Bool
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if let detail = store.incidentDetail {
                    List {
                        Section {
                            LabeledContent("Roads", value: "\(detail.roadCount)")
                            LabeledContent("Reports", value: "\(detail.reports.count)")
                            if let imagery = detail.imagery {
                                LabeledContent("Aerial survey", value: imagery.source)
                                LabeledContent("Captured", value: imagery.timestamp)
                            } else {
                                Label("No aerial survey published", systemImage: "photo.badge.exclamationmark")
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Section("Tap a road to inspect or report") {
                            ForEach(detail.roads) { road in
                                Button {
                                    store.selectRoad(road)
                                } label: {
                                    HStack {
                                        Circle().fill(roadColor(road.state)).frame(width: 10, height: 10)
                                        VStack(alignment: .leading) {
                                            Text(road.label).foregroundStyle(.primary)
                                            Text(road.state.rawValue.capitalized).font(.caption).foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                        if store.selectedRoad?.id == road.id { Image(systemName: "checkmark.circle.fill") }
                                    }
                                }
                            }
                        }
                        if let road = store.selectedRoad {
                            Section("Selected road") {
                                Text(road.label)
                                Button {
                                    dismiss()
                                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { showingReport = true }
                                } label: {
                                    Label("Add confirmed evidence", systemImage: "plus.viewfinder")
                                }
                                .accessibilityIdentifier("incident.report")
                            }
                        }
                    }
                } else {
                    ProgressView("Loading incident evidence…")
                }
            }
            .navigationTitle(store.selectedIncident?.name ?? "Incident")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { store.clearIncidentSelection(); dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func roadColor(_ state: IncidentRoad.State) -> Color {
        switch state {
        case .unknown: .gray
        case .open: .green
        case .blocked: .red
        case .hazard: .orange
        case .conflict: .purple
        }
    }
}

private struct ReportSheet: View {
    @ObservedObject var store: WorldMapStore
    @Environment(\.dismiss) private var dismiss
    @State private var condition: IncidentRoad.State = .open
    @State private var note = ""
    @State private var evidenceType = "manual"
    @State private var submitting = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Location") {
                    LabeledContent("Incident", value: store.selectedIncident?.name ?? "Not selected")
                    LabeledContent("Road", value: store.selectedRoad?.label ?? "Not selected")
                }
                Section("Observed condition") {
                    Picker("Condition", selection: $condition) {
                        Text("Open").tag(IncidentRoad.State.open)
                        Text("Blocked").tag(IncidentRoad.State.blocked)
                        Text("Hazard").tag(IncidentRoad.State.hazard)
                    }
                    .pickerStyle(.segmented)
                    Picker("Evidence", selection: $evidenceType) {
                        Text("Field check").tag("manual")
                        Text("Written note").tag("text")
                        Text("Voice note").tag("voice")
                    }
                    TextField("What did you observe?", text: $note, axis: .vertical)
                        .lineLimit(3...7)
                }
                Section {
                    Label("Submitting confirms this is a direct observation. It may change routes for everyone.", systemImage: "checkmark.shield")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Add Evidence")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(submitting ? "Submitting…" : "Submit") {
                        submitting = true
                        Task {
                            if await store.submitReport(condition: condition, note: note, evidenceType: evidenceType) { dismiss() }
                            submitting = false
                        }
                    }
                    .disabled(submitting)
                    .accessibilityIdentifier("report.submit")
                }
            }
        }
    }
}
