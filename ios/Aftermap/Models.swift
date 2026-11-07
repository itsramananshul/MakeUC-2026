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
    var routeChange: RouteChange?
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
    static let preview = SessionSnapshot(
        session: .init(code: "WESTHALL", name: "West Hall Drill", mode: "drill"),
        version: 7,
        nodes: [
            .init(id: "A", label: "Lobby", x: 120, y: 360, kind: .entrance),
            .init(id: "B", label: "West Hall", x: 390, y: 360, kind: .checkpoint),
            .init(id: "C", label: "Atrium", x: 650, y: 220, kind: .checkpoint),
            .init(id: "D", label: "South Exit", x: 850, y: 520, kind: .exit)
        ],
        edges: [
            .init(id: "AB", from: "A", to: "B", label: "Lobby passage", distance: 12, state: .open, discovered: true, lastObservationAt: nil, observationIds: []),
            .init(id: "BC", from: "B", to: "C", label: "West corridor", distance: 18, state: .blocked, discovered: true, lastObservationAt: nil, observationIds: []),
            .init(id: "CD", from: "C", to: "D", label: "Exit corridor", distance: 20, state: .unknown, discovered: false, lastObservationAt: nil, observationIds: [])
        ],
        participants: [.init(id: "p1", displayName: "Raman", checkpointId: "B", lastSeenAt: nil)],
        observations: [],
        route: .init(nodeIds: ["A", "B"], edgeIds: ["AB"], distance: 12),
        previousRoute: nil,
        routeChange: nil
    )
}
