import CoreLocation
import Foundation

@MainActor
final class WorldMapStore: ObservableObject {
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
    @Published private(set) var selectedIncident: Incident?
    @Published private(set) var incidentDetail: IncidentDetail?
    @Published var selectedRoad: IncidentRoad?
    @Published var query = ""
    @Published private(set) var places: [PlaceResult] = []
    @Published private(set) var isSearching = false
    @Published var origin: IncidentCoordinate?
    @Published var destination: IncidentCoordinate?
    @Published var selectionMode: SelectionMode?
    @Published private(set) var routeState: RoutePreviewState = .idle
    @Published private(set) var connection: ConnectionState = .loading
    @Published private(set) var lastUpdated: Date?
    @Published var cameraTarget: CameraTarget?
    @Published var displayName: String
    @Published var reportKey = ""
    @Published var notice: String?
    @Published private(set) var userCoordinate: IncidentCoordinate?
    @Published private(set) var locationRequestRevision = 0
    @Published var reportLocation: IncidentCoordinate?
    @Published private(set) var reportLocationRevision = 0
    @Published var incidentDraftCenter: IncidentCoordinate?
    @Published var mapStyle: MapStyle {
        didSet { defaults.set(mapStyle.rawValue, forKey: "aftermap.mapStyle") }
    }

    private let defaults: UserDefaults
    private let urlSession: URLSession
    private var cameraRevision = 0
    private enum PendingLocationUse {
        case origin(userInitiated: Bool)
        case report
        case incident
    }
    private var pendingLocationUse: PendingLocationUse?
    private var isIncidentPreviewMode = false

    init(defaults: UserDefaults = .standard, urlSession: URLSession = .shared) {
        self.defaults = defaults
        self.urlSession = urlSession
        mapStyle = MapStyle(rawValue: defaults.string(forKey: "aftermap.mapStyle") ?? "") ?? .satellite
        if let savedServer = defaults.string(forKey: "aftermap.serverURL"),
           URL(string: savedServer)?.host != "aftermap-makeuc.vercel.app" {
            serverURL = savedServer
        } else {
            serverURL = "https://yourmapisgaslightingyou.us"
        }
        displayName = defaults.string(forKey: "aftermap.displayName") ?? ""
#if DEBUG
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
#endif
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
        do {
            let latest = try await client.incidents()
            incidents = latest
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
        } catch {
            connection = .stale(error.localizedDescription)
        }
    }

    func search() async {
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard term.count >= 2 else {
            places = []
            isSearching = false
            return
        }
        isSearching = true
        defer {
            if query.trimmingCharacters(in: .whitespacesAndNewlines) == term {
                isSearching = false
            }
        }
        do {
            try await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            places = try await client.places(query: term)
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            places = []
            notice = error.localizedDescription
        }
    }

    func choosePlace(_ place: PlaceResult) {
        destination = place.coordinate
        query = place.name
        places = []
        focus(on: place.coordinate, zoom: 14)
    }

    func chooseCoordinate(_ coordinate: CLLocationCoordinate2D) {
        let value = IncidentCoordinate(coordinate)
        switch selectionMode {
        case .origin: origin = value
        case .destination: destination = value
        case .reportLocation:
            guard let incident = selectedIncident, incident.bounds.contains(coordinate) else {
                notice = "Choose a point inside the selected incident."
                return
            }
            selectedRoad = nil
            reportLocation = value
            reportLocationRevision += 1
            focus(on: value, zoom: 16)
        case nil:
            if let incident = incidents.first(where: { $0.bounds.contains(coordinate) }) {
                Task { await loadIncident(incident) }
            }
        }
        selectionMode = nil
        routeState = .idle
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
        let value = IncidentCoordinate(coordinate)
        userCoordinate = value
        switch pendingLocationUse {
        case .origin:
            origin = value
            routeState = .idle
            focus(on: value, zoom: 15)
        case .report:
            guard let incident = selectedIncident, incident.bounds.contains(coordinate) else {
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

    func locationFailed(_ message: String) {
        guard let pending = pendingLocationUse else { return }
        pendingLocationUse = nil
        if case .origin(userInitiated: false) = pending { return }
        notice = message
    }

    func loadIncident(_ incident: Incident) async {
        selectedIncident = incident
        selectedRoad = nil
        reportLocation = nil
        focus(on: IncidentCoordinate(incident.bounds.center), zoom: 13)
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
        let endpointIncident = incidents.first(where: {
            $0.bounds.contains(origin.coordinate) || $0.bounds.contains(destination.coordinate)
        })

        do {
            if let incident = endpointIncident {
                let response = try await client.route(incidentId: incident.id, origin: origin, destination: destination)
                if response.status == .unavailable {
                    routeState = .unavailable(response.reason)
                } else if let other = incidents.first(where: {
                    $0.id != incident.id && $0.bounds.intersects(response.coordinates)
                }) {
                    routeState = .unavailable(
                        "The verified route for \(incident.name) also enters \(other.name), so Gaslight Maps withheld it pending cross-incident verification."
                    )
                } else {
                    routeState = .route(response, affectedIncidentName: incident.name)
                }
                return
            }

            let ordinary = try await client.ordinaryRoute(origin: origin, destination: destination)
            if let affected = incidents.first(where: { $0.bounds.intersects(ordinary.coordinates) }) {
                routeState = .unavailable(
                    "The proposed route enters \(affected.name), so Gaslight Maps withheld it pending incident-road verification."
                )
            } else {
                routeState = ordinary.status == .unavailable
                    ? .unavailable(ordinary.reason)
                    : .route(ordinary, affectedIncidentName: nil)
            }
        } catch {
            routeState = .unavailable(error.localizedDescription)
        }
    }

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
