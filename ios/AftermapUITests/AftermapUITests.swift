import XCTest

final class AftermapUITests: XCTestCase {
    func testManualReportCompletesParticipantLoop() {
        let app = XCUIApplication()
        app.launchArguments = ["-aftermapPreview", "-aftermapReport"]
        app.launchEnvironment["AFTERMAP_PREVIEW"] = "1"
        app.launchEnvironment["AFTERMAP_REPORT"] = "1"
        app.launch()

        let confirmPosition = app.buttons["report.confirmPosition"]
        XCTAssertTrue(confirmPosition.waitForExistence(timeout: 5))
        confirmPosition.tap()

        let prepareReview = app.buttons["report.prepareReview"]
        XCTAssertTrue(prepareReview.waitForExistence(timeout: 5))
        prepareReview.tap()

        let submit = app.buttons["report.submit"]
        XCTAssertTrue(submit.waitForExistence(timeout: 5))
        submit.tap()

        let alert = app.alerts["AFTERMAP"]
        XCTAssertTrue(alert.waitForExistence(timeout: 5))
        XCTAssertTrue(alert.staticTexts["Confirmed report added to the shared map."].exists)
        alert.buttons["OK"].tap()
        XCTAssertTrue(app.buttons["map.addReport"].waitForExistence(timeout: 5))
    }

    func testLiveServerJoinAndMexicoBeachSnapshot() throws {
        guard let serverURL = ProcessInfo.processInfo.environment["AFTERMAP_LIVE_URL"], !serverURL.isEmpty else {
            throw XCTSkip("Set AFTERMAP_LIVE_URL to opt into the non-mutating live join check.")
        }
        let suffix = UUID().uuidString.prefix(6)
        let app = XCUIApplication()
        app.launchArguments = [
            "-aftermap.serverURL", serverURL,
            "-aftermap.sessionCode", "WESTHALL",
            "-aftermap.displayName", "Test-iOS-\(suffix)",
            "-aftermap.observerId", ""
        ]
        app.launch()

        let join = app.buttons["join.submit"]
        XCTAssertTrue(join.waitForExistence(timeout: 8))
        join.tap()

        XCTAssertTrue(app.staticTexts["Mexico Beach"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["map.node.ATRIUM"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["map.addReport"].exists)
    }
}
