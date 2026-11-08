import AVFoundation
import CoreLocation
import Foundation

@MainActor
final class WorldMapStore: ObservableObject {
    static let productionServerURL = "https://yourmapisgaslightingyou.us"

    enum MapStyle: String, CaseIterable {
        case satellite
        case streets

        var label: String {
            switch self {
            case .satellite: "Satellite"
            case .streets: "Streets"
            }
        }

        var icon: String {
            switch self {
            case .satellite: "globe.americas.fill"
            case .streets: "map.fill"
            }
        }
    }

    enum ConnectionState: Equatable {
        case loading
        case live
        case stale(String)
    }

    enum SelectionMode: Equatable {
        case origin
        case destination
        case reportLocation

        var instruction: String {
            switch self {
            case .origin: "Tap the map to choose your starting point"
            case .destination: "Tap the map to choose your destination"
            case .reportLocation: "Tap inside the incident to place your field report"
            }
        }
    }

    struct CameraTarget: Equatable {
        var coordinate: IncidentCoordinate
        var zoom: Double
        var revision: Int
    }

    @Published var serverURL: String
    @Published private(set) var incidents: [Incident] = []
    @Published private(set) var recoveryImagery: [IncidentImagery] = []
    @Published private(set) var selectedIncident: Incident?
    @Published private(set) var incidentDetail: IncidentDetail?
    @Published var selectedRoad: IncidentRoad?
    @Published var query = ""
    @Published private(set) var places: [PlaceResult] = []
    @Published private(set) var selectedPlace: PlaceResult?
    @Published private(set) var originPlace: PlaceResult?
    @Published private(set) var originUsesCurrentLocation = false
    @Published private(set) var destinationPlace: PlaceResult?
    @Published private(set) var isSearching = false
    @Published private(set) var searchMessage: String?
    @Published var origin: IncidentCoordinate?
    @Published var destination: IncidentCoordinate?
    @Published var travelMode: RouteTravelMode = .driving {
        didSet {
            if oldValue != travelMode, navigationState != .idle {
                stopNavigation(announce: false)
            }
            routeState = .idle
            routeAlternatives = []
        }
    }
    @Published var selectionMode: SelectionMode?
    @Published private(set) var routeState: RoutePreviewState = .idle
    @Published private(set) var routeAlternatives: [IncidentRouteResponse] = []
    @Published private(set) var connection: ConnectionState = .loading
    @Published private(set) var lastUpdated: Date?
    @Published var cameraTarget: CameraTarget?
    @Published var displayName: String
    @Published var reportKey = ""
    @Published var notice: String?
    @Published private(set) var userCoordinate: IncidentCoordinate?
    @Published private(set) var locationRequestRevision = 0
    @Published private(set) var navigationState: NavigationSessionState = .idle
    @Published private(set) var navigationHeading: CLLocationDirection?
    @Published private(set) var navigationCameraRevision = 0
    @Published private(set) var navigationCameraFollowing = true
    @Published private(set) var navigationRenderRevision = 0
    @Published private(set) var navigationRemainingCoordinates: [IncidentCoordinate] = []
    @Published private(set) var lastNavigationAnnouncement: String?
    @Published var reportLocation: IncidentCoordinate?
    @Published private(set) var reportLocationRevision = 0
    @Published var incidentDraftCenter: IncidentCoordinate?
    @Published var mapStyle: MapStyle {
        didSet { defaults.set(mapStyle.rawValue, forKey: "aftermap.mapStyle") }
    }
    @Published var showsIncidentSurveyImagery = true

    private let defaults: UserDefaults
    private let urlSession: URLSession
    private var cameraRevision = 0
    private var searchRevision = 0
    private enum PendingLocationUse {
        case origin(userInitiated: Bool)
        case report
        case incident
    }
    private var pendingLocationUse: PendingLocationUse?
    private var isIncidentPreviewMode = false
    private var lastUserLocation: CLLocation?
    private var navigationRoute: IncidentRouteResponse?
    private var navigationManeuvers: [RouteManeuver] = []
    private var navigationAllowedIncidentID: String?
    private var navigationIncidentVersions: [String: Int] = [:]
    private var navigationLastRenderedDistance = -Double.infinity
    private var navigationLastSpokenManeuver = -1
    private var navigationOffRouteUpdates = 0
    private var navigationLastRerouteAt: Date?
    @Published private(set) var navigationVoiceEnabled = true
    private let navigationVoice = AVSpeechSynthesizer()
    private lazy var navigationLocationDriver: NavigationLocationDriver = {
        let driver = NavigationLocationDriver()
        driver.onLocation = { [weak self] location in self?.acceptUserLocation(location) }
        driver.onHeading = { [weak self] heading in self?.acceptNavigationHeading(heading) }
        driver.onFailure = { [weak self] message in self?.navigationLocationFailed(message) }
        return driver
    }()

    init(defaults: UserDefaults = .standard, urlSession: URLSession = .shared) {
        self.defaults = defaults
        self.urlSession = urlSession
        mapStyle = MapStyle(rawValue: defaults.string(forKey: "aftermap.mapStyle") ?? "") ?? .satellite
        serverURL = Self.resolvedServerURL(defaults: defaults)
        displayName = defaults.string(forKey: "aftermap.displayName") ?? ""
#if DEBUG
        if let testServerURL = ProcessInfo.processInfo.environment["AFTERMAP_TEST_SERVER_URL"],
           !testServerURL.isEmpty {
            serverURL = testServerURL
        }
        if let testReportKey = ProcessInfo.processInfo.environment["AFTERMAP_TEST_REPORT_KEY"],
           !testReportKey.isEmpty {
            reportKey = testReportKey
        }
        let environment = ProcessInfo.processInfo.environment
        if let latitudeText = environment["AFTERMAP_FOCUS_LATITUDE"],
           let longitudeText = environment["AFTERMAP_FOCUS_LONGITUDE"],
           let zoomText = environment["AFTERMAP_FOCUS_ZOOM"],
           let latitude = Double(latitudeText),
           let longitude = Double(longitudeText),
           let zoom = Double(zoomText) {
            focus(on: IncidentCoordinate(latitude: latitude, longitude: longitude), zoom: zoom)
        }
        if ProcessInfo.processInfo.arguments.contains("-aftermapIncidentPreview") ||
            ProcessInfo.processInfo.environment["AFTERMAP_INCIDENT_PREVIEW"] == "1" {
            let bounds = IncidentBounds(west: -84.520, south: 39.094, east: -84.504, north: 39.108)
            let road = IncidentRoad(
                id: "preview-road",
                from: IncidentCoordinate(latitude: 39.099, longitude: -84.516),
                to: IncidentCoordinate(latitude: 39.104, longitude: -84.508),
                state: .unknown,
                label: "Preview Avenue"
            )
            let incident = Incident(
                id: "preview-incident",
                name: "Preview Incident",
                kind: .incident,
                bounds: bounds,
                imagery: nil,
                version: 1,
                roadCount: 1
            )
            incidents = [incident]
            selectedIncident = incident
            incidentDetail = IncidentDetail(
                id: incident.id,
                name: incident.name,
                kind: incident.kind,
                bounds: bounds,
                imagery: nil,
                version: 1,
                roadCount: 1,
                roads: [road],
                reports: []
            )
            displayName = "Preview Reporter"
            reportKey = "preview-key"
            connection = .live
            isIncidentPreviewMode = true
            focus(on: IncidentCoordinate(bounds.center), zoom: 15)
        }
        if ProcessInfo.processInfo.environment["AFTERMAP_NAVIGATION_PREVIEW"] == "1" {
            let start = IncidentCoordinate(latitude: 39.10310, longitude: -84.51200)
            let turn = IncidentCoordinate(latitude: 39.10420, longitude: -84.50980)
            let finish = IncidentCoordinate(latitude: 39.10610, longitude: -84.50720)
            let route = IncidentRouteResponse(
                status: .complete,
                coordinates: [start, turn, finish],
                distanceMeters: 420,
                reason: "Navigation preview route",
                startLabel: "Head northeast",
                endLabel: "Arrive at your destination",
                expectedTravelTime: 240,
                maneuvers: [
                    RouteManeuver(id: "preview-start", instruction: "Head northeast", coordinate: start, distanceFromStart: 0, distanceMeters: 180),
                    RouteManeuver(id: "preview-turn", instruction: "Turn right", coordinate: turn, distanceFromStart: 180, distanceMeters: 240),
                    RouteManeuver(id: "preview-arrive", instruction: "Arrive at your destination", coordinate: finish, distanceFromStart: 420, distanceMeters: 0),
                ]
            )
            origin = start
            destination = finish
            userCoordinate = start
            lastUserLocation = CLLocation(latitude: start.latitude, longitude: start.longitude)
            routeState = .route(route, affectedIncidentName: nil)
            routeAlternatives = [route]
            connection = .live
            isIncidentPreviewMode = true
            focus(on: start, zoom: 16)
        }
#endif
    }

    static func resolvedServerURL(defaults: UserDefaults) -> String {
        if let savedServer = defaults.string(forKey: "aftermap.serverURL") {
            let trimmed = savedServer.trimmingCharacters(in: .whitespacesAndNewlines)
            if let host = URL(string: trimmed)?.host?.lowercased(),
               !host.isEmpty,
               host != "localhost",
               host != "127.0.0.1",
               host != "::1",
               host != "aftermap-makeuc.vercel.app",
               !host.hasSuffix(".trycloudflare.com") {
                return trimmed
            }
        }
        defaults.set(productionServerURL, forKey: "aftermap.serverURL")
        return productionServerURL
    }

    var client: IncidentAPIClient { IncidentAPIClient(baseURL: serverURL, urlSession: urlSession) }

    func run() async {
        if isIncidentPreviewMode { return }
        await refreshIncidents()
        while !Task.isCancelled {
            do { try await Task.sleep(for: .seconds(15)) }
            catch { return }
            await refreshIncidents()
        }
    }

    func saveSettings() {
        serverURL = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
        displayName = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        defaults.set(serverURL, forKey: "aftermap.serverURL")
        defaults.set(displayName, forKey: "aftermap.displayName")
        Task { await refreshIncidents() }
    }

    func refreshIncidents() async {
        if isIncidentPreviewMode { return }
        do {
            // Training fixtures belong in rehearsals, not in the public navigation
            // experience. Never let a seeded exercise tint the live map or influence
            // a real trip.
            let world = try await client.world()
            let latest = world.incidents.filter(Self.isLiveIncident)
            incidents = latest
            recoveryImagery = (world.recoveryImagery ?? []).sorted { $0.timestamp < $1.timestamp }
            lastUpdated = Date()
            connection = .live

            if let selectedIncident {
                if let updated = latest.first(where: { $0.id == selectedIncident.id }) {
                    self.selectedIncident = updated
                    if incidentDetail?.version != updated.version { await loadIncident(updated) }
                } else {
                    self.selectedIncident = nil
                    incidentDetail = nil
                    selectedRoad = nil
                }
            }
            revalidateActiveNavigation()
        } catch {
            connection = .stale(error.localizedDescription)
        }
    }

    func search() async {
        _ = await search(selectFirstResult: false, debounce: true)
    }

    @discardableResult
    func submitSearch() async -> Bool {
        await search(selectFirstResult: true, debounce: false)
    }

    private func search(selectFirstResult: Bool, debounce: Bool) async -> Bool {
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard term.count >= 2 else {
            places = []
            isSearching = false
            searchMessage = nil
            return false
        }

        if let selectedPlace, selectedPlace.name == term {
            isSearching = false
            return true
        }

        searchRevision += 1
        let revision = searchRevision
        isSearching = true
        searchMessage = nil
        defer {
            if revision == searchRevision,
               query.trimmingCharacters(in: .whitespacesAndNewlines) == term {
                isSearching = false
            }
        }
        do {
            if debounce {
                // The public geocoder is rate limited. Wait for a real typing pause so
                // ordinary text entry produces one request instead of one per letter.
                try await Task.sleep(for: .milliseconds(850))
            }
            guard !Task.isCancelled, revision == searchRevision,
                  query.trimmingCharacters(in: .whitespacesAndNewlines) == term else { return false }

            let found: [PlaceResult]
#if DEBUG
            if ProcessInfo.processInfo.environment["AFTERMAP_SEARCH_PREVIEW"] == "1" {
                found = [PlaceResult(
                    id: "gandhinagar-preview",
                    name: "Gandhinagar",
                    detail: "Gujarat, India",
                    latitude: 23.2156,
                    longitude: 72.6369
                )]
            } else {
                found = try await fetchPlaces(term: term, revision: revision)
            }
#else
            found = try await fetchPlaces(term: term, revision: revision)
#endif

            guard revision == searchRevision,
                  query.trimmingCharacters(in: .whitespacesAndNewlines) == term else { return false }
            places = found

            if found.isEmpty {
                searchMessage = "No matching places found. Try a city, address, or landmark."
                return false
            }
            if selectFirstResult, let first = found.first {
                choosePlace(first)
            }
            return true
        } catch is CancellationError {
            return false
        } catch {
            guard !Task.isCancelled, revision == searchRevision else { return false }
            places = []
            searchMessage = isSearchThrottle(error)
                ? "Search is busy. Pause for a moment, then try again."
                : "Place search is temporarily unavailable. Try again shortly."
            return false
        }
    }

    private func fetchPlaces(term: String, revision: Int) async throws -> [PlaceResult] {
        do {
            return sortPlacesByDistance(try await client.places(query: term, near: searchReferenceCoordinate))
        } catch {
            if isSearchThrottle(error) {
                try await Task.sleep(for: .milliseconds(900))
                guard !Task.isCancelled, revision == searchRevision,
                      query.trimmingCharacters(in: .whitespacesAndNewlines) == term else {
                    throw CancellationError()
                }
                if let retried = try? await client.places(query: term, near: searchReferenceCoordinate) {
                    return sortPlacesByDistance(retried)
                }
            }
            throw error
        }
    }

    private var searchReferenceCoordinate: IncidentCoordinate? {
        userCoordinate ?? origin ?? cameraTarget?.coordinate
    }

    private func sortPlacesByDistance(_ values: [PlaceResult]) -> [PlaceResult] {
        guard let reference = searchReferenceCoordinate else { return values }
        let origin = CLLocation(latitude: reference.latitude, longitude: reference.longitude)
        return values.enumerated().sorted { lhs, rhs in
            let left = origin.distance(from: CLLocation(latitude: lhs.element.latitude, longitude: lhs.element.longitude))
            let right = origin.distance(from: CLLocation(latitude: rhs.element.latitude, longitude: rhs.element.longitude))
            if abs(left - right) < 1 { return lhs.offset < rhs.offset }
            return left < right
        }.map(\.element)
    }

    private func isSearchThrottle(_ error: Error) -> Bool {
        error.localizedDescription.localizedCaseInsensitiveContains("wait briefly before searching again")
    }

    func choosePlace(_ place: PlaceResult) {
        searchRevision += 1
        selectedPlace = place
        query = place.name
        places = []
        isSearching = false
        searchMessage = nil
        focus(on: place.coordinate, zoom: 14)
    }

    func queryDidChange() {
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if selectedPlace?.name != term { selectedPlace = nil }
    }

    func clearSearch() {
        searchRevision += 1
        query = ""
        places = []
        selectedPlace = nil
        isSearching = false
        searchMessage = nil
    }

    func useSelectedPlaceAsDestination() {
        guard let selectedPlace else { return }
        stopNavigation(announce: false)
        destination = selectedPlace.coordinate
        destinationPlace = selectedPlace
        routeState = .idle
        routeAlternatives = []
        calculateRouteWhenReady()
    }

    func setOrigin(place: PlaceResult) {
        stopNavigation(announce: false)
        origin = place.coordinate
        originPlace = place
        originUsesCurrentLocation = false
        routeState = .idle
        routeAlternatives = []
        focus(on: place.coordinate, zoom: 14)
        calculateRouteWhenReady()
    }

    func setDestination(place: PlaceResult) {
        stopNavigation(announce: false)
        destination = place.coordinate
        destinationPlace = place
        routeState = .idle
        routeAlternatives = []
        focus(on: place.coordinate, zoom: 14)
        calculateRouteWhenReady()
    }

    func endpointPlaces(query term: String) async throws -> [PlaceResult] {
#if DEBUG
        if ProcessInfo.processInfo.environment["AFTERMAP_SEARCH_PREVIEW"] == "1" {
            let isStart = term.localizedCaseInsensitiveContains("start")
            return [PlaceResult(
                id: isStart ? "start-preview" : "destination-preview",
                name: isStart ? "Cincinnati" : "Highland Coffee House",
                detail: isStart ? "Ohio, United States" : "Cincinnati, Ohio",
                latitude: isStart ? 39.1031 : 39.1325,
                longitude: isStart ? -84.5120 : -84.4969
            )]
        }
#endif
        do {
            return sortPlacesByDistance(try await client.places(query: term, near: searchReferenceCoordinate))
        } catch {
            if isSearchThrottle(error) {
                try await Task.sleep(for: .milliseconds(900))
                if let retried = try? await client.places(query: term, near: searchReferenceCoordinate) {
                    return sortPlacesByDistance(retried)
                }
            }
            throw error
        }
    }

    private static func isLiveIncident(_ incident: Incident) -> Bool {
        // A published survey history is operational evidence even if an older
        // incident name still contains rehearsal wording.
        if !incident.publishedSurveys.isEmpty, incident.surveys != nil { return true }
        let descriptor = [incident.name, incident.imagery?.source ?? ""]
            .joined(separator: " ")
            .lowercased()
        return !["demo", "exercise", "simulation", "simulated"].contains(where: descriptor.contains)
    }

    func chooseCoordinate(_ coordinate: CLLocationCoordinate2D) {
        let value = IncidentCoordinate(coordinate)
        var shouldCalculateRoute = false
        switch selectionMode {
        case .origin:
            stopNavigation(announce: false)
            origin = value
            originPlace = nil
            originUsesCurrentLocation = false
            shouldCalculateRoute = true
        case .destination:
            stopNavigation(announce: false)
            destination = value
            destinationPlace = nil
            shouldCalculateRoute = true
        case .reportLocation:
            guard let incident = selectedIncident, incident.coverageContains(coordinate) else {
                notice = "Choose a point inside the selected incident."
                return
            }
            selectedRoad = nil
            reportLocation = value
            reportLocationRevision += 1
            focus(on: value, zoom: 16)
        case nil:
            if let incident = incidents.first(where: { $0.coverageContains(coordinate) }) {
                Task { await loadIncident(incident) }
            }
        }
        selectionMode = nil
        routeState = .idle
        routeAlternatives = []
        if shouldCalculateRoute { calculateRouteWhenReady() }
    }

    func setSelectionMode(_ mode: SelectionMode) {
        selectionMode = mode
    }

    func selectRoad(_ road: IncidentRoad) {
        selectedRoad = road
        reportLocation = nil
    }

    func requestCurrentLocationAsOrigin(userInitiated: Bool = true) {
        pendingLocationUse = .origin(userInitiated: userInitiated)
        locationRequestRevision += 1
    }

    func beginReportLocationSelection() {
        selectedRoad = nil
        selectionMode = .reportLocation
    }

    func requestCurrentLocationForReport() {
        pendingLocationUse = .report
        locationRequestRevision += 1
    }

    func requestCurrentLocationForIncident() {
        pendingLocationUse = .incident
        locationRequestRevision += 1
    }

    func clearReportLocation() {
        reportLocation = nil
    }

    func acceptUserLocation(_ coordinate: CLLocationCoordinate2D) {
        acceptUserLocation(CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude))
    }

    func acceptUserLocation(_ location: CLLocation) {
        let coordinate = location.coordinate
        let value = IncidentCoordinate(coordinate)
        let previousLocation = lastUserLocation
        lastUserLocation = location
        userCoordinate = value
        if navigationState.keepsLocationTrackingActive,
           (previousLocation?.timestamp != location.timestamp || (previousLocation?.distance(from: location) ?? .infinity) > 0.5) {
            updateNavigationProgress(with: location)
        }
        switch pendingLocationUse {
        case .origin:
            origin = value
            originPlace = nil
            originUsesCurrentLocation = true
            routeState = .idle
            focus(on: value, zoom: 15)
            calculateRouteWhenReady()
        case .report:
            guard let incident = selectedIncident, incident.coverageContains(coordinate) else {
                pendingLocationUse = nil
                notice = "Your current location is outside the selected incident. Choose a point on the map instead."
                return
            }
            selectedRoad = nil
            reportLocation = value
            reportLocationRevision += 1
            focus(on: value, zoom: 16)
        case .incident:
            incidentDraftCenter = value
            focus(on: value, zoom: 15)
        case nil:
            return
        }
        pendingLocationUse = nil
    }

    private func calculateRouteWhenReady() {
        guard origin != nil, destination != nil else { return }
        Task { await previewRoute() }
    }

    func locationFailed(_ message: String) {
        guard let pending = pendingLocationUse else {
            if navigationState == .awaitingLocation { navigationLocationFailed(message) }
            return
        }
        pendingLocationUse = nil
        if case .origin(userInitiated: false) = pending { return }
        notice = message
    }

    func loadIncident(_ incident: Incident) async {
        selectedIncident = incident
        selectedRoad = nil
        reportLocation = nil
        focus(on: IncidentCoordinate(incident.mapBoundaryBounds.center), zoom: 13)
        do {
            incidentDetail = try await client.incident(id: incident.id)
        } catch {
            incidentDetail = nil
            notice = error.localizedDescription
        }
    }

    func clearIncidentSelection() {
        selectedIncident = nil
        incidentDetail = nil
        selectedRoad = nil
        reportLocation = nil
    }

    func previewRoute() async {
        guard let origin, let destination else {
            notice = "Choose both a starting point and destination first."
            return
        }

        routeState = .calculating
        routeAlternatives = []
        let endpointIncident = incidents.first(where: {
            $0.coverageContains(origin.coordinate) || $0.coverageContains(destination.coordinate)
        })

        do {
            if let incident = endpointIncident {
                guard travelMode == .walking else {
                    routeState = .unavailable("Only verified walking passages are available inside \(incident.name). Switch to Walk.")
                    return
                }
                let response = try await client.route(
                    incidentId: incident.id,
                    origin: origin,
                    destination: destination,
                    mode: travelMode
                )
                if response.status == .unavailable {
                    routeState = .unavailable(response.reason)
                } else if let other = incidents.first(where: {
                    $0.id != incident.id && $0.coverageIntersects(response.coordinates)
                }) {
                    routeState = .unavailable(
                        "The verified route for \(incident.name) also enters \(other.name), so Gaslight Maps withheld it pending cross-incident verification."
                    )
                } else {
                    routeAlternatives = [response]
                    routeState = .route(response, affectedIncidentName: incident.name)
                }
                return
            }

            if travelMode != .cycling {
                let candidates = try await AppleDirectionsService().routes(
                    origin: origin,
                    destination: destination,
                    mode: travelMode
                )
                let safeRoutes = candidates.filter { route in
                    !incidents.contains(where: { $0.coverageIntersects(route.coordinates) })
                }
                guard let first = safeRoutes.first else {
                    routeState = .unavailable(
                        candidates.isEmpty
                            ? "No \(travelMode.shortLabel.lowercased()) route is available for this trip."
                            : "Every available \(travelMode.shortLabel.lowercased()) route enters an affected area, so Gaslight Maps withheld them."
                    )
                    return
                }
                routeAlternatives = safeRoutes
                routeState = .route(first, affectedIncidentName: nil)
                return
            }

            let ordinary = try await client.ordinaryRoute(
                origin: origin,
                destination: destination,
                mode: travelMode
            )
            if let affected = incidents.first(where: { $0.coverageIntersects(ordinary.coordinates) }) {
                routeState = .unavailable(
                    "The proposed route enters \(affected.name), so Gaslight Maps withheld it pending incident-road verification."
                )
            } else {
                if ordinary.status != .unavailable { routeAlternatives = [ordinary] }
                routeState = ordinary.status == .unavailable
                    ? .unavailable(ordinary.reason)
                    : .route(ordinary, affectedIncidentName: nil)
            }
        } catch {
            routeState = .unavailable(error.localizedDescription)
        }
    }

    func selectRouteAlternative(_ route: IncidentRouteResponse) {
        guard routeAlternatives.contains(route),
              !incidents.contains(where: { $0.coverageIntersects(route.coordinates) }) else {
            routeState = .unavailable("That route can no longer be verified against the current incident map.")
            return
        }
        routeState = .route(route, affectedIncidentName: nil)
    }

    var showsNavigationUI: Bool {
        navigationState != .idle
    }

    var showsSurveyImageryOnMap: Bool {
        showsIncidentSurveyImagery
    }

    var followsNavigationCamera: Bool {
        navigationState.keepsLocationTrackingActive && navigationCameraFollowing
    }

    var canStartNavigation: Bool {
        guard case let .route(route, _) = routeState else { return false }
        return route.status == .complete
            && route.coordinates.count > 1
            && destination != nil
            && !route.hasUnverifiedSegments
    }

    var requiresRoutePreview: Bool {
        guard let origin, !originUsesCurrentLocation else { return false }
        guard let lastUserLocation else { return true }
        let selectedStart = CLLocation(latitude: origin.latitude, longitude: origin.longitude)
        return lastUserLocation.distance(from: selectedStart) > 250
    }

    func showRoutePreview(_ route: IncidentRouteResponse) {
        selectRouteAlternative(route)
        notice = nil
        guard !route.coordinates.isEmpty else { return }
        let latitudes = route.coordinates.map(\.latitude)
        let longitudes = route.coordinates.map(\.longitude)
        guard let south = latitudes.min(), let north = latitudes.max(),
              let west = longitudes.min(), let east = longitudes.max() else { return }
        let center = IncidentCoordinate(latitude: (south + north) / 2, longitude: (west + east) / 2)
        let longitudeScale = max(0.2, cos(center.latitude * .pi / 180))
        let span = max(north - south, (east - west) * longitudeScale, 0.000_01)
        let zoom = min(16, max(7, log2(360 / span) - 1.4))
        focus(on: center, zoom: zoom)
    }

    @discardableResult
    func startNavigation(enableLiveTracking: Bool = true) -> Bool {
        guard case let .route(route, affectedIncidentName) = routeState,
              route.status == .complete,
              route.coordinates.count > 1,
              destination != nil,
              !route.hasUnverifiedSegments else {
            if case let .route(route, _) = routeState, route.hasUnverifiedSegments {
                notice = "This route includes unverified street segments. Confirm current passage evidence or choose a fully verified route before starting live navigation."
                return false
            }
            notice = "Choose a complete route before starting navigation."
            return false
        }

        if !originUsesCurrentLocation {
            guard let origin, let lastUserLocation else {
                notice = "Route preview is ready. To begin live guidance from this selected start, move to the start or choose My Location."
                return false
            }
            let selectedStart = CLLocation(latitude: origin.latitude, longitude: origin.longitude)
            guard lastUserLocation.distance(from: selectedStart) <= 250 else {
                let name = originPlace?.name ?? "the selected start"
                notice = "Showing the route from \(name). You’re not near that start, so live guidance has not begun. Choose My Location to navigate from where you are."
                return false
            }
        }

        var shouldTrackLiveLocation = enableLiveTracking
#if DEBUG
        if ProcessInfo.processInfo.environment["AFTERMAP_NAVIGATION_PREVIEW"] == "1" {
            shouldTrackLiveLocation = false
        }
#endif
        navigationVoiceEnabled = shouldTrackLiveLocation
        navigationCameraFollowing = true
        prepareNavigation(route, affectedIncidentName: affectedIncidentName)
        navigationState = .awaitingLocation
        navigationCameraRevision += 1
        locationRequestRevision += 1
        if shouldTrackLiveLocation { navigationLocationDriver.start() }
        speak("Starting navigation")
        if let lastUserLocation { updateNavigationProgress(with: lastUserLocation) }
        return true
    }

    func stopNavigation(announce: Bool = true) {
        guard navigationState != .idle else { return }
        navigationLocationDriver.stop()
        navigationVoice.stopSpeaking(at: .immediate)
        navigationState = .idle
        navigationRoute = nil
        navigationManeuvers = []
        navigationRemainingCoordinates = []
        navigationAllowedIncidentID = nil
        navigationIncidentVersions = [:]
        navigationOffRouteUpdates = 0
        navigationHeading = nil
        navigationCameraFollowing = true
        navigationCameraRevision += 1
        navigationRenderRevision += 1
        if announce { speak("Navigation ended") }
    }

    func toggleNavigationVoice() {
        navigationVoiceEnabled.toggle()
        if navigationVoiceEnabled {
            if let progress = navigationState.progress {
                speak(progress.currentInstruction)
            }
        } else {
            navigationVoice.stopSpeaking(at: .immediate)
        }
    }

    func retryNavigation() {
        guard case .blocked = navigationState, let location = lastUserLocation, destination != nil else { return }
        navigationState = .rerouting(nil)
        navigationCameraFollowing = true
        navigationLocationDriver.start()
        navigationCameraRevision += 1
        Task { await rerouteFromCurrentLocation(location) }
    }

    func recenterNavigation() {
        guard navigationState.keepsLocationTrackingActive else { return }
        navigationCameraFollowing = true
        navigationCameraRevision += 1
    }

    func suspendNavigationCameraFollowing() {
        guard navigationState.keepsLocationTrackingActive, navigationCameraFollowing else { return }
        navigationCameraFollowing = false
    }

    private func prepareNavigation(_ route: IncidentRouteResponse, affectedIncidentName: String?) {
        navigationRoute = route
        navigationManeuvers = NavigationGuidance.maneuvers(for: route, mode: travelMode)
        navigationRemainingCoordinates = route.coordinates
        navigationAllowedIncidentID = affectedIncidentName.flatMap { name in
            incidents.first(where: { $0.name == name })?.id
        }
        navigationIncidentVersions = Dictionary(uniqueKeysWithValues: incidents.map { ($0.id, $0.version) })
        navigationLastRenderedDistance = -Double.infinity
        navigationLastSpokenManeuver = -1
        navigationOffRouteUpdates = 0
        navigationRenderRevision += 1
    }

    private func updateNavigationProgress(with location: CLLocation) {
        guard let route = navigationRoute,
              let projection = NavigationGeometry.project(location.coordinate, onto: route.coordinates) else {
            navigationLocationFailed("The active route can no longer be followed.")
            return
        }

        let destinationDistance = destination.map {
            location.distance(from: CLLocation(latitude: $0.latitude, longitude: $0.longitude))
        } ?? .infinity
        let fraction = min(1, max(0, projection.distanceAlongRoute / max(projection.totalRouteDistance, 1)))
        let reportedDistanceAlongRoute = route.distanceMeters * fraction
        let remainingDistance = max(0, route.distanceMeters - reportedDistanceAlongRoute)
        let offRouteThreshold: CLLocationDistance = switch travelMode {
        case .walking: 25
        case .cycling: 35
        case .driving: 45
        case .transit: 60
        }

        if destinationDistance <= 25 || (remainingDistance <= 15 && projection.distanceFromRoute <= offRouteThreshold) {
            navigationState = .arrived
            navigationRemainingCoordinates = []
            navigationLocationDriver.stop()
            navigationCameraRevision += 1
            navigationRenderRevision += 1
            speak("You have arrived at your destination")
            return
        }

        if abs(reportedDistanceAlongRoute - navigationLastRenderedDistance) >= 12 || navigationRemainingCoordinates.isEmpty {
            navigationRemainingCoordinates = projection.remainingCoordinates
            navigationLastRenderedDistance = reportedDistanceAlongRoute
            navigationRenderRevision += 1
        }

        let maneuverIndex = NavigationGuidance.currentManeuverIndex(
            in: navigationManeuvers,
            distanceAlongRoute: reportedDistanceAlongRoute
        )
        let maneuver = navigationManeuvers[min(maneuverIndex, max(0, navigationManeuvers.count - 1))]
        let nextInstruction = navigationManeuvers.indices.contains(maneuverIndex + 1)
            ? navigationManeuvers[maneuverIndex + 1].instruction
            : nil
        let distanceToManeuver = max(0, maneuver.distanceFromStart - reportedDistanceAlongRoute)
        let remainingTime = route.expectedTravelTime.map { max(0, $0 * (1 - fraction)) }
        let progress = NavigationProgress(
            currentInstruction: maneuver.instruction,
            nextInstruction: nextInstruction,
            distanceToManeuver: distanceToManeuver,
            remainingDistance: remainingDistance,
            remainingTime: remainingTime,
            fractionComplete: fraction,
            distanceFromRoute: projection.distanceFromRoute,
            maneuverIndex: maneuverIndex
        )

        navigationOffRouteUpdates = projection.distanceFromRoute > offRouteThreshold
            ? navigationOffRouteUpdates + 1
            : 0

        navigationState = .navigating(progress)
        navigationCameraRevision += 1
        announceManeuverIfNeeded(progress)

        if navigationOffRouteUpdates >= 3 {
            triggerReroute(from: location, progress: progress)
        }
    }

    private func announceManeuverIfNeeded(_ progress: NavigationProgress) {
        guard progress.maneuverIndex != navigationLastSpokenManeuver else { return }
        navigationLastSpokenManeuver = progress.maneuverIndex
        let prefix = progress.distanceToManeuver > 20
            ? "In \(NavigationGuidance.spokenDistance(progress.distanceToManeuver)), "
            : ""
        speak(prefix + progress.currentInstruction)
    }

    private func triggerReroute(from location: CLLocation, progress: NavigationProgress?) {
        if case .rerouting = navigationState { return }
        guard Date().timeIntervalSince(navigationLastRerouteAt ?? .distantPast) >= 8 else { return }
        navigationLastRerouteAt = Date()
        navigationState = .rerouting(progress)
        navigationOffRouteUpdates = 0
        speak("Rerouting around affected areas")
        Task { await rerouteFromCurrentLocation(location) }
    }

    private func rerouteFromCurrentLocation(_ location: CLLocation) async {
        origin = IncidentCoordinate(location.coordinate)
        originPlace = nil
        originUsesCurrentLocation = true
        await previewRoute()
        guard case let .route(route, affectedIncidentName) = routeState,
              route.status == .complete,
              route.coordinates.count > 1 else {
            let reason: String
            if case let .unavailable(message) = routeState {
                reason = message
            } else {
                reason = "No route is currently available."
            }
            navigationState = .blocked(reason)
            navigationLocationDriver.stop()
            navigationCameraRevision += 1
            speak("Navigation paused. \(reason)")
            return
        }
        prepareNavigation(route, affectedIncidentName: affectedIncidentName)
        navigationState = .awaitingLocation
        speak("Route updated")
        updateNavigationProgress(with: location)
    }

    private func revalidateActiveNavigation() {
        guard navigationState.keepsLocationTrackingActive,
              case .navigating = navigationState,
              let location = lastUserLocation,
              !navigationRemainingCoordinates.isEmpty else { return }
        let changedConflict = incidents.first { incident in
            guard incident.coverageIntersects(navigationRemainingCoordinates) else { return false }
            if incident.id != navigationAllowedIncidentID { return true }
            return navigationIncidentVersions[incident.id] != incident.version
        }
        guard changedConflict != nil else { return }
        triggerReroute(from: location, progress: navigationState.progress)
    }

    private func acceptNavigationHeading(_ heading: CLLocationDirection) {
        guard followsNavigationCamera else { return }
        navigationHeading = heading
        navigationCameraRevision += 1
    }

    private func navigationLocationFailed(_ message: String) {
        guard navigationState.keepsLocationTrackingActive else { return }
        navigationLocationDriver.stop()
        navigationState = .blocked(message)
        navigationCameraRevision += 1
        notice = message
        speak("Navigation paused. \(message)")
    }

    private func speak(_ text: String) {
        guard !text.isEmpty else { return }
        lastNavigationAnnouncement = text
        guard navigationVoiceEnabled else { return }
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .voicePrompt, options: [.duckOthers])
        try? AVAudioSession.sharedInstance().setActive(true, options: .notifyOthersOnDeactivation)
        navigationVoice.stopSpeaking(at: .immediate)
        let utterance = AVSpeechUtterance(string: text)
        utterance.rate = 0.49
        utterance.voice = AVSpeechSynthesisVoice(language: Locale.current.language.languageCode?.identifier ?? "en-US")
        navigationVoice.speak(utterance)
    }

#if DEBUG
    func installRouteForTesting(_ route: IncidentRouteResponse, affectedIncidentName: String? = nil) {
        routeState = .route(route, affectedIncidentName: affectedIncidentName)
        routeAlternatives = [route]
    }
#endif

    func createIncident(name: String, center: IncidentCoordinate, widthKilometers: Double, operatorKey: String) async -> IncidentCreationResponse? {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmedName.count >= 2 else {
            notice = "Enter a name for the incident."
            return nil
        }
        guard let bounds = IncidentBounds.square(center: center, widthKilometers: widthKilometers) else {
            notice = "Choose an incident area under 10 km across and away from the map edge."
            return nil
        }
        do {
            let response = try await client.createIncident(
                name: trimmedName,
                bounds: bounds,
                operatorKey: operatorKey.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            reportKey = response.key
            incidents.removeAll { $0.id == response.incident.id }
            incidents.insert(response.incident, at: 0)
            incidentDraftCenter = nil
            return response
        } catch {
            notice = error.localizedDescription
            return nil
        }
    }

    func submitReport(condition: IncidentRoad.State?, note: String, photoJPEG: Data?) async -> Bool {
        guard let incident = selectedIncident else {
            notice = "Select an incident before submitting evidence."
            return false
        }
        let road = selectedRoad
        let location = road == nil ? reportLocation : nil
        guard road != nil || location != nil else {
            notice = "Select a road, choose a point on the map, or use your current location."
            return false
        }
        if road != nil, condition == nil {
            notice = "Choose the observed road condition."
            return false
        }
        guard !reportKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            notice = "Enter the incident report key in Settings first."
            return false
        }
        guard !displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            notice = "Enter your display name in Settings first."
            return false
        }

        let request = IncidentReportRequest(
            id: UUID().uuidString.lowercased(),
            displayName: displayName,
            edgeId: road?.id,
            condition: condition,
            note: note.trimmingCharacters(in: .whitespacesAndNewlines),
            evidenceType: photoJPEG == nil ? (note.isEmpty ? "manual" : "text") : "image",
            location: location,
            photoBase64: photoJPEG?.base64EncodedString(),
            confirmed: true
        )
#if DEBUG
        if isIncidentPreviewMode, var detail = incidentDetail {
            let timestamp = ISO8601DateFormatter().string(from: Date())
            if let road, let condition, let index = detail.roads.firstIndex(where: { $0.id == road.id }) {
                detail.roads[index].state = condition
            }
            detail.reports.insert(IncidentReport(
                id: request.id,
                edgeId: road?.id,
                displayName: displayName,
                condition: condition,
                note: request.note,
                at: timestamp,
                evidenceType: request.evidenceType,
                location: location,
                evidenceUrl: photoJPEG == nil ? nil : "preview://evidence/\(request.id)"
            ), at: 0)
            detail.version += 1
            incidentDetail = detail
            if let road { selectedRoad = detail.roads.first(where: { $0.id == road.id }) }
            reportLocation = nil
            notice = road.map { "Evidence added to \($0.label)." } ?? "Field report added to \(incident.name)."
            return true
        }
#endif
        do {
            try await client.submitReport(incidentId: incident.id, key: reportKey, request: request)
            incidentDetail = try await client.incident(id: incident.id)
            if let road { selectedRoad = incidentDetail?.roads.first(where: { $0.id == road.id }) }
            reportLocation = nil
            notice = road.map { "Evidence added to \($0.label)." } ?? "Field report added to \(incident.name)."
            await refreshIncidents()
            return true
        } catch {
            notice = error.localizedDescription
            return false
        }
    }

    func uploadGeoTIFFs(_ files: [IncidentSurveyFile]) async -> Bool {
        guard let incident = selectedIncident else {
            notice = "Select an incident before adding aerial imagery."
            return false
        }
        guard !reportKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            notice = "Enter the incident access key in Settings first."
            return false
        }
        guard !files.isEmpty, files.count <= 8 else {
            notice = "Choose one to eight georeferenced TIFF files."
            return false
        }
        guard files.reduce(0, { $0 + $1.data.count }) <= 72 * 1024 * 1024 else {
            notice = "Choose up to 72 MB of imagery."
            return false
        }
        do {
            let detail = try await client.uploadGeoTIFFs(incidentId: incident.id, key: reportKey, files: files)
            incidentDetail = detail
            let summary = Incident(
                id: detail.id,
                name: detail.name,
                kind: detail.kind,
                bounds: detail.bounds,
                imagery: detail.imagery,
                surveys: detail.surveys,
                version: detail.version,
                roadCount: detail.roadCount
            )
            selectedIncident = summary
            incidents.removeAll { $0.id == summary.id }
            incidents.insert(summary, at: 0)
            notice = "Aerial survey published and aligned to the map."
            return true
        } catch {
            notice = error.localizedDescription
            return false
        }
    }

    func removeIncidentImagery() async -> Bool {
        guard let incident = selectedIncident else {
            notice = "Select an incident before removing aerial imagery."
            return false
        }
        guard incidentDetail?.imagery != nil else {
            notice = "This incident has no published aerial survey."
            return false
        }
        guard !reportKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            notice = "Enter the incident access key in Settings first."
            return false
        }
        do {
            let detail = try await client.removeImagery(incidentId: incident.id, key: reportKey)
            incidentDetail = detail
            let summary = Incident(
                id: detail.id,
                name: detail.name,
                kind: detail.kind,
                bounds: detail.bounds,
                imagery: detail.imagery,
                surveys: detail.surveys,
                version: detail.version,
                roadCount: detail.roadCount
            )
            selectedIncident = summary
            incidents.removeAll { $0.id == summary.id }
            incidents.insert(summary, at: 0)
            notice = "Aerial survey removed. The labeled base map remains available."
            return true
        } catch {
            notice = error.localizedDescription
            return false
        }
    }

    func importIncidentRoads() async -> Bool {
        guard let incident = selectedIncident else {
            notice = "Select an incident before importing roads."
            return false
        }
        guard !reportKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            notice = "Enter the incident access key in Settings first."
            return false
        }
        do {
            let detail = try await client.importRoads(incidentId: incident.id, key: reportKey)
            incidentDetail = detail
            let summary = Incident(
                id: detail.id,
                name: detail.name,
                kind: detail.kind,
                bounds: detail.bounds,
                imagery: detail.imagery,
                surveys: detail.surveys,
                version: detail.version,
                roadCount: detail.roadCount
            )
            selectedIncident = summary
            incidents.removeAll { $0.id == summary.id }
            incidents.insert(summary, at: 0)
            notice = detail.roadCount == 0
                ? "No mapped roads were found inside this incident."
                : "Imported \(detail.roadCount) road segments."
            return true
        } catch {
            notice = error.localizedDescription
            return false
        }
    }

    func focus(on coordinate: IncidentCoordinate, zoom: Double) {
        cameraRevision += 1
        cameraTarget = CameraTarget(coordinate: coordinate, zoom: zoom, revision: cameraRevision)
    }
}

struct NavigationRouteProjection: Equatable {
    var segmentIndex: Int
    var fractionOnSegment: Double
    var projectedCoordinate: IncidentCoordinate
    var distanceFromRoute: CLLocationDistance
    var distanceAlongRoute: CLLocationDistance
    var totalRouteDistance: CLLocationDistance
    var remainingCoordinates: [IncidentCoordinate]
}

enum NavigationGeometry {
    static func project(
        _ location: CLLocationCoordinate2D,
        onto route: [IncidentCoordinate]
    ) -> NavigationRouteProjection? {
        guard route.count > 1 else { return nil }
        let latitudeScale = 111_132.0
        let longitudeScale = max(1, 111_320.0 * cos(location.latitude * .pi / 180))
        var cumulativeDistance = 0.0
        var best: NavigationRouteProjection?

        for index in 0..<(route.count - 1) {
            let start = route[index]
            let end = route[index + 1]
            let longitudeSpan = normalizedLongitude(end.longitude - start.longitude)
            let ax = normalizedLongitude(start.longitude - location.longitude) * longitudeScale
            let ay = (start.latitude - location.latitude) * latitudeScale
            let dx = longitudeSpan * longitudeScale
            let dy = (end.latitude - start.latitude) * latitudeScale
            let denominator = dx * dx + dy * dy
            let fraction = denominator > 0
                ? min(1, max(0, -(ax * dx + ay * dy) / denominator))
                : 0
            let closestX = ax + fraction * dx
            let closestY = ay + fraction * dy
            let distanceFromRoute = hypot(closestX, closestY)
            let startLocation = CLLocation(latitude: start.latitude, longitude: start.longitude)
            let endLocation = CLLocation(latitude: end.latitude, longitude: end.longitude)
            let segmentDistance = startLocation.distance(from: endLocation)
            let projected = IncidentCoordinate(
                latitude: start.latitude + fraction * (end.latitude - start.latitude),
                longitude: wrappedLongitude(start.longitude + fraction * longitudeSpan)
            )
            var remaining = [projected]
            remaining.append(contentsOf: route[(index + 1)...])
            let candidate = NavigationRouteProjection(
                segmentIndex: index,
                fractionOnSegment: fraction,
                projectedCoordinate: projected,
                distanceFromRoute: distanceFromRoute,
                distanceAlongRoute: cumulativeDistance + fraction * segmentDistance,
                totalRouteDistance: 0,
                remainingCoordinates: remaining
            )
            if best == nil || distanceFromRoute < best!.distanceFromRoute { best = candidate }
            cumulativeDistance += segmentDistance
        }

        guard var best else { return nil }
        best.totalRouteDistance = cumulativeDistance
        return best
    }

    static func routeDistance(_ route: [IncidentCoordinate]) -> CLLocationDistance {
        zip(route, route.dropFirst()).reduce(0) { total, pair in
            total + CLLocation(latitude: pair.0.latitude, longitude: pair.0.longitude)
                .distance(from: CLLocation(latitude: pair.1.latitude, longitude: pair.1.longitude))
        }
    }

    static func bearing(from start: IncidentCoordinate, to end: IncidentCoordinate) -> Double {
        let startLatitude = start.latitude * .pi / 180
        let endLatitude = end.latitude * .pi / 180
        let longitudeDelta = normalizedLongitude(end.longitude - start.longitude) * .pi / 180
        let y = sin(longitudeDelta) * cos(endLatitude)
        let x = cos(startLatitude) * sin(endLatitude) - sin(startLatitude) * cos(endLatitude) * cos(longitudeDelta)
        return wrappedBearing(atan2(y, x) * 180 / .pi)
    }

    static func signedTurn(from first: IncidentCoordinate, via middle: IncidentCoordinate, to last: IncidentCoordinate) -> Double {
        let incoming = bearing(from: first, to: middle)
        let outgoing = bearing(from: middle, to: last)
        var delta = outgoing - incoming
        while delta > 180 { delta -= 360 }
        while delta < -180 { delta += 360 }
        return delta
    }

    private static func normalizedLongitude(_ value: Double) -> Double {
        var result = value
        while result > 180 { result -= 360 }
        while result < -180 { result += 360 }
        return result
    }

    private static func wrappedLongitude(_ value: Double) -> Double {
        normalizedLongitude(value)
    }

    private static func wrappedBearing(_ value: Double) -> Double {
        let result = value.truncatingRemainder(dividingBy: 360)
        return result >= 0 ? result : result + 360
    }
}

enum NavigationGuidance {
    static func maneuvers(for route: IncidentRouteResponse, mode: RouteTravelMode) -> [RouteManeuver] {
        if var provided = route.maneuvers, !provided.isEmpty {
            provided = provided
                .map { maneuver in
                    var value = maneuver
                    value.distanceFromStart = min(route.distanceMeters, max(0, value.distanceFromStart))
                    return value
                }
                .sorted { $0.distanceFromStart < $1.distanceFromStart }
            appendArrivalIfNeeded(to: &provided, route: route)
            return provided
        }

        guard let start = route.coordinates.first, let destination = route.coordinates.last else { return [] }
        var result = [RouteManeuver(
            id: "generated-start",
            instruction: route.startLabel?.nilIfBlank ?? "Head toward your destination",
            coordinate: start,
            distanceFromStart: 0,
            distanceMeters: route.distanceMeters
        )]
        let geometryDistance = max(1, NavigationGeometry.routeDistance(route.coordinates))
        let scale = route.distanceMeters / geometryDistance
        let minimumSpacing: CLLocationDistance = switch mode {
        case .walking: 35
        case .cycling: 60
        case .driving, .transit: 90
        }
        var distanceAlongGeometry = 0.0
        var lastManeuverDistance = 0.0
        if route.coordinates.count > 2 {
            for index in 1..<(route.coordinates.count - 1) {
                let previous = route.coordinates[index - 1]
                let current = route.coordinates[index]
                let next = route.coordinates[index + 1]
                distanceAlongGeometry += CLLocation(latitude: previous.latitude, longitude: previous.longitude)
                    .distance(from: CLLocation(latitude: current.latitude, longitude: current.longitude))
                let reportedDistance = distanceAlongGeometry * scale
                let turn = NavigationGeometry.signedTurn(from: previous, via: current, to: next)
                guard abs(turn) >= 28, reportedDistance - lastManeuverDistance >= minimumSpacing else { continue }
                let instruction: String
                if abs(turn) >= 145 {
                    instruction = "Make a U-turn"
                } else if turn > 0 {
                    instruction = abs(turn) >= 70 ? "Turn right" : "Bear right"
                } else {
                    instruction = abs(turn) >= 70 ? "Turn left" : "Bear left"
                }
                result.append(RouteManeuver(
                    id: "generated-\(index)",
                    instruction: instruction,
                    coordinate: current,
                    distanceFromStart: min(route.distanceMeters, reportedDistance),
                    distanceMeters: 0
                ))
                lastManeuverDistance = reportedDistance
            }
        }
        result.append(RouteManeuver(
            id: "generated-arrival",
            instruction: route.endLabel?.nilIfBlank ?? "Arrive at your destination",
            coordinate: destination,
            distanceFromStart: route.distanceMeters,
            distanceMeters: 0
        ))
        return result
    }

    static func currentManeuverIndex(in maneuvers: [RouteManeuver], distanceAlongRoute: Double) -> Int {
        guard maneuvers.count > 1 else { return 0 }
        if distanceAlongRoute < 20 { return 0 }
        return maneuvers.firstIndex(where: { $0.distanceFromStart > distanceAlongRoute + 8 }) ?? (maneuvers.count - 1)
    }

    static func spokenDistance(_ meters: Double) -> String {
        if meters < 1_000 {
            let rounded = max(10, Int((meters / 10).rounded()) * 10)
            return "\(rounded) meters"
        }
        return String(format: "%.1f kilometers", meters / 1_000)
    }

    private static func appendArrivalIfNeeded(to maneuvers: inout [RouteManeuver], route: IncidentRouteResponse) {
        guard let destination = route.coordinates.last else { return }
        let last = maneuvers.last
        let alreadyHasArrival = last?.instruction.localizedCaseInsensitiveContains("arriv") == true
            && abs((last?.distanceFromStart ?? 0) - route.distanceMeters) < 15
        guard !alreadyHasArrival else { return }
        maneuvers.append(RouteManeuver(
            id: "arrival-\(Int(route.distanceMeters.rounded()))",
            instruction: route.endLabel?.nilIfBlank ?? "Arrive at your destination",
            coordinate: destination,
            distanceFromStart: route.distanceMeters,
            distanceMeters: 0
        ))
    }
}

@MainActor
private final class NavigationLocationDriver: NSObject, @preconcurrency CLLocationManagerDelegate {
    var onLocation: ((CLLocation) -> Void)?
    var onHeading: ((CLLocationDirection) -> Void)?
    var onFailure: ((String) -> Void)?

    private let manager = CLLocationManager()
    private var wantsUpdates = false

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        manager.distanceFilter = 3
        manager.activityType = .automotiveNavigation
        manager.pausesLocationUpdatesAutomatically = false
        manager.allowsBackgroundLocationUpdates = true
        manager.showsBackgroundLocationIndicator = true
    }

    func start() {
        wantsUpdates = true
        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            beginUpdates()
        case .denied, .restricted:
            onFailure?("Location permission is required for live navigation. Enable it in Settings and try again.")
        @unknown default:
            onFailure?("Location permission is unavailable.")
        }
    }

    func stop() {
        wantsUpdates = false
        manager.stopUpdatingLocation()
        manager.stopUpdatingHeading()
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard wantsUpdates else { return }
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            beginUpdates()
        case .denied, .restricted:
            onFailure?("Location permission is required for live navigation. Enable it in Settings and try again.")
        case .notDetermined:
            break
        @unknown default:
            onFailure?("Location permission is unavailable.")
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard wantsUpdates, let location = locations.last, location.horizontalAccuracy >= 0 else { return }
        onLocation?(location)
    }

    func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
        guard wantsUpdates, newHeading.headingAccuracy >= 0 else { return }
        onHeading?(newHeading.trueHeading >= 0 ? newHeading.trueHeading : newHeading.magneticHeading)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        guard (error as? CLError)?.code != .locationUnknown else { return }
        onFailure?("Current location is unavailable: \(error.localizedDescription)")
    }

    private func beginUpdates() {
        manager.startUpdatingLocation()
        if CLLocationManager.headingAvailable() { manager.startUpdatingHeading() }
    }
}

private extension String {
    var nilIfBlank: String? {
        let value = trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }
}
