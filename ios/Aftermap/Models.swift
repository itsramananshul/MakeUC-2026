import Foundation

struct SessionSnapshot: Codable, Equatable {
    var session: SessionInfo
    var version: Int
    var nodes: [MapNode]
    var edges: [MapEdge]
    var participants: [Participant]
    var observations: [ObservationRecord]
    var route: MapRoute?
    var previousRoute: MapRoute?
    var imagery: ImageryLayer?
    var routeChange: RouteChange?
}

struct ImageryLayer: Codable, Equatable {
    var url: String
    var label: String
    var source: String
    var timestamp: String
    var bounds: [Double]
    var aligned: Bool
    var width: Int
    var height: Int
    var count: Int

    func resolvedURL(against serverURL: String) -> URL? {
        Self.resolve(url, against: serverURL)
    }

    static func resolve(_ value: String, against serverURL: String) -> URL? {
        if let absolute = URL(string: value), absolute.scheme != nil { return absolute }
        guard let base = URL(string: serverURL),
              var origin = URLComponents(url: base, resolvingAgainstBaseURL: false) else { return nil }
        origin.path = "/"
        origin.query = nil
        origin.fragment = nil
        guard let originURL = origin.url else { return nil }
        return URL(string: value, relativeTo: originURL)?.absoluteURL
    }
}

struct SessionInfo: Codable, Equatable {
    var code: String
    var name: String
    var mode: String
}

struct MapNode: Codable, Identifiable, Equatable {
    enum Kind: String, Codable, CaseIterable { case entrance, checkpoint, room, exit }
    var id: String
    var label: String
    var x: Double
    var y: Double
    var kind: Kind
}

struct MapEdge: Codable, Identifiable, Equatable {
    enum State: String, Codable, CaseIterable { case open, blocked, hazard, unknown, conflict }
    var id: String
    var from: String
    var to: String
    var label: String
    var distance: Double
    var state: State
    var discovered: Bool
    var lastObservationAt: String?
    var observationIds: [String]
}

struct Participant: Codable, Identifiable, Equatable {
    var id: String
    var displayName: String
    var checkpointId: String?
    var lastSeenAt: String?
}

struct ObservationRecord: Codable, Identifiable, Equatable {
    var id: String
    var observerId: String?
    var checkpointId: String?
    var kind: String?
    var from: String?
    var to: String?
    var nodeId: String?
    var status: String?
    var evidenceType: String?
    var confidence: Double?
    var note: String?
    var confirmed: Bool?
    var createdAt: String?
}

struct MapRoute: Codable, Equatable {
    var nodeIds: [String]
    var edgeIds: [String]
    var distance: Double
}

struct RouteChange: Codable, Equatable {
    var observationId: String
    var reason: String
    var at: String
}

struct JoinResponse: Codable { var observerId: String; var state: SessionSnapshot }
struct StateResponse: Codable { var state: SessionSnapshot }

struct AISuggestion: Codable, Equatable {
    enum Kind: String, Codable, CaseIterable { case passage, exit, help }
    var kind: Kind
    var from: String?
    var to: String?
    var nodeId: String?
    var status: MapEdge.State?
    var confidence: Double
    var note: String?
}

struct InterpretResponse: Codable { var suggestion: AISuggestion?; var message: String? }

struct JoinRequest: Codable { var observerId: String?; var displayName: String }
struct PositionRequest: Codable { var observerId: String; var checkpointId: String }

struct InterpretRequest: Codable {
    enum EvidenceType: String, Codable, CaseIterable { case image, text, voice }
    var observerId: String
    var checkpointId: String
    var evidenceType: EvidenceType
    var note: String?
    var imageBase64: String?
    var imageMimeType: String?
}

struct ObservationRequest: Codable {
    var id: String
    var observerId: String
    var checkpointId: String
    var kind: AISuggestion.Kind
    var from: String?
    var to: String?
    var nodeId: String?
    var status: MapEdge.State?
    var evidenceType: String
    var confidence: Double?
    var note: String?
    var confirmed: Bool
}

struct APIErrorEnvelope: Codable { var error: String }

extension SessionSnapshot {
    func preferredMapImageryURL(against serverURL: String) -> URL? {
        let base = ImageryLayer.resolve("/mexico-beach-noaa.jpg", against: serverURL)
        guard let imagery, imagery.aligned else { return base }
        return imagery.resolvedURL(against: serverURL) ?? base
    }

    var mapImageryAttribution: String {
        guard let imagery, imagery.aligned else { return "Historical aerial • NOAA / NGS • October 2018" }
        return "\(imagery.label) • \(imagery.source)"
    }

    static let preview = SessionSnapshot(
        session: .init(code: "WESTHALL", name: "Mexico Beach", mode: "drill"),
        version: 7,
        nodes: [
            .init(id: "SOUTH", label: "Staging point", x: 325, y: 500, kind: .entrance),
            .init(id: "ATRIUM", label: "Coastal junction", x: 391, y: 408, kind: .checkpoint),
            .init(id: "CENTRAL", label: "Harbor junction", x: 483, y: 279, kind: .checkpoint),
            .init(id: "EAST", label: "East crossing", x: 568, y: 166, kind: .checkpoint),
            .init(id: "EXIT", label: "East assembly", x: 650, y: 60, kind: .exit)
        ],
        edges: [
            .init(id: "ATRIUM:SOUTH", from: "SOUTH", to: "ATRIUM", label: "South approach", distance: 113, state: .open, discovered: true, lastObservationAt: nil, observationIds: []),
            .init(id: "ATRIUM:CENTRAL", from: "ATRIUM", to: "CENTRAL", label: "Harbor Road", distance: 158, state: .open, discovered: true, lastObservationAt: nil, observationIds: []),
            .init(id: "CENTRAL:EAST", from: "CENTRAL", to: "EAST", label: "North approach", distance: 141, state: .open, discovered: true, lastObservationAt: nil, observationIds: []),
            .init(id: "EAST:EXIT", from: "EAST", to: "EXIT", label: "Assembly approach", distance: 134, state: .open, discovered: true, lastObservationAt: nil, observationIds: [])
        ],
        participants: [.init(id: "p1", displayName: "Test Observer", checkpointId: "ATRIUM", lastSeenAt: nil)],
        observations: [],
        route: .init(nodeIds: ["SOUTH", "ATRIUM", "CENTRAL", "EAST", "EXIT"], edgeIds: ["ATRIUM:SOUTH", "ATRIUM:CENTRAL", "CENTRAL:EAST", "EAST:EXIT"], distance: 546),
        previousRoute: nil,
        imagery: nil,
        routeChange: nil
    )
}
