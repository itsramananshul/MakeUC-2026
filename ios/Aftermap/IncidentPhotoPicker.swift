import SwiftUI
import UIKit

enum IncidentPhotoProcessor {
    static let maximumJPEGBytes = 1_150_000

    static func jpegData(from source: UIImage) -> Data? {
        var image = resized(source, maximumDimension: 1_600)
        for maximumDimension in [1_600, 1_300, 1_050, 850] {
            if max(image.size.width, image.size.height) > CGFloat(maximumDimension) {
                image = resized(image, maximumDimension: CGFloat(maximumDimension))
            }
            for quality in [0.82, 0.72, 0.62, 0.5, 0.4] {
                if let data = image.jpegData(compressionQuality: quality), data.count <= maximumJPEGBytes {
                    return data
                }
            }
        }
        return nil
    }

    static func jpegData(from data: Data) -> Data? {
        guard let image = UIImage(data: data) else { return nil }
        return jpegData(from: image)
    }

    private static func resized(_ source: UIImage, maximumDimension: CGFloat) -> UIImage {
        let longest = max(source.size.width, source.size.height)
        guard longest > maximumDimension else { return normalized(source) }
        let scale = maximumDimension / longest
        let size = CGSize(width: source.size.width * scale, height: source.size.height * scale)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in
            UIColor.white.setFill()
            UIRectFill(CGRect(origin: .zero, size: size))
            source.draw(in: CGRect(origin: .zero, size: size))
        }
    }

    private static func normalized(_ source: UIImage) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: source.size, format: format).image { _ in
            UIColor.white.setFill()
            UIRectFill(CGRect(origin: .zero, size: source.size))
            source.draw(in: CGRect(origin: .zero, size: source.size))
        }
    }
}

struct IncidentCameraPicker: UIViewControllerRepresentable {
    @Binding var image: UIImage?
    @Environment(\.dismiss) private var dismiss

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let controller = UIImagePickerController()
        controller.sourceType = .camera
        controller.cameraCaptureMode = .photo
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    final class Coordinator: NSObject, UINavigationControllerDelegate, UIImagePickerControllerDelegate {
        var parent: IncidentCameraPicker

        init(parent: IncidentCameraPicker) { self.parent = parent }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            parent.image = info[.originalImage] as? UIImage
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }
    }
}
