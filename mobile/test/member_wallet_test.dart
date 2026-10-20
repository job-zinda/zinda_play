import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:zinda_play/api.dart';
import 'package:zinda_play/screens/home_screen.dart';
import 'package:zinda_play/screens/promoter_screen.dart';

void main() {
  tearDown(() async {
    FlutterSecureStorage.setMockInitialValues({});
    await Api.instance.restore();
  });

  for (final role in ['member', 'creator', 'promoter', 'business']) {
    testWidgets('$role gets the correct Earn destination', (tester) async {
      FlutterSecureStorage.setMockInitialValues({
        'token': 'test',
        'role': role,
        'username': 'existing-account',
      });
      await Api.instance.restore();
      final requests = <String>[];
      final client = MockClient((request) async {
        requests.add(request.url.path);
        final Object data = switch (request.url.path) {
          '/api/account' => {'role': role, 'promoterAccount': true},
          '/api/promoter/wallet' => {
            'referralCode': '123456',
            'availableRupees': 150,
            'earnedRupees': 200,
            'paidRupees': 50,
            'pendingRupees': 0,
            'referredViews': 1000,
            'referralViewsUntilReward': 1000,
            'distinctVideosWatched': 100,
            'videosUntilWatchReward': 100,
            'rewardSettings': {
              'memberWatch': {'enabled': true, 'rateRupees': 30},
              'referralViews': {'enabled': false, 'rateRupees': 20},
            },
            'withdrawals': [
              {
                'amountRupees': 50,
                'payoutHandle': 'existing@upi',
                'createdAt': '2026-10-01T00:00:00Z',
                'status': 'paid',
              },
            ],
          },
          _ => [],
        };
        return http.Response(jsonEncode(data), 200);
      });
      await http.runWithClient(() async {
        await tester.pumpWidget(const MaterialApp(home: HomeScreen()));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Earn'));
        await tester.pumpAndSettle();
        if (role == 'business') {
          expect(find.byType(PromoterScreen), findsNothing);
          expect(requests, isNot(contains('/api/promoter/wallet')));
          expect(
            find.textContaining('not available to business'),
            findsOneWidget,
          );
        } else {
          expect(find.text('Wallet & referrals'), findsOneWidget);
          expect(find.text('123456'), findsOneWidget);
          expect(find.text('₹150.00'), findsOneWidget);
          expect(
            find.textContaining('Personal watches: ₹30.00 per 1,000'),
            findsOneWidget,
          );
          expect(find.text('Referral rewards: paused.'), findsOneWidget);
          expect(find.textContaining('more to the next reward'), findsNothing);
          expect(requests, contains('/api/promoter/wallet'));
          expect(
            tester
                .widget<FilledButton>(
                  find.widgetWithText(FilledButton, 'Withdraw (min ₹100)'),
                )
                .onPressed,
            isNotNull,
          );
          expect(
            find.text('Creator earnings'),
            role == 'creator' ? findsOneWidget : findsNothing,
          );
        }
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      }, () => client);
    });
  }

  testWidgets('member rewards fit a small Android screen with live rates', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 640));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final client = MockClient(
      (request) async => http.Response(
        jsonEncode({
          'referralCode': '123456',
          'availableRupees': 10.08,
          'earnedRupees': 10.08,
          'paidRupees': 0,
          'pendingRupees': 0,
          'referredViews': 4,
          'distinctVideosWatched': 3,
          'withdrawals': [],
          'rewardSettings': {
            'memberWatch': {'enabled': false, 'rateRupees': 90},
            'referralViews': {'enabled': true, 'rateRupees': 40},
          },
        }),
        200,
      ),
    );
    await http.runWithClient(() async {
      await tester.pumpWidget(const MaterialApp(home: PromoterScreen()));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.text('Personal-watch rewards: paused.'),
        180,
        scrollable: find.byType(Scrollable).first,
      );
      expect(
        find.textContaining('Referral views: ₹40.00 per 1,000'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    }, () => client);
  });
}
