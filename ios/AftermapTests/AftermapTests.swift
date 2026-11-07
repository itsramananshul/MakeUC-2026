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
