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
        XCTAssertTrue(app.buttons["map.useCurrentLocation"].exists)
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

    func testFieldReportCanChooseMapPointWithoutTypingCoordinates() {
        let app = XCUIApplication()
        app.launchArguments = ["-aftermapIncidentPreview"]
        app.launchEnvironment["AFTERMAP_INCIDENT_PREVIEW"] = "1"
        app.launch()

        let addReport = app.buttons["incident.fieldReport"]
        XCTAssertTrue(addReport.waitForExistence(timeout: 10))
        addReport.tap()

        let choosePoint = app.buttons["Choose point on map"]
        XCTAssertTrue(choosePoint.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Use my current location"].exists)
        XCTAssertTrue(app.buttons["Choose from Photo Library"].exists)
        choosePoint.tap()

        XCTAssertTrue(app.staticTexts["Tap inside the incident to place your field report"].waitForExistence(timeout: 5))
        let map = app.otherElements["world.map"]
        map.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.48)).tap()

        XCTAssertTrue(app.staticTexts["Map point selected inside incident"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["report.submit"].isEnabled)
        XCTAssertFalse(app.textFields.matching(NSPredicate(format: "placeholderValue CONTAINS[c] 'latitude' OR placeholderValue CONTAINS[c] 'longitude'")).firstMatch.exists)

        app.buttons["report.submit"].tap()
        let confirmation = app.alerts["Gaslight Maps"]
        XCTAssertTrue(confirmation.waitForExistence(timeout: 5))
        XCTAssertTrue(confirmation.staticTexts["Field report added to Preview Incident."].exists)
        confirmation.buttons["OK"].tap()
    }
}
