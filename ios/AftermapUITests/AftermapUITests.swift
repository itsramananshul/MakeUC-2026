import XCTest

final class AftermapUITests: XCTestCase {
    func testAppOpensDirectlyToWorldwideMap() {
        let app = XCUIApplication()
        app.launch()

        XCTAssertTrue(app.otherElements["world.map"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.textFields["place.search"].exists)
        XCTAssertTrue(app.buttons["route.origin"].exists)
        XCTAssertTrue(app.buttons["route.destination"].exists)
        XCTAssertTrue(app.buttons["route.preview"].exists)
        XCTAssertFalse(app.buttons["join.submit"].exists)
    }

    func testSimulatorCanChooseRouteEndpointsOnMap() {
        let app = XCUIApplication()
        app.launch()

        let origin = app.buttons["route.origin"]
        XCTAssertTrue(origin.waitForExistence(timeout: 10))
        origin.tap()
        XCTAssertTrue(app.staticTexts["Tap the map to choose your starting point"].waitForExistence(timeout: 3))

        let map = app.otherElements["world.map"]
        map.coordinate(withNormalizedOffset: CGVector(dx: 0.45, dy: 0.45)).tap()
        XCTAssertFalse(app.staticTexts["Tap the map to choose your starting point"].exists)

        let destination = app.buttons["route.destination"]
        destination.tap()
        XCTAssertTrue(app.staticTexts["Tap the map to choose your destination"].waitForExistence(timeout: 3))
        map.coordinate(withNormalizedOffset: CGVector(dx: 0.55, dy: 0.55)).tap()
        XCTAssertTrue(app.buttons["route.preview"].isEnabled)
    }
}
