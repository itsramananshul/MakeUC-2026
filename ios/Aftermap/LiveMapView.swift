import SwiftUI

struct LiveMapView: View {
    let snapshot: SessionSnapshot
    let observerId: String?
    let serverURL: String
    @State private var selectedNode: MapNode?

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                RadialGradient(colors: [AftermapTheme.panelRaised, AftermapTheme.navy], center: .center, startRadius: 30, endRadius: 520)
                    .ignoresSafeArea()

                let transform = MapTransform(size: geometry.size)
                AerialImageLayer(
                    primaryURL: snapshot.preferredMapImageryURL(against: serverURL),
                    fallbackURL: baseImageryURL,
                    mapRect: transform.mapRect
                )

                Rectangle()
                    .fill(AftermapTheme.navy.opacity(0.45))
                    .frame(width: transform.mapRect.width, height: transform.mapRect.height)
                    .position(x: transform.mapRect.midX, y: transform.mapRect.midY)

                Canvas { context, size in
                    let transform = MapTransform(size: size)
                    let byId = Dictionary(uniqueKeysWithValues: snapshot.nodes.map { ($0.id, $0) })

                    for x in stride(from: 0.0, through: size.width, by: 42) {
                        var grid = Path(); grid.move(to: CGPoint(x: x, y: 0)); grid.addLine(to: CGPoint(x: x, y: size.height))
                        context.stroke(grid, with: .color(AftermapTheme.cyan.opacity(0.035)), lineWidth: 1)
                    }
                    for y in stride(from: 0.0, through: size.height, by: 42) {
                        var grid = Path(); grid.move(to: CGPoint(x: 0, y: y)); grid.addLine(to: CGPoint(x: size.width, y: y))
                        context.stroke(grid, with: .color(AftermapTheme.cyan.opacity(0.035)), lineWidth: 1)
                    }

                    for edge in snapshot.edges {
                        guard let a = byId[edge.from], let b = byId[edge.to] else { continue }
                        var path = Path()
                        path.move(to: transform.point(a))
                        path.addLine(to: transform.point(b))
                        let isRoute = snapshot.route?.edgeIds.contains(edge.id) == true
                        let style = StrokeStyle(lineWidth: isRoute ? 8 : 5, lineCap: .round, dash: edge.state == .unknown ? [7, 7] : [])
                        if isRoute {
                            context.stroke(path, with: .color(AftermapTheme.mint.opacity(0.2)), style: StrokeStyle(lineWidth: 15, lineCap: .round))
                        }
                        context.stroke(path, with: .color(color(edge.state)), style: style)
                    }

                    for node in snapshot.nodes {
                        let point = transform.point(node)
                        let radius: CGFloat = node.kind == .exit ? 15 : 11
                        let rect = CGRect(x: point.x - radius, y: point.y - radius, width: radius * 2, height: radius * 2)
                        context.fill(Path(ellipseIn: rect), with: .color(node.kind == .exit ? AftermapTheme.mint : AftermapTheme.panelRaised))
                        context.stroke(Path(ellipseIn: rect), with: .color(node.kind == .exit ? AftermapTheme.mint : AftermapTheme.cyan), lineWidth: 2)
                        context.draw(Text(node.label).font(.system(size: 11, weight: .bold)).foregroundColor(.white), at: CGPoint(x: point.x, y: point.y + 24))
                    }

                    for participant in snapshot.participants {
                        guard let checkpointId = participant.checkpointId, let node = byId[checkpointId] else { continue }
                        let p = transform.point(node)
                        let offset = CGPoint(x: p.x + 12, y: p.y - 12)
                        context.fill(Path(ellipseIn: CGRect(x: offset.x - 5, y: offset.y - 5, width: 10, height: 10)), with: .color(participant.id == observerId ? AftermapTheme.amber : .white))
                    }
                }

                ForEach(snapshot.nodes) { node in
                    let point = MapTransform(size: geometry.size).point(node)
                    Button { selectedNode = node } label: { Color.clear.frame(width: 48, height: 48).contentShape(Circle()) }
                        .position(point)
                        .accessibilityIdentifier("map.node.\(node.id)")
                        .accessibilityLabel("\(node.label), \(node.kind.rawValue). Tap for current field details.")
                }

                VStack {
                    Spacer()
                    HStack {
                        VStack(alignment: .leading, spacing: 5) {
                            Label("LIVE FIELD MODEL", systemImage: "point.3.connected.trianglepath.dotted")
                                .font(.caption2.weight(.black)).foregroundStyle(AftermapTheme.cyan)
                            legend
                            Text(snapshot.mapImageryAttribution)
                                .font(.system(size: 8, weight: .medium))
                                .foregroundStyle(.white.opacity(0.7))
                                .lineLimit(1)
                        }
                        Spacer()
                    }
                    .padding(.horizontal, 14).padding(.bottom, 235)
                }
            }
        }
        .sheet(item: $selectedNode) { node in
            CheckpointDetailView(node: node, snapshot: snapshot)
                .presentationDetents([.height(230), .medium])
                .presentationDragIndicator(.visible)
                .presentationBackground(.ultraThinMaterial)
        }
    }

    private var baseImageryURL: URL? {
        ImageryLayer.resolve("/mexico-beach-noaa.jpg", against: serverURL)
    }

    private var legend: some View {
        HStack(spacing: 9) {
            legendItem("Open", AftermapTheme.mint)
            legendItem("Blocked", AftermapTheme.red)
            legendItem("Hazard", AftermapTheme.amber)
            legendItem("Unknown", AftermapTheme.muted)
        }
        .font(.system(size: 8, weight: .bold))
        .padding(6).background(.black.opacity(0.45), in: Capsule())
    }

    private func legendItem(_ label: String, _ color: Color) -> some View {
        HStack(spacing: 3) { Circle().fill(color).frame(width: 5, height: 5); Text(label) }
    }

    private func color(_ state: MapEdge.State) -> Color {
        switch state {
        case .open: AftermapTheme.mint
        case .blocked: AftermapTheme.red
        case .hazard, .conflict: AftermapTheme.amber
        case .unknown: AftermapTheme.muted
        }
    }
}

private struct MapTransform {
    let size: CGSize
    private let inset: CGFloat = 26

    var mapRect: CGRect {
        let top: CGFloat = 125
        let bottom: CGFloat = 255
        return CGRect(
            x: inset,
            y: top,
            width: max(1, size.width - inset * 2),
            height: max(120, size.height - top - bottom)
        )
    }

    func point(_ node: MapNode) -> CGPoint {
        return CGPoint(
            x: mapRect.minX + CGFloat(node.x / 1000) * mapRect.width,
            y: mapRect.minY + CGFloat(node.y / 720) * mapRect.height
        )
    }
}

private struct AerialImageLayer: View {
    let primaryURL: URL?
    let fallbackURL: URL?
    let mapRect: CGRect

    var body: some View {
        Group {
            if let primaryURL {
                AsyncImage(url: primaryURL, transaction: Transaction(animation: .easeInOut(duration: 0.25))) { phase in
                    switch phase {
                    case .success(let image): rendered(image)
                    case .failure:
                        if primaryURL != fallbackURL, let fallbackURL {
                            AsyncImage(url: fallbackURL) { fallback in
                                if let image = fallback.image { rendered(image) }
                                else { placeholder }
                            }
                        } else { placeholder }
                    case .empty: placeholder.overlay { ProgressView().tint(AftermapTheme.mint) }
                    @unknown default: placeholder
                    }
                }
            } else { placeholder }
        }
        .frame(width: mapRect.width, height: mapRect.height)
        .clipped()
        .position(x: mapRect.midX, y: mapRect.midY)
        .accessibilityHidden(true)
    }

    private func rendered(_ image: Image) -> some View {
        image.resizable().frame(width: mapRect.width, height: mapRect.height).clipped()
    }

    private var placeholder: some View {
        LinearGradient(colors: [AftermapTheme.panelRaised, AftermapTheme.navy], startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

private struct CheckpointDetailView: View {
    let node: MapNode
    let snapshot: SessionSnapshot

    var connectedEdges: [MapEdge] { snapshot.edges.filter { $0.from == node.id || $0.to == node.id } }
    var people: [Participant] { snapshot.participants.filter { $0.checkpointId == node.id } }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text(node.label).font(.title2.bold())
                    Text("\(node.kind.rawValue.uppercased()) • \(node.id)").font(.caption.monospaced().weight(.bold)).foregroundStyle(AftermapTheme.cyan)
                }
                Spacer()
                Image(systemName: node.kind == .exit ? "flag.checkered" : "mappin.circle.fill")
                    .font(.title).foregroundStyle(node.kind == .exit ? AftermapTheme.mint : AftermapTheme.cyan)
            }
            HStack(spacing: 12) {
                Label("\(connectedEdges.count) passages", systemImage: "point.3.connected.trianglepath.dotted")
                Label("\(people.count) people", systemImage: "person.2.fill")
            }
            .font(.subheadline).foregroundStyle(AftermapTheme.muted)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    ForEach(connectedEdges) { edge in
                        Label(edge.label, systemImage: edge.state == .open ? "checkmark.circle.fill" : edge.state == .blocked ? "xmark.octagon.fill" : "exclamationmark.triangle.fill")
                            .font(.caption.weight(.semibold)).padding(9)
                            .background(AftermapTheme.panelRaised, in: Capsule())
                    }
                }
            }
            Text("Field details come from the current shared drill snapshot and may be stale or incomplete.")
                .font(.caption).foregroundStyle(AftermapTheme.amber)
        }
        .padding(20)
    }
}

#Preview {
    LiveMapView(snapshot: .preview, observerId: "p1", serverURL: "https://example.com")
        .frame(height: 780).background(AftermapTheme.navy)
}
