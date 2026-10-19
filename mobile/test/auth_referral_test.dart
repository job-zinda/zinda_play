import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:zinda_play/api.dart';
import 'package:zinda_play/screens/auth_screen.dart';

void main() {
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
      expect(registration, isNot(contains('accountType')));
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    }, () => client);
  });
}
