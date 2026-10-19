import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:zinda_play/api.dart';
import 'package:zinda_play/screens/recovery_screen.dart';

void main() {
  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({
      'token': 'member-token',
      'role': 'member',
      'username': 'member',
    });
    await Api.instance.restore();
  });
  tearDown(() async {
    FlutterSecureStorage.setMockInitialValues({});
    await Api.instance.restore();
  });

  testWidgets(
    'signup OTP supports resend, inline errors and successful verification',
    (tester) async {
      var sends = 0;
      var attempts = 0;
      final client = MockClient((request) async {
        expect(request.headers['authorization'], 'Bearer member-token');
        if (request.url.path == '/api/account/verification-otp') {
          sends++;
          expect(jsonDecode(request.body), isEmpty);
          return http.Response(
            jsonEncode({'message': 'Verification OTP sent.'}),
            200,
          );
        }
        expect(request.url.path, '/api/auth/account-action');
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['email'], 'member@example.test');
        expect(body['purpose'], 'verify');
        attempts++;
        if (attempts == 1) {
          return http.Response(jsonEncode({'error': 'Incorrect OTP.'}), 400);
        }
        expect(body['token'], '123456');
        return http.Response(
          jsonEncode({'message': 'Recovery email verified.'}),
          200,
        );
      });
      await http.runWithClient(() async {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: Builder(
                builder: (context) => TextButton(
                  onPressed: () => Navigator.push(
                    context,
                    MaterialPageRoute<void>(
                      builder: (_) => const RecoveryScreen(
                        initialPurpose: 'verify',
                        initialEmail: 'member@example.test',
                        signupVerification: true,
                        verificationSent: false,
                      ),
                    ),
                  ),
                  child: const Text('Home'),
                ),
              ),
            ),
          ),
        );
        await tester.tap(find.text('Home'));
        await tester.pumpAndSettle();
        expect(find.text('Verify your email'), findsOneWidget);
        expect(find.textContaining('could not be sent'), findsOneWidget);
        expect(find.byType(DropdownButtonFormField<String>), findsNothing);
        final email = find.byWidgetPredicate(
          (widget) =>
              widget is TextField &&
              widget.decoration?.labelText == 'Email receiving the OTP',
        );
        expect(tester.widget<TextField>(email).readOnly, true);
        await tester.tap(find.text('Resend OTP'));
        await tester.pumpAndSettle();
        expect(sends, 1);
        final code = find.byWidgetPredicate(
          (widget) =>
              widget is TextField &&
              widget.decoration?.labelText == 'Paste code from email',
        );
        await tester.enterText(code, '000000');
        await tester.tap(find.widgetWithText(FilledButton, 'Confirm'));
        await tester.pumpAndSettle();
        expect(find.text('Incorrect OTP.'), findsOneWidget);
        expect(find.text('Verify your email'), findsOneWidget);
        await tester.enterText(code, '123456');
        await tester.tap(find.widgetWithText(FilledButton, 'Confirm'));
        await tester.pumpAndSettle();
        expect(find.text('Home'), findsOneWidget);
        expect(find.text('Recovery email verified.'), findsOneWidget);
        expect(Api.instance.role, 'member');
        await tester.pumpWidget(const SizedBox.shrink());
      }, () => client);
    },
  );
}
