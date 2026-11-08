import MapLibre
import SwiftUI
import UIKit

struct MapLibreWorldMap: UIViewRepresentable {
    @ObservedObject var store: WorldMapStore
    var onMapTap: ((CLLocationCoordinate2D) -> Void)?
    @Environment(\.colorScheme) private var colorScheme

    init(store: WorldMapStore, onMapTap: ((CLLocationCoordinate2D) -> Void)? = nil) {
        self.store = store
        self.onMapTap = onMapTap
    }

    static let lightStyleURL = URL(string: "https://tiles.openfreemap.org/styles/liberty")!
    static let darkStyleURL = URL(string: "https://tiles.openfreemap.org/styles/fiord")!

    static func styleURL(for colorScheme: ColorScheme) -> URL {
        colorScheme == .dark ? darkStyleURL : lightStyleURL
    }

    static func styleURL(for mapStyle: WorldMapStore.MapStyle, colorScheme: ColorScheme) -> URL {
        styleURL(for: colorScheme)
    }

    private var baseStyleURL: URL { Self.styleURL(for: store.mapStyle, colorScheme: colorScheme) }

    func makeCoordinator() -> Coordinator { Coordinator(store: store, baseStyleURL: baseStyleURL, onMapTap: onMapTap) }

    func makeUIView(context: Context) -> MLNMapView {
        let map = MLNMapView(frame: .zero, styleURL: baseStyleURL)
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
        context.coordinator.onMapTap = onMapTap
        context.coordinator.applyBaseStyle(baseStyleURL, to: map)
        context.coordinator.refreshStyle()
        if context.coordinator.lastLocationRequestRevision != store.locationRequestRevision {
            context.coordinator.lastLocationRequestRevision = store.locationRequestRevision
            map.showsUserLocation = true
            map.userTrackingMode = .follow
        }
        if store.followsNavigationCamera {
            map.showsUserLocation = true
            map.userTrackingMode = .followWithCourse
            if context.coordinator.lastNavigationCameraRevision != store.navigationCameraRevision {
                context.coordinator.lastNavigationCameraRevision = store.navigationCameraRevision
                if let coordinate = store.userCoordinate?.coordinate {
                    map.setCenter(
                        coordinate,
                        zoomLevel: max(16, map.zoomLevel),
                        direction: store.navigationHeading ?? map.direction,
                        animated: true
                    )
                }
            }
            context.coordinator.wasFollowingNavigation = true
        } else if context.coordinator.wasFollowingNavigation {
            map.userTrackingMode = .none
            context.coordinator.wasFollowingNavigation = false
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
        var lastNavigationCameraRevision = -1
        var wasFollowingNavigation = false
        private var isStyleReady = false
        private var renderedStaticSignature = ""
        private var renderedDynamicSignature = ""
        private var baseStyleURL: URL
        var onMapTap: ((CLLocationCoordinate2D) -> Void)?

        init(store: WorldMapStore, baseStyleURL: URL, onMapTap: ((CLLocationCoordinate2D) -> Void)?) {
            self.store = store
            self.baseStyleURL = baseStyleURL
            self.onMapTap = onMapTap
        }

        func applyBaseStyle(_ url: URL, to mapView: MLNMapView) {
            guard url != baseStyleURL else { return }
            baseStyleURL = url
            isStyleReady = false
            renderedStaticSignature = ""
            renderedDynamicSignature = ""
            mapView.styleURL = url
        }

        func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
            isStyleReady = true
            renderedStaticSignature = ""
            renderedDynamicSignature = ""
            refreshStyle()
        }

        func mapView(
            _ mapView: MLNMapView,
            regionWillChangeWith reason: MLNCameraChangeReason,
            animated: Bool
        ) {
            let gestureMask = (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5) | (1 << 6) | (1 << 7) | (1 << 8)
            guard reason.rawValue & UInt(gestureMask) != 0 else { return }
            store.suspendNavigationCameraFollowing()
            mapView.userTrackingMode = .none
        }

        func mapView(_ mapView: MLNMapView, didUpdate userLocation: MLNUserLocation?) {
            guard let location = userLocation?.location else { return }
            store.acceptUserLocation(location)
        }

        func mapView(_ mapView: MLNMapView, didFailToLocateUserWithError error: Error) {
            store.locationFailed("Current location is unavailable: \(error.localizedDescription)")
        }

        @objc func handleTap(_ recognizer: UITapGestureRecognizer) {
            guard recognizer.state == .ended, let map = mapView else { return }
            let point = recognizer.location(in: map)
            let coordinate = map.convert(point, toCoordinateFrom: map)

            if let onMapTap {
                onMapTap(coordinate)
                return
            }

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
            let staticSignature = staticStyleSignature
            if staticSignature != renderedStaticSignature {
                renderedStaticSignature = staticSignature
                renderedDynamicSignature = ""
                removeAftermapContent(from: style)
                configureBaseMap(in: style)
                addImagery(to: style)
                addIncidents(to: style)
            }

            let dynamicSignature = dynamicStyleSignature
            guard dynamicSignature != renderedDynamicSignature else { return }
            renderedDynamicSignature = dynamicSignature
            removeDynamicContent(from: style)
            addRoads(to: style)
            addRoute(to: style)
            addEndpoints(to: style)
            addReportLocation(to: style)
            addIncidentDraftCenter(to: style)
        }

        private var staticStyleSignature: String {
            let imagery = Self.surveyImageryForRendering(
                incidents: store.incidents,
                recoveryImagery: store.recoveryImagery
            ).map { imagery in
                let detailTiles = imagery.detailTiles?.map {
                    "\($0.url):\($0.bounds.west),\($0.bounds.south),\($0.bounds.east),\($0.bounds.north)"
                }.joined(separator: ",") ?? "-"
                return "\(imagery.timestamp):\(imagery.url):\(detailTiles)"
            }.joined(separator: ";")
            let surveyVisibility = store.showsIncidentSurveyImagery ? "surveys-on" : "surveys-off"
            let boundaries = store.incidents.map { incident in
                let bounds = incident.mapBoundaryBounds
                return "\(incident.id):\(incident.version):\(bounds.west),\(bounds.south),\(bounds.east),\(bounds.north)"
            }.joined(separator: ";")
            return [store.mapStyle.rawValue, surveyVisibility, boundaries, imagery].joined(separator: "#")
        }

        private var dynamicStyleSignature: String {
            let detail = store.incidentDetail.map { "\($0.id):\($0.version):\($0.roads.count)" } ?? "-"
            let selectedRoad = store.selectedRoad?.id ?? "-"
            let origin = store.origin.map { "\($0.latitude),\($0.longitude)" } ?? "-"
            let destination = store.destination.map { "\($0.latitude),\($0.longitude)" } ?? "-"
            let reportLocation = store.reportLocation.map { "\($0.latitude),\($0.longitude)" } ?? "-"
            let incidentDraftCenter = store.incidentDraftCenter.map { "\($0.latitude),\($0.longitude)" } ?? "-"
            let route: String
            switch store.routeState {
            case .idle: route = "idle"
            case .calculating: route = "calculating"
            case let .unavailable(reason): route = "unavailable:\(reason)"
            case let .route(response, affected):
                let unverified = response.unverifiedSegments?.map(String.init).joined(separator: ",") ?? "-"
                route = "\(response.status.rawValue):\(response.coordinates.count):\(response.distanceMeters):\(unverified):\(affected ?? "-")"
            }
            let navigationState: String = switch store.navigationState {
            case .idle: "idle"
            case .awaitingLocation: "awaiting"
            case .navigating: "navigating"
            case .rerouting: "rerouting"
            case .blocked: "blocked"
            case .arrived: "arrived"
            }
            let navigation = "\(navigationState):\(store.navigationRenderRevision)"
            return [detail, selectedRoad, origin, destination, reportLocation, incidentDraftCenter, route, navigation]
                .joined(separator: "#")
        }

        private func configureBaseMap(in style: MLNStyle) {
            let baseLayers = style.layers.filter { !$0.identifier.hasPrefix("aftermap-") }
            for layer in baseLayers {
                layer.isVisible = store.mapStyle == .streets || layer is MLNSymbolStyleLayer
            }

            guard store.mapStyle == .satellite else { return }
            let attribution = MLNAttributionInfo(
                title: NSAttributedString(string: "Esri World Imagery"),
                url: URL(string: "https://www.esri.com/en-us/arcgis/products/arcgis-living-atlas")!
            )
            let source = MLNRasterTileSource(
                identifier: "aftermap-basemap-satellite-source",
                tileURLTemplates: ["https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
                options: [
                    .minimumZoomLevel: 0,
                    .maximumZoomLevel: 23,
                    .tileSize: 256,
                    .attributionInfos: [attribution]
                ]
            )
            style.addSource(source)
            let layer = MLNRasterStyleLayer(identifier: "aftermap-basemap-satellite-layer", source: source)
            layer.rasterFadeDuration = NSExpression(forConstantValue: 0.15)
            layer.maximumZoomLevel = 24
            style.insertLayer(layer, at: 0)
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

        private func removeDynamicContent(from style: MLNStyle) {
            let prefixes = [
                "aftermap-roads-",
                "aftermap-road-selection-",
                "aftermap-route-",
                "aftermap-endpoints-",
                "aftermap-report-location-",
                "aftermap-incident-draft-",
            ]
            let matches: (String) -> Bool = { id in prefixes.contains { id.hasPrefix($0) } }
            for id in style.layers.map(\.identifier).filter(matches) {
                if let layer = style.layer(withIdentifier: id) { style.removeLayer(layer) }
            }
            for id in style.sources.map(\.identifier).filter(matches) {
                if let source = style.source(withIdentifier: id) { style.removeSource(source) }
            }
        }

        private func addImagery(to style: MLNStyle) {
            guard store.showsSurveyImageryOnMap else { return }
            let imagery = Self.surveyImageryForRendering(
                incidents: store.incidents,
                recoveryImagery: store.recoveryImagery
            )
            for (index, survey) in imagery.enumerated() {
                addSurvey(survey, namespace: "survey-\(index)", to: style)
            }
        }

        /// Mirrors the web renderer: compose every published survey batch in
        /// chronological order, then place newer observations above older ones.
        /// A repeated URL is one raster, even when a legacy `imagery` field and
        /// the current `surveys` array both reference it.
        static func surveyImageryForRendering(
            incidents: [Incident],
            recoveryImagery: [IncidentImagery]
        ) -> [IncidentImagery] {
            let ordered = (recoveryImagery + incidents.flatMap(\.publishedSurveys))
                .sorted { $0.timestamp < $1.timestamp }
            var seenURLs = Set<String>()
            return ordered.filter { seenURLs.insert($0.url).inserted }
        }

        private func addSurvey(_ imagery: IncidentImagery, namespace: String, to style: MLNStyle) {
            if let url = store.client.resolvedURL(imagery.url) {
                addImageryLayer(
                    to: style,
                    sourceID: "aftermap-image-source-\(namespace)",
                    layerID: "aftermap-image-layer-\(namespace)",
                    url: url,
                    bounds: imagery.bounds,
                    opacity: 1,
                    minimumZoom: 9,
                    maximumZoom: 24
                )
            }
            for (tileIndex, tile) in (imagery.detailTiles ?? []).enumerated() {
                guard let tileURL = store.client.resolvedURL(tile.url) else { continue }
                addImageryLayer(
                    to: style,
                    sourceID: "aftermap-image-detail-source-\(namespace)-\(tileIndex)",
                    layerID: "aftermap-image-detail-layer-\(namespace)-\(tileIndex)",
                    url: tileURL,
                    bounds: tile.bounds,
                    opacity: 1,
                    minimumZoom: 16,
                    maximumZoom: 24
                )
            }
        }

        private func addImageryLayer(
            to style: MLNStyle,
            sourceID: String,
            layerID: String,
            url: URL,
            bounds: IncidentBounds,
            opacity: Double,
            minimumZoom: Float,
            maximumZoom: Float
        ) {
            let quad = MLNCoordinateQuad(
                topLeft: CLLocationCoordinate2D(latitude: bounds.north, longitude: bounds.west),
                bottomLeft: CLLocationCoordinate2D(latitude: bounds.south, longitude: bounds.west),
                bottomRight: CLLocationCoordinate2D(latitude: bounds.south, longitude: bounds.east),
                topRight: CLLocationCoordinate2D(latitude: bounds.north, longitude: bounds.east)
            )
            let source = MLNImageSource(identifier: sourceID, coordinateQuad: quad, url: url)
            style.addSource(source)
            let layer = MLNRasterStyleLayer(identifier: layerID, source: source)
            layer.rasterOpacity = NSExpression(forConstantValue: opacity)
            layer.rasterFadeDuration = NSExpression(forConstantValue: 0)
            layer.minimumZoomLevel = minimumZoom
            layer.maximumZoomLevel = maximumZoom
            if let firstLabel = style.layers.first(where: { $0 is MLNSymbolStyleLayer }) {
                style.insertLayer(layer, below: firstLabel)
            } else {
                style.addLayer(layer)
            }
        }

        private func addIncidents(to style: MLNStyle) {
            let polygons: [MLNPolygon] = store.incidents.map { incident in
                let bounds = incident.mapBoundaryBounds
                var coordinates = [
                    CLLocationCoordinate2D(latitude: bounds.north, longitude: bounds.west),
                    CLLocationCoordinate2D(latitude: bounds.north, longitude: bounds.east),
                    CLLocationCoordinate2D(latitude: bounds.south, longitude: bounds.east),
                    CLLocationCoordinate2D(latitude: bounds.south, longitude: bounds.west),
                    CLLocationCoordinate2D(latitude: bounds.north, longitude: bounds.west)
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
            if case .arrived = store.navigationState { return }
            let routeCoordinates = store.showsNavigationUI
                ? store.navigationRemainingCoordinates
                : response.coordinates
            guard routeCoordinates.count > 1 else { return }
            var coordinates = routeCoordinates.map(\.coordinate)
            let lineShape = MLNPolyline(coordinates: &coordinates, count: UInt(coordinates.count))
            let source = MLNShapeSource(identifier: "aftermap-route-source", shape: lineShape, options: nil)
            style.addSource(source)
            let casing = MLNLineStyleLayer(identifier: "aftermap-route-casing", source: source)
            casing.lineColor = NSExpression(forConstantValue: UIColor.white)
            casing.lineWidth = NSExpression(forConstantValue: 9)
            style.addLayer(casing)

            let unverifiedIndices = store.showsNavigationUI
                ? Set<Int>()
                : Set((response.unverifiedSegments ?? []).filter { routeCoordinates.indices.dropLast().contains($0) })
            guard !unverifiedIndices.isEmpty else {
                let line = MLNLineStyleLayer(identifier: "aftermap-route-line", source: source)
                line.lineColor = NSExpression(forConstantValue: response.status == .complete ? UIColor.systemBlue : UIColor.systemOrange)
                line.lineWidth = NSExpression(forConstantValue: 6)
                style.addLayer(line)
                return
            }

            let verifiedSegments: [MLNPolyline] = routeCoordinates.indices.dropLast().compactMap { index in
                guard !unverifiedIndices.contains(index) else { return nil }
                var segment = [routeCoordinates[index].coordinate, routeCoordinates[index + 1].coordinate]
                return MLNPolyline(coordinates: &segment, count: UInt(segment.count))
            }
            if !verifiedSegments.isEmpty {
                let verifiedSource = MLNShapeSource(
                    identifier: "aftermap-route-verified-source",
                    shape: MLNShapeCollection(shapes: verifiedSegments),
                    options: nil
                )
                style.addSource(verifiedSource)
                let verifiedLine = MLNLineStyleLayer(identifier: "aftermap-route-verified-line", source: verifiedSource)
                verifiedLine.lineColor = NSExpression(forConstantValue: UIColor.systemBlue)
                verifiedLine.lineWidth = NSExpression(forConstantValue: 6)
                style.addLayer(verifiedLine)
            }

            let unverifiedSegments: [MLNPolyline] = unverifiedIndices.sorted().map { index in
                var segment = [routeCoordinates[index].coordinate, routeCoordinates[index + 1].coordinate]
                return MLNPolyline(coordinates: &segment, count: UInt(segment.count))
            }
            let unverifiedSource = MLNShapeSource(
                identifier: "aftermap-route-unverified-source",
                shape: MLNShapeCollection(shapes: unverifiedSegments),
                options: nil
            )
            style.addSource(unverifiedSource)
            let unverifiedLine = MLNLineStyleLayer(identifier: "aftermap-route-unverified-line", source: unverifiedSource)
            unverifiedLine.lineColor = NSExpression(forConstantValue: UIColor.systemOrange)
            unverifiedLine.lineWidth = NSExpression(forConstantValue: 6)
            unverifiedLine.lineDashPattern = NSExpression(forConstantValue: [1.4, 1.4])
            style.addLayer(unverifiedLine)
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

        private func addReportLocation(to style: MLNStyle) {
            guard let location = store.reportLocation else { return }
            let feature = MLNPointFeature()
            feature.coordinate = location.coordinate
            let source = MLNShapeSource(identifier: "aftermap-report-location-source", shape: feature, options: nil)
            style.addSource(source)

            let halo = MLNCircleStyleLayer(identifier: "aftermap-report-location-halo", source: source)
            halo.circleColor = NSExpression(forConstantValue: UIColor.white)
            halo.circleRadius = NSExpression(forConstantValue: 12)
            halo.circleOpacity = NSExpression(forConstantValue: 0.9)
            style.addLayer(halo)

            let circle = MLNCircleStyleLayer(identifier: "aftermap-report-location-circle", source: source)
            circle.circleColor = NSExpression(forConstantValue: UIColor.systemOrange)
            circle.circleRadius = NSExpression(forConstantValue: 8)
            circle.circleStrokeColor = NSExpression(forConstantValue: UIColor.white)
            circle.circleStrokeWidth = NSExpression(forConstantValue: 2)
            style.addLayer(circle)
        }

        private func addIncidentDraftCenter(to style: MLNStyle) {
            guard let location = store.incidentDraftCenter else { return }
            let feature = MLNPointFeature()
            feature.coordinate = location.coordinate
            let source = MLNShapeSource(identifier: "aftermap-incident-draft-source", shape: feature, options: nil)
            style.addSource(source)

            let halo = MLNCircleStyleLayer(identifier: "aftermap-incident-draft-halo", source: source)
            halo.circleColor = NSExpression(forConstantValue: UIColor.white)
            halo.circleRadius = NSExpression(forConstantValue: 14)
            halo.circleOpacity = NSExpression(forConstantValue: 0.92)
            style.addLayer(halo)

            let circle = MLNCircleStyleLayer(identifier: "aftermap-incident-draft-circle", source: source)
            circle.circleColor = NSExpression(forConstantValue: UIColor.systemRed)
            circle.circleRadius = NSExpression(forConstantValue: 9)
            circle.circleStrokeColor = NSExpression(forConstantValue: UIColor.white)
            circle.circleStrokeWidth = NSExpression(forConstantValue: 2)
            style.addLayer(circle)
        }
    }
}
