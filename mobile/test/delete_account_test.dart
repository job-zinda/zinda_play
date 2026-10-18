import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:zinda_play/api.dart';
import 'package:zinda_play/screens/delete_account_screen.dart';
import 'package:zinda_play/screens/home_screen.dart';

void main() {
  testWidgets(
    'Profile keeps deletion available when cleanup is pending',
    (tester) async {
      tester.view.physicalSize = const Size(800, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });
      FlutterSecureStorage.setMockInitialValues({
        'token': 'test',
        'username': 'owner',
        'role': 'member',
      });
      await Api.instance.restore();
      addTearDown(() {
        Api.instance.token = null;
        Api.instance.username = null;
        Api.instance.role = null;
      });
      final client = MockClient((request) async {
        if (request.url.path == '/api/account') {
          return http.Response(
            jsonEncode({'error': 'Account deletion is incomplete. Retry.'}),
            409,
          );
        }
        return http.Response(
          jsonEncode(request.url.path == '/api/banner' ? null : []),
          200,
        );
      });
      await http.runWithClient(() async {
        await tester.pumpWidget(const MaterialApp(home: HomeScreen()));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Profile').last);
        await tester.pumpAndSettle();
        expect(find.text('Privacy Policy'), findsOneWidget);
        await tester.tap(find.text('Delete account'));
        await tester.pumpAndSettle();
        expect(find.byType(DeleteAccountScreen), findsOneWidget);
        expect(tester.takeException(), isNull);
      }, () => client);
    },
  );

  testWidgets(
    'deletion needs password and DELETE; errors retain session, retry clears it',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });
      FlutterSecureStorage.setMockInitialValues({
        'token': 'test-token',
        'username': 'owner',
        'role': 'creator',
      });
      await Api.instance.restore();
      addTearDown(() {
        Api.instance.token = null;
        Api.instance.username = null;
        Api.instance.role = null;
      });
      bool fail = true;
      int calls = 0;
      bool? deleted;
      final client = MockClient((request) async {
        calls++;
        expect(request.method, 'DELETE');
        expect(request.url.path, '/api/account');
        expect(request.headers['authorization'], 'Bearer test-token');
        expect(jsonDecode(request.body), {
          'password': 'current-password',
          'confirmation': 'DELETE',
        });
        return fail
            ? http.Response(
                jsonEncode({'error': 'Storage unavailable. Retry deletion.'}),
                503,
              )
            : http.Response('', 204);
      });
      await http.runWithClient(() async {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: Builder(
                builder: (context) => TextButton(
                  onPressed: () async {
                    deleted = await Navigator.push<bool>(
                      context,
                      MaterialPageRoute(
                        builder: (_) => const DeleteAccountScreen(),
                      ),
                    );
                  },
                  child: const Text('Open deletion'),
                ),
              ),
            ),
          ),
        );
        await tester.tap(find.text('Open deletion'));
        await tester.pumpAndSettle();
        final button = find.widgetWithText(
          FilledButton,
          'Permanently delete account',
        );
        expect(tester.widget<FilledButton>(button).onPressed, isNull);
        await tester.enterText(
          find.byType(TextField).at(0),
          'current-password',
        );
        await tester.enterText(find.byType(TextField).at(1), 'delete');
        await tester.pump();
        expect(tester.widget<FilledButton>(button).onPressed, isNull);
        await tester.enterText(find.byType(TextField).at(1), 'DELETE');
        await tester.pump();
        await tester.ensureVisible(button);
        await tester.pumpAndSettle();
        await tester.tap(button);
        await tester.pumpAndSettle();
        expect(calls, 1);
        expect(find.textContaining('Storage unavailable'), findsOneWidget);
        expect(Api.instance.signedIn, isTrue);
        expect(deleted, isNull);
        fail = false;
        await tester.ensureVisible(button);
        await tester.pumpAndSettle();
        await tester.tap(button);
        await tester.pumpAndSettle();
        expect(calls, 2);
        expect(deleted, isTrue);
        expect(Api.instance.signedIn, isFalse);
        expect(Api.instance.username, isNull);
        expect(await const FlutterSecureStorage().read(key: 'token'), isNull);
        expect(tester.takeException(), isNull);
      }, () => client);
    },
  );
}
