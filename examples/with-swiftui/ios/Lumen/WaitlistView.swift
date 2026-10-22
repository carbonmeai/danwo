import SwiftUI

/// The waitlist screen: an email field, a button, and what the API answered.
struct WaitlistView: View {
    @State private var email = ""
    @State private var sending = false
    @State private var joined: WaitlistAPI.Joined?
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("LUMEN")
                .font(.system(.caption, design: .monospaced).weight(.semibold))
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 8) {
                Text("Join the waitlist")
                    .font(.largeTitle.weight(.semibold))
                    .accessibilityAddTraits(.isHeader)
                Text("Lumen opens to a few teams each week. Leave your work email and we'll write when your seat is ready.")
                    .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Work email")
                    .font(.subheadline.weight(.medium))
                    .accessibilityHidden(true)
                // accessibilityIdentifier is what getByTestId finds; the label is what getByLabel finds.
                TextField("you@company.com", text: $email)
                    .accessibilityLabel("Work email")
                    .accessibilityIdentifier("email")
                    .keyboardType(.emailAddress)
                    .textContentType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focused)
                    .onSubmit(join)
                    .padding(.horizontal, 12)
                    .frame(height: 44)
                    .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 8))
            }

            Button(action: join) {
                Text(sending ? "Joining…" : "Join the waitlist")
                    .font(.body.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .disabled(sending)
            .accessibilityIdentifier("join")

            if let error {
                Text(error)
                    .foregroundStyle(.red)
                    .accessibilityIdentifier("error")
            }

            if let joined {
                VStack(alignment: .leading, spacing: 6) {
                    Text("You're on the list")
                        .font(.headline)
                        .accessibilityIdentifier("status")
                    if joined.status == "already" {
                        Text("This email had already joined.")
                            .foregroundStyle(.secondary)
                    }
                    HStack(spacing: 4) {
                        Text("People waiting:")
                            .foregroundStyle(.secondary)
                        Text("\(joined.count)")
                            .accessibilityIdentifier("waitlist-count")
                    }
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 12))
            }

            Spacer()
        }
        .padding(24)
    }

    private func join() {
        focused = false
        error = nil
        joined = nil
        sending = true

        Task {
            defer { sending = false }

            do {
                joined = try await WaitlistAPI.join(email: email)
            } catch let refused as WaitlistAPI.Refused {
                error = refused.error
            } catch {
                self.error = "We couldn't add you just now. Please try again in a minute."
            }
        }
    }
}

#Preview {
    WaitlistView()
}
