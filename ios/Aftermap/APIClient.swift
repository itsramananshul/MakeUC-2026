import Foundation

enum AftermapAPIError: LocalizedError {
    case invalidServerURL
    case invalidResponse
    case backend(String)
    case transport(String)

    var errorDescription: String? {
        switch self {
        case .invalidServerURL: return "Enter a valid server URL, including http:// or https://."
        case .invalidResponse: return "The drill server returned an unreadable response."
        case .backend(let message), .transport(let message): return message
        }
    }
}

struct APIClient {
    var baseURL: String
    var sessionCode: String
    var urlSession: URLSession = .shared

    private var decoder: JSONDecoder { JSONDecoder() }
    private var encoder: JSONEncoder { JSONEncoder() }

    func snapshot() async throws -> SessionSnapshot {
        try await send(path: "", method: "GET", body: Optional<String>.none)
    }

    func join(observerId: String?, displayName: String) async throws -> JoinResponse {
        try await send(path: "join", method: "POST", body: JoinRequest(observerId: observerId, displayName: displayName))
    }

    func position(observerId: String, checkpointId: String) async throws -> StateResponse {
        try await send(path: "position", method: "POST", body: PositionRequest(observerId: observerId, checkpointId: checkpointId))
    }

    func interpret(_ request: InterpretRequest) async throws -> InterpretResponse {
        try await send(path: "interpret", method: "POST", body: request)
    }

    func submit(_ request: ObservationRequest) async throws -> StateResponse {
        try await send(path: "observations", method: "POST", body: request)
    }

    private func endpoint(_ path: String) throws -> URL {
        let trimmed = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let code = sessionCode.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard let url = URL(string: "\(trimmed)/api/sessions/\(code)/\(path)"),
              let scheme = url.scheme, ["http", "https"].contains(scheme) else {
            throw AftermapAPIError.invalidServerURL
        }
        return url
    }

    private func send<Response: Decodable, Body: Encodable>(path: String, method: String, body: Body?) async throws -> Response {
        var request = URLRequest(url: try endpoint(path))
        request.httpMethod = method
        request.timeoutInterval = 12
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try encoder.encode(body)
        }
        do {
            let (data, response) = try await urlSession.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw AftermapAPIError.invalidResponse }
            guard (200..<300).contains(http.statusCode) else {
                if let envelope = try? decoder.decode(APIErrorEnvelope.self, from: data) {
                    throw AftermapAPIError.backend(envelope.error)
                }
                throw AftermapAPIError.backend("Server error \(http.statusCode).")
            }
            do { return try decoder.decode(Response.self, from: data) }
            catch { throw AftermapAPIError.backend("Could not read the server response: \(error.localizedDescription)") }
        } catch let error as AftermapAPIError {
            throw error
        } catch {
            throw AftermapAPIError.transport(error.localizedDescription)
        }
    }
}

