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

        var instruction: String {
            switch self {
            case .origin: "Tap the map to choose your starting point"
            case .destination: "Tap the map to choose your destination"
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

    private let defaults: UserDefaults
    private var cameraRevision = 0
    private var useNextLocationAsOrigin = false

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        serverURL = defaults.string(forKey: "aftermap.serverURL") ?? "https://aftermap-makeuc.vercel.app"
        displayName = defaults.string(forKey: "aftermap.displayName") ?? ""
    }

    var client: IncidentAPIClient { IncidentAPIClient(baseURL: serverURL) }

    func run() async {
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
    }

    func requestCurrentLocationAsOrigin() {
        useNextLocationAsOrigin = true
        locationRequestRevision += 1
    }

    func acceptUserLocation(_ coordinate: CLLocationCoordinate2D) {
        let value = IncidentCoordinate(coordinate)
        userCoordinate = value
        guard useNextLocationAsOrigin else { return }
        useNextLocationAsOrigin = false
        origin = value
        routeState = .idle
        focus(on: value, zoom: 15)
    }

    func locationFailed(_ message: String) {
        useNextLocationAsOrigin = false
        notice = message
    }

    func loadIncident(_ incident: Incident) async {
        selectedIncident = incident
        selectedRoad = nil
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
                    "The proposed route enters \(affected.name), so AFTERMAP refused to display it without incident-road verification."
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

    func submitReport(condition: IncidentRoad.State, note: String, evidenceType: String) async -> Bool {
        guard let incident = selectedIncident, let road = selectedRoad else {
            notice = "Select an incident road before submitting evidence."
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
            edgeId: road.id,
            condition: condition,
            note: note.trimmingCharacters(in: .whitespacesAndNewlines),
            evidenceType: evidenceType,
            confirmed: true
        )
        do {
            try await client.submitReport(incidentId: incident.id, key: reportKey, request: request)
            incidentDetail = try await client.incident(id: incident.id)
            selectedRoad = incidentDetail?.roads.first(where: { $0.id == road.id })
            notice = "Evidence added to (road.label)."
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
