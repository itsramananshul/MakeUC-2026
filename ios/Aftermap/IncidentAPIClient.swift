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

    func createIncident(name: String, bounds: IncidentBounds, operatorKey: String) async throws -> IncidentCreationResponse {
        try await send(
            path: "api/incidents",
            method: "POST",
            body: IncidentCreationRequest(name: name, bounds: bounds),
            bearer: operatorKey
        )
    }

    func places(query: String, near coordinate: IncidentCoordinate? = nil) async throws -> [PlaceResult] {
        try await placeResults(path: "api/places", query: query, near: coordinate)
    }

    func canonicalPlaces(query: String) async throws -> [PlaceResult] {
        try await placeResults(path: "api/places/exact", query: query, near: nil)
    }

    private func placeResults(path: String, query: String, near coordinate: IncidentCoordinate?) async throws -> [PlaceResult] {
        guard var components = URLComponents(url: try endpoint(path), resolvingAgainstBaseURL: false) else {
            throw AftermapAPIError.invalidServerURL
        }
        components.queryItems = [URLQueryItem(name: "q", value: query)]
        if let coordinate {
            components.queryItems?.append(URLQueryItem(name: "lat", value: String(coordinate.latitude)))
            components.queryItems?.append(URLQueryItem(name: "lon", value: String(coordinate.longitude)))
        }
        guard let url = components.url else { throw AftermapAPIError.invalidServerURL }
        let response: PlaceListResponse = try await send(url: url, method: "GET", body: Optional<String>.none, bearer: nil)
        return response.places
    }

    func ordinaryRoute(
        origin: IncidentCoordinate,
        destination: IncidentCoordinate,
        mode: RouteTravelMode = .walking
    ) async throws -> IncidentRouteResponse {
        try await send(
            path: "api/routes",
            method: "POST",
            body: IncidentRouteRequest(origin: origin, destination: destination, mode: mode)
        )
    }

    func route(
        incidentId: String,
        origin: IncidentCoordinate,
        destination: IncidentCoordinate,
        mode: RouteTravelMode = .walking
    ) async throws -> IncidentRouteResponse {
        try await send(
            path: "api/incidents/\(escaped(incidentId))/route",
            method: "POST",
            body: IncidentRouteRequest(origin: origin, destination: destination, mode: mode)
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

    func uploadGeoTIFFs(
        incidentId: String,
        key: String,
        files: [IncidentSurveyFile],
        source: String? = nil,
        timestamp: Date? = nil
    ) async throws -> IncidentDetail {
        let boundary = "Aftermap-\(UUID().uuidString)"
        var body = Data()
        func appendField(name: String, value: String) {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n".data(using: .utf8)!)
            body.append(value.data(using: .utf8)!)
            body.append("\r\n".data(using: .utf8)!)
        }
        if let source = source?.trimmingCharacters(in: .whitespacesAndNewlines), !source.isEmpty {
            appendField(name: "source", value: source)
        }
        if let timestamp {
            appendField(name: "timestamp", value: ISO8601DateFormatter().string(from: timestamp))
        }
        for file in files {
            let safeName = file.name
                .replacingOccurrences(of: "\"", with: "_")
                .replacingOccurrences(of: "\r", with: "_")
                .replacingOccurrences(of: "\n", with: "_")
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"files\"; filename=\"\(safeName)\"\r\n".data(using: .utf8)!)
            body.append("Content-Type: image/tiff\r\n\r\n".data(using: .utf8)!)
            body.append(file.data)
            body.append("\r\n".data(using: .utf8)!)
        }
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)

        var request = URLRequest(url: try endpoint("api/incidents/\(escaped(incidentId))/imagery"))
        request.httpMethod = "POST"
        request.timeoutInterval = 120
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue(String(body.count), forHTTPHeaderField: "Content-Length")
        if !key.isEmpty { request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization") }
        request.httpBody = body

        do {
            let (data, response) = try await urlSession.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw AftermapAPIError.invalidResponse }
            guard (200..<300).contains(http.statusCode) else {
                if let envelope = try? JSONDecoder().decode(APIErrorEnvelope.self, from: data) {
                    throw AftermapAPIError.backend(envelope.error)
                }
                throw AftermapAPIError.backend("Server error \(http.statusCode).")
            }
            return try JSONDecoder().decode(IncidentDetailResponse.self, from: data).incident
        } catch is CancellationError { throw CancellationError() }
        catch let error as URLError where error.code == .cancelled { throw CancellationError() }
        catch let error as AftermapAPIError { throw error }
        catch { throw AftermapAPIError.transport(error.localizedDescription) }
    }

    func removeImagery(incidentId: String, key: String) async throws -> IncidentDetail {
        let response: IncidentDetailResponse = try await send(
            path: "api/incidents/\(escaped(incidentId))/imagery",
            method: "DELETE",
            body: Optional<String>.none,
            bearer: key
        )
        return response.incident
    }

    func importRoads(incidentId: String, key: String) async throws -> IncidentDetail {
        let response: IncidentDetailResponse = try await send(
            path: "api/incidents/\(escaped(incidentId))/roads",
            method: "POST",
            body: Optional<String>.none,
            bearer: key
        )
        return response.incident
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
        } catch is CancellationError { throw CancellationError() }
        catch let error as URLError where error.code == .cancelled { throw CancellationError() }
        catch let error as AftermapAPIError { throw error }
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
        } catch is CancellationError { throw CancellationError() }
        catch let error as URLError where error.code == .cancelled { throw CancellationError() }
        catch let error as AftermapAPIError { throw error }
        catch { throw AftermapAPIError.transport(error.localizedDescription) }
    }
}
