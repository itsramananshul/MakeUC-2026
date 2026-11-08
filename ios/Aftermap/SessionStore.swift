import Foundation

@MainActor
final class SessionStore: ObservableObject {
    enum ConnectionState: Equatable { case idle, connecting, live, stale, failed(String) }

    @Published var snapshot: SessionSnapshot?
    @Published var connection: ConnectionState = .idle
    @Published var isBusy = false
    @Published var bannerMessage: String?
    @Published var serverURL: String
    @Published var sessionCode: String
    @Published var displayName: String
    @Published private(set) var observerId: String?
    @Published private(set) var lastUpdatedAt: Date?

    private let defaults: UserDefaults
    private var pollTask: Task<Void, Never>?
    private var foregrounded = true
    private var consecutivePollFailures = 0
    private var isPreviewMode = false

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        serverURL = WorldMapStore.resolvedServerURL(defaults: defaults)
        sessionCode = defaults.string(forKey: "aftermap.sessionCode") ?? "WESTHALL"
        displayName = defaults.string(forKey: "aftermap.displayName") ?? ""
        observerId = defaults.string(forKey: "aftermap.observerId").flatMap { $0.isEmpty ? nil : $0 }
#if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-aftermapPreview") || ProcessInfo.processInfo.environment["AFTERMAP_PREVIEW"] == "1" {
            isPreviewMode = true
            observerId = "p1"
            displayName = "Preview Observer"
            snapshot = .preview
            connection = .live
            lastUpdatedAt = Date()
        }
#endif
    }

    var isJoined: Bool { observerId != nil }
    var client: APIClient { APIClient(baseURL: serverURL, sessionCode: sessionCode) }

    func start() async {
        if isPreviewMode { return }
        if isJoined { await refresh(showFailure: false) }
        startPolling()
    }

    func setForegrounded(_ value: Bool) {
        foregrounded = value
        if value { startPolling() } else { pollTask?.cancel(); pollTask = nil }
    }

    func updateConfiguration(serverURL: String, sessionCode: String, displayName: String? = nil) {
        self.serverURL = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
        self.sessionCode = sessionCode.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        if let displayName { self.displayName = displayName.trimmingCharacters(in: .whitespacesAndNewlines) }
        defaults.set(self.serverURL, forKey: "aftermap.serverURL")
        defaults.set(self.sessionCode, forKey: "aftermap.sessionCode")
        defaults.set(self.displayName, forKey: "aftermap.displayName")
    }

    func join(serverURL: String, sessionCode: String, displayName: String) async -> Bool {
        updateConfiguration(serverURL: serverURL, sessionCode: sessionCode, displayName: displayName)
        guard !self.displayName.isEmpty else { bannerMessage = "Enter the name other participants should see."; return false }
        isBusy = true
        connection = .connecting
        defer { isBusy = false }
        do {
            let response = try await client.join(observerId: observerId, displayName: self.displayName)
            observerId = response.observerId
            defaults.set(response.observerId, forKey: "aftermap.observerId")
            accept(response.state)
            startPolling()
            return true
        } catch {
            fail(error)
            return false
        }
    }

    func refresh(showFailure: Bool = true) async {
        guard foregrounded, isJoined else { return }
        do {
            accept(try await client.snapshot())
            consecutivePollFailures = 0
        } catch {
            consecutivePollFailures += 1
            if consecutivePollFailures >= 2 { connection = .stale }
            if showFailure { bannerMessage = error.localizedDescription }
        }
    }

    func confirmPosition(checkpointId: String) async -> Bool {
        guard let observerId else { return false }
#if DEBUG
        if isPreviewMode {
            guard var state = snapshot else { return false }
            if let index = state.participants.firstIndex(where: { $0.id == observerId }) {
                state.participants[index].checkpointId = checkpointId
            }
            state.version += 1
            accept(state)
            return true
        }
#endif
        isBusy = true
        defer { isBusy = false }
        do {
            accept(try await client.position(observerId: observerId, checkpointId: checkpointId).state)
            return true
        } catch { fail(error); return false }
    }

    func interpret(_ request: InterpretRequest) async throws -> InterpretResponse {
#if DEBUG
        if isPreviewMode {
            let destination = snapshot?.nodes.first(where: { $0.id != request.checkpointId })?.id
            return InterpretResponse(
                suggestion: AISuggestion(kind: .passage, from: request.checkpointId, to: destination, nodeId: nil, status: .blocked, confidence: 0.78, note: request.note),
                message: "Preview AI suggestion for simulator verification."
            )
        }
#endif
        isBusy = true
        defer { isBusy = false }
        return try await client.interpret(request)
    }

    func submit(_ request: ObservationRequest) async -> Bool {
#if DEBUG
        if isPreviewMode {
            guard var state = snapshot else { return false }
            state.observations.append(ObservationRecord(
                id: request.id, observerId: request.observerId, checkpointId: request.checkpointId,
                kind: request.kind.rawValue, from: request.from, to: request.to, nodeId: request.nodeId,
                status: request.status?.rawValue, evidenceType: request.evidenceType, confidence: request.confidence,
                note: request.note, confirmed: request.confirmed, createdAt: ISO8601DateFormatter().string(from: Date())
            ))
            if request.kind == .passage, let from = request.from, let to = request.to,
               let index = state.edges.firstIndex(where: { Set([$0.from, $0.to]) == Set([from, to]) }), let status = request.status {
                state.edges[index].state = status
                state.edges[index].observationIds.append(request.id)
            }
            state.version += 1
            accept(state)
            bannerMessage = "Confirmed report added to the shared map."
            return true
        }
#endif
        isBusy = true
        defer { isBusy = false }
        do {
            accept(try await client.submit(request).state)
            bannerMessage = "Confirmed report added to the shared map."
            return true
        } catch { fail(error); return false }
    }

    func leaveDeviceIdentity() {
        observerId = nil
        snapshot = nil
        defaults.removeObject(forKey: "aftermap.observerId")
        connection = .idle
    }

    private func accept(_ newSnapshot: SessionSnapshot) {
        snapshot = newSnapshot
        lastUpdatedAt = Date()
        connection = .live
        consecutivePollFailures = 0
    }

    private func fail(_ error: Error) {
        let message = error.localizedDescription
        connection = .failed(message)
        bannerMessage = message
    }

    private func startPolling() {
        guard !isPreviewMode, foregrounded, isJoined, pollTask == nil else { return }
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                guard !Task.isCancelled, let self else { return }
                await self.refresh(showFailure: false)
            }
            self?.pollTask = nil
        }
    }
}
