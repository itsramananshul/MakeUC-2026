import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

private enum RouteEndpointEditor: String, Identifiable {
    case origin
    case destination

    var id: String { rawValue }
    var title: String { self == .origin ? "Change Start" : "Change Destination" }
    var placeholder: String { self == .origin ? "Search for a starting place" : "Search for a destination" }
}

struct RootView: View {
    @EnvironmentObject private var store: WorldMapStore
    @State private var showingSettings = false
    @State private var showingIncident = false
    @State private var showingReport = false
    @State private var showingDisasterHub = false
    @State private var showingDashboard = true
    @State private var showingDirections = false
    @State private var endpointEditor: RouteEndpointEditor?
    @State private var requestedInitialLocation = false
    @State private var dashboardDetent: PresentationDetent = .medium
    @FocusState private var searchFocused: Bool

    private static let compactDashboardDetent = PresentationDetent.height(118)

    var body: some View {
        ZStack {
            MapLibreWorldMap(store: store)
                .ignoresSafeArea()
                .accessibilityIdentifier("world.map")

            VStack(spacing: 10) {
                if store.showsNavigationUI {
                    navigationBanner
                } else if let mode = store.selectionMode {
                    selectionBanner(mode)
                } else if case let .stale(message) = store.connection {
                    staleBanner(message)
                }
                Spacer()
            }
            .padding(.horizontal)
            .padding(.top, 8)

            VStack {
                Spacer()
                HStack {
                    if store.mapStyle == .satellite {
                        Link(destination: URL(string: "https://www.esri.com/en-us/arcgis/products/arcgis-living-atlas")!) {
                            Text("Esri World Imagery")
                                .font(.caption2.weight(.medium))
                        }
                        .padding(.horizontal, 9)
                        .padding(.vertical, 6)
                        .background(.regularMaterial, in: Capsule())
                        .accessibilityLabel("Satellite imagery by Esri World Imagery")
                    }
                    Spacer()
                    VStack(spacing: 8) {
                        Menu {
                            ForEach(WorldMapStore.MapStyle.allCases, id: \.self) { style in
                                Button {
                                    store.mapStyle = style
                                } label: {
                                    Label(style.label, systemImage: style == store.mapStyle ? "checkmark" : style.icon)
                                }
                            }
                        } label: {
                            Image(systemName: store.mapStyle.icon)
                                .font(.title3.weight(.semibold))
                        }
                        .buttonStyle(.borderedProminent)
                        .buttonBorderShape(.circle)
                        .controlSize(.large)
                        .accessibilityLabel("Map style, \(store.mapStyle.label)")
                        .accessibilityIdentifier("map.style")

                        Button { store.requestCurrentLocationAsOrigin() } label: {
                            Image(systemName: store.userCoordinate == nil ? "location" : "location.fill")
                                .font(.title3.weight(.semibold))
                        }
                        .buttonStyle(.borderedProminent)
                        .buttonBorderShape(.circle)
                        .controlSize(.large)
                        .accessibilityLabel("Use my location as start")
                        .accessibilityIdentifier("map.useCurrentLocation")
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 8)
        }
        .tint(.blue)
        .sheet(isPresented: $showingDashboard) { dashboardSheet }
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
        .onChange(of: store.query) { _, _ in store.queryDidChange() }
        .task(id: store.query) { await store.search() }
        .task {
            guard !requestedInitialLocation else { return }
            requestedInitialLocation = true
            guard ProcessInfo.processInfo.environment["AFTERMAP_AUTOMATIC_LOCATION"] != "0" else { return }
            store.requestCurrentLocationAsOrigin(userInitiated: false)
        }
    }

    private var searchPanel: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                TextField("Search Maps", text: $store.query)
                    .textInputAutocapitalization(.words)
                    .submitLabel(.search)
                    .focused($searchFocused)
                    .onSubmit {
                        Task {
                            if await store.submitSearch() {
                                searchFocused = false
                                withAnimation(.spring(response: 0.34, dampingFraction: 0.86)) {
                                    dashboardDetent = .medium
                                }
                            }
                        }
                    }
                    .accessibilityIdentifier("place.search")
                if store.isSearching {
                    ProgressView().controlSize(.small)
                } else if !store.query.isEmpty {
                    Button {
                        store.clearSearch()
                        searchFocused = true
                        dashboardDetent = .large
                    } label: { Image(systemName: "xmark.circle.fill") }
                        .foregroundStyle(.secondary)
                }
                Divider().frame(height: 22)
                Button { showingSettings = true } label: { Image(systemName: "slider.horizontal.3") }
                    .accessibilityLabel("Settings")
            }
            .padding(.horizontal, 14)
            .frame(height: 48)
            .background(Color(.secondarySystemBackground), in: Capsule())

            if let message = store.searchMessage, store.places.isEmpty {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 14)
                    .padding(.top, 8)
                    .accessibilityIdentifier("place.searchMessage")
            }

            if !store.places.isEmpty {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(store.places.prefix(6))) { place in
                            Button {
                                store.choosePlace(place)
                                searchFocused = false
                                dashboardDetent = .medium
                            } label: {
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
                            .accessibilityIdentifier("place.result.\(place.id)")
                            if place.id != store.places.prefix(6).last?.id { Divider().padding(.leading, 50) }
                        }
                    }
                }
                .frame(maxHeight: dashboardDetent == .large ? 520 : 220)
                .padding(.top, 8)
            }
        }
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

    private var navigationBanner: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: navigationManeuverIcon)
                    .font(.title2.weight(.bold))
                    .foregroundStyle(.white)
                    .frame(width: 42, height: 42)
                    .background(.blue, in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text(navigationHeadline)
                        .font(.headline)
                        .lineLimit(2)
                    if let progress = store.navigationState.progress {
                        Text(navigationDistanceText(progress.distanceToManeuver))
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                if store.followsNavigationCamera {
                    Button { store.recenterNavigation() } label: {
                        Image(systemName: "location.north.fill")
                    }
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.circle)
                    .accessibilityLabel("Recenter navigation")
                    .accessibilityIdentifier("navigation.recenter")
                    Button { store.stopNavigation() } label: {
                        Image(systemName: "xmark")
                    }
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.circle)
                    .tint(.red)
                    .accessibilityLabel("End navigation")
                    .accessibilityIdentifier("navigation.end")
                }
            }

            switch store.navigationState {
            case .idle:
                EmptyView()
            case .awaitingLocation:
                Label("Finding your live location…", systemImage: "location.circle")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            case let .navigating(progress):
                VStack(alignment: .leading, spacing: 5) {
                    if let next = progress.nextInstruction {
                        Text("Then: \(next)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Text(navigationRemainingText(progress))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            case let .rerouting(progress):
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Finding another route…")
                        .font(.caption)
                }
                if let progress {
                    Text(navigationRemainingText(progress))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            case let .blocked(reason):
                VStack(alignment: .leading, spacing: 8) {
                    Label(reason, systemImage: "exclamationmark.shield.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.red)
                    HStack {
                        Button("Retry Route") { store.retryNavigation() }
                            .buttonStyle(.borderedProminent)
                        Button("End") { store.stopNavigation(announce: false) }
                            .buttonStyle(.bordered)
                    }
                }
            case .arrived:
                Button("Done") { store.stopNavigation(announce: false) }
                    .buttonStyle(.borderedProminent)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
        .padding(14)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20))
        .shadow(color: .black.opacity(0.18), radius: 14, y: 6)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("navigation.banner")
    }

    private var navigationHeadline: String {
        switch store.navigationState {
        case .idle: "Navigation"
        case .awaitingLocation: "Starting navigation"
        case let .navigating(progress): progress.currentInstruction
        case .rerouting: "Rerouting safely"
        case .blocked: "Navigation paused"
        case .arrived: "You’ve arrived"
        }
    }

    private var navigationManeuverIcon: String {
        let instruction = store.navigationState.progress?.currentInstruction.lowercased() ?? ""
        if instruction.contains("arriv") { return "mappin.and.ellipse" }
        if instruction.contains("u-turn") { return "arrow.uturn.backward" }
        if instruction.contains("left") { return "arrow.turn.up.left" }
        if instruction.contains("right") { return "arrow.turn.up.right" }
        if case .rerouting = store.navigationState { return "arrow.triangle.2.circlepath" }
        if case .blocked = store.navigationState { return "exclamationmark.shield.fill" }
        return "arrow.up"
    }

    private func navigationDistanceText(_ meters: Double) -> String {
        Measurement(value: max(0, meters), unit: UnitLength.meters)
            .formatted(.measurement(width: .abbreviated, usage: .road))
    }

    private func navigationRemainingText(_ progress: NavigationProgress) -> String {
        let distance = navigationDistanceText(progress.remainingDistance)
        let duration = progress.remainingTime.map { Duration.seconds($0).formatted(.units(width: .abbreviated)) }
        return [distance, duration].compactMap { $0 }.joined(separator: " • ") + " remaining"
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

    private var dashboardSheet: some View {
        dashboardPanel
            .presentationDetents([Self.compactDashboardDetent, .medium, .large], selection: $dashboardDetent)
            .presentationDragIndicator(.hidden)
            .presentationBackground(.regularMaterial)
            .presentationCornerRadius(28)
            .presentationBackgroundInteraction(.enabled(upThrough: .medium))
            .presentationContentInteraction(.resizes)
            .interactiveDismissDisabled()
            .sheet(isPresented: $showingSettings) { SettingsSheet(store: store) }
            .sheet(isPresented: $showingDisasterHub) { DisasterHubSheet(store: store) }
            .sheet(isPresented: $showingIncident) { IncidentSheet(store: store, showingReport: $showingReport) }
            .sheet(isPresented: $showingReport) {
                ReportSheet(store: store) {
                    showingReport = false
                    store.beginReportLocationSelection()
                    dashboardDetent = Self.compactDashboardDetent
                }
            }
            .sheet(item: $endpointEditor) { endpoint in
                RouteEndpointSearchSheet(store: store, endpoint: endpoint)
            }
            .alert("Gaslight Maps", isPresented: Binding(
                get: { store.notice != nil },
                set: { if !$0 { store.notice = nil } }
            )) {
                Button("OK") { store.notice = nil }
            } message: {
                Text(store.notice ?? "")
            }
    }

    private var dashboardPanel: some View {
        VStack(spacing: 12) {
            Capsule()
                .fill(Color.secondary.opacity(0.42))
                .frame(width: 42, height: 5)
                .frame(maxWidth: .infinity, minHeight: 20)
                .contentShape(Rectangle())
                .accessibilityLabel("Resize map dashboard")
                .accessibilityAddTraits(.isButton)
                .accessibilityIdentifier("dashboard.handle")

            searchPanel

            if dashboardDetent != Self.compactDashboardDetent {
                if showingDirections {
                    routePlanner
                } else if let place = store.selectedPlace, !searchFocused {
                    selectedPlaceCard(place)
                } else if store.places.isEmpty && !searchFocused {
                    dashboardActions
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 18)
        .padding(.bottom, 12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .onChange(of: searchFocused) { _, focused in
            if focused {
                showingDirections = false
                withAnimation(.spring(response: 0.34, dampingFraction: 0.86)) {
                    dashboardDetent = .large
                }
            }
        }
    }

    private var dashboardActions: some View {
        VStack(spacing: 12) {
            HStack {
                Text("Report & Navigate")
                    .font(.title3.weight(.bold))
                Spacer()
                Label(connectionLabel, systemImage: connectionIcon)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(connectionColor)
            }

            HStack(alignment: .top, spacing: 4) {
                quickAction(
                    title: "Report",
                    subtitle: "Disaster",
                    icon: "exclamationmark.triangle.fill",
                    tint: .red,
                    accessibilityID: "disaster.report"
                ) { showingDisasterHub = true }

                quickAction(
                    title: "Start",
                    subtitle: originLabel,
                    icon: "location.fill",
                    tint: .blue,
                    accessibilityID: "route.origin"
                ) {
                    endpointEditor = .origin
                }

                quickAction(
                    title: "Destination",
                    subtitle: destinationLabel,
                    icon: "mappin.and.ellipse",
                    tint: .blue,
                    accessibilityID: "route.destination"
                ) {
                    endpointEditor = .destination
                }

                quickAction(
                    title: "Directions",
                    subtitle: routeActionSubtitle,
                    icon: "arrow.triangle.turn.up.right.diamond.fill",
                    tint: .green,
                    accessibilityID: "route.preview",
                    disabled: store.destination == nil
                ) {
                    showingDirections = true
                    dashboardDetent = .medium
                    if store.origin == nil { store.requestCurrentLocationAsOrigin() }
                }
            }

            routeStatus
        }
    }

    private func selectedPlaceCard(_ place: PlaceResult) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "mappin.circle.fill")
                    .font(.largeTitle)
                    .foregroundStyle(.red)
                VStack(alignment: .leading, spacing: 3) {
                    Text(place.name)
                        .font(.title2.weight(.bold))
                    if !place.detail.isEmpty {
                        Text(place.detail)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                Button {
                    store.clearSearch()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title2)
                        .foregroundStyle(.secondary)
                }
                .accessibilityLabel("Close place details")
            }

            Button {
                store.useSelectedPlaceAsDestination()
                showingDirections = true
                dashboardDetent = .medium
            } label: {
                Label("Directions", systemImage: "arrow.triangle.turn.up.right.diamond.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .accessibilityIdentifier("place.directions")

            HStack(spacing: 18) {
                Label(String(format: "%.4f", place.latitude), systemImage: "location.north.line")
                Label(String(format: "%.4f", place.longitude), systemImage: "location.east.line")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var routePlanner: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Button {
                    showingDirections = false
                } label: {
                    Image(systemName: "chevron.left")
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.circle)
                Text("Directions")
                    .font(.title2.weight(.bold))
                Spacer()
            }

            VStack(spacing: 8) {
                routeEndpointRow(
                    icon: "location.fill",
                    title: "Start",
                    subtitle: originLabel
                ) {
                    endpointEditor = .origin
                }
                routeEndpointRow(
                    icon: "mappin.and.ellipse",
                    title: "Destination",
                    subtitle: destinationLabel
                ) {
                    endpointEditor = .destination
                }
            }

            HStack(spacing: 8) {
                ForEach(RouteTravelMode.allCases, id: \.self) { mode in
                    Button {
                        store.travelMode = mode
                        if store.origin != nil, store.destination != nil {
                            Task { await store.previewRoute() }
                        }
                    } label: {
                        VStack(spacing: 4) {
                            Image(systemName: mode.icon)
                            Text(mode.shortLabel).font(.caption2.weight(.semibold))
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .tint(store.travelMode == mode ? .blue : .secondary)
                    .accessibilityIdentifier("route.mode.\(mode.rawValue)")
                }
            }

            Button {
                if store.origin == nil {
                    store.requestCurrentLocationAsOrigin()
                } else {
                    Task { await store.previewRoute() }
                }
            } label: {
                if store.routeState == .calculating {
                    ProgressView().frame(maxWidth: .infinity)
                } else {
                    Label(store.origin == nil ? "Use My Location" : "Directions", systemImage: "point.topleft.down.to.point.bottomright.curvepath")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(store.destination == nil || store.routeState == .calculating)
            .accessibilityIdentifier("route.calculate")

            if store.routeAlternatives.count > 1 {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Route options")
                        .font(.subheadline.weight(.semibold))
                    ForEach(Array(store.routeAlternatives.enumerated()), id: \.offset) { index, route in
                        Button {
                            store.selectRouteAlternative(route)
                        } label: {
                            HStack {
                                Image(systemName: "arrow.triangle.turn.up.right.diamond.fill")
                                Text(routeOptionTitle(route, index: index))
                                Spacer()
                                Image(systemName: selectedRoute == route ? "checkmark.circle.fill" : "circle")
                            }
                            .padding(.vertical, 5)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("route.alternative.\(index)")
                    }
                }
            }

            routeStatus
            navigationStartControl
        }
    }

    @ViewBuilder private var navigationStartControl: some View {
        if case let .route(response, _) = store.routeState, response.status == .complete {
            Button {
                if store.showsNavigationUI {
                    store.stopNavigation()
                } else if store.startNavigation() {
                    withAnimation(.spring(response: 0.34, dampingFraction: 0.86)) {
                        dashboardDetent = Self.compactDashboardDetent
                    }
                }
            } label: {
                Label(
                    store.showsNavigationUI
                        ? "End Navigation"
                        : (response.hasUnverifiedSegments ? "Verify Route to Navigate" : "Start Navigation"),
                    systemImage: store.showsNavigationUI
                        ? "xmark.circle.fill"
                        : (response.hasUnverifiedSegments ? "exclamationmark.shield.fill" : "location.north.circle.fill")
                )
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(store.showsNavigationUI ? .red : (response.hasUnverifiedSegments ? .orange : .green))
            .controlSize(.large)
            .disabled(!store.showsNavigationUI && !store.canStartNavigation)
            .accessibilityIdentifier(store.showsNavigationUI ? "navigation.end" : "navigation.start")
        }
    }

    private func routeEndpointRow(
        icon: String,
        title: String,
        subtitle: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .foregroundStyle(.blue)
                    .frame(width: 24)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.subheadline.weight(.semibold))
                    Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
            }
            .padding(10)
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }

    private var originLabel: String {
        if let place = store.originPlace { return place.name }
        if store.origin != nil { return "My Location" }
        return "Search for a starting place"
    }

    private var destinationLabel: String {
        if let place = store.destinationPlace { return place.name }
        if let destination = store.destination { return coordinateLabel(destination) }
        return "Search for a destination"
    }

    private func quickAction(
        title: String,
        subtitle: String,
        icon: String,
        tint: Color,
        accessibilityID: String,
        disabled: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        VStack(spacing: 5) {
            Button(action: action) {
                Image(systemName: icon)
                    .font(.title3.weight(.semibold))
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.circle)
            .controlSize(.large)
            .tint(tint)
            .disabled(disabled)
            .accessibilityIdentifier(accessibilityID)

            Text(title)
                .font(.caption.weight(.semibold))
                .lineLimit(1)
            Text(subtitle)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity)
    }

    private var routeActionSubtitle: String {
        switch store.routeState {
        case .calculating: "Checking"
        case .route: "Ready"
        case .unavailable: "Unavailable"
        case .idle: "Preview"
        }
    }

    private var connectionLabel: String {
        switch store.connection {
        case .loading: "Loading"
        case .live: store.incidents.isEmpty ? "Map live" : "\(store.incidents.count) active"
        case .stale: "Offline"
        }
    }

    private var connectionIcon: String {
        switch store.connection {
        case .loading: "arrow.triangle.2.circlepath"
        case .live: "checkmark.circle.fill"
        case .stale: "wifi.exclamationmark"
        }
    }

    private var connectionColor: Color {
        switch store.connection {
        case .loading: .secondary
        case .live: .green
        case .stale: .orange
        }
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
        case let .route(response, _):
            VStack(alignment: .leading, spacing: 3) {
                Label(
                    routeStatusTitle(response),
                    systemImage: response.status == .complete && !response.hasUnverifiedSegments
                        ? "checkmark.shield.fill"
                        : "exclamationmark.shield.fill"
                )
                    .font(.caption.weight(.bold))
                    .foregroundStyle(
                        response.status == .complete && !response.hasUnverifiedSegments
                            ? AftermapTheme.mint
                            : AftermapTheme.amber
                    )
                if response.hasUnverifiedSegments {
                    Text("Some streets on this route need current confirmation. Choose another route to begin navigation.")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(AftermapTheme.amber)
                }
                if response.status == .partial {
                    Text("A complete route is not available. Try another travel mode or destination.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityIdentifier("route.status")
        }
    }

    private func routeStatusTitle(_ response: IncidentRouteResponse) -> String {
        let distance = Measurement(value: response.distanceMeters, unit: UnitLength.meters)
        let formatted = distance.formatted(.measurement(width: .abbreviated, usage: .road))
        let duration = response.expectedTravelTime.map { Duration.seconds($0).formatted(.units(width: .abbreviated)) }
        let summary = [formatted, duration].compactMap { $0 }.joined(separator: " • ")
        if response.hasUnverifiedSegments {
            let count = response.unverifiedSegments?.count ?? 0
            return "Route needs verification • \(summary)"
        }
        return switch response.status {
        case .complete: "\(store.travelMode.shortLabel) • \(summary)"
        case .partial: "Route unavailable • \(summary)"
        case .unavailable: "No route available"
        }
    }

    private var selectedRoute: IncidentRouteResponse? {
        guard case let .route(response, _) = store.routeState else { return nil }
        return response
    }

    private func routeOptionTitle(_ route: IncidentRouteResponse, index: Int) -> String {
        let distance = Measurement(value: route.distanceMeters, unit: UnitLength.meters)
            .formatted(.measurement(width: .abbreviated, usage: .road))
        let duration = route.expectedTravelTime.map { Duration.seconds($0).formatted(.units(width: .abbreviated)) }
        return ["Route \(index + 1)", duration, distance].compactMap { $0 }.joined(separator: " • ")
    }

    private func coordinateLabel(_ value: IncidentCoordinate) -> String {
        String(format: "%.4f, %.4f", value.latitude, value.longitude)
    }
}

private struct RouteEndpointSearchSheet: View {
    @ObservedObject var store: WorldMapStore
    let endpoint: RouteEndpointEditor

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var results: [PlaceResult] = []
    @State private var isSearching = false
    @State private var message: String?
    @FocusState private var isFocused: Bool

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    TextField(endpoint.placeholder, text: $query)
                        .textInputAutocapitalization(.words)
                        .submitLabel(.search)
                        .focused($isFocused)
                        .onSubmit { Task { await search(immediate: true) } }
                        .accessibilityIdentifier("route.endpoint.search")
                    if isSearching {
                        ProgressView().controlSize(.small)
                    } else if !query.isEmpty {
                        Button {
                            query = ""
                            results = []
                            message = nil
                            isFocused = true
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                        }
                        .foregroundStyle(.secondary)
                        .accessibilityLabel("Clear endpoint search")
                    }
                }
                .padding(.horizontal, 14)
                .frame(height: 50)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
                .padding(.horizontal)
                .padding(.top, 8)

                List {
                    if endpoint == .origin {
                        Button {
                            store.requestCurrentLocationAsOrigin()
                            dismiss()
                        } label: {
                            Label("My Location", systemImage: "location.fill")
                        }
                        .accessibilityIdentifier("route.endpoint.myLocation")
                    }

                    ForEach(results) { place in
                        Button { choose(place) } label: {
                            HStack(spacing: 12) {
                                Image(systemName: "mappin.circle.fill")
                                    .font(.title3)
                                    .foregroundStyle(.blue)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(place.name).font(.body.weight(.semibold)).foregroundStyle(.primary)
                                    if !place.detail.isEmpty {
                                        Text(place.detail).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                    }
                                }
                            }
                        }
                        .accessibilityIdentifier("route.endpoint.result.\(place.id)")
                    }

                    if let message {
                        Text(message)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .accessibilityIdentifier("route.endpoint.message")
                    }
                }
                .listStyle(.plain)
            }
            .navigationTitle(endpoint.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .presentationDetents([.large])
        .onAppear {
            query = endpoint == .origin ? (store.originPlace?.name ?? "") : (store.destinationPlace?.name ?? "")
            isFocused = true
        }
        .task(id: query) {
            await search(immediate: false)
        }
    }

    @MainActor
    private func search(immediate: Bool) async {
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard term.count >= 2 else {
            results = []
            message = nil
            isSearching = false
            return
        }
        if !immediate {
            do { try await Task.sleep(for: .milliseconds(650)) }
            catch { return }
        }
        guard !Task.isCancelled, query.trimmingCharacters(in: .whitespacesAndNewlines) == term else { return }
        isSearching = true
        message = nil
        defer { isSearching = false }
        do {
            let found = try await store.endpointPlaces(query: term)
            guard !Task.isCancelled, query.trimmingCharacters(in: .whitespacesAndNewlines) == term else { return }
            results = found
            if found.isEmpty { message = "No matching places found. Try a complete street address, city, or landmark." }
        } catch is CancellationError {
            return
        } catch {
            results = []
            message = "Search is temporarily unavailable. Pause for a moment, then try again."
        }
    }

    private func choose(_ place: PlaceResult) {
        if endpoint == .origin {
            store.setOrigin(place: place)
        } else {
            store.setDestination(place: place)
        }
        dismiss()
    }
}

private struct DisasterHubSheet: View {
    @ObservedObject var store: WorldMapStore
    @Environment(\.dismiss) private var dismiss
    @State private var showingCreate = false

    var body: some View {
        NavigationStack {
            Group {
                if store.incidents.isEmpty {
                    ContentUnavailableView {
                        Label("No Active Disasters", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text("Mark an affected area to start collecting field evidence and aerial surveys.")
                    } actions: {
                        Button("Report an Incident", systemImage: "plus") { showingCreate = true }
                            .buttonStyle(.borderedProminent)
                            .accessibilityIdentifier("incident.create")
                    }
                } else {
                    List(store.incidents) { incident in
                        Button {
                            Task {
                                await store.loadIncident(incident)
                                dismiss()
                            }
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .font(.title3)
                                    .foregroundStyle(.red)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(incident.name)
                                        .foregroundStyle(.primary)
                                    Text("Open map and add field evidence")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.tertiary)
                            }
                        }
                        .accessibilityIdentifier("incident.open.\(incident.id)")
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Report Disaster")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button { showingCreate = true } label: { Image(systemName: "plus") }
                        .accessibilityLabel("Report a new incident")
                        .accessibilityIdentifier("incident.create")
                }
            }
        }
        .presentationDetents([.medium, .large])
        .sheet(isPresented: $showingCreate) {
            NewIncidentSheet(store: store) { incident in
                showingCreate = false
                Task {
                    await store.loadIncident(incident)
                    dismiss()
                }
            }
        }
    }
}

private struct NewIncidentSheet: View {
    @ObservedObject var store: WorldMapStore
    var onCreated: (Incident) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var locationQuery = ""
    @State private var results: [PlaceResult] = []
    @State private var widthKilometers = 1.0
    @State private var operatorKey = ""
    @State private var searching = false
    @State private var submitting = false
    @State private var error: String?
    @State private var created: IncidentCreationResponse?

    var body: some View {
        NavigationStack {
            Group {
                if let created {
                    creationConfirmation(created)
                } else {
                    creationForm
                }
            }
            .navigationTitle(created == nil ? "Report Incident" : "Incident Created")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button { dismiss() } label: { Image(systemName: "xmark") }
                        .accessibilityLabel("Cancel")
                }
                if created == nil {
                    ToolbarItem(placement: .confirmationAction) {
                        Button { Task { await submit() } } label: {
                            if submitting { ProgressView() } else { Image(systemName: "checkmark") }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(!canSubmit || submitting)
                        .accessibilityLabel("Create incident")
                        .accessibilityIdentifier("incident.create.submit")
                    }
                }
            }
        }
        .interactiveDismissDisabled(submitting)
        .onDisappear {
            if created == nil { store.incidentDraftCenter = nil }
        }
    }

    private var creationForm: some View {
        Form {
            Section("Incident") {
                TextField("e.g. Riverside flood", text: $name)
                    .textInputAutocapitalization(.words)
                    .accessibilityIdentifier("incident.create.name")
            }

            Section("Find the affected area") {
                HStack {
                    TextField("Address, city, or landmark", text: $locationQuery)
                        .submitLabel(.search)
                        .onSubmit { Task { await search() } }
                        .accessibilityIdentifier("incident.create.locationSearch")
                    if searching { ProgressView().controlSize(.small) }
                    Button { Task { await search() } } label: { Image(systemName: "magnifyingglass") }
                        .disabled(locationQuery.trimmingCharacters(in: .whitespacesAndNewlines).count < 2 || searching)
                        .accessibilityLabel("Search location")
                }
                ForEach(results.prefix(5)) { place in
                    Button {
                        choose(place.coordinate)
                        locationQuery = place.name
                        results = []
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(place.name).foregroundStyle(.primary)
                            Text(place.detail).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                Button { store.requestCurrentLocationForIncident() } label: {
                    Label("Use My Current Location", systemImage: "location.fill")
                }
                .accessibilityIdentifier("incident.create.currentLocation")
            }

            Section("Pin the center") {
                MapLibreWorldMap(store: store) { coordinate in
                    choose(IncidentCoordinate(coordinate))
                }
                .frame(height: 230)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .accessibilityLabel("Incident location map")
                .accessibilityIdentifier("incident.create.map")

                if let center = store.incidentDraftCenter {
                    Label(
                        String(format: "Selected %.5f, %.5f", center.latitude, center.longitude),
                        systemImage: "mappin.circle.fill"
                    )
                    .font(.caption)
                    .foregroundStyle(AftermapTheme.mint)
                } else {
                    Text("Search, use your location, or tap the map to place the incident center.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Picker("Affected area", selection: $widthKilometers) {
                    Text("500 m across").tag(0.5)
                    Text("1 km across").tag(1.0)
                    Text("2 km across").tag(2.0)
                    Text("4 km across").tag(4.0)
                }
            }

            Section("Workspace access") {
                SecureField("Operator key (if required)", text: $operatorKey)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Text("The server may require its workspace operator key before it creates an incident.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if let error {
                Section {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(AftermapTheme.red)
                        .accessibilityIdentifier("incident.create.error")
                }
            }
        }
    }

    private func creationConfirmation(_ response: IncidentCreationResponse) -> some View {
        VStack(spacing: 20) {
            Image(systemName: "checkmark.shield.fill")
                .font(.system(size: 52))
                .foregroundStyle(AftermapTheme.mint)
            Text(response.incident.name)
                .font(.title2.weight(.bold))
            Text("Save this incident access key. It is required to add reports, roads, or aerial surveys.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            Text(response.key)
                .font(.body.monospaced())
                .textSelection(.enabled)
                .padding()
                .frame(maxWidth: .infinity)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
            Button("Copy Access Key", systemImage: "doc.on.doc") {
                UIPasteboard.general.string = response.key
            }
            .buttonStyle(.bordered)
            Button("Open Incident", systemImage: "map.fill") {
                onCreated(response.incident)
            }
            .buttonStyle(.borderedProminent)
            .accessibilityIdentifier("incident.create.open")
        }
        .padding()
    }

    private var canSubmit: Bool {
        name.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2 && store.incidentDraftCenter != nil
    }

    private func choose(_ coordinate: IncidentCoordinate) {
        store.incidentDraftCenter = coordinate
        store.focus(on: coordinate, zoom: 15)
        error = nil
    }

    private func search() async {
        let term = locationQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard term.count >= 2 else { return }
        searching = true
        error = nil
        defer { searching = false }
        do {
            results = try await store.client.places(query: term)
            if results.isEmpty { error = "No matching places found. Try a nearby city or tap the map." }
        } catch is CancellationError {
            return
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func submit() async {
        guard let center = store.incidentDraftCenter else { return }
        submitting = true
        error = nil
        defer { submitting = false }
        if let response = await store.createIncident(
            name: name,
            center: center,
            widthKilometers: widthKilometers,
            operatorKey: operatorKey
        ) {
            created = response
        } else {
            error = store.notice
            store.notice = nil
        }
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
    @State private var showingSurveyImporter = false
    @State private var uploadingSurvey = false
    @State private var showingSurveyRemovalConfirmation = false
    @State private var removingSurvey = false
    @State private var importingRoads = false

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
                                Button(role: .destructive) {
                                    showingSurveyRemovalConfirmation = true
                                } label: {
                                    if removingSurvey {
                                        Label("Removing aerial survey…", systemImage: "trash")
                                    } else {
                                        Label("Remove aerial survey", systemImage: "trash")
                                    }
                                }
                                .disabled(removingSurvey || uploadingSurvey)
                                .accessibilityIdentifier("incident.removeSurvey")
                            } else {
                                Label("No aerial survey published", systemImage: "photo.badge.exclamationmark")
                                    .foregroundStyle(.secondary)
                            }
                            Button { showingSurveyImporter = true } label: {
                                if uploadingSurvey {
                                    Label("Publishing aerial survey…", systemImage: "arrow.up.circle")
                                } else {
                                    Label("Add georeferenced aerial survey", systemImage: "square.and.arrow.up")
                                }
                            }
                            .disabled(uploadingSurvey)
                            .accessibilityIdentifier("incident.addSurvey")
                            Button {
                                importingRoads = true
                                Task {
                                    _ = await store.importIncidentRoads()
                                    importingRoads = false
                                }
                            } label: {
                                if importingRoads {
                                    Label("Importing map roads…", systemImage: "arrow.triangle.2.circlepath")
                                } else {
                                    Label(detail.roadCount == 0 ? "Import map roads" : "Refresh map roads", systemImage: "road.lanes")
                                }
                            }
                            .disabled(importingRoads)
                            .accessibilityIdentifier("incident.importRoads")
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
        .fileImporter(
            isPresented: $showingSurveyImporter,
            allowedContentTypes: [.tiff],
            allowsMultipleSelection: true
        ) { result in
            guard case let .success(urls) = result else {
                if case let .failure(error) = result { store.notice = error.localizedDescription }
                return
            }
            uploadingSurvey = true
            Task {
                do {
                    let files = try await IncidentSurveyFileLoader.load(urls)
                    _ = await store.uploadGeoTIFFs(files)
                } catch {
                    store.notice = error.localizedDescription
                }
                uploadingSurvey = false
            }
        }
        .confirmationDialog(
            "Remove this aerial survey?",
            isPresented: $showingSurveyRemovalConfirmation,
            titleVisibility: .visible
        ) {
            Button("Remove Aerial Survey", role: .destructive) {
                removingSurvey = true
                Task {
                    _ = await store.removeIncidentImagery()
                    removingSurvey = false
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("The uploaded survey layer will be removed. Roads, labels, reports, and the base map will stay available.")
        }
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

private enum IncidentSurveyFileLoader {
    static func load(_ urls: [URL]) async throws -> [IncidentSurveyFile] {
        try await Task.detached(priority: .userInitiated) {
            guard !urls.isEmpty, urls.count <= 8 else {
                throw AftermapAPIError.backend("Choose one to eight georeferenced TIFF files.")
            }
            var total = 0
            var files: [IncidentSurveyFile] = []
            for url in urls {
                let ext = url.pathExtension.lowercased()
                guard ext == "tif" || ext == "tiff" else {
                    throw AftermapAPIError.backend("Choose georeferenced .tif or .tiff files.")
                }
                let accessing = url.startAccessingSecurityScopedResource()
                defer { if accessing { url.stopAccessingSecurityScopedResource() } }
                let data = try Data(contentsOf: url, options: .mappedIfSafe)
                total += data.count
                guard total <= 72 * 1024 * 1024 else {
                    throw AftermapAPIError.backend("Choose up to 72 MB of imagery.")
                }
                files.append(IncidentSurveyFile(name: url.lastPathComponent, data: data))
            }
            return files
        }.value
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
