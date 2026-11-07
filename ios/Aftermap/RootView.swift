import PhotosUI
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
        .sheet(isPresented: $showingReport) {
            ReportSheet(store: store) {
                showingReport = false
                store.beginReportLocationSelection()
            }
        }
        .alert("Gaslight Maps", isPresented: Binding(
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
        .onAppear {
            if store.selectedIncident != nil { showingIncident = true }
        }
        .onChange(of: store.reportLocationRevision) { _, revision in
            if revision > 0 {
                showingIncident = false
                showingReport = true
            }
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
                    Text("Gaslight Maps").font(.caption.weight(.black)).tracking(1.4)
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
            .navigationTitle("Gaslight Maps Settings")
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
                            Button {
                                store.selectedRoad = nil
                                store.clearReportLocation()
                                dismiss()
                                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { showingReport = true }
                            } label: {
                                Label("Add field report", systemImage: "mappin.and.ellipse")
                            }
                            .accessibilityIdentifier("incident.fieldReport")
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
    var chooseOnMap: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var condition: IncidentRoad.State = .open
    @State private var note = ""
    @State private var submitting = false
    @State private var photoItem: PhotosPickerItem?
    @State private var cameraImage: UIImage?
    @State private var photoJPEG: Data?
    @State private var photoError: String?
    @State private var showingCamera = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Where") {
                    LabeledContent("Incident", value: store.selectedIncident?.name ?? "Not selected")
                    if let road = store.selectedRoad {
                        Label(road.label, systemImage: "road.lanes")
                        Button("Report a map point instead") {
                            store.selectedRoad = nil
                            store.clearReportLocation()
                        }
                    } else {
                        if store.reportLocation != nil {
                            Label("Map point selected inside incident", systemImage: "mappin.circle.fill")
                                .foregroundStyle(AftermapTheme.mint)
                        } else {
                            Label("Choose where you observed this", systemImage: "mappin.slash")
                                .foregroundStyle(.secondary)
                        }
                        Button(action: chooseOnMap) {
                            Label(store.reportLocation == nil ? "Choose point on map" : "Change point on map", systemImage: "map")
                        }
                        Button { store.requestCurrentLocationForReport() } label: {
                            Label("Use my current location", systemImage: "location.fill")
                        }
                    }
                }

                if store.selectedRoad != nil {
                    Section("Road condition") {
                        Picker("Condition", selection: $condition) {
                            Text("Open").tag(IncidentRoad.State.open)
                            Text("Blocked").tag(IncidentRoad.State.blocked)
                            Text("Hazard").tag(IncidentRoad.State.hazard)
                        }
                        .pickerStyle(.segmented)
                    }
                }

                Section("What did you observe?") {
                    TextField("Add a short note", text: $note, axis: .vertical)
                        .lineLimit(3...7)
                }

                Section("Photo evidence (optional)") {
                    if let photoJPEG, let image = UIImage(data: photoJPEG) {
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFit()
                            .frame(maxHeight: 220)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                            .accessibilityLabel("Selected evidence photo")
                        Button(role: .destructive) {
                            self.photoJPEG = nil
                            photoItem = nil
                            cameraImage = nil
                        } label: {
                            Label("Remove photo", systemImage: "trash")
                        }
                    }
                    PhotosPicker(selection: $photoItem, matching: .images) {
                        Label("Choose from Photo Library", systemImage: "photo.on.rectangle")
                    }
                    Button { showingCamera = true } label: {
                        Label("Take Photo", systemImage: "camera")
                    }
                    .disabled(!UIImagePickerController.isSourceTypeAvailable(.camera))
                    if let photoError {
                        Text(photoError).font(.caption).foregroundStyle(AftermapTheme.red)
                    }
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
                            let roadCondition = store.selectedRoad == nil ? nil : condition
                            if await store.submitReport(condition: roadCondition, note: note, photoJPEG: photoJPEG) { dismiss() }
                            submitting = false
                        }
                    }
                    .disabled(submitting || !targetReady)
                    .accessibilityIdentifier("report.submit")
                }
            }
        }
        .sheet(isPresented: $showingCamera) { IncidentCameraPicker(image: $cameraImage) }
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            Task {
                do {
                    guard let data = try await item.loadTransferable(type: Data.self),
                          let jpeg = IncidentPhotoProcessor.jpegData(from: data) else {
                        photoError = "That image could not be prepared. Choose a different photo."
                        return
                    }
                    photoJPEG = jpeg
                    photoError = nil
                } catch {
                    photoError = "That image could not be loaded."
                }
            }
        }
        .onChange(of: cameraImage) { _, image in
            guard let image else { return }
            if let jpeg = IncidentPhotoProcessor.jpegData(from: image) {
                photoJPEG = jpeg
                photoError = nil
            } else {
                photoError = "That photo could not be prepared. Try again."
            }
        }
    }

    private var targetReady: Bool {
        store.selectedRoad != nil || store.reportLocation != nil
    }
}
