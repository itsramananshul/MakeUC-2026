import XCTest

final class AftermapUITests: XCTestCase {
    func testAppOpensDirectlyToWorldwideMap() {
        let app = XCUIApplication()
        app.launchEnvironment["AFTERMAP_AUTOMATIC_LOCATION"] = "0"
        app.launch()

        XCTAssertTrue(app.otherElements["world.map"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.textFields["place.search"].exists)
        XCTAssertTrue(app.buttons["route.origin"].exists)
        XCTAssertTrue(app.buttons["route.destination"].exists)
        XCTAssertTrue(app.buttons["route.preview"].exists)
        XCTAssertTrue(app.buttons["disaster.report"].exists)
        XCTAssertTrue(app.buttons["map.useCurrentLocation"].exists)
        XCTAssertTrue(app.buttons["map.style"].exists)
        XCTAssertTrue(app.buttons["dashboard.handle"].exists)
        XCTAssertFalse(app.buttons["join.submit"].exists)
    }

    func testDashboardCanCollapseAndExpand() {
        let app = XCUIApplication()
        app.launchEnvironment["AFTERMAP_AUTOMATIC_LOCATION"] = "0"
        app.launch()

        let handle = app.buttons["dashboard.handle"]
        XCTAssertTrue(handle.waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["route.origin"].exists)

        handle.tap()
        XCTAssertFalse(app.buttons["route.origin"].waitForExistence(timeout: 1))

        handle.swipeUp()
        XCTAssertTrue(app.buttons["route.origin"].waitForExistence(timeout: 3))
    }

    func testReportDisasterOpensNativeIncidentCreationFlow() {
        let app = XCUIApplication()
        app.launchEnvironment["AFTERMAP_AUTOMATIC_LOCATION"] = "0"
        app.launch()

        let report = app.buttons["disaster.report"]
        XCTAssertTrue(report.waitForExistence(timeout: 10))
        report.tap()

        let create = app.buttons["incident.create"].firstMatch
        XCTAssertTrue(create.waitForExistence(timeout: 5))
        create.tap()

        XCTAssertTrue(app.textFields["incident.create.name"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.textFields["incident.create.locationSearch"].exists)
        XCTAssertTrue(app.buttons["incident.create.currentLocation"].exists)
        XCTAssertTrue(app.otherElements["incident.create.map"].exists)
        XCTAssertTrue(app.buttons["incident.create.submit"].exists)
        XCTAssertFalse(app.buttons["incident.create.submit"].isEnabled)
    }

    func testSimulatorCanChooseRouteEndpointsOnMap() {
        let app = XCUIApplication()
        app.launchEnvironment["AFTERMAP_AUTOMATIC_LOCATION"] = "0"
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
        app.launchEnvironment["AFTERMAP_AUTOMATIC_LOCATION"] = "0"
        app.launch()

        let addReport = app.buttons["incident.fieldReport"]
        XCTAssertTrue(addReport.waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["incident.addSurvey"].exists)
        XCTAssertTrue(app.buttons["incident.importRoads"].exists)
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
        let confirmation = app.alerts["AFTERMAP"]
        XCTAssertTrue(confirmation.waitForExistence(timeout: 5))
        XCTAssertTrue(confirmation.staticTexts["Field report added to Preview Incident."].exists)
        confirmation.buttons["OK"].tap()
    }
}
