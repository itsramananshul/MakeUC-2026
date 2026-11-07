import Foundation

struct IncidentAPIClient {
    var baseURL: String
    var urlSession: URLSession = .shared

    func incidents() async throws -> [Incident] {
        let response: IncidentListResponse = try await send(path: "api/incidents", method: "GET", body: Optional<String>.none)
        return response.incidents
    }

    func incident(id: String) async throws -> IncidentDetail {
        try await send(path: "api/incidents/\(escaped(id))", method: "GET", body: Optional<String>.none)
    }

    func places(query: String) async throws -> [PlaceResult] {
        guard var components = URLComponents(url: try endpoint("api/places"), resolvingAgainstBaseURL: false) else {
            throw AftermapAPIError.invalidServerURL
        }
        components.queryItems = [URLQueryItem(name: "q", value: query)]
        guard let url = components.url else { throw AftermapAPIError.invalidServerURL }
        let response: PlaceListResponse = try await send(url: url, method: "GET", body: Optional<String>.none, bearer: nil)
        return response.places
    }

    func ordinaryRoute(origin: IncidentCoordinate, destination: IncidentCoordinate) async throws -> IncidentRouteResponse {
        try await send(path: "api/routes", method: "POST", body: IncidentRouteRequest(origin: origin, destination: destination))
    }

    func route(incidentId: String, origin: IncidentCoordinate, destination: IncidentCoordinate) async throws -> IncidentRouteResponse {
        try await send(
            path: "api/incidents/\(escaped(incidentId))/route",
            method: "POST",
            body: IncidentRouteRequest(origin: origin, destination: destination)
        )
    }

    func submitReport(incidentId: String, key: String, request: IncidentReportRequest) async throws {
        try await sendIgnoringResponse(
            path: "api/incidents/\(escaped(incidentId))/reports",
            method: "POST",
            body: request,
            bearer: key
        )
    }

    func resolvedURL(_ value: String) -> URL? {
        ImageryLayer.resolve(value, against: baseURL)
    }

    private func endpoint(_ path: String) throws -> URL {
        let trimmed = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: "\(trimmed)/\(path)"),
              let scheme = url.scheme, ["http", "https"].contains(scheme) else {
            throw AftermapAPIError.invalidServerURL
        }
        return url
    }

    private func escaped(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? value
    }

    private func send<Response: Decodable, Body: Encodable>(path: String, method: String, body: Body?) async throws -> Response {
        try await send(url: try endpoint(path), method: method, body: body, bearer: nil)
    }

    private func send<Response: Decodable, Body: Encodable>(path: String, method: String, body: Body?, bearer: String?) async throws -> Response {
        try await send(url: try endpoint(path), method: method, body: body, bearer: bearer)
    }

    private func send<Response: Decodable, Body: Encodable>(url: URL, method: String, body: Body?, bearer: String?) async throws -> Response {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let bearer, !bearer.isEmpty { request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        do {
            let (data, response) = try await urlSession.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw AftermapAPIError.invalidResponse }
            guard (200..<300).contains(http.statusCode) else {
                if let envelope = try? JSONDecoder().decode(APIErrorEnvelope.self, from: data) {
                    throw AftermapAPIError.backend(envelope.error)
                }
                throw AftermapAPIError.backend("Server error \(http.statusCode).")
            }
            do { return try JSONDecoder().decode(Response.self, from: data) }
            catch { throw AftermapAPIError.backend("Could not read the incident response: \(error.localizedDescription)") }
        } catch let error as AftermapAPIError { throw error }
        catch { throw AftermapAPIError.transport(error.localizedDescription) }
    }

    private func sendIgnoringResponse<Body: Encodable>(path: String, method: String, body: Body, bearer: String?) async throws {
        var request = URLRequest(url: try endpoint(path))
        request.httpMethod = method
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let bearer, !bearer.isEmpty { request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
        request.httpBody = try JSONEncoder().encode(body)
        do {
            let (data, response) = try await urlSession.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw AftermapAPIError.invalidResponse }
            guard (200..<300).contains(http.statusCode) else {
                if let envelope = try? JSONDecoder().decode(APIErrorEnvelope.self, from: data) {
                    throw AftermapAPIError.backend(envelope.error)
                }
                throw AftermapAPIError.backend("Server error \(http.statusCode).")
            }
        } catch let error as AftermapAPIError { throw error }
        catch { throw AftermapAPIError.transport(error.localizedDescription) }
    }
}
