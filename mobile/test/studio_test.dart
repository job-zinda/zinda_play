import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:zinda_play/screens/studio_screen.dart';

void main() {
  testWidgets(
    'creator deletion confirms, sends DELETE, refreshes, and preserves server errors',
    (tester) async {
      final calls = <String>[];
      bool deleted = false;
      bool failDelete = true;
      final client = MockClient((request) async {
        final path = request.url.path;
        calls.add('${request.method} $path');
        Object body;
        if (request.method == 'DELETE') {
          if (failDelete) {
            return http.Response(
              jsonEncode({'error': 'Deletion failed. Please retry.'}),
              503,
            );
          }
          deleted = true;
          return http.Response('', 204);
        }
        switch (path) {
          case '/api/account':
            body = {
              'username': 'creator',
              'displayName': 'Creator',
              'profilePhotoUrl': '',
              'introVideoUrl': '',
            };
          case '/api/creator/membership':
            body = {'status': 'trial', 'daysLeft': 7};
          case '/api/creator/referrals':
            body = {'referralCode': 'creator', 'total': 0};
          case '/api/creator/wallet':
            body = {'estimatedEarningsRupees': 12.50, 'totalViews': 500};
          case '/api/creator/videos':
            body = deleted
                ? []
                : [
                    {
                      'id': 'owned',
                      'title': 'My Simply',
                      'videoType': 'short',
                      'processingStatus': 'ready',
                      'published': true,
                      'views': 500,
                    },
                  ];
          default:
            return http.Response(
              jsonEncode({'error': 'Unexpected request: $path'}),
              404,
            );
        }
        return http.Response(jsonEncode(body), 200);
      });
      await http.runWithClient(() async {
        await tester.pumpWidget(const MaterialApp(home: StudioScreen()));
        await tester.pumpAndSettle();
        await tester.scrollUntilVisible(
          find.byTooltip('Delete My Simply'),
          300,
          scrollable: find.byType(Scrollable).first,
        );
        await tester.tap(find.byTooltip('Delete My Simply'));
        await tester.pumpAndSettle();
        expect(
          find.textContaining(
            'Earned wallet credit and ad history will be retained',
          ),
          findsOneWidget,
        );
        await tester.tap(find.text('Cancel'));
        await tester.pumpAndSettle();
        expect(calls.where((call) => call.startsWith('DELETE')), isEmpty);
        await tester.tap(find.byTooltip('Delete My Simply'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Delete'));
        await tester.pumpAndSettle();
        await tester.drag(find.byType(ListView).first, const Offset(0, 900));
        await tester.pumpAndSettle();
        expect(find.text('Deletion failed. Please retry.'), findsOneWidget);
        expect(deleted, isFalse);
        failDelete = false;
        await tester.scrollUntilVisible(
          find.byTooltip('Delete My Simply'),
          300,
          scrollable: find.byType(Scrollable).first,
        );
        await tester.drag(find.byType(ListView).first, const Offset(0, -150));
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Delete My Simply'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Delete'));
        await tester.pumpAndSettle();
        expect(deleted, isTrue);
        expect(calls, contains('DELETE /api/creator/videos/owned'));
        expect(find.byTooltip('Delete My Simply'), findsNothing);
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pump();
      }, () => client);
      expect(tester.takeException(), isNull);
    },
  );
}
