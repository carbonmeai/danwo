import Foundation

/// The waitlist API, at its production address. Nothing here changes for tests: danwo sets the
/// simulator's proxy and trusts its own CA there, and the proxy routes this host to the test API.
enum WaitlistAPI {
    static let base = URL(string: "https://api.lumen.example")!

    /// What joining answers: a new seat or one the email already had, and how many are waiting.
    struct Joined: Decodable, Sendable {
        let status: String
        let count: Int
    }

    /// An answer the API refused, with the message it gave.
    struct Refused: Decodable, Error, Sendable {
        let error: String
    }

    /// The API's own trouble (a 5xx) or a lost connection: worth another try.
    private struct Unavailable: Error {}

    /// The pauses before each retry. Joining is safe to repeat: the API keeps one row and sends one
    /// email per address however many times it is asked.
    private static let retryDelays: [Duration] = [.milliseconds(300), .seconds(1), .seconds(2)]

    /// Puts `email` on the waitlist, trying again when the API is briefly unavailable.
    static func join(email: String) async throws -> Joined {
        for delay in retryDelays {
            do {
                return try await attempt(email: email)
            } catch is Unavailable {
                try await Task.sleep(for: delay)
            } catch is URLError {
                try await Task.sleep(for: delay)
            }
        }

        do {
            return try await attempt(email: email)
        } catch is Unavailable {
            throw Refused(error: "We couldn't add you just now. Please try again in a minute.")
        }
    }

    private static func attempt(email: String) async throws -> Joined {
        var request = URLRequest(url: base.appending(path: "join"))

        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["email": email])
        request.timeoutInterval = 20

        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0

        if status >= 500 { throw Unavailable() }
        guard (200..<300).contains(status) else {
            throw (try? JSONDecoder().decode(Refused.self, from: data))
                ?? Refused(error: "We couldn't add you just now. Please try again in a minute.")
        }

        return try JSONDecoder().decode(Joined.self, from: data)
    }
}
