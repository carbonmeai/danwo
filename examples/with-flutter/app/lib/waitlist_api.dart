import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:cupertino_http/cupertino_http.dart';
import 'package:http/http.dart' as http;
import 'package:cronet_http/cronet_http.dart';

/// What joining answers: a new seat or one the email already had, and how many are waiting.
class Joined {
  const Joined({required this.status, required this.count});

  final String status;
  final int count;
}

/// An answer the API refused, with the message it gave.
class Refused implements Exception {
  const Refused(this.message);

  final String message;
}

/// The API's own trouble (a 5xx) or a lost connection: worth another try.
class _Unavailable implements Exception {}

const _unavailable =
    "We couldn't add you just now. Please try again in a minute.";

/// The platform's own HTTP stack: URLSession on iOS and Cronet on Android follow the device's
/// proxy and trust store as a native app does. Dart's own `HttpClient` would follow neither.
http.Client _platformClient() {
  if (Platform.isIOS) return CupertinoClient.defaultSessionConfiguration();
  if (Platform.isAndroid) return CronetClient.defaultCronetEngine();
  return http.Client();
}

/// The waitlist API, at its production address. Nothing here changes for tests: danwo points the
/// device's proxy at its own and trusts its CA there, and the proxy routes this host to the test API.
class WaitlistApi {
  WaitlistApi({http.Client? client}) : _client = client ?? _platformClient();

  static final Uri base = Uri.parse('https://api.lumen.example');

  final http.Client _client;

  /// The pauses before each retry. Joining is safe to repeat: the API keeps one row and sends one
  /// email per address however many times it is asked.
  static const _retryDelays = [
    Duration(milliseconds: 300),
    Duration(seconds: 1),
    Duration(seconds: 2),
  ];

  /// Puts [email] on the waitlist, trying again when the API is briefly unavailable.
  Future<Joined> join(String email) async {
    for (final pause in _retryDelays) {
      try {
        return await _attempt(email);
      } on _Unavailable {
        await Future<void>.delayed(pause);
      } on http.ClientException {
        await Future<void>.delayed(pause);
      } on TimeoutException {
        await Future<void>.delayed(pause);
      }
    }

    try {
      return await _attempt(email);
    } on _Unavailable {
      throw const Refused(_unavailable);
    } on http.ClientException {
      throw const Refused(_unavailable);
    } on TimeoutException {
      throw const Refused(_unavailable);
    }
  }

  Future<Joined> _attempt(String email) async {
    final response = await _client
        .post(
          base.resolve('/join'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({'email': email}),
        )
        .timeout(const Duration(seconds: 20));

    if (response.statusCode >= 500) throw _Unavailable();
    if (response.statusCode < 200 || response.statusCode > 299) {
      String? message;

      try {
        message =
            (jsonDecode(response.body) as Map<String, dynamic>)['error']
                as String?;
      } on FormatException {
        message = null;
      }

      throw Refused(message ?? _unavailable);
    }

    final json = jsonDecode(response.body) as Map<String, dynamic>;

    return Joined(
      status: json['status'] as String,
      count: json['count'] as int,
    );
  }
}
