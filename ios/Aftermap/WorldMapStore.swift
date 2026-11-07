import CoreLocation
import Foundation

@MainActor
final class WorldMapStore: ObservableObject {
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

    private let defaults: UserDefaults
    private var cameraRevision = 0
    private enum PendingLocationUse { case origin, report }
    private var pendingLocationUse: PendingLocationUse?
    private var isIncidentPreviewMode = false

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
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

    var client: IncidentAPIClient { IncidentAPIClient(baseURL: serverURL) }

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
        do {
            try await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            places = try await client.places(query: term)
        } catch is CancellationError {
            return
        } catch {
            places = []
            notice = error.localizedDescription
        }
        isSearching = false
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

    func requestCurrentLocationAsOrigin() {
        pendingLocationUse = .origin
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
        case nil:
            return
        }
        pendingLocationUse = nil
    }

    func locationFailed(_ message: String) {
        pendingLocationUse = nil
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
                routeState = response.status == .unavailable
                    ? .unavailable(response.reason)
                    : .route(response, affectedIncidentName: incident.name)
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

    func focus(on coordinate: IncidentCoordinate, zoom: Double) {
        cameraRevision += 1
        cameraTarget = CameraTarget(coordinate: coordinate, zoom: zoom, revision: cameraRevision)
    }
}
