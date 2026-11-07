import PhotosUI
import SwiftUI

struct ReportFlowView: View {
    enum Stage { case checkpoint, evidence, review }
    enum Evidence: String, CaseIterable, Identifiable {
        case manual, text, voice, image
        var id: String { rawValue }
        var label: String { rawValue.capitalized }
        var icon: String {
            switch self { case .manual: "hand.tap"; case .text: "text.bubble"; case .voice: "waveform"; case .image: "camera" }
        }
    }

    @EnvironmentObject private var store: SessionStore
    @Environment(\.dismiss) private var dismiss
    @StateObject private var speech = SpeechTranscriber()
    @State private var stage: Stage = .checkpoint
    @State private var checkpointId = ""
    @State private var scannedValue = ""
    @State private var showingScanner = false
    @State private var showingCamera = false
    @State private var photoItem: PhotosPickerItem?
    @State private var image: UIImage?
    @State private var kind: AISuggestion.Kind = .passage
    @State private var fromId = ""
    @State private var toId = ""
    @State private var nodeId = ""
    @State private var status: MapEdge.State = .open
    @State private var evidence: Evidence = .manual
    @State private var note = ""
    @State private var suggestion: AISuggestion?
    @State private var interpretationMessage: String?
    @State private var localError: String?
    @State private var isInterpreting = false
    @State private var observationId = UUID().uuidString.lowercased()

    private var snapshot: SessionSnapshot? { store.snapshot }
    private var nodes: [MapNode] { snapshot?.nodes ?? [] }
    private var nodeIds: [String] { nodes.map(\.id) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    progress
                    switch stage {
                    case .checkpoint: checkpointStep
                    case .evidence: evidenceStep
                    case .review: reviewStep
                    }
                }
                .padding(18)
            }
            .background(AftermapTheme.navy)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { speech.stop(); dismiss() } }
            }
            .sheet(isPresented: $showingScanner) {
                NavigationStack {
                    QRScannerView { payload in handleScanned(payload); showingScanner = false }
                        .ignoresSafeArea()
                        .navigationTitle("Scan checkpoint")
                        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { showingScanner = false } } }
                }
            }
            .fullScreenCover(isPresented: $showingCamera) { CameraPicker { image = $0 } }
            .alert("Report issue", isPresented: Binding(get: { localError != nil }, set: { if !$0 { localError = nil } })) {
                Button("OK") { localError = nil }
            } message: { Text(localError ?? "") }
            .onChange(of: speech.transcript) { _, value in if evidence == .voice { note = value } }
            .onChange(of: speech.errorMessage) { _, value in if let value { localError = value } }
            .onChange(of: photoItem) { _, item in
                Task {
                    guard let data = try? await item?.loadTransferable(type: Data.self), let loaded = UIImage(data: data) else { return }
                    image = loaded
                }
            }
            .onAppear { seedDefaults() }
        }
        .interactiveDismissDisabled(store.isBusy || isInterpreting)
    }

    private var title: String {
        switch stage { case .checkpoint: "Confirm position"; case .evidence: "Add evidence"; case .review: "Human confirmation" }
    }

    private var progress: some View {
        HStack(spacing: 7) {
            ForEach(0..<3) { index in
                Capsule().fill(index <= stageIndex ? AftermapTheme.mint : AftermapTheme.panelRaised).frame(height: 4)
            }
        }
    }
    private var stageIndex: Int { switch stage { case .checkpoint: 0; case .evidence: 1; case .review: 2 } }

    private var checkpointStep: some View {
        VStack(alignment: .leading, spacing: 18) {
            DrillBadge()
            Text("Anchor this report to a known field checkpoint.")
                .font(.title2.bold())
            Text("Scan its AFTERMAP QR label, or select the ID manually on the simulator or if the camera is unavailable.")
                .foregroundStyle(AftermapTheme.muted)

            Button { showingScanner = true } label: {
                Label("Scan checkpoint QR", systemImage: "qrcode.viewfinder")
                    .frame(maxWidth: .infinity).padding().background(AftermapTheme.panelRaised, in: RoundedRectangle(cornerRadius: 14))
            }
            .disabled(!UIImagePickerController.isSourceTypeAvailable(.camera))

            VStack(alignment: .leading, spacing: 8) {
                Text("MANUAL CHECKPOINT").font(.caption.weight(.bold)).foregroundStyle(AftermapTheme.cyan)
                Picker("Checkpoint", selection: $checkpointId) {
                    ForEach(nodes) { node in Text("\(node.label)  •  \(node.id)").tag(node.id) }
                }
                .pickerStyle(.menu)
            }
            .aftermapPanel()

            Button {
                Task {
                    guard nodeIds.contains(checkpointId) else { localError = "Choose a valid checkpoint supplied by the server."; return }
                    if await store.confirmPosition(checkpointId: checkpointId) { fromId = checkpointId; if nodeId.isEmpty { nodeId = checkpointId }; stage = .evidence }
                }
            } label: { primaryLabel(store.isBusy ? "Confirming…" : "Confirm position", icon: "location.fill") }
            .disabled(checkpointId.isEmpty || store.isBusy)
        }
    }

    private var evidenceStep: some View {
        VStack(alignment: .leading, spacing: 18) {
            locationHeader
            VStack(alignment: .leading, spacing: 12) {
                Text("WHAT ARE YOU REPORTING?").font(.caption.weight(.bold)).foregroundStyle(AftermapTheme.cyan)
                Picker("Report type", selection: $kind) {
                    Text("Passage").tag(AISuggestion.Kind.passage)
                    Text("Assembly / exit point").tag(AISuggestion.Kind.exit)
                    Text("Request help").tag(AISuggestion.Kind.help)
                }
                .pickerStyle(.segmented)
                reportFields
            }
            .aftermapPanel()

            VStack(alignment: .leading, spacing: 12) {
                Text("EVIDENCE").font(.caption.weight(.bold)).foregroundStyle(AftermapTheme.cyan)
                HStack {
                    ForEach(Evidence.allCases) { option in
                        Button { evidence = option; if option != .voice { speech.stop() } } label: {
                            VStack(spacing: 6) { Image(systemName: option.icon); Text(option.label).font(.caption2) }
                                .frame(maxWidth: .infinity).padding(.vertical, 9)
                                .foregroundStyle(evidence == option ? AftermapTheme.navy : .white)
                                .background(evidence == option ? AftermapTheme.mint : AftermapTheme.panelRaised, in: RoundedRectangle(cornerRadius: 10))
                        }
                    }
                }
                evidenceInput
            }
            .aftermapPanel()

            Button { Task { await prepareReview() } } label: {
                primaryLabel(evidence == .manual ? "Review manual report" : (isInterpreting ? "Interpreting…" : "Ask AI to interpret"), icon: evidence == .manual ? "checklist" : "sparkles")
            }
            .disabled(isInterpreting || store.isBusy || !canContinue)
        }
    }

    @ViewBuilder private var reportFields: some View {
        if kind == .passage {
            nodePicker("From", selection: $fromId)
            nodePicker("To", selection: $toId, excluding: fromId)
            Picker("Condition", selection: $status) {
                Text("Open").tag(MapEdge.State.open)
                Text("Blocked").tag(MapEdge.State.blocked)
                Text("Suspected hazard").tag(MapEdge.State.hazard)
            }
            .pickerStyle(.segmented)
        } else {
            nodePicker(kind == .exit ? "Assembly / exit point" : "Help location", selection: $nodeId)
        }
    }

    @ViewBuilder private var evidenceInput: some View {
        switch evidence {
        case .manual:
            TextField("Optional field note", text: $note, axis: .vertical).lineLimit(3...6).textFieldStyle(.roundedBorder)
        case .text:
            TextField("Describe what you observe", text: $note, axis: .vertical).lineLimit(3...6).textFieldStyle(.roundedBorder)
        case .voice:
            Button { speech.toggle() } label: {
                Label(speech.isRecording ? "Stop transcription" : "Start voice transcription", systemImage: speech.isRecording ? "stop.circle.fill" : "mic.circle.fill")
                    .foregroundStyle(speech.isRecording ? AftermapTheme.red : AftermapTheme.mint)
            }
            TextField("Editable transcript", text: $note, axis: .vertical).lineLimit(3...6).textFieldStyle(.roundedBorder)
        case .image:
            if let image { Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 180).clipShape(RoundedRectangle(cornerRadius: 12)) }
            HStack {
                Button { showingCamera = true } label: { Label("Camera", systemImage: "camera.fill") }
                    .disabled(!UIImagePickerController.isSourceTypeAvailable(.camera))
                PhotosPicker(selection: $photoItem, matching: .images) { Label("Photo library", systemImage: "photo") }
            }
            TextField("Optional note for the image", text: $note, axis: .vertical).lineLimit(2...4).textFieldStyle(.roundedBorder)
        }
    }

    private var reviewStep: some View {
        VStack(alignment: .leading, spacing: 18) {
            Label(suggestion == nil ? "MANUAL REPORT" : "AI SUGGESTION — NOT YET SHARED", systemImage: suggestion == nil ? "person.fill.checkmark" : "sparkles")
                .font(.caption.weight(.bold)).foregroundStyle(suggestion == nil ? AftermapTheme.cyan : AftermapTheme.amber)
            Text("Confirm what the shared map should learn.").font(.title2.bold())
            Text("AI output is only a proposal. Your tap below creates the authoritative, provenance-linked observation.")
                .foregroundStyle(AftermapTheme.muted)

            VStack(alignment: .leading, spacing: 12) {
                reviewRow("Type", value: confirmedSuggestion.kind.rawValue.capitalized)
                if confirmedSuggestion.kind == .passage {
                    reviewRow("Passage", value: "\(nodeLabel(confirmedSuggestion.from)) → \(nodeLabel(confirmedSuggestion.to))")
                    reviewRow("Condition", value: confirmedSuggestion.status?.rawValue.capitalized ?? "Not set")
                } else { reviewRow("Location", value: nodeLabel(confirmedSuggestion.nodeId)) }
                if let confidence = suggestion?.confidence { reviewRow("AI confidence", value: "\(Int(confidence * 100))%") }
                if !note.isEmpty { reviewRow("Evidence note", value: note) }
                if let interpretationMessage { Text(interpretationMessage).font(.caption).foregroundStyle(AftermapTheme.amber) }
                Text("Observation ID\n\(observationId)").font(.caption2.monospaced()).foregroundStyle(AftermapTheme.muted)
            }
            .aftermapPanel()

            Button { Task { await submitConfirmed() } } label: { primaryLabel(store.isBusy ? "Submitting…" : "Confirm and update shared map", icon: "checkmark.shield.fill") }
                .disabled(store.isBusy)
            Button("Go back and edit") { stage = .evidence }.frame(maxWidth: .infinity)
        }
    }

    private var locationHeader: some View {
        HStack {
            Label(nodeLabel(checkpointId), systemImage: "location.fill").font(.headline)
            Spacer()
            Button("Change") { stage = .checkpoint }.font(.caption)
        }
        .padding(12).background(AftermapTheme.mint.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
    }

    private var confirmedSuggestion: AISuggestion {
        suggestion ?? AISuggestion(kind: kind, from: kind == .passage ? fromId : nil, to: kind == .passage ? toId : nil, nodeId: kind == .passage ? nil : nodeId, status: kind == .passage ? status : nil, confidence: 1, note: note.isEmpty ? nil : note)
    }

    private var canContinue: Bool {
        let fieldsValid = kind == .passage ? (!fromId.isEmpty && !toId.isEmpty && fromId != toId) : !nodeId.isEmpty
        let evidenceValid: Bool = switch evidence { case .manual: true; case .text, .voice: !note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty; case .image: image != nil }
        return fieldsValid && evidenceValid
    }

    private func seedDefaults() {
        guard let first = nodes.first else { return }
        if checkpointId.isEmpty { checkpointId = store.snapshot?.participants.first(where: { $0.id == store.observerId })?.checkpointId ?? first.id }
        if fromId.isEmpty { fromId = checkpointId }
        if toId.isEmpty { toId = nodes.first(where: { $0.id != fromId })?.id ?? "" }
        if nodeId.isEmpty { nodeId = checkpointId }
    }

    private func handleScanned(_ payload: String) {
        guard let parsed = QRPayloadParser.checkpoint(from: payload, expectedSession: store.sessionCode) else { localError = "That QR belongs to a different session."; return }
        guard nodeIds.contains(parsed) else { localError = "Checkpoint “\(parsed)” is not in the current server snapshot."; return }
        checkpointId = parsed
    }

    private func prepareReview() async {
        speech.stop()
        guard evidence != .manual else { suggestion = nil; stage = .review; return }
        guard let observerId = store.observerId else { localError = "Rejoin the session before reporting."; return }
        isInterpreting = true
        defer { isInterpreting = false }
        var encodedImage: String?
        if evidence == .image {
            guard let data = image?.aftermapJPEG(), data.count < 1_000_000 else { localError = "The image could not be resized below 1 MB."; return }
            encodedImage = data.base64EncodedString()
        }
        let request = InterpretRequest(
            observerId: observerId,
            checkpointId: checkpointId,
            evidenceType: evidence == .image ? .image : (evidence == .voice ? .voice : .text),
            note: note.isEmpty ? nil : note,
            imageBase64: encodedImage,
            imageMimeType: encodedImage == nil ? nil : "image/jpeg"
        )
        do {
            let response = try await store.interpret(request)
            interpretationMessage = response.message
            if let proposed = response.suggestion {
                suggestion = proposed
            } else {
                suggestion = nil
                interpretationMessage = response.message ?? "AI was unavailable or uncertain. Review and manually confirm the structured report below."
            }
            stage = .review
        } catch {
            suggestion = nil
            interpretationMessage = "AI interpretation was unavailable: \(error.localizedDescription) Review the manual fields and confirm if they are accurate."
            stage = .review
        }
    }

    private func submitConfirmed() async {
        guard let observerId = store.observerId else { return }
        let value = confirmedSuggestion
        let request = ObservationRequest(
            id: observationId, observerId: observerId, checkpointId: checkpointId, kind: value.kind,
            from: value.kind == .passage ? value.from : nil, to: value.kind == .passage ? value.to : nil,
            nodeId: value.kind == .passage ? nil : value.nodeId, status: value.kind == .passage ? value.status : nil,
            evidenceType: evidence.rawValue, confidence: suggestion?.confidence, note: note.isEmpty ? value.note : note, confirmed: true
        )
        if await store.submit(request) { dismiss() }
    }

    private func nodeLabel(_ id: String?) -> String {
        guard let id else { return "Not set" }
        return nodes.first(where: { $0.id == id }).map { "\($0.label) (\($0.id))" } ?? id
    }

    private func nodePicker(_ label: String, selection: Binding<String>, excluding: String? = nil) -> some View {
        Picker(label, selection: selection) {
            ForEach(nodes.filter { $0.id != excluding }) { node in Text("\(node.label) • \(node.id)").tag(node.id) }
        }.pickerStyle(.menu)
    }

    private func reviewRow(_ label: String, value: String) -> some View {
        HStack(alignment: .top) { Text(label).foregroundStyle(AftermapTheme.muted); Spacer(); Text(value).multilineTextAlignment(.trailing).fontWeight(.semibold) }
    }

    private func primaryLabel(_ text: String, icon: String) -> some View {
        Label(text, systemImage: icon).font(.headline).frame(maxWidth: .infinity).padding().foregroundStyle(AftermapTheme.navy).background(AftermapTheme.mint, in: RoundedRectangle(cornerRadius: 15))
    }
}
