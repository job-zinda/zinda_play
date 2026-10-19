import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:zinda_play/api.dart';
import 'package:zinda_play/screens/auth_screen.dart';

void main() {
  testWidgets(
    'business signup hides referrals and never submits a saved member invitation',
    (tester) async {
      FlutterSecureStorage.setMockInitialValues({});
      await Api.instance.restore();
      addTearDown(() async {
        FlutterSecureStorage.setMockInitialValues({});
        await Api.instance.restore();
      });
      Map<String, dynamic>? registration;
      final client = MockClient((request) async {
        registration = jsonDecode(request.body) as Map<String, dynamic>;
        return http.Response(
          jsonEncode({
            'token': 'test',
            'username': 'business',
            'role': 'business',
          }),
          201,
        );
      });
      await http.runWithClient(() async {
        await tester.pumpWidget(const MaterialApp(home: AuthScreen()));
        await tester.tap(find.text('New here? Create an account'));
        await tester.pumpAndSettle();
        final invitation = find.byWidgetPredicate(
          (widget) =>
              widget is TextField &&
              widget.decoration?.labelText == 'Invitation ID (optional)',
        );
        await tester.enterText(invitation, '123456');
        await tester.ensureVisible(find.text('Business'));
        await tester.tap(find.text('Business'));
        await tester.pumpAndSettle();
        expect(invitation, findsNothing);
        await tester.enterText(find.byType(TextField).at(0), 'business');
        expect(
          find.byWidgetPredicate(
            (widget) =>
                widget is TextField && widget.decoration?.labelText == 'Email',
          ),
          findsNothing,
        );
        await tester.enterText(find.byType(TextField).at(1), 'password123');
        await tester.enterText(find.byType(TextField).at(2), 'Business name');
        final submit = find.widgetWithText(FilledButton, 'Create account');
        await tester.ensureVisible(submit);
        await tester.tap(submit);
        await tester.pumpAndSettle();
        expect(registration?['accountType'], 'business');
        expect(registration?['businessName'], 'Business name');
        expect(registration, isNot(contains('referrerPromoterId')));
        expect(registration, isNot(contains('email')));
        await tester.pumpWidget(const SizedBox.shrink());
      }, () => client);
    },
  );

  testWidgets('signup accepts and submits a six-digit invitation ID', (
    tester,
  ) async {
    FlutterSecureStorage.setMockInitialValues({});
    await Api.instance.restore();
    addTearDown(() async {
      FlutterSecureStorage.setMockInitialValues({});
      await Api.instance.restore();
    });
    Map<String, dynamic>? registration;
    final client = MockClient((request) async {
      expect(request.url.path, '/api/auth/register');
      registration = jsonDecode(request.body) as Map<String, dynamic>;
      return http.Response(
        jsonEncode({
          'token': 'test-token',
          'username': 'viewer',
          'role': 'member',
        }),
        201,
      );
    });
    await http.runWithClient(() async {
      await tester.pumpWidget(const MaterialApp(home: AuthScreen()));
      await tester.tap(find.text('New here? Create an account'));
      await tester.pumpAndSettle();
      expect(find.text('Viewer'), findsNothing);
      expect(find.text('Promoter'), findsNothing);
      expect(find.text('Creator'), findsNothing);
      expect(find.text('Member'), findsOneWidget);
      expect(find.text('Business'), findsOneWidget);
      final invitation = find.byWidgetPredicate(
        (widget) =>
            widget is TextField &&
            widget.decoration?.labelText == 'Invitation ID (optional)',
      );
      await tester.enterText(invitation, 'a12b34567');
      expect(tester.widget<TextField>(invitation).controller?.text, '123456');
      expect(
        tester.widget<TextField>(invitation).keyboardType,
        TextInputType.number,
      );
      await tester.enterText(find.byType(TextField).at(0), 'viewer');
      await tester.enterText(find.byType(TextField).at(1), 'password123');
      final submit = find.widgetWithText(FilledButton, 'Create account');
      await tester.ensureVisible(submit);
      await tester.tap(submit);
      await tester.pumpAndSettle();
      expect(registration?['referrerPromoterId'], '123456');
      expect(registration, isNot(contains('email')));
      expect(registration, isNot(contains('accountType')));
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    }, () => client);
  });

  testWidgets('signup completes without email or an OTP step', (tester) async {
    var requests = 0;
    final client = MockClient((request) async {
      requests++;
      expect(request.url.path, '/api/auth/register');
      final body = jsonDecode(request.body) as Map<String, dynamic>;
      expect(body, isNot(contains('email')));
      return http.Response(
        jsonEncode({'token': 'test', 'username': 'viewer', 'role': 'member'}),
        201,
      );
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
      await tester.enterText(find.byType(TextField).at(0), 'viewer');
      await tester.enterText(find.byType(TextField).at(1), 'password123');
      final submit = find.widgetWithText(FilledButton, 'Create account');
      await tester.ensureVisible(submit);
      await tester.tap(submit);
      await tester.pumpAndSettle();
      expect(requests, 1);
      expect(find.text('Open signup'), findsOneWidget);
      expect(find.text('Verify your email'), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
    }, () => client);
  });

  testWidgets(
    'username/password login remains and email recovery links are removed',
    (tester) async {
      Map<String, dynamic>? sent;
      final client = MockClient((request) async {
        expect(request.url.path, '/api/auth/login');
        sent = jsonDecode(request.body) as Map<String, dynamic>;
        return http.Response(
          jsonEncode({'token': 'test', 'username': 'viewer', 'role': 'member'}),
          200,
        );
      });
      await http.runWithClient(() async {
        await tester.pumpWidget(const MaterialApp(home: AuthScreen()));
        expect(find.text('Forgot username?'), findsNothing);
        expect(find.text('Forgot password?'), findsNothing);
        await tester.enterText(find.byType(TextField).at(0), 'viewer');
        await tester.enterText(find.byType(TextField).at(1), 'password123');
        await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
        await tester.pumpAndSettle();
        expect(sent, {'username': 'viewer', 'password': 'password123'});
        await tester.pumpWidget(const SizedBox.shrink());
      }, () => client);
    },
  );
}
