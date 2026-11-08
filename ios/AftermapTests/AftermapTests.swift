import XCTest
import CoreLocation
import UIKit
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

    func testMapStyleFollowsSystemAppearance() {
        XCTAssertEqual(MapLibreWorldMap.styleURL(for: .light).lastPathComponent, "liberty")
        XCTAssertEqual(MapLibreWorldMap.styleURL(for: .dark).lastPathComponent, "fiord")
    }

    @MainActor
    func testSatelliteIsTheDefaultMapStyleAndStreetsRemainAvailable() {
        let suite = "AFTERMAP.MapStyle.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = WorldMapStore(defaults: defaults)

        XCTAssertEqual(store.mapStyle, .satellite)
        XCTAssertEqual(
            MapLibreWorldMap.styleURL(for: store.mapStyle, colorScheme: .light).lastPathComponent,
            "liberty"
        )

        store.mapStyle = .streets
        XCTAssertEqual(MapLibreWorldMap.styleURL(for: store.mapStyle, colorScheme: .dark).lastPathComponent, "fiord")
        XCTAssertEqual(defaults.string(forKey: "aftermap.mapStyle"), "streets")
    }

    @MainActor
    func testExpiredDevelopmentServerMigratesToProduction() {
        for staleServer in [
            "https://guardian-administrative-percent-attention.trycloudflare.com",
            "https://aftermap-makeuc.vercel.app",
            "http://localhost:3000",
        ] {
            let suite = "AFTERMAP.ServerMigration.\(UUID().uuidString)"
            let defaults = UserDefaults(suiteName: suite)!
            defer { defaults.removePersistentDomain(forName: suite) }
            defaults.set(staleServer, forKey: "aftermap.serverURL")

            let store = WorldMapStore(defaults: defaults)

            XCTAssertEqual(store.serverURL, WorldMapStore.productionServerURL)
            XCTAssertEqual(defaults.string(forKey: "aftermap.serverURL"), WorldMapStore.productionServerURL)
        }
    }

    @MainActor
    func testCustomProductionServerIsPreserved() {
        let suite = "AFTERMAP.CustomServer.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set("https://maps.example.org", forKey: "aftermap.serverURL")

        let store = WorldMapStore(defaults: defaults)

        XCTAssertEqual(store.serverURL, "https://maps.example.org")
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

    func testIncidentBoundsCreatesBackendCompatibleSquare() throws {
        let center = IncidentCoordinate(latitude: 39.1031, longitude: -84.5120)
        let bounds = try XCTUnwrap(IncidentBounds.square(center: center, widthKilometers: 2))

        XCTAssertEqual((bounds.south + bounds.north) / 2, center.latitude, accuracy: 0.000_001)
        XCTAssertEqual((bounds.west + bounds.east) / 2, center.longitude, accuracy: 0.000_001)
        XCTAssertNil(IncidentBounds.square(center: center, widthKilometers: 11))
        XCTAssertNil(IncidentBounds.square(
            center: IncidentCoordinate(latitude: 84.999, longitude: 179.999),
            widthKilometers: 4
        ))
    }

    func testCreateIncidentUsesOperatorBearerAndSharedBoundsContract() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let session = URLSession(configuration: configuration)
        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/incidents")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer workspace-secret")
            let object = try XCTUnwrap(JSONSerialization.jsonObject(with: try requestBody(request)) as? [String: Any])
            XCTAssertEqual(object["name"] as? String, "Riverside flood")
            let bounds = try XCTUnwrap(object["bounds"] as? [String: Double])
            XCTAssertLessThan(bounds["west"]!, bounds["east"]!)
            XCTAssertLessThan(bounds["south"]!, bounds["north"]!)
            let data = #"{"incident":{"id":"flood-1","name":"Riverside flood","kind":"incident","bounds":{"west":-84.52,"south":39.10,"east":-84.51,"north":39.11},"imagery":null,"version":1,"roadCount":0},"key":"incident-secret"}"#.data(using: .utf8)!
            return (HTTPURLResponse(url: request.url!, statusCode: 201, httpVersion: nil, headerFields: nil)!, data)
        }
        let center = IncidentCoordinate(latitude: 39.105, longitude: -84.515)
        let bounds = try XCTUnwrap(IncidentBounds.square(center: center, widthKilometers: 1))
        let response = try await IncidentAPIClient(baseURL: "https://aftermap.example", urlSession: session)
            .createIncident(name: "Riverside flood", bounds: bounds, operatorKey: "workspace-secret")

        XCTAssertEqual(response.incident.id, "flood-1")
        XCTAssertEqual(response.key, "incident-secret")
    }

    func testGeoTIFFUploadUsesAuthorizedMultipartContract() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let session = URLSession(configuration: configuration)
        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/incidents/flood-1/imagery")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer incident-secret")
            XCTAssertTrue(request.value(forHTTPHeaderField: "Content-Type")?.hasPrefix("multipart/form-data; boundary=") == true)
            let body = try requestBody(request)
            let text = String(decoding: body, as: UTF8.self)
            XCTAssertTrue(text.contains("name=\"files\"; filename=\"survey.tif\""))
            XCTAssertTrue(text.contains("Content-Type: image/tiff"))
            XCTAssertTrue(text.contains("TIFF-BYTES"))
            let data = #"{"incident":{"id":"flood-1","name":"Riverside flood","kind":"incident","bounds":{"west":-84.52,"south":39.10,"east":-84.51,"north":39.11},"imagery":{"url":"/api/imagery/a1","bounds":{"west":-84.52,"south":39.10,"east":-84.51,"north":39.11},"source":"Uploaded GeoTIFF","timestamp":"2026-11-07T22:00:00Z"},"version":2,"roadCount":0,"roads":[],"reports":[]}}"#.data(using: .utf8)!
            return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, data)
        }
        let detail = try await IncidentAPIClient(baseURL: "https://aftermap.example", urlSession: session)
            .uploadGeoTIFFs(
                incidentId: "flood-1",
                key: "incident-secret",
                files: [IncidentSurveyFile(name: "survey.tif", data: Data("TIFF-BYTES".utf8))]
            )

        XCTAssertEqual(detail.imagery?.source, "Uploaded GeoTIFF")
        XCTAssertEqual(detail.version, 2)
    }

    func testRoadImportUsesIncidentAuthorizationContract() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let session = URLSession(configuration: configuration)
        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/incidents/flood-1/roads")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer incident-secret")
            let data = #"{"incident":{"id":"flood-1","name":"Riverside flood","kind":"incident","bounds":{"west":-84.52,"south":39.10,"east":-84.51,"north":39.11},"imagery":null,"version":2,"roadCount":1,"roads":[{"id":"r1","from":{"latitude":39.10,"longitude":-84.52},"to":{"latitude":39.11,"longitude":-84.51},"state":"unknown","label":"River Road"}],"reports":[]}}"#.data(using: .utf8)!
            return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, data)
        }
        let detail = try await IncidentAPIClient(baseURL: "https://aftermap.example", urlSession: session)
            .importRoads(incidentId: "flood-1", key: "incident-secret")

        XCTAssertEqual(detail.roadCount, 1)
        XCTAssertEqual(detail.roads.first?.label, "River Road")
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
            XCTAssertEqual(object["mode"] as? String, "walking")
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

    @MainActor
    func testSearchSelectionOpensPlaceCardBeforeBecomingDestination() {
        let suite = "AFTERMAP.PlaceCard.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = WorldMapStore(defaults: defaults)
        let place = PlaceResult(
            id: "gandhinagar",
            name: "Gandhinagar",
            detail: "Gujarat, India",
            latitude: 23.2156,
            longitude: 72.6369
        )

        store.choosePlace(place)

        XCTAssertEqual(store.selectedPlace, place)
        XCTAssertNil(store.destination)

        store.useSelectedPlaceAsDestination()

        XCTAssertEqual(store.destination, place.coordinate)
        XCTAssertEqual(store.travelMode, .driving)
    }

    func testRouteRequestCarriesSelectedTravelMode() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let session = URLSession(configuration: configuration)
        MockURLProtocol.handler = { request in
            let object = try XCTUnwrap(JSONSerialization.jsonObject(with: try requestBody(request)) as? [String: Any])
            XCTAssertEqual(object["mode"] as? String, "cycling")
            let data = #"{"status":"complete","coordinates":[{"latitude":40,"longitude":-73},{"latitude":40.1,"longitude":-73.1}],"distanceMeters":15000,"reason":"Standard cycling route."}"#.data(using: .utf8)!
            return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, data)
        }

        let route = try await IncidentAPIClient(baseURL: "https://aftermap.example", urlSession: session).ordinaryRoute(
            origin: IncidentCoordinate(latitude: 40, longitude: -73),
            destination: IncidentCoordinate(latitude: 40.1, longitude: -73.1),
            mode: .cycling
        )

        XCTAssertEqual(route.status, .complete)
    }

    @MainActor
    func testIncidentRouteCrossingSecondIncidentIsWithheld() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let session = URLSession(configuration: configuration)
        MockURLProtocol.handler = { request in
            if request.httpMethod == "GET" {
                let data = #"{"incidents":[{"id":"a","name":"Flood A","kind":"incident","bounds":{"west":-85.0,"south":39.0,"east":-84.9,"north":39.1},"imagery":null,"version":1,"roadCount":2},{"id":"b","name":"Fire B","kind":"incident","bounds":{"west":-84.8,"south":39.0,"east":-84.7,"north":39.1},"imagery":null,"version":1,"roadCount":2}]}"#.data(using: .utf8)!
                return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, data)
            }
            XCTAssertEqual(request.url?.path, "/api/incidents/a/route")
            let data = #"{"status":"complete","coordinates":[{"latitude":39.05,"longitude":-84.95},{"latitude":39.05,"longitude":-84.75},{"latitude":39.05,"longitude":-84.6}],"distanceMeters":22000,"reason":"Verified around Flood A."}"#.data(using: .utf8)!
            return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, data)
        }
        let suite = "AFTERMAP.CrossIncidentRoute.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = WorldMapStore(defaults: defaults, urlSession: session)
        store.serverURL = "https://aftermap.example"
        await store.refreshIncidents()
        store.origin = IncidentCoordinate(latitude: 39.05, longitude: -84.95)
        store.destination = IncidentCoordinate(latitude: 39.05, longitude: -84.6)
        store.travelMode = .walking

        await store.previewRoute()

        guard case let .unavailable(reason) = store.routeState else {
            return XCTFail("Expected the cross-incident route to be withheld")
        }
        XCTAssertTrue(reason.contains("Fire B"))
        XCTAssertTrue(reason.contains("cross-incident verification"))
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
            note: "Downed tree", evidenceType: "manual", location: nil, photoBase64: nil, confirmed: true
        )
        try await IncidentAPIClient(baseURL: "https://aftermap.example", urlSession: session)
            .submitReport(incidentId: "storm-1", key: "shared-secret", request: request)
    }

    func testPointPhotoReportOmitsRoadFieldsAndIncludesMappedLocation() throws {
        let request = IncidentReportRequest(
            id: "point-report-1",
            displayName: "Alex",
            edgeId: nil,
            condition: nil,
            note: "Water across the entrance",
            evidenceType: "image",
            location: IncidentCoordinate(latitude: 39.1013, longitude: -84.5127),
            photoBase64: "/9j/2Q==",
            confirmed: true
        )
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any])
        XCTAssertNil(object["edgeId"])
        XCTAssertNil(object["condition"])
        XCTAssertEqual(object["photoBase64"] as? String, "/9j/2Q==")
        let location = try XCTUnwrap(object["location"] as? [String: Any])
        XCTAssertEqual(location["latitude"] as? Double, 39.1013)
        XCTAssertEqual(location["longitude"] as? Double, -84.5127)
    }

    func testEvidencePhotoIsConvertedToBoundedJPEG() throws {
        let size = CGSize(width: 2_400, height: 1_800)
        let image = UIGraphicsImageRenderer(size: size).image { context in
            UIColor.systemBlue.setFill()
            context.fill(CGRect(origin: .zero, size: size))
        }
        let data = try XCTUnwrap(IncidentPhotoProcessor.jpegData(from: image))
        XCTAssertLessThanOrEqual(data.count, IncidentPhotoProcessor.maximumJPEGBytes)
        XCTAssertEqual(Array(data.prefix(3)), [0xff, 0xd8, 0xff])
        let prepared = try XCTUnwrap(UIImage(data: data))
        XCTAssertLessThanOrEqual(max(prepared.size.width, prepared.size.height), 1_600)
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

    @MainActor
    func testCanceledPlaceSearchDoesNotShowAnAlert() async {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let session = URLSession(configuration: configuration)
        MockURLProtocol.handler = { _ in throw URLError(.cancelled) }
        let suite = "AFTERMAP.SearchCancellation.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = WorldMapStore(defaults: defaults, urlSession: session)
        store.query = "Cincinnati"

        await store.search()

        XCTAssertNil(store.notice)
        XCTAssertTrue(store.places.isEmpty)
        XCTAssertFalse(store.isSearching)
    }

    @MainActor
    func testThrottledPlaceSearchRetriesWithoutShowingAnAlert() async {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let session = URLSession(configuration: configuration)
        var requestCount = 0
        MockURLProtocol.handler = { request in
            requestCount += 1
            if requestCount == 1 {
                let data = #"{"error":"Wait briefly before searching again."}"#.data(using: .utf8)!
                return (HTTPURLResponse(url: request.url!, statusCode: 429, httpVersion: nil, headerFields: nil)!, data)
            }
            let data = #"{"places":[{"id":"gandhinagar","name":"Gandhinagar","detail":"Gujarat, India","latitude":23.2156,"longitude":72.6369}]}"#.data(using: .utf8)!
            return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, data)
        }
        let suite = "Aftermap.SearchThrottle.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = WorldMapStore(defaults: defaults, urlSession: session)
        store.query = "Gandhinagar"

        await store.search()

        XCTAssertEqual(requestCount, 2)
        XCTAssertEqual(store.places.first?.name, "Gandhinagar")
        XCTAssertNil(store.searchMessage)
        XCTAssertNil(store.notice)
        XCTAssertFalse(store.isSearching)
    }

    @MainActor
    func testAcceptedAutomaticLocationBecomesRouteStart() {
        let suite = "AFTERMAP.AutomaticLocation.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = WorldMapStore(defaults: defaults)

        store.requestCurrentLocationAsOrigin(userInitiated: false)
        store.acceptUserLocation(CLLocationCoordinate2D(latitude: 39.1031, longitude: -84.5120))

        XCTAssertEqual(store.origin?.latitude, 39.1031)
        XCTAssertEqual(store.origin?.longitude, -84.5120)
        XCTAssertNil(store.notice)
    }

    @MainActor
    func testDeclinedAutomaticLocationStaysSilent() {
        let suite = "AFTERMAP.DeclinedLocation.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = WorldMapStore(defaults: defaults)

        store.requestCurrentLocationAsOrigin(userInitiated: false)
        store.locationFailed("Location permission was denied.")

        XCTAssertNil(store.origin)
        XCTAssertNil(store.notice)
    }

    @MainActor
    func testDeclinedManualLocationShowsHelpfulNotice() {
        let suite = "AFTERMAP.ManualLocation.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = WorldMapStore(defaults: defaults)

        store.requestCurrentLocationAsOrigin()
        store.locationFailed("Location permission was denied. Choose a start point on the map instead.")

        XCTAssertEqual(store.notice, "Location permission was denied. Choose a start point on the map instead.")
    }

    func testLiveWorldContract() async throws {
        guard let serverURL = ProcessInfo.processInfo.environment["AFTERMAP_LIVE_WORLD_URL"], !serverURL.isEmpty else {
            throw XCTSkip("Set AFTERMAP_LIVE_WORLD_URL to opt into the read-only production contract check.")
        }
        let client = IncidentAPIClient(baseURL: serverURL)
        _ = try await client.incidents()

        let places = try await client.places(query: "Cincinnati")
        XCTAssertFalse(places.isEmpty)

        let route = try await client.ordinaryRoute(
            origin: IncidentCoordinate(latitude: 39.1329, longitude: -84.5150),
            destination: IncidentCoordinate(latitude: 39.1031, longitude: -84.5120)
        )
        XCTAssertEqual(route.status, .complete)
        XCTAssertGreaterThan(route.coordinates.count, 2)
        XCTAssertGreaterThan(route.distanceMeters, 0)
        XCTAssertFalse(route.reason.isEmpty)
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
