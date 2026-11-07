import MapLibre
import SwiftUI
import UIKit

struct MapLibreWorldMap: UIViewRepresentable {
    @ObservedObject var store: WorldMapStore

    func makeCoordinator() -> Coordinator { Coordinator(store: store) }

    func makeUIView(context: Context) -> MLNMapView {
        let map = MLNMapView(frame: .zero, styleURL: URL(string: "https://tiles.openfreemap.org/styles/liberty"))
        map.delegate = context.coordinator
        map.logoView.isHidden = false
        map.attributionButton.isHidden = false
        map.setCenter(CLLocationCoordinate2D(latitude: 20, longitude: 0), zoomLevel: 1.6, animated: false)

        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleTap(_:)))
        tap.cancelsTouchesInView = false
        map.addGestureRecognizer(tap)
        context.coordinator.mapView = map
        return map
    }

    func updateUIView(_ map: MLNMapView, context: Context) {
        context.coordinator.store = store
        context.coordinator.refreshStyle()
        if context.coordinator.lastLocationRequestRevision != store.locationRequestRevision {
            context.coordinator.lastLocationRequestRevision = store.locationRequestRevision
            map.showsUserLocation = true
            map.userTrackingMode = .follow
        }
        if let target = store.cameraTarget, context.coordinator.lastCameraRevision != target.revision {
            context.coordinator.lastCameraRevision = target.revision
            map.setCenter(target.coordinate.coordinate, zoomLevel: target.zoom, animated: true)
        }
    }

    @MainActor
    final class Coordinator: NSObject, @preconcurrency MLNMapViewDelegate {
        var store: WorldMapStore
        weak var mapView: MLNMapView?
        var lastCameraRevision = -1
        var lastLocationRequestRevision = 0
        private var isStyleReady = false
        private var renderedSignature = ""

        init(store: WorldMapStore) {
            self.store = store
        }

        func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
            isStyleReady = true
            renderedSignature = ""
            refreshStyle()
        }

        func mapView(_ mapView: MLNMapView, didUpdate userLocation: MLNUserLocation?) {
            guard let coordinate = userLocation?.location?.coordinate else { return }
            store.acceptUserLocation(coordinate)
        }

        func mapView(_ mapView: MLNMapView, didFailToLocateUserWithError error: Error) {
            store.locationFailed("Current location is unavailable: \(error.localizedDescription)")
        }

        @objc func handleTap(_ recognizer: UITapGestureRecognizer) {
            guard recognizer.state == .ended, let map = mapView else { return }
            let point = recognizer.location(in: map)
            let coordinate = map.convert(point, toCoordinateFrom: map)

            if store.selectionMode != nil {
                store.chooseCoordinate(coordinate)
                return
            }

            if let road = closestRoad(to: point, in: map), road.distance < 28 {
                store.selectRoad(road.road)
                return
            }
            store.chooseCoordinate(coordinate)
        }

        private func closestRoad(to point: CGPoint, in map: MLNMapView) -> (road: IncidentRoad, distance: CGFloat)? {
            store.incidentDetail?.roads.compactMap { road in
                let a = map.convert(road.from.coordinate, toPointTo: map)
                let b = map.convert(road.to.coordinate, toPointTo: map)
                return (road, distanceFrom(point, toSegmentFrom: a, to: b))
            }.min(by: { $0.1 < $1.1 })
        }

        private func distanceFrom(_ point: CGPoint, toSegmentFrom a: CGPoint, to b: CGPoint) -> CGFloat {
            let dx = b.x - a.x
            let dy = b.y - a.y
            guard dx != 0 || dy != 0 else { return hypot(point.x - a.x, point.y - a.y) }
            let raw = ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)
            let t = max(0, min(1, raw))
            return hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy))
        }

        func refreshStyle() {
            guard isStyleReady, let style = mapView?.style else { return }
            let signature = styleSignature
            guard signature != renderedSignature else { return }
            renderedSignature = signature
            removeAftermapContent(from: style)
            addImagery(to: style)
            addIncidents(to: style)
            addRoads(to: style)
            addRoute(to: style)
            addEndpoints(to: style)
        }

        private var styleSignature: String {
            let incidentVersions = store.incidents.map { "\($0.id):\($0.version):\($0.imagery?.url ?? "-")" }.joined(separator: "|")
            let detail = store.incidentDetail.map { "\($0.id):\($0.version):\($0.roads.count)" } ?? "-"
            let selectedRoad = store.selectedRoad?.id ?? "-"
            let origin = store.origin.map { "\($0.latitude),\($0.longitude)" } ?? "-"
            let destination = store.destination.map { "\($0.latitude),\($0.longitude)" } ?? "-"
            let route: String
            switch store.routeState {
            case .idle: route = "idle"
            case .calculating: route = "calculating"
            case let .unavailable(reason): route = "unavailable:\(reason)"
            case let .route(response, affected):
                route = "\(response.status.rawValue):\(response.coordinates.count):\(response.distanceMeters):\(affected ?? "-")"
            }
            return [incidentVersions, detail, selectedRoad, origin, destination, route].joined(separator: "#")
        }

        private func removeAftermapContent(from style: MLNStyle) {
            let layerIDs = style.layers.map(\.identifier).filter { $0.hasPrefix("aftermap-") }
            for id in layerIDs {
                if let layer = style.layer(withIdentifier: id) { style.removeLayer(layer) }
            }
            let sourceIDs = style.sources.map(\.identifier).filter { $0.hasPrefix("aftermap-") }
            for id in sourceIDs {
                if let source = style.source(withIdentifier: id) { style.removeSource(source) }
            }
        }

        private func addImagery(to style: MLNStyle) {
            for (index, incident) in store.incidents.enumerated() {
                guard let imagery = incident.imagery, let url = store.client.resolvedURL(imagery.url) else { continue }
                let bounds = imagery.bounds
                let quad = MLNCoordinateQuad(
                    topLeft: CLLocationCoordinate2D(latitude: bounds.north, longitude: bounds.west),
                    bottomLeft: CLLocationCoordinate2D(latitude: bounds.south, longitude: bounds.west),
                    bottomRight: CLLocationCoordinate2D(latitude: bounds.south, longitude: bounds.east),
                    topRight: CLLocationCoordinate2D(latitude: bounds.north, longitude: bounds.east)
                )
                let source = MLNImageSource(identifier: "aftermap-image-source-\(index)", coordinateQuad: quad, url: url)
                style.addSource(source)
                let layer = MLNRasterStyleLayer(identifier: "aftermap-image-layer-\(index)", source: source)
                layer.rasterOpacity = NSExpression(forConstantValue: 0.72)
                layer.maximumZoomLevel = 22
                style.addLayer(layer)
            }
        }

        private func addIncidents(to style: MLNStyle) {
            let polygons: [MLNPolygon] = store.incidents.map { incident in
                var coordinates = [
                    CLLocationCoordinate2D(latitude: incident.bounds.north, longitude: incident.bounds.west),
                    CLLocationCoordinate2D(latitude: incident.bounds.north, longitude: incident.bounds.east),
                    CLLocationCoordinate2D(latitude: incident.bounds.south, longitude: incident.bounds.east),
                    CLLocationCoordinate2D(latitude: incident.bounds.south, longitude: incident.bounds.west),
                    CLLocationCoordinate2D(latitude: incident.bounds.north, longitude: incident.bounds.west)
                ]
                return MLNPolygon(coordinates: &coordinates, count: UInt(coordinates.count))
            }
            guard !polygons.isEmpty else { return }
            let shape = MLNShapeCollection(shapes: polygons)
            let source = MLNShapeSource(identifier: "aftermap-incidents-source", shape: shape, options: nil)
            style.addSource(source)

            let fill = MLNFillStyleLayer(identifier: "aftermap-incidents-fill", source: source)
            fill.fillColor = NSExpression(forConstantValue: UIColor.systemRed)
            fill.fillOpacity = NSExpression(forConstantValue: 0.12)
            style.addLayer(fill)

            let line = MLNLineStyleLayer(identifier: "aftermap-incidents-line", source: source)
            line.lineColor = NSExpression(forConstantValue: UIColor.systemRed)
            line.lineWidth = NSExpression(forConstantValue: 2.5)
            line.lineDashPattern = NSExpression(forConstantValue: [2, 1.5])
            style.addLayer(line)
        }

        private func addRoads(to style: MLNStyle) {
            guard let detail = store.incidentDetail else { return }
            for state in IncidentRoad.State.allCases {
                let roads = detail.roads.filter { $0.state == state }
                guard !roads.isEmpty else { continue }
                let lines: [MLNPolyline] = roads.map { road in
                    var coordinates = [road.from.coordinate, road.to.coordinate]
                    return MLNPolyline(coordinates: &coordinates, count: UInt(coordinates.count))
                }
                let source = MLNShapeSource(
                    identifier: "aftermap-roads-\(state.rawValue)-source",
                    shape: MLNShapeCollection(shapes: lines),
                    options: nil
                )
                style.addSource(source)
                let casing = MLNLineStyleLayer(identifier: "aftermap-roads-\(state.rawValue)-casing", source: source)
                casing.lineColor = NSExpression(forConstantValue: UIColor.black.withAlphaComponent(0.62))
                casing.lineWidth = NSExpression(forConstantValue: 8)
                style.addLayer(casing)
                let layer = MLNLineStyleLayer(identifier: "aftermap-roads-\(state.rawValue)-line", source: source)
                layer.lineColor = NSExpression(forConstantValue: color(for: state))
                layer.lineWidth = NSExpression(forConstantValue: 5)
                style.addLayer(layer)
            }

            if let selected = store.selectedRoad {
                var coordinates = [selected.from.coordinate, selected.to.coordinate]
                let shape = MLNPolyline(coordinates: &coordinates, count: UInt(coordinates.count))
                let source = MLNShapeSource(identifier: "aftermap-road-selection-source", shape: shape, options: nil)
                style.addSource(source)
                let layer = MLNLineStyleLayer(identifier: "aftermap-road-selection-line", source: source)
                layer.lineColor = NSExpression(forConstantValue: UIColor.white)
                layer.lineWidth = NSExpression(forConstantValue: 9)
                layer.lineOpacity = NSExpression(forConstantValue: 0.85)
                style.addLayer(layer)
            }
        }

        private func color(for state: IncidentRoad.State) -> UIColor {
            switch state {
            case .unknown: .systemGray
            case .open: .systemGreen
            case .blocked: .systemRed
            case .hazard: .systemOrange
            case .conflict: .systemPurple
            }
        }

        private func addRoute(to style: MLNStyle) {
            guard case let .route(response, _) = store.routeState, response.coordinates.count > 1 else { return }
            var coordinates = response.coordinates.map(\.coordinate)
            let lineShape = MLNPolyline(coordinates: &coordinates, count: UInt(coordinates.count))
            let source = MLNShapeSource(identifier: "aftermap-route-source", shape: lineShape, options: nil)
            style.addSource(source)
            let casing = MLNLineStyleLayer(identifier: "aftermap-route-casing", source: source)
            casing.lineColor = NSExpression(forConstantValue: UIColor.white)
            casing.lineWidth = NSExpression(forConstantValue: 9)
            style.addLayer(casing)
            let line = MLNLineStyleLayer(identifier: "aftermap-route-line", source: source)
            line.lineColor = NSExpression(forConstantValue: response.status == .complete ? UIColor.systemBlue : UIColor.systemOrange)
            line.lineWidth = NSExpression(forConstantValue: 6)
            style.addLayer(line)
        }

        private func addEndpoints(to style: MLNStyle) {
            var points: [MLNPointFeature] = []
            if let origin = store.origin {
                let feature = MLNPointFeature()
                feature.coordinate = origin.coordinate
                points.append(feature)
            }
            if let destination = store.destination {
                let feature = MLNPointFeature()
                feature.coordinate = destination.coordinate
                points.append(feature)
            }
            guard !points.isEmpty else { return }
            let source = MLNShapeSource(identifier: "aftermap-endpoints-source", shape: MLNShapeCollection(shapes: points), options: nil)
            style.addSource(source)
            let circle = MLNCircleStyleLayer(identifier: "aftermap-endpoints-circle", source: source)
            circle.circleColor = NSExpression(forConstantValue: UIColor.white)
            circle.circleStrokeColor = NSExpression(forConstantValue: UIColor.systemBlue)
            circle.circleStrokeWidth = NSExpression(forConstantValue: 4)
            circle.circleRadius = NSExpression(forConstantValue: 7)
            style.addLayer(circle)
        }
    }
}
