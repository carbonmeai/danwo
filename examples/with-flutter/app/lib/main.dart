import 'package:flutter/material.dart';

import 'waitlist_api.dart';

/// Lumen's waitlist as a Flutter app: one screen that joins the waitlist through the API.
void main() => runApp(const LumenApp());

class LumenApp extends StatelessWidget {
  const LumenApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Lumen',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(colorSchemeSeed: const Color(0xFF3D5AFE)),
      home: const WaitlistScreen(),
    );
  }
}

/// The waitlist screen: an email field, a button, and what the API answered.
class WaitlistScreen extends StatefulWidget {
  const WaitlistScreen({super.key});

  @override
  State<WaitlistScreen> createState() => _WaitlistScreenState();
}

class _WaitlistScreenState extends State<WaitlistScreen> {
  final _api = WaitlistApi();
  final _email = TextEditingController();
  bool _sending = false;
  Joined? _joined;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _join() async {
    FocusScope.of(context).unfocus();
    setState(() {
      _error = null;
      _joined = null;
      _sending = true;
    });

    try {
      final joined = await _api.join(_email.text);

      if (mounted) setState(() => _joined = joined);
    } on Refused catch (refused) {
      if (mounted) setState(() => _error = refused.message);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;
    final joined = _joined;
    final error = _error;

    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            Text(
              'LUMEN',
              style: theme.textTheme.labelMedium?.copyWith(
                fontFamily: 'monospace',
                fontWeight: FontWeight.w600,
                color: muted,
              ),
            ),
            const SizedBox(height: 20),
            Semantics(
              header: true,
              child: Text(
                'Join the waitlist',
                style: theme.textTheme.headlineMedium,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              "Lumen opens to a few teams each week. Leave your work email and we'll write when your seat is ready.",
              style: TextStyle(color: muted),
            ),
            const SizedBox(height: 20),
            // The identifier is what getByTestId finds, on both platforms.
            Semantics(
              identifier: 'email',
              child: TextField(
                controller: _email,
                decoration: const InputDecoration(
                  labelText: 'Work email',
                  hintText: 'you@company.com',
                  border: OutlineInputBorder(),
                ),
                keyboardType: TextInputType.emailAddress,
                autocorrect: false,
                textInputAction: TextInputAction.go,
                onSubmitted: (_) => _join(),
              ),
            ),
            const SizedBox(height: 20),
            Semantics(
              identifier: 'join',
              child: FilledButton(
                onPressed: _sending ? null : _join,
                style: FilledButton.styleFrom(
                  minimumSize: const Size.fromHeight(48),
                ),
                child: Text(_sending ? 'Joining…' : 'Join the waitlist'),
              ),
            ),
            if (error != null) ...[
              const SizedBox(height: 20),
              Semantics(
                identifier: 'error',
                container: true,
                child: Text(
                  error,
                  style: TextStyle(color: theme.colorScheme.error),
                ),
              ),
            ],
            if (joined != null) ...[
              const SizedBox(height: 20),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    spacing: 6,
                    children: [
                      Semantics(
                        identifier: 'status',
                        container: true,
                        child: Text(
                          "You're on the list",
                          style: theme.textTheme.titleMedium,
                        ),
                      ),
                      if (joined.status == 'already')
                        const Text('This email had already joined.'),
                      Row(
                        spacing: 4,
                        children: [
                          Text(
                            'People waiting:',
                            style: TextStyle(color: muted),
                          ),
                          Semantics(
                            identifier: 'waitlist-count',
                            container: true,
                            child: Text('${joined.count}'),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
