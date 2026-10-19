import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:zinda_play/api.dart';
import 'package:zinda_play/screens/creator_screen.dart';
import 'package:zinda_play/screens/creator_search_screen.dart';
import 'package:zinda_play/widgets/homepage_promotion_banner.dart';
import 'package:zinda_play/widgets/share_sheet.dart';

Map<String, dynamic> _banner(String id) => {
  'id': id,
  'enabled': true,
  'title': 'Banner $id',
  'imageUrl': 'https://example.test/$id.png',
};

void main() {
  testWidgets('video share sheet shows the creator photo, name and title', (
    tester,
  ) async {
    String? copied;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async {
        if (call.method == 'Clipboard.setData') {
          copied = (call.arguments as Map)['text'] as String;
        }
        return null;
      },
    );
    addTearDown(
      () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        null,
      ),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => TextButton(
              onPressed: () => showVideoShareSheet(context, {
                'id': 'video-1',
                'title': 'Morning ride',
                'creatorProfile': {
                  'id': 'creator-1',
                  'username': 'rider',
                  'displayName': 'Rider Ravi',
                  'profilePhotoUrl': 'https://example.test/ravi.png',
                },
              }),
              child: const Text('Open share'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Open share'));
    await tester.pumpAndSettle();
    expect(find.text('Share video'), findsOneWidget);
    expect(find.text('Rider Ravi'), findsOneWidget);
    expect(find.text('@rider'), findsOneWidget);
    expect(find.text('Morning ride'), findsOneWidget);
    final avatar = tester.widget<CircleAvatar>(
      find.byKey(const ValueKey('share-creator-avatar')),
    );
    expect(
      (avatar.backgroundImage as NetworkImage).url,
      'https://example.test/ravi.png',
    );
    expect(find.text('WhatsApp'), findsOneWidget);
    await tester.tap(find.text('Copy link'));
    await tester.pumpAndSettle();
    expect(
      copied,
      'https://zindaplay.com/share/video/video-1?preview=video-frame-v2',
    );
    expect(find.text('Link copied.'), findsOneWidget);
  });

  testWidgets('creator profile share uses the public profile link', (
    tester,
  ) async {
    String? copied;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async {
        if (call.method == 'Clipboard.setData') {
          copied = (call.arguments as Map)['text'] as String;
        }
        return null;
      },
    );
    addTearDown(
      () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        null,
      ),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => TextButton(
              onPressed: () => showCreatorShareSheet(context, {
                'id': 'creator-1',
                'username': 'rider',
                'displayName': 'Rider Ravi',
              }),
              child: const Text('Open share'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Open share'));
    await tester.pumpAndSettle();
    expect(find.text('Share profile'), findsOneWidget);
    expect(find.text('Rider Ravi on Zinda Play'), findsOneWidget);
    await tester.tap(find.text('Copy link'));
    await tester.pumpAndSettle();
    expect(copied, 'https://zindaplay.com/share/creator/creator-1');
  });

  testWidgets('home banners rotate automatically with indicators', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: HomepagePromotionCarousel(
            banners: [
              _banner('one'),
              {..._banner('hidden'), 'enabled': false},
              _banner('two'),
            ],
          ),
        ),
      ),
    );
    expect(find.byType(PageView), findsOneWidget);
    expect(find.byType(AnimatedContainer), findsNWidgets(2));
    final controller = tester
        .widget<PageView>(find.byType(PageView))
        .controller!;
    expect(controller.page, 0);
    await tester.pump(const Duration(seconds: 5));
    await tester.pumpAndSettle();
    expect(controller.page, 1);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('single banner renders without carousel controls', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: HomepagePromotionCarousel(banners: [_banner('one')]),
        ),
      ),
    );
    expect(find.byType(PageView), findsNothing);
    expect(find.byType(HomepagePromotionBanner), findsOneWidget);
  });

  testWidgets('creator search queries the API and opens the creator', (
    tester,
  ) async {
    FlutterSecureStorage.setMockInitialValues({});
    await Api.instance.restore();
    final searches = <String>[];
    final client = MockClient((request) async {
      if (request.url.path == '/api/discover/creators') {
        searches.add(request.url.queryParameters['search'] ?? '');
        return http.Response(
          jsonEncode([
            {
              'id': 'creator-1',
              'username': 'rider',
              'displayName': 'Rider Ravi',
              'followerCount': 7,
            },
          ]),
          200,
        );
      }
      return http.Response(
        jsonEncode({'followerCount': 7, 'following': false, 'videos': []}),
        200,
      );
    });
    await http.runWithClient(() async {
      await tester.pumpWidget(const MaterialApp(home: CreatorSearchScreen()));
      await tester.enterText(find.byType(TextField), 'r');
      await tester.pump(const Duration(milliseconds: 400));
      expect(searches, isEmpty);
      await tester.enterText(find.byType(TextField), 'ravi');
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pumpAndSettle();
      expect(searches, ['ravi']);
      expect(find.text('Rider Ravi'), findsOneWidget);
      expect(find.text('@rider · 7 followers'), findsOneWidget);
      await tester.tap(find.text('Rider Ravi'));
      await tester.pumpAndSettle();
      expect(find.byType(CreatorScreen), findsOneWidget);
      expect(find.byTooltip('Share profile'), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
    }, () => client);
  });
}
