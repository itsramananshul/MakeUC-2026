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

        let handleCenter = handle.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        handleCenter.press(
            forDuration: 0.1,
            thenDragTo: handleCenter.withOffset(CGVector(dx: 0, dy: 190))
        )
        XCTAssertFalse(app.buttons["route.origin"].waitForExistence(timeout: 1))

        let collapsedHandle = app.buttons["dashboard.handle"]
        let collapsedCenter = collapsedHandle.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        collapsedCenter.press(
            forDuration: 0.1,
            thenDragTo: collapsedCenter.withOffset(CGVector(dx: 0, dy: -260))
        )
        XCTAssertTrue(app.buttons["route.origin"].waitForExistence(timeout: 3))
    }

    func testSearchOpensPlaceCardAndDirectionsModes() {
        let app = XCUIApplication()
        app.launchEnvironment["AFTERMAP_AUTOMATIC_LOCATION"] = "0"
        app.launchEnvironment["AFTERMAP_SEARCH_PREVIEW"] = "1"
        app.launch()

        let search = app.textFields["place.search"]
        XCTAssertTrue(search.waitForExistence(timeout: 10))
        search.tap()
        search.typeText("Gandhinagar")

        let result = app.buttons["place.result.gandhinagar-preview"]
        XCTAssertTrue(result.waitForExistence(timeout: 5))
        search.typeText("\n")

        let directions = app.buttons["place.directions"]
        XCTAssertTrue(directions.waitForExistence(timeout: 5))
        directions.tap()

        XCTAssertTrue(app.staticTexts["Directions"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["route.mode.driving"].exists)
        XCTAssertTrue(app.buttons["route.mode.walking"].exists)
        XCTAssertTrue(app.buttons["route.mode.cycling"].exists)
        XCTAssertTrue(app.buttons["route.mode.transit"].exists)
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

    func testRouteEndpointsUseTypedPlaceSearch() {
        let app = XCUIApplication()
        app.launchEnvironment["AFTERMAP_AUTOMATIC_LOCATION"] = "0"
        app.launchEnvironment["AFTERMAP_SEARCH_PREVIEW"] = "1"
        app.launch()

        let origin = app.buttons["route.origin"]
        XCTAssertTrue(origin.waitForExistence(timeout: 10))
        origin.tap()
        let originSearch = app.textFields["route.endpoint.search"]
        XCTAssertTrue(originSearch.waitForExistence(timeout: 3))
        originSearch.typeText("Start address")
        let startResult = app.buttons["route.endpoint.result.start-preview"]
        XCTAssertTrue(startResult.waitForExistence(timeout: 5))
        startResult.tap()

        let destination = app.buttons["route.destination"]
        XCTAssertTrue(destination.waitForExistence(timeout: 3))
        destination.tap()
        let destinationSearch = app.textFields["route.endpoint.search"]
        XCTAssertTrue(destinationSearch.waitForExistence(timeout: 3))
        destinationSearch.typeText("Coffee shop")
        let destinationResult = app.buttons["route.endpoint.result.destination-preview"]
        XCTAssertTrue(destinationResult.waitForExistence(timeout: 5))
        destinationResult.tap()

        XCTAssertTrue(app.buttons["route.preview"].isEnabled)
        XCTAssertFalse(app.staticTexts["Tap the map to choose your destination"].exists)
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
        let confirmation = app.alerts["Gaslight Maps"]
        XCTAssertTrue(confirmation.waitForExistence(timeout: 5))
        XCTAssertTrue(confirmation.staticTexts["Field report added to Preview Incident."].exists)
        confirmation.buttons["OK"].tap()
    }
}
