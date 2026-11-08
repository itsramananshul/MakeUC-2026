import CoreLocation
import Foundation

struct IncidentCoordinate: Codable, Equatable {
    var latitude: Double
    var longitude: Double

    init(latitude: Double, longitude: Double) {
        self.latitude = latitude
        self.longitude = longitude
    }

    init(_ coordinate: CLLocationCoordinate2D) {
        latitude = coordinate.latitude
        longitude = coordinate.longitude
    }

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

struct IncidentBounds: Codable, Equatable {
    var west: Double
    var south: Double
    var east: Double
    var north: Double

    var center: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: (south + north) / 2, longitude: (west + east) / 2)
    }

    func contains(_ coordinate: CLLocationCoordinate2D) -> Bool {
        latitudeRange.contains(coordinate.latitude) && longitudeRange.contains(coordinate.longitude)
    }

    func intersects(_ coordinates: [IncidentCoordinate]) -> Bool {
        for (index, point) in coordinates.enumerated() {
            if contains(point.coordinate) { return true }
            guard index > 0 else { continue }
            let previous = coordinates[index - 1]
            let segmentWest = min(previous.longitude, point.longitude)
            let segmentEast = max(previous.longitude, point.longitude)
            let segmentSouth = min(previous.latitude, point.latitude)
            let segmentNorth = max(previous.latitude, point.latitude)
            if segmentWest <= east, segmentEast >= west, segmentSouth <= north, segmentNorth >= south { return true }
        }
        return false
    }

    static func square(center: IncidentCoordinate, widthKilometers: Double) -> IncidentBounds? {
        guard widthKilometers > 0, widthKilometers <= 10 else { return nil }
        let latitudeDelta = widthKilometers / 2 / 111.32
        let cosine = cos(center.latitude * .pi / 180)
        guard abs(cosine) > 0.000_001 else { return nil }
        let longitudeDelta = latitudeDelta / cosine
        guard abs(center.latitude) + latitudeDelta <= 85,
              abs(center.longitude) + abs(longitudeDelta) <= 180 else { return nil }
        return IncidentBounds(
            west: center.longitude - longitudeDelta,
            south: center.latitude - latitudeDelta,
            east: center.longitude + longitudeDelta,
            north: center.latitude + latitudeDelta
        )
    }

    private var latitudeRange: ClosedRange<Double> { min(south, north)...max(south, north) }
    private var longitudeRange: ClosedRange<Double> { min(west, east)...max(west, east) }
}

struct IncidentImagery: Codable, Equatable {
    var url: String
    var bounds: IncidentBounds
    var source: String
    var timestamp: String
}

struct Incident: Codable, Identifiable, Equatable {
    enum Kind: String, Codable { case incident }
    var id: String
    var name: String
    var kind: Kind
    var bounds: IncidentBounds
    var imagery: IncidentImagery?
    var version: Int
    var roadCount: Int
}

struct IncidentListResponse: Codable { var incidents: [Incident] }

struct IncidentCreationRequest: Encodable {
    var name: String
    var bounds: IncidentBounds
}

struct IncidentCreationResponse: Decodable, Equatable {
    var incident: Incident
    var key: String
}

struct IncidentDetailResponse: Decodable, Equatable {
    var incident: IncidentDetail
}

struct IncidentSurveyFile: Equatable {
    var name: String
    var data: Data
}

struct IncidentRouteRequest: Codable {
    var origin: IncidentCoordinate
    var destination: IncidentCoordinate
}

struct IncidentRouteResponse: Codable, Equatable {
    enum Status: String, Codable { case complete, partial, unavailable }
    var status: Status
    var coordinates: [IncidentCoordinate]
    var distanceMeters: Double
    var reason: String
    var startLabel: String?
    var endLabel: String?
}

struct IncidentRoad: Codable, Identifiable, Equatable {
    enum State: String, Codable, CaseIterable { case unknown, open, blocked, hazard, conflict }
    var id: String
    var from: IncidentCoordinate
    var to: IncidentCoordinate
    var state: State
    var label: String
}

struct IncidentReport: Codable, Identifiable, Equatable {
    var id: String
    var edgeId: String?
    var displayName: String
    var condition: IncidentRoad.State?
    var note: String?
    var at: String
    var evidenceType: String
    var location: IncidentCoordinate?
    var evidenceUrl: String?
}

struct IncidentDetail: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var kind: Incident.Kind
    var bounds: IncidentBounds
    var imagery: IncidentImagery?
    var version: Int
    var roadCount: Int
    var roads: [IncidentRoad]
    var reports: [IncidentReport]
}

struct PlaceResult: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var detail: String
    var latitude: Double
    var longitude: Double
    var coordinate: IncidentCoordinate { IncidentCoordinate(latitude: latitude, longitude: longitude) }
}

struct PlaceListResponse: Codable { var places: [PlaceResult] }

struct IncidentReportRequest: Encodable {
    var id: String
    var displayName: String
    var edgeId: String?
    var condition: IncidentRoad.State?
    var note: String
    var evidenceType: String
    var location: IncidentCoordinate?
    var photoBase64: String?
    var confirmed: Bool

    private enum CodingKeys: String, CodingKey {
        case id, displayName, edgeId, condition, note, evidenceType, location, photoBase64, confirmed
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(displayName, forKey: .displayName)
        try container.encodeIfPresent(edgeId, forKey: .edgeId)
        try container.encodeIfPresent(condition, forKey: .condition)
        try container.encode(note, forKey: .note)
        try container.encode(evidenceType, forKey: .evidenceType)
        try container.encodeIfPresent(location, forKey: .location)
        try container.encodeIfPresent(photoBase64, forKey: .photoBase64)
        try container.encode(confirmed, forKey: .confirmed)
    }
}

enum RoutePreviewState: Equatable {
    case idle
    case calculating
    case route(IncidentRouteResponse, affectedIncidentName: String?)
    case unavailable(String)
}
