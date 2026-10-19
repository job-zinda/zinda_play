import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:zinda_play/api.dart';
import 'package:zinda_play/screens/account_screen.dart';

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

  for (final pending in [false, true]) {
    testWidgets(
      'creator application preserves ${pending ? 'pending' : 'draft'} state without email controls',
      (tester) async {
        var submitted = false;
        final client = MockClient((request) async {
          if (request.url.path == '/api/account/creator-application') {
            submitted = true;
          }
          final body = request.url.path == '/api/account/security'
              ? {'username': 'viewer'}
              : {
                  'role': 'member',
                  'approvalStatus': pending ? 'pending' : 'draft',
                  'profilePhotoUrl': '',
                  'introVideoUrl': '',
                };
          return http.Response(jsonEncode(body), 200);
        });
        await http.runWithClient(() async {
          await tester.pumpWidget(const MaterialApp(home: AccountScreen()));
          await tester.pumpAndSettle();
          if (pending) {
            expect(find.textContaining('awaiting approval'), findsOneWidget);
            expect(find.text('Submit for approval'), findsNothing);
          } else {
            expect(
              find.text('1. Add profile photo (required)'),
              findsOneWidget,
            );
            expect(
              find.textContaining('Introduction video (optional)'),
              findsOneWidget,
            );
            expect(find.textContaining('quicker approval'), findsOneWidget);
            expect(
              tester
                  .widget<FilledButton>(
                    find.widgetWithText(FilledButton, 'Submit for approval'),
                  )
                  .onPressed,
              isNull,
            );
          }
          expect(field('Recovery email'), findsNothing);
          expect(find.text('Send verification email'), findsNothing);
          expect(find.text('Forgot password or username?'), findsNothing);
          expect(Api.instance.role, 'member');
          expect(submitted, isFalse);
          await tester.pumpWidget(const SizedBox.shrink());
        }, () => client);
      },
    );
  }

  for (final role in ['member', 'creator', 'promoter', 'business']) {
    testWidgets('$role can still update username without email recovery', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(430, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      Api.instance.role = role;
      var username = 'viewer';
      Map<String, dynamic>? usernameBody;
      final client = MockClient((request) async {
        if (request.url.path == '/api/account/security') {
          return http.Response(jsonEncode({'username': username}), 200);
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
        expect(request.url.path, '/api/account/username');
        expect(request.method, 'PATCH');
        usernameBody = jsonDecode(request.body) as Map<String, dynamic>;
        username = usernameBody!['username'] as String;
        return http.Response(
          jsonEncode({'username': username, 'message': 'Username updated.'}),
          200,
        );
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
        expect(field('Recovery email'), findsNothing);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      }, () => client);
    });
  }
}
