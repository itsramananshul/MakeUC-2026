import XCTest
@testable import Aftermap

final class AftermapTests: XCTestCase {
    override func tearDown() {
        MockURLProtocol.handler = nil
        super.tearDown()
    }

    func testParsesNamespacedAndPlainCheckpointQRs() {
        XCTAssertEqual(QRPayloadParser.checkpoint(from: "aftermap:WESTHALL:C2", expectedSession: "westhall"), "C2")
        XCTAssertEqual(QRPayloadParser.checkpoint(from: "C3", expectedSession: "WESTHALL"), "C3")
        XCTAssertNil(QRPayloadParser.checkpoint(from: "aftermap:OTHER:C2", expectedSession: "WESTHALL"))
    }

    func testDecodesSharedSnapshotContract() throws {
        let json = #"""
        {"session":{"code":"WESTHALL","name":"Outdoor Drill","mode":"drill"},"version":2,
        "nodes":[{"id":"C1","label":"Staging Point","x":100,"y":200,"kind":"checkpoint"}],
        "edges":[],"participants":[{"id":"o1","displayName":"Sam","checkpointId":"C1","lastSeenAt":null}],
        "observations":[],"route":null,"previousRoute":null,"routeChange":null}
        """#.data(using: .utf8)!
        let snapshot = try JSONDecoder().decode(SessionSnapshot.self, from: json)
        XCTAssertEqual(snapshot.session.name, "Outdoor Drill")
        XCTAssertEqual(snapshot.nodes.first?.label, "Staging Point")
        XCTAssertEqual(snapshot.version, 2)
        XCTAssertNil(snapshot.imagery)
    }

    func testDecodesAlignedImageryAndResolvesRelativeURL() throws {
        let json = #"""
        {"session":{"code":"WESTHALL","name":"Mexico Beach","mode":"drill"},"version":3,
        "nodes":[],"edges":[],"participants":[],"observations":[],"route":null,"previousRoute":null,
        "imagery":{"url":"/api/imagery/frame-1","label":"Drone mosaic","source":"Test flight","timestamp":"2026-11-07T22:00:00Z","bounds":[-10,20,-9,21],"aligned":true,"width":1000,"height":720,"count":12},
        "routeChange":null}
        """#.data(using: .utf8)!
        let snapshot = try JSONDecoder().decode(SessionSnapshot.self, from: json)
        let imagery = try XCTUnwrap(snapshot.imagery)
        XCTAssertTrue(imagery.aligned)
        XCTAssertEqual(imagery.bounds, [-10, 20, -9, 21])
        XCTAssertEqual(imagery.resolvedURL(against: "https://example.test:8443/base")?.absoluteString, "https://example.test:8443/api/imagery/frame-1")
    }

    func testAbsoluteImageryURLIsPreserved() {
        let url = ImageryLayer.resolve("https://cdn.example.test/aerial.jpg", against: "https://example.test")
        XCTAssertEqual(url?.absoluteString, "https://cdn.example.test/aerial.jpg")
    }

    func testUnalignedImageryKeepsMexicoBeachBaseAerial() {
        var snapshot = SessionSnapshot.preview
        snapshot.imagery = ImageryLayer(
            url: "/api/imagery/unaligned", label: "Unaligned upload", source: "Test", timestamp: "2026-11-07T22:00:00Z",
            bounds: [0, 0, 1, 1], aligned: false, width: 800, height: 600, count: 4
        )
        XCTAssertEqual(
            snapshot.preferredMapImageryURL(against: "https://example.test")?.absoluteString,
            "https://example.test/mexico-beach-noaa.jpg"
        )
        XCTAssertTrue(snapshot.mapImageryAttribution.contains("NOAA"))
    }

    func testObservationRequestKeepsStableIdAndConfirmation() throws {
        let id = "88c7b2e1-1fc1-4f3e-9000-bd4491d3450d"
        let request = ObservationRequest(id: id, observerId: "observer", checkpointId: "C1", kind: .passage, from: "C1", to: "C2", nodeId: nil, status: .blocked, evidenceType: "voice", confidence: 0.88, note: "Debris", confirmed: true)
        let data = try JSONEncoder().encode(request)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(object["id"] as? String, id)
        XCTAssertEqual(object["confirmed"] as? Bool, true)
        XCTAssertEqual(object["status"] as? String, "blocked")
    }

    func testJoinUsesCaseInsensitiveSessionPathAndExpectedBody() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let session = URLSession(configuration: configuration)
        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/sessions/WESTHALL/join")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
            let response = #"{"observerId":"device-1","state":{"session":{"code":"WESTHALL","name":"Field Drill","mode":"drill"},"version":1,"nodes":[],"edges":[],"participants":[],"observations":[],"route":null,"previousRoute":null,"routeChange":null}}"#.data(using: .utf8)!
            return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, response)
        }
        let result = try await APIClient(baseURL: "http://10.0.0.2:3000/", sessionCode: "westhall", urlSession: session).join(observerId: nil, displayName: "Alex")
        XCTAssertEqual(result.observerId, "device-1")
    }

    func testBackendErrorStringIsPreserved() async {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let session = URLSession(configuration: configuration)
        MockURLProtocol.handler = { request in
            let data = #"{"error":"Unknown checkpoint C9"}"#.data(using: .utf8)!
            return (HTTPURLResponse(url: request.url!, statusCode: 400, httpVersion: nil, headerFields: nil)!, data)
        }
        do {
            _ = try await APIClient(baseURL: "http://localhost:3000", sessionCode: "WESTHALL", urlSession: session).snapshot()
            XCTFail("Expected an API error")
        } catch {
            XCTAssertEqual(error.localizedDescription, "Unknown checkpoint C9")
        }
    }

    func testDecodesEmptyWorldwideIncidentList() throws {
        let data = #"{"incidents":[]}"#.data(using: .utf8)!
        let response = try JSONDecoder().decode(IncidentListResponse.self, from: data)
        XCTAssertTrue(response.incidents.isEmpty)
    }

    func testIncidentBoundsDetectsRouteIntersection() {
        let bounds = IncidentBounds(west: -85.0, south: 29.0, east: -84.0, north: 30.0)
        XCTAssertTrue(bounds.intersects([
            IncidentCoordinate(latitude: 29.5, longitude: -85.5),
            IncidentCoordinate(latitude: 29.5, longitude: -83.5)
        ]))
        XCTAssertFalse(bounds.intersects([
            IncidentCoordinate(latitude: 35, longitude: -90),
            IncidentCoordinate(latitude: 36, longitude: -89)
        ]))
    }

    func testOrdinaryRouteUsesSharedContractAndPreservesUnavailableReason() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let session = URLSession(configuration: configuration)
        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/routes")
            XCTAssertEqual(request.httpMethod, "POST")
            let object = try XCTUnwrap(JSONSerialization.jsonObject(with: try requestBody(request)) as? [String: Any])
            XCTAssertNotNil(object["origin"])
            XCTAssertNotNil(object["destination"])
            let data = #"{"status":"unavailable","coordinates":[],"distanceMeters":0,"reason":"No verified path around the affected area."}"#.data(using: .utf8)!
            return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, data)
        }
        let client = IncidentAPIClient(baseURL: "https://aftermap.example", urlSession: session)
        let route = try await client.ordinaryRoute(
            origin: IncidentCoordinate(latitude: 40, longitude: -73),
            destination: IncidentCoordinate(latitude: 40.1, longitude: -73.1)
        )
        XCTAssertEqual(route.status, .unavailable)
        XCTAssertEqual(route.reason, "No verified path around the affected area.")
    }

    func testIncidentReportUsesBearerKeyAndExactRoadEvidenceContract() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let session = URLSession(configuration: configuration)
        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/incidents/storm-1/reports")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer shared-secret")
            let object = try XCTUnwrap(JSONSerialization.jsonObject(with: try requestBody(request)) as? [String: Any])
            XCTAssertEqual(object["edgeId"] as? String, "road-7")
            XCTAssertEqual(object["condition"] as? String, "blocked")
            XCTAssertEqual(object["confirmed"] as? Bool, true)
            let data = #"{"ok":true}"#.data(using: .utf8)!
            return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, data)
        }
        let request = IncidentReportRequest(
            id: "report-1", displayName: "Alex", edgeId: "road-7", condition: .blocked,
            note: "Downed tree", evidenceType: "manual", confirmed: true
        )
        try await IncidentAPIClient(baseURL: "https://aftermap.example", urlSession: session)
            .submitReport(incidentId: "storm-1", key: "shared-secret", request: request)
    }

    func testPlaceSearchEncodesQueryAndDecodesResult() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let session = URLSession(configuration: configuration)
        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/places")
            XCTAssertEqual(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first?.value, "New York")
            let data = #"{"places":[{"id":"nyc","name":"New York","detail":"New York, USA","latitude":40.7128,"longitude":-74.006}]}"#.data(using: .utf8)!
            return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, data)
        }
        let places = try await IncidentAPIClient(baseURL: "https://aftermap.example", urlSession: session).places(query: "New York")
        XCTAssertEqual(places.first?.id, "nyc")
    }
}

private func requestBody(_ request: URLRequest) throws -> Data {
    if let body = request.httpBody { return body }
    guard let stream = request.httpBodyStream else {
        throw NSError(domain: "AftermapTests", code: 1, userInfo: [NSLocalizedDescriptionKey: "Request has no body"])
    }
    stream.open()
    defer { stream.close() }
    var result = Data()
    var buffer = [UInt8](repeating: 0, count: 1024)
    while stream.hasBytesAvailable {
        let count = stream.read(&buffer, maxLength: buffer.count)
        if count < 0 { throw stream.streamError ?? NSError(domain: "AftermapTests", code: 2) }
        if count == 0 { break }
        result.append(buffer, count: count)
    }
    return result
}

private final class MockURLProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let handler = Self.handler else { return }
        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}
