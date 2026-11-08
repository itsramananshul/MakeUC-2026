import MapKit

struct AppleDirectionsService {
    func routes(
        origin: IncidentCoordinate,
        destination: IncidentCoordinate,
        mode: RouteTravelMode
    ) async throws -> [IncidentRouteResponse] {
        guard let transportType = transportType(for: mode) else { return [] }

        let request = MKDirections.Request()
        request.source = MKMapItem(placemark: MKPlacemark(coordinate: origin.coordinate))
        request.destination = MKMapItem(placemark: MKPlacemark(coordinate: destination.coordinate))
        request.transportType = transportType
        request.requestsAlternateRoutes = true

        let response = try await MKDirections(request: request).calculate()
        return response.routes.compactMap { route in
            let pointCount = route.polyline.pointCount
            guard pointCount > 1 else { return nil }
            var coordinates = [CLLocationCoordinate2D](
                repeating: CLLocationCoordinate2D(latitude: 0, longitude: 0),
                count: pointCount
            )
            route.polyline.getCoordinates(&coordinates, range: NSRange(location: 0, length: pointCount))
            let reason = route.name.isEmpty
                ? "Apple Maps \(mode.shortLabel.lowercased()) route."
                : "\(route.name) • Apple Maps"
            return IncidentRouteResponse(
                status: .complete,
                coordinates: coordinates.map(IncidentCoordinate.init),
                distanceMeters: route.distance,
                reason: reason,
                startLabel: route.steps.first?.instructions,
                endLabel: route.steps.last?.instructions,
                expectedTravelTime: route.expectedTravelTime
            )
        }
    }

    private func transportType(for mode: RouteTravelMode) -> MKDirectionsTransportType? {
        switch mode {
        case .driving: .automobile
        case .walking: .walking
        case .transit: .transit
        case .cycling: nil
        }
    }
}
