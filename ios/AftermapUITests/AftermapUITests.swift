import XCTest

final class AftermapUITests: XCTestCase {
    func testManualReportCompletesParticipantLoop() {
        let app = XCUIApplication()
        app.launchArguments = ["-aftermapPreview", "-aftermapReport"]
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
}
