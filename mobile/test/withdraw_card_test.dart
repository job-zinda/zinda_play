import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:zinda_play/api.dart';
import 'package:zinda_play/widgets/withdraw_card.dart';

Map<String, dynamic> _wallet({
  num available = 150,
  bool canWithdraw = true,
  bool pending = false,
}) => {
  'availableRupees': available,
  'withdrawnRupees': 0,
  'pendingWithdrawalRupees': pending ? 120 : 0,
  'adminCreditsRupees': 0,
  'minimumWithdrawalRupees': 100,
  'hasPendingWithdrawal': pending,
  'canWithdraw': canWithdraw,
  'withdrawals': [
    if (pending)
      {
        'id': 'w1',
        'amountRupees': 120,
        'payoutAppLabel': 'PhonePe',
        'payoutNumber': '9847561998',
        'status': 'pending',
        'createdAt': '2026-10-19T06:00:00.000Z',
      },
  ],
  'credits': [],
};

Widget _host(
  Map<String, dynamic> wallet, {
  Future<void> Function()? onChanged,
}) => MaterialApp(
  home: Scaffold(
    body: SingleChildScrollView(
      child: WithdrawCard(wallet: wallet, onChanged: onChanged ?? () async {}),
    ),
  ),
);

void main() {
  testWidgets('withdraw is disabled below the ₹100 minimum', (tester) async {
    await tester.pumpWidget(_host(_wallet(available: 60, canWithdraw: false)));
    expect(find.text('₹60.00'), findsOneWidget);
    expect(find.textContaining('Earn ₹40.00 more to withdraw'), findsOneWidget);
    final button = tester.widget<ButtonStyleButton>(
      find.byKey(const Key('withdraw-button')),
    );
    expect(button.onPressed, isNull);
  });

  testWidgets('pending requests show in the history', (tester) async {
    await tester.pumpWidget(
      _host(_wallet(available: 30, canWithdraw: false, pending: true)),
    );
    expect(
      find.text('Your withdrawal request is waiting for the admin.'),
      findsOneWidget,
    );
    expect(find.text('₹120.00 · PhonePe 9847561998'), findsOneWidget);
    expect(find.text('pending'), findsOneWidget);
  });

  testWidgets('creators request a custom amount to PhonePe', (tester) async {
    FlutterSecureStorage.setMockInitialValues({});
    await Api.instance.restore();
    Map<String, dynamic>? sent;
    var refreshed = false;
    final client = MockClient((request) async {
      if (request.url.path == '/api/creator/withdrawals') {
        sent = jsonDecode(request.body) as Map<String, dynamic>;
        return http.Response(
          jsonEncode({
            'id': 'w2',
            'amountRupees': 125.5,
            'payoutAppLabel': 'PhonePe',
            'payoutNumber': '9847561998',
            'status': 'pending',
          }),
          201,
        );
      }
      return http.Response('{}', 404);
    });
    await http.runWithClient(() async {
      await tester.pumpWidget(
        _host(_wallet(), onChanged: () async => refreshed = true),
      );
      await tester.tap(find.byKey(const Key('withdraw-button')));
      await tester.pumpAndSettle();
      expect(find.text('Withdraw money'), findsOneWidget);
      await tester.tap(find.text('Custom'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('withdraw-amount')),
        '125.50',
      );
      await tester.tap(find.text('PhonePe'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('withdraw-number')),
        '98475 61998',
      );
      await tester.tap(find.byKey(const Key('withdraw-submit')));
      await tester.pumpAndSettle();
      expect(sent, {
        'payoutApp': 'phonepe',
        'payoutNumber': '98475 61998',
        'amountRupees': '125.50',
      });
      expect(refreshed, isTrue);
      expect(find.text('Withdraw money'), findsNothing);
      expect(
        find.textContaining('Withdrawal of ₹125.50 requested'),
        findsOneWidget,
      );
    }, () => client);
  });
}
