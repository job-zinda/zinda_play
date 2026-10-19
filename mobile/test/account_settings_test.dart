import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:zinda_play/api.dart';
import 'package:zinda_play/screens/account_screen.dart';
import 'package:zinda_play/screens/auth_screen.dart';
import 'package:zinda_play/screens/recovery_screen.dart';

Finder field(String label) => find.byWidgetPredicate(
  (widget) => widget is TextField && widget.decoration?.labelText == label,
);

void main() {
  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({
      'token': 'test',
      'role': 'member',
      'username': 'viewer',
    });
    await Api.instance.restore();
  });
  tearDown(() async {
    FlutterSecureStorage.setMockInitialValues({});
    await Api.instance.restore();
  });

  testWidgets(
    'verification recovery submits the six-digit OTP with its recipient email',
    (tester) async {
      Map<String, dynamic>? body;
      final client = MockClient((request) async {
        expect(request.url.path, '/api/auth/account-action');
        body = jsonDecode(request.body) as Map<String, dynamic>;
        return http.Response(
          jsonEncode({'message': 'Recovery email verified.'}),
          200,
        );
      });
      await http.runWithClient(() async {
        await tester.pumpWidget(
          const MaterialApp(home: RecoveryScreen(initialPurpose: 'verify')),
        );
        await tester.enterText(
          field('Email receiving the OTP'),
          'person@example.test',
        );
        await tester.enterText(field('Paste code from email'), '123456');
        await tester.tap(find.widgetWithText(FilledButton, 'Confirm'));
        await tester.pumpAndSettle();
        expect(body, {
          'purpose': 'verify',
          'token': '123456',
          'password': '',
          'email': 'person@example.test',
        });
        expect(find.text('Recovery email verified.'), findsOneWidget);
        await tester.pumpWidget(const SizedBox.shrink());
      }, () => client);
    },
  );

  testWidgets(
    'viewer sees required photo, optional intro, and disabled explicit submission',
    (tester) async {
      var submitted = false;
      final client = MockClient((request) async {
        if (request.url.path == '/api/account/creator-application') {
          submitted = true;
        }
        final body = request.url.path == '/api/account/security'
            ? {'username': 'viewer', 'email': '', 'pendingEmail': ''}
            : {
                'role': 'member',
                'approvalStatus': 'draft',
                'profilePhotoUrl': '',
                'introVideoUrl': '',
              };
        return http.Response(jsonEncode(body), 200);
      });
      await http.runWithClient(() async {
        await tester.pumpWidget(const MaterialApp(home: AccountScreen()));
        await tester.pumpAndSettle();
        expect(find.text('1. Add profile photo (required)'), findsOneWidget);
        expect(
          find.textContaining('Introduction video (optional)'),
          findsOneWidget,
        );
        expect(find.textContaining('quicker approval'), findsOneWidget);
        final submit = find.widgetWithText(FilledButton, 'Submit for approval');
        expect(tester.widget<FilledButton>(submit).onPressed, isNull);
        expect(Api.instance.role, 'member');
        expect(submitted, isFalse);
        await tester.pumpWidget(const SizedBox.shrink());
      }, () => client);
    },
  );

  testWidgets(
    'pending application remains viewer with no second submit button',
    (tester) async {
      final client = MockClient(
        (request) async => http.Response(
          jsonEncode(
            request.url.path == '/api/account/security'
                ? {'username': 'viewer', 'email': '', 'pendingEmail': ''}
                : {
                    'role': 'member',
                    'approvalStatus': 'pending',
                    'profilePhotoUrl': '',
                    'introVideoUrl': '',
                  },
          ),
          200,
        ),
      );
      await http.runWithClient(() async {
        await tester.pumpWidget(const MaterialApp(home: AccountScreen()));
        await tester.pumpAndSettle();
        expect(find.textContaining('awaiting approval'), findsOneWidget);
        expect(find.text('Submit for approval'), findsNothing);
        expect(Api.instance.role, 'member');
        await tester.pumpWidget(const SizedBox.shrink());
      }, () => client);
    },
  );

  testWidgets(
    'member signup opens OTP entry immediately and allows verification later',
    (tester) async {
      final paths = <String>[];
      final client = MockClient((request) async {
        paths.add(request.url.path);
        final Object body = switch (request.url.path) {
          '/api/auth/register' => {
            'token': 'test',
            'username': 'new-creator',
            'role': 'member',
            'verificationSent': true,
          },
          '/api/account/security' => {
            'username': 'new-creator',
            'email': '',
            'pendingEmail': '',
          },
          '/api/account' => {
            'role': 'member',
            'approvalStatus': 'draft',
            'profilePhotoUrl': '',
            'introVideoUrl': '',
          },
          _ => throw StateError('Unexpected request: ${request.url.path}'),
        };
        return http.Response(jsonEncode(body), 200);
      });
      await http.runWithClient(() async {
        await tester.pumpWidget(
          MaterialApp(
            home: Builder(
              builder: (context) => Scaffold(
                body: TextButton(
                  onPressed: () => Navigator.push(
                    context,
                    MaterialPageRoute<void>(builder: (_) => const AuthScreen()),
                  ),
                  child: const Text('Open signup'),
                ),
              ),
            ),
          ),
        );
        await tester.tap(find.text('Open signup'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('New here? Create an account'));
        await tester.pumpAndSettle();
        expect(find.text('Viewer'), findsNothing);
        expect(find.text('Promoter'), findsNothing);
        expect(find.text('Creator'), findsNothing);
        expect(find.text('Member'), findsOneWidget);
        await tester.enterText(field('Username'), 'new-creator');
        await tester.enterText(field('Email'), 'creator@example.test');
        await tester.enterText(field('Password'), 'new-password');
        final submit = find.widgetWithText(FilledButton, 'Create account');
        await tester.ensureVisible(submit);
        await tester.tap(submit);
        await tester.pumpAndSettle();
        expect(find.byType(AuthScreen), findsNothing);
        expect(find.byType(AccountScreen), findsNothing);
        expect(Api.instance.role, 'member');
        expect(paths, isNot(contains('/api/account/creator-application')));
        expect(paths, ['/api/auth/register']);
        expect(find.text('Verify your email'), findsOneWidget);
        expect(
          tester
              .widget<TextField>(field('Email receiving the OTP'))
              .controller!
              .text,
          'creator@example.test',
        );
        await tester.tap(find.text('Verify later'));
        await tester.pumpAndSettle();
        expect(find.text('Open signup'), findsOneWidget);
        expect(Api.instance.role, 'member');
        await tester.pumpWidget(const SizedBox.shrink());
      }, () => client);
    },
  );

  for (final role in ['member', 'creator', 'promoter', 'business']) {
    testWidgets('$role can update username and verify recovery email', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(430, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      Api.instance.role = role;
      var username = 'viewer', pending = '', verified = '';
      Map<String, dynamic>? usernameBody, emailBody, verifyBody;
      final client = MockClient((request) async {
        if (request.url.path == '/api/account/security') {
          return http.Response(
            jsonEncode({
              'username': username,
              'email': verified,
              'pendingEmail': pending,
            }),
            200,
          );
        }
        if (request.url.path == '/api/account') {
          expect(role, isNot('business'));
          return http.Response(
            jsonEncode({
              'role': role,
              'approvalStatus': role == 'creator' ? 'approved' : 'draft',
              'profilePhotoUrl': '',
              'introVideoUrl': '',
            }),
            200,
          );
        }
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        if (request.url.path == '/api/account/username') {
          expect(request.method, 'PATCH');
          usernameBody = body;
          username = body['username'] as String;
          return http.Response(
            jsonEncode({'username': username, 'message': 'Username updated.'}),
            200,
          );
        }
        if (request.url.path == '/api/account/recovery-email') {
          emailBody = body;
          pending = body['email'] as String;
          return http.Response(
            jsonEncode({'message': 'Verification email sent.'}),
            200,
          );
        }
        if (request.url.path == '/api/auth/account-action') {
          verifyBody = body;
          verified = pending;
          pending = '';
          return http.Response(
            jsonEncode({'message': 'Recovery email verified.'}),
            200,
          );
        }
        fail('Unexpected route: ${request.url.path}');
      });
      await http.runWithClient(() async {
        await tester.pumpWidget(const MaterialApp(home: AccountScreen()));
        await tester.pumpAndSettle();
        await tester.ensureVisible(field('Current password'));
        await tester.enterText(field('Current password'), 'current-password');
        await tester.ensureVisible(field('New username'));
        await tester.enterText(field('New username'), 'renamed');
        final change = find.widgetWithText(OutlinedButton, 'Change username');
        await tester.ensureVisible(change);
        await tester.tap(change);
        await tester.pumpAndSettle();
        expect(usernameBody, {
          'username': 'renamed',
          'password': 'current-password',
        });
        expect(Api.instance.username, 'renamed');
        await tester.ensureVisible(field('Current password'));
        await tester.enterText(field('Current password'), 'current-password');
        await tester.ensureVisible(field('Recovery email'));
        await tester.enterText(field('Recovery email'), 'person@example.test');
        final send = find.widgetWithText(
          OutlinedButton,
          'Send verification email',
        );
        await tester.ensureVisible(send);
        await tester.tap(send);
        await tester.pumpAndSettle();
        expect(emailBody, {
          'email': 'person@example.test',
          'password': 'current-password',
        });
        await tester.ensureVisible(field('Paste verification code from email'));
        await tester.enterText(
          field('Paste verification code from email'),
          '123456',
        );
        final verify = find.widgetWithText(FilledButton, 'Verify email');
        await tester.ensureVisible(verify);
        await tester.tap(verify);
        await tester.pumpAndSettle();
        expect(verifyBody, {
          'purpose': 'verify',
          'token': '123456',
          'email': 'person@example.test',
        });
        expect(
          find.text('Verified recovery email: person@example.test'),
          findsOneWidget,
        );
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      }, () => client);
    });
  }

  testWidgets(
    'forgot password and username recovery are available from sign in',
    (tester) async {
      final requests = <Map<String, dynamic>>[];
      final client = MockClient((request) async {
        expect(request.url.path, '/api/auth/recovery');
        requests.add(jsonDecode(request.body) as Map<String, dynamic>);
        return http.Response(jsonEncode({'message': 'Check your inbox.'}), 200);
      });
      await http.runWithClient(() async {
        await tester.pumpWidget(const MaterialApp(home: AuthScreen()));
        expect(find.text('Forgot username?'), findsOneWidget);
        await tester.tap(find.text('Forgot password?'));
        await tester.pumpAndSettle();
        expect(find.byType(RecoveryScreen), findsOneWidget);
        await tester.enterText(
          field('Verified recovery email'),
          'person@example.test',
        );
        await tester.tap(find.text('Send recovery email'));
        await tester.pumpAndSettle();
        expect(requests.single, {
          'purpose': 'password',
          'email': 'person@example.test',
        });
        await tester.tap(find.byType(DropdownButtonFormField<String>));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Forgot username').last);
        await tester.pumpAndSettle();
        await tester.tap(find.text('Send recovery email'));
        await tester.pumpAndSettle();
        expect(requests.last['purpose'], 'username');
        expect(find.text('Check your inbox.'), findsOneWidget);
        await tester.pumpWidget(const SizedBox.shrink());
      }, () => client);
    },
  );

  testWidgets(
    'expired reset errors are displayed and the exact reset body is sent',
    (tester) async {
      Map<String, dynamic>? sent;
      final client = MockClient((request) async {
        expect(request.url.path, '/api/auth/account-action');
        sent = jsonDecode(request.body) as Map<String, dynamic>;
        return http.Response(
          jsonEncode({'error': 'This code is expired.'}),
          400,
        );
      });
      await http.runWithClient(() async {
        await tester.pumpWidget(const MaterialApp(home: RecoveryScreen()));
        await tester.tap(find.byType(DropdownButtonFormField<String>));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Reset password with email code').last);
        await tester.pumpAndSettle();
        await tester.enterText(field('Paste code from email'), 'reset-token');
        await tester.enterText(
          field('New password (at least 8 characters)'),
          'new-password',
        );
        await tester.tap(find.text('Confirm'));
        await tester.pumpAndSettle();
        expect(sent, {
          'purpose': 'reset',
          'token': 'reset-token',
          'password': 'new-password',
        });
        expect(find.text('This code is expired.'), findsOneWidget);
        await tester.pumpWidget(const SizedBox.shrink());
      }, () => client);
    },
  );
}
