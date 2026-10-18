import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:zinda_play/screens/inbox_screen.dart';

void main() {
  testWidgets(
    'creator ad notice displays source and rate and can be marked read',
    (tester) async {
      final calls = <String>[];
      const id = '680000000000000000000001';
      final client = MockClient((request) async {
        calls.add('${request.method} ${request.url.path}');
        if (request.url.path.endsWith('/read')) return http.Response('', 204);
        final Object body = request.url.path.endsWith('/notifications')
            ? {
                'notifications': [
                  {
                    'id': id,
                    'type': 'creator_video_ad',
                    'title': 'Your video was selected for an ad',
                    'message': '"My Simply" is now linked to "Campaign". Earn INR 100 per 1000 qualifying full ad watches.',
                    'readAt': null,
                  },
                ],
              }
            : [];
        return http.Response(jsonEncode(body), 200);
      });
      await http.runWithClient(() async {
        await tester.pumpWidget(const MaterialApp(home: InboxScreen()));
        await tester.pumpAndSettle();
        expect(find.text('Your video was selected for an ad'), findsOneWidget);
        expect(find.textContaining('INR 100 per 1000'), findsOneWidget);
        expect(find.byIcon(Icons.circle), findsOneWidget);
        await tester.tap(find.text('Your video was selected for an ad'));
        await tester.pumpAndSettle();
        expect(calls, contains('POST /api/notifications/$id/read'));
        expect(find.byIcon(Icons.circle), findsNothing);
        expect(tester.takeException(), isNull);
      }, () => client);
    },
  );
}
