import SwiftUI

enum AftermapTheme {
    static let navy = Color(red: 0.025, green: 0.055, blue: 0.105)
    static let panel = Color(red: 0.055, green: 0.095, blue: 0.155)
    static let panelRaised = Color(red: 0.075, green: 0.13, blue: 0.20)
    static let mint = Color(red: 0.27, green: 0.96, blue: 0.73)
    static let cyan = Color(red: 0.24, green: 0.81, blue: 0.98)
    static let amber = Color(red: 1.0, green: 0.69, blue: 0.23)
    static let red = Color(red: 1.0, green: 0.29, blue: 0.31)
    static let muted = Color(red: 0.56, green: 0.65, blue: 0.75)
}

struct PanelModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(16)
            .background(AftermapTheme.panel)
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .stroke(Color.white.opacity(0.08))
            }
    }
}

extension View {
    func aftermapPanel() -> some View { modifier(PanelModifier()) }
}

struct DrillBadge: View {
    var body: some View {
        Label("SIMULATED DRILL", systemImage: "shield.lefthalf.filled")
            .font(.caption2.weight(.bold))
            .foregroundStyle(AftermapTheme.amber)
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(AftermapTheme.amber.opacity(0.12), in: Capsule())
            .accessibilityLabel("Simulated drill. Not for real emergency use.")
    }
}

