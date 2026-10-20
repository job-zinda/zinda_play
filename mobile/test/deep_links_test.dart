import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:zinda_play/api.dart';
import 'package:zinda_play/deep_links.dart';
import 'package:zinda_play/screens/auth_screen.dart';
import 'package:zinda_play/screens/creator_screen.dart';

void main() {
  test('share links map to videos and creator profiles', () {
    expect(
      parseDeepLink(Uri.parse('https://zindaplay.com/share/video/abc-123')),
      const DeepLink(DeepLinkKind.video, 'abc-123'),
    );
    expect(
      parseDeepLink(
        Uri.parse(
          'https://zindaplay.com/share/video/abc-123?preview=video-frame-v2',
        ),
      ),
      const DeepLink(DeepLinkKind.video, 'abc-123'),
    );
    expect(
      parseDeepLink(Uri.parse('https://www.zindaplay.com/share/creator/6ad2')),
      const DeepLink(DeepLinkKind.creator, '6ad2'),
    );
    expect(
      parseDeepLink(Uri.parse('https://zindaplay.com/?short=s1')),
      const DeepLink(DeepLinkKind.video, 's1'),
    );
    expect(
      parseDeepLink(Uri.parse('https://zindaplay.com/?creator=c1')),
      const DeepLink(DeepLinkKind.creator, 'c1'),
    );
    expect(
      parseDeepLink(Uri.parse('https://zindaplay.com/?ref=123456')),
      const DeepLink(DeepLinkKind.referral, '123456'),
    );
    expect(
      parseDeepLink(Uri.parse('https://zindaplay.com/join/123456')),
      const DeepLink(DeepLinkKind.referral, '123456'),
    );
    expect(
      parseDeepLink(
        Uri.parse(
          'zindaplay://zindaplay.com/share/video/abc?preview=video-frame-v2',
        ),
      ),
      const DeepLink(DeepLinkKind.video, 'abc'),
    );
    expect(
      parseDeepLink(Uri.parse('zindaplay://zindaplay.com/join/123456')),
      const DeepLink(DeepLinkKind.referral, '123456'),
    );
    for (final bad in [
      'https://zindaplay.com/join/012345',
      'https://zindaplay.com/join/12345',
      'https://zindaplay.com/?ref=abc',
      'http://zindaplay.com/share/video/x',
      'zindaplay://example.com/share/video/x',
    ]) {
      expect(parseDeepLink(Uri.parse(bad)), isNull, reason: bad);
    }
    expect(
      parseDeepLink(Uri.parse('https://example.com/share/video/x')),
      isNull,
    );
  });

  testWidgets('an incoming creator link opens that creator profile', (
    tester,
  ) async {
    FlutterSecureStorage.setMockInitialValues({});
    await Api.instance.restore();
    final requested = <String>[];
    final client = MockClient((request) async {
      requested.add(request.url.path);
      if (request.url.path == '/api/creators/c1/profile') {
        return http.Response(
          jsonEncode({
            'id': 'c1',
            'displayName': 'Raizan',
            'username': 'Zindabuddy',
            'followerCount': 2,
            'videos': [],
          }),
          200,
        );
      }
      return http.Response('{}', 404);
    });
    final links = StreamController<Uri>();
    await http.runWithClient(() async {
      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: appNavigatorKey,
          home: DeepLinkListener(
            links: links.stream,
            child: const Text('home'),
          ),
        ),
      );
      links.add(Uri.parse('https://zindaplay.com/share/creator/c1'));
      await tester.pumpAndSettle();
    }, () => client);
    expect(requested, contains('/api/creators/c1/profile'));
    expect(find.byType(CreatorScreen), findsOneWidget);
    expect(find.text('Raizan'), findsWidgets);
    await links.close();
  });

  testWidgets(
    'an invitation link opens member sign-up with the code filled in',
    (tester) async {
      FlutterSecureStorage.setMockInitialValues({});
      await Api.instance.restore();
      final links = StreamController<Uri>();
      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: appNavigatorKey,
          home: Scaffold(
            body: DeepLinkListener(
              links: links.stream,
              child: const Text('home'),
            ),
          ),
        ),
      );
      links.add(Uri.parse('zindaplay://zindaplay.com/join/123456'));
      await tester.pumpAndSettle();
      expect(find.byType(AuthScreen), findsOneWidget);
      expect(find.text('Create account'), findsWidgets);
      expect(
        tester
            .widget<TextField>(
              find.widgetWithText(TextField, 'Invitation ID (optional)'),
            )
            .controller!
            .text,
        '123456',
      );
      await links.close();
    },
  );
}
