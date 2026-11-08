import XCTest

final class AftermapUITests: XCTestCase {
    private func firstExisting(_ candidates: [XCUIElement], timeout: TimeInterval = 3) -> XCUIElement? {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if let match = candidates.first(where: \.exists) { return match }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        } while Date() < deadline
        return candidates.first(where: \.exists)
    }

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

    func testRouteEndpointCanBeChosenDirectlyOnMap() {
        let app = XCUIApplication()
        app.launchEnvironment["AFTERMAP_AUTOMATIC_LOCATION"] = "0"
        app.launch()

        let origin = app.buttons["route.origin"]
        XCTAssertTrue(origin.waitForExistence(timeout: 10))
        origin.tap()
        let chooseOnMap = app.buttons["route.endpoint.chooseOnMap"]
        XCTAssertTrue(chooseOnMap.waitForExistence(timeout: 3))
        chooseOnMap.tap()

        XCTAssertTrue(app.staticTexts["Tap the map to choose your starting point"].waitForExistence(timeout: 5))
        app.otherElements["world.map"].coordinate(withNormalizedOffset: CGVector(dx: 0.48, dy: 0.42)).tap()
        XCTAssertFalse(app.staticTexts["Tap the map to choose your starting point"].exists)
    }

    func testStartNavigationShowsLiveGuidanceControls() {
        let app = XCUIApplication()
        app.launchEnvironment["AFTERMAP_AUTOMATIC_LOCATION"] = "0"
        app.launchEnvironment["AFTERMAP_NAVIGATION_PREVIEW"] = "1"
        app.launch()

        let directions = app.buttons["route.preview"]
        XCTAssertTrue(directions.waitForExistence(timeout: 10))
        directions.tap()

        let start = app.buttons["navigation.start"]
        XCTAssertTrue(start.waitForExistence(timeout: 5))
        start.tap()

        XCTAssertTrue(app.otherElements["navigation.banner"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["navigation.instruction"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["navigation.remaining"].waitForExistence(timeout: 5))
        let recenter = app.buttons["navigation.recenter"]
        XCTAssertTrue(recenter.exists)
        XCTAssertTrue(app.buttons["navigation.end"].exists)

        let map = app.otherElements["world.map"]
        let startPoint = map.coordinate(withNormalizedOffset: CGVector(dx: 0.65, dy: 0.45))
        startPoint.press(forDuration: 0.1, thenDragTo: startPoint.withOffset(CGVector(dx: -100, dy: 0)))
        XCTAssertTrue(recenter.waitForExistence(timeout: 2))
        XCTAssertEqual(recenter.value as? String, "Free")

        recenter.tap()
        XCTAssertEqual(recenter.value as? String, "Following")
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

    func testGeoTIFFFilesImporterPublishesSurvey() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let serverURL = environment["AFTERMAP_IMPORT_TEST_SERVER_URL"],
              let reportKey = environment["AFTERMAP_IMPORT_TEST_REPORT_KEY"],
              let incidentID = environment["AFTERMAP_IMPORT_TEST_INCIDENT_ID"] else {
            throw XCTSkip("Set the isolated importer-test server, report key, and incident ID to run this test.")
        }
        let fileLabels = ["detail", "northwest", "northeast", "Riverfront-west", "Riverfront-east"]

        let app = XCUIApplication()
        app.launchEnvironment["AFTERMAP_AUTOMATIC_LOCATION"] = "0"
        app.launchEnvironment["AFTERMAP_TEST_SERVER_URL"] = serverURL
        app.launchEnvironment["AFTERMAP_TEST_REPORT_KEY"] = reportKey
        app.launch()

        let report = app.buttons["disaster.report"]
        XCTAssertTrue(report.waitForExistence(timeout: 15))
        report.tap()

        let incident = app.buttons["incident.open.\(incidentID)"]
        XCTAssertTrue(incident.waitForExistence(timeout: 15))
        incident.tap()

        let addSurvey = app.buttons["incident.addSurvey"]
        XCTAssertTrue(addSurvey.waitForExistence(timeout: 15))
        addSurvey.tap()

        let documents = XCUIApplication(bundleIdentifier: "com.apple.DocumentsApp")

        let pickerAlreadyShowsLocalStorage = app.navigationBars["On My iPhone"].exists
            || documents.navigationBars["On My iPhone"].exists
        if !pickerAlreadyShowsLocalStorage, let browse = firstExisting([
            documents.tabBars.buttons["Browse"].firstMatch,
            app.tabBars.buttons["Browse"].firstMatch,
            documents.buttons["Browse"].firstMatch,
            app.buttons["Browse"].firstMatch,
        ], timeout: 1) { browse.tap() }

        if !app.navigationBars["On My iPhone"].exists, let local = firstExisting([
            documents.staticTexts["On My iPhone"].firstMatch, documents.buttons["On My iPhone"].firstMatch,
            app.staticTexts["On My iPhone"].firstMatch, app.buttons["On My iPhone"].firstMatch,
        ]) { local.tap() }

        let folder = firstExisting([
            documents.staticTexts["Cincinnati Import Verification"].firstMatch,
            documents.buttons["Cincinnati Import Verification"].firstMatch,
            app.staticTexts["Cincinnati Import Verification"].firstMatch,
            app.buttons["Cincinnati Import Verification"].firstMatch,
        ], timeout: 5)
        XCTAssertNotNil(folder, "The seeded folder must be visible in the native Files picker.")
        folder?.tap()

        if let select = firstExisting([documents.buttons["Select"], app.buttons["Select"]], timeout: 1) {
            select.tap()
        }
        for fileLabel in fileLabels {
            let predicate = NSPredicate(format: "label CONTAINS[c] %@", fileLabel)
            let file = firstExisting([
                app.descendants(matching: .any).matching(predicate).firstMatch,
                documents.descendants(matching: .any).matching(predicate).firstMatch,
            ], timeout: 5)
            XCTAssertNotNil(file, "Missing \(fileLabel) in the native Files picker.")
            file?.tap()
        }

        let open = firstExisting([documents.buttons["Open"], app.buttons["Open"]], timeout: 5)
        XCTAssertNotNil(open, "The native Files picker did not expose its Open action.")
        open?.tap()

        let confirmation = app.alerts["Gaslight Maps"]
        XCTAssertTrue(confirmation.waitForExistence(timeout: 120))
        XCTAssertTrue(confirmation.staticTexts["Aerial survey published and aligned to the map."].exists)
        confirmation.buttons["OK"].tap()
    }
}
