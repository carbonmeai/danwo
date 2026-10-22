import SwiftUI

/// Lumen's waitlist as a SwiftUI app: one screen that joins the waitlist through the API.
@main
struct LumenApp: App {
    var body: some Scene {
        WindowGroup {
            WaitlistView()
        }
    }
}
