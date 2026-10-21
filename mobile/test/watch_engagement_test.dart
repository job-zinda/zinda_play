import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:zinda_play/api.dart';
import 'package:zinda_play/engagement.dart';
import 'package:zinda_play/public_links.dart';
import 'package:zinda_play/screens/auth_screen.dart';
import 'package:zinda_play/screens/watch_screen.dart';
import 'package:zinda_play/widgets/share_sheet.dart';
import 'package:zinda_play/widgets/video_engagement.dart';

const video = {'id': 'regular-video', 'title': 'A real video'};

Widget app({double scale = 1}) => MaterialApp(
  theme: ThemeData.dark(),
  builder: (context, child) => MediaQuery(
    data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(scale)),
    child: child!,
  ),
  home: const WatchScreen(video: video),
);

Finder action(String label) => find.descendant(
  of: find.byType(VideoEngagementBar),
  matching: find.text(label),
);

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    Api.instance.token = 'test-token';
    Api.instance.username = 'viewer';
    Api.instance.role = 'member';
  });
  tearDown(() {
    Api.instance.token = null;
    Api.instance.username = null;
    Api.instance.role = null;
    FlutterSecureStorage.setMockInitialValues({});
  });

  for (final width in [280.0, 320.0, 360.0]) {
    testWidgets('guest layout fits $width px with enlarged text', (
      tester,
    ) async {
      tester.view.physicalSize = Size(width, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      Api.instance.token = null;
      final client = MockClient(
        (request) async => http.Response(
          jsonEncode({
            'liked': false,
            'likeCount': 1234567,
            'commentCount': 0,
            'comments': [],
          }),
          200,
        ),
      );
      await http.runWithClient(() async {
        await tester.pumpWidget(app(scale: 1.4));
        await tester.pumpAndSettle();
        expect(find.text('Comments (0)'), findsOneWidget);
        expect(find.text('No comments yet'), findsOneWidget);
        expect(
          find.text('Be the first to share your thoughts!'),
          findsOneWidget,
        );
        expect(find.text('Sign In'), findsOneWidget);
        expect(find.byType(TextField), findsNothing);
        expect(tester.takeException(), isNull);
        final bar = tester.getRect(find.byType(VideoEngagementBar));
        expect(bar.left, greaterThanOrEqualTo(0));
        expect(bar.right, lessThanOrEqualTo(width));
        for (final label in ['Like', 'Comments', 'Share', 'Save']) {
          expect(action(label), findsOneWidget);
        }
        await tester.pumpWidget(const SizedBox.shrink());
      }, () => client);
    });
  }

  testWidgets('likes use server counts and ignore duplicate taps', (
    tester,
  ) async {
    final response = Completer<http.Response>();
    var posts = 0;
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/reaction')) {
        posts++;
        return response.future;
      }
      return http.Response(
        jsonEncode({
          'liked': false,
          'likeCount': 7,
          'commentCount': 0,
          'comments': [],
        }),
        200,
      );
    });
    await http.runWithClient(() async {
      await tester.pumpWidget(app());
      await tester.pumpAndSettle();
      expect(find.text('7'), findsOneWidget);
      await tester.ensureVisible(action('Like'));
      await tester.tap(action('Like'));
      await tester.tap(action('Like'));
      await tester.pump();
      await tester.tap(action('Like'));
      await tester.pump();
      expect(posts, 1);
      response.complete(
        http.Response('{"liked":true,"reaction":"like","likeCount":12}', 200),
      );
      await tester.pumpAndSettle();
      final bar = tester.widget<VideoEngagementBar>(
        find.byType(VideoEngagementBar),
      );
      expect(bar.liked, isTrue);
      expect(bar.likes, 12);
      await tester.pumpWidget(const SizedBox.shrink());
    }, () => client);
  });

  testWidgets(
    'video picker replaces and removes all six reactions with sound',
    (tester) async {
      final sounds = <MethodCall>[];
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        (call) async {
          if (call.method == 'SystemSound.play') sounds.add(call);
          return null;
        },
      );
      addTearDown(
        () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          SystemChannels.platform,
          null,
        ),
      );
      String? reaction;
      final writes = <String>[];
      final client = MockClient((request) async {
        if (request.url.path.endsWith('/reaction')) {
          final selected = jsonDecode(request.body)['reaction'] as String;
          writes.add(selected);
          reaction = selected == reaction ? null : selected;
        }
        return http.Response(
          jsonEncode({
            'liked': reaction != null,
            'reaction': reaction,
            'likeCount': reaction == null ? 7 : 8,
            'reactions': {if (reaction != null) reaction!: 1},
            'commentCount': 0,
            'comments': [],
          }),
          200,
        );
      });
      await http.runWithClient(() async {
        await tester.pumpWidget(app());
        await tester.pumpAndSettle();
        for (final choice in reactionChoices) {
          await tester.ensureVisible(find.byTooltip('Choose reaction'));
          await tester.tap(find.byTooltip('Choose reaction'));
          await tester.pumpAndSettle();
          await tester.tap(find.widgetWithText(OutlinedButton, choice.label));
          await tester.pumpAndSettle();
          final bar = tester.widget<VideoEngagementBar>(
            find.byType(VideoEngagementBar),
          );
          expect(bar.reaction, choice.type);
          expect(bar.likes, 8);
          expect(bar.reactions, {choice.type: 1});
        }
        expect(sounds, hasLength(6));
        await tester.tap(find.byTooltip('Choose reaction'));
        await tester.pumpAndSettle();
        await tester.tap(find.widgetWithText(OutlinedButton, 'Angry'));
        await tester.pumpAndSettle();
        final bar = tester.widget<VideoEngagementBar>(
          find.byType(VideoEngagementBar),
        );
        expect(bar.reaction, isNull);
        expect(bar.likes, 7);
        expect(sounds, hasLength(6));
        expect(writes, [
          ...reactionChoices.map((choice) => choice.type),
          'angry',
        ]);
        await tester.pumpWidget(const SizedBox.shrink());
      }, () => client);
    },
  );

  testWidgets('comments open composer, post text and refresh accurate counts', (
    tester,
  ) async {
    var posted = false;
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/comments')) {
        expect(request.method, 'POST');
        expect(jsonDecode(request.body), {'text': 'My thoughts'});
        posted = true;
        return http.Response('{}', 201);
      }
      return http.Response(
        jsonEncode({
          'liked': false,
          'likeCount': 3,
          'commentCount': posted ? 41 : 40,
          'comments': [
            {'username': 'creator', 'text': 'Welcome'},
            if (posted) {'username': 'viewer', 'text': 'My thoughts'},
          ],
        }),
        200,
      );
    });
    await http.runWithClient(() async {
      await tester.pumpWidget(app());
      await tester.pumpAndSettle();
      expect(find.text('Comments (40)'), findsOneWidget);
      await tester.ensureVisible(action('Comments'));
      await tester.tap(action('Comments'));
      await tester.pumpAndSettle();
      expect(
        tester.widget<TextField>(find.byType(TextField)).focusNode!.hasFocus,
        isTrue,
      );
      await tester.enterText(find.byType(TextField), '  My thoughts  ');
      await tester.ensureVisible(find.byTooltip('Post comment'));
      await tester.tap(find.byTooltip('Post comment'));
      await tester.pumpAndSettle();
      expect(posted, isTrue);
      expect(find.text('Comments (41)'), findsOneWidget);
      expect(find.text('My thoughts'), findsOneWidget);
      expect(find.text('No comments yet'), findsNothing);
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        '',
      );
      await tester.pumpWidget(const SizedBox.shrink());
    }, () => client);
  });

  testWidgets(
    'bookmarks persist across screen visits and stay account-specific',
    (tester) async {
      final client = MockClient((request) async {
        expect(request.url.path.contains('/saved'), isFalse);
        return http.Response(
          '{"liked":false,"likeCount":0,"commentCount":0,"comments":[]}',
          200,
        );
      });
      await http.runWithClient(() async {
        await tester.pumpWidget(app());
        await tester.pumpAndSettle();
        await tester.ensureVisible(action('Save'));
        await tester.tap(action('Save'));
        await tester.pumpAndSettle();
        expect(action('Saved'), findsOneWidget);
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pumpWidget(app());
        await tester.pumpAndSettle();
        expect(action('Saved'), findsOneWidget);
        await tester.pumpWidget(const SizedBox.shrink());
        Api.instance.username = 'another-viewer';
        await tester.pumpWidget(app());
        await tester.pumpAndSettle();
        expect(action('Save'), findsOneWidget);
        await tester.pumpWidget(const SizedBox.shrink());
        Api.instance.username = 'viewer';
        await tester.pumpWidget(app());
        await tester.pumpAndSettle();
        expect(action('Saved'), findsOneWidget);
        await tester.ensureVisible(action('Saved'));
        await tester.tap(action('Saved'));
        await tester.pumpAndSettle();
        expect(action('Save'), findsOneWidget);
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pumpWidget(app());
        await tester.pumpAndSettle();
        expect(action('Save'), findsOneWidget);
        await tester.pumpWidget(const SizedBox.shrink());
      }, () => client);
    },
  );

  testWidgets('share preserves the existing video share sheet', (tester) async {
    final client = MockClient(
      (request) async => http.Response(
        '{"liked":false,"likeCount":0,"commentCount":0,"comments":[]}',
        200,
      ),
    );
    await http.runWithClient(() async {
      await tester.pumpWidget(app());
      await tester.pumpAndSettle();
      await tester.ensureVisible(action('Share'));
      await tester.tap(action('Share'));
      await tester.pumpAndSettle();
      expect(find.byType(ShareSheet), findsOneWidget);
      expect(
        tester.widget<ShareSheet>(find.byType(ShareSheet)).url,
        videoShareUrl('regular-video'),
      );
      await tester.pumpWidget(const SizedBox.shrink());
    }, () => client);
  });

  testWidgets(
    'failed interactions show retry rather than a false empty state',
    (tester) async {
      var failed = true;
      final client = MockClient(
        (request) async => failed
            ? http.Response('{"error":"Offline"}', 503)
            : http.Response(
                '{"liked":true,"likeCount":9,"commentCount":0,"comments":[]}',
                200,
              ),
      );
      await http.runWithClient(() async {
        await tester.pumpWidget(app());
        await tester.pumpAndSettle();
        expect(find.textContaining('Offline'), findsOneWidget);
        expect(find.text('No comments yet'), findsNothing);
        expect(find.text('Comments (0)'), findsNothing);
        failed = false;
        await tester.ensureVisible(find.byTooltip('Refresh comments'));
        await tester.tap(find.byTooltip('Refresh comments'));
        await tester.pumpAndSettle();
        expect(find.text('Comments (0)'), findsOneWidget);
        expect(find.text('No comments yet'), findsOneWidget);
        expect(find.text('9'), findsOneWidget);
        await tester.pumpWidget(const SizedBox.shrink());
      }, () => client);
    },
  );

  testWidgets('guest sign-in returns to refreshed interactions and composer', (
    tester,
  ) async {
    Api.instance.token = null;
    final client = MockClient(
      (request) async => http.Response(
        jsonEncode({
          'liked': Api.instance.signedIn,
          'likeCount': Api.instance.signedIn ? 5 : 4,
          'commentCount': 0,
          'comments': [],
        }),
        200,
      ),
    );
    await http.runWithClient(() async {
      await tester.pumpWidget(app());
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Sign In'));
      await tester.tap(find.text('Sign In'));
      await tester.pumpAndSettle();
      expect(find.byType(AuthScreen), findsOneWidget);
      Api.instance.token = 'signed-in';
      Navigator.pop(tester.element(find.byType(AuthScreen)));
      await tester.pumpAndSettle();
      expect(find.byType(TextField), findsOneWidget);
      expect(find.text('Sign In'), findsNothing);
      expect(find.text('5'), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
    }, () => client);
  });

  testWidgets('failed mutations preserve like count and comment draft', (
    tester,
  ) async {
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/reaction') ||
          request.url.path.endsWith('/comments')) {
        return http.Response('{"error":"Please try again"}', 503);
      }
      return http.Response(
        '{"liked":false,"likeCount":8,"commentCount":0,"comments":[]}',
        200,
      );
    });
    await http.runWithClient(() async {
      await tester.pumpWidget(app());
      await tester.pumpAndSettle();
      await tester.ensureVisible(action('Like'));
      await tester.tap(action('Like'));
      await tester.pumpAndSettle();
      var bar = tester.widget<VideoEngagementBar>(
        find.byType(VideoEngagementBar),
      );
      expect(bar.liked, isFalse);
      expect(bar.likes, 8);
      expect(bar.liking, isFalse);
      expect(find.textContaining('Please try again'), findsOneWidget);
      await tester.ensureVisible(find.byType(TextField));
      await tester.enterText(find.byType(TextField), 'Keep this draft');
      await tester.ensureVisible(find.byTooltip('Post comment'));
      await tester.tap(find.byTooltip('Post comment'));
      await tester.pumpAndSettle();
      expect(find.text('Comments (0)'), findsOneWidget);
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        'Keep this draft',
      );
      expect(find.textContaining('Please try again'), findsOneWidget);
      bar = tester.widget<VideoEngagementBar>(find.byType(VideoEngagementBar));
      expect(bar.likes, 8);
      await tester.pumpWidget(const SizedBox.shrink());
    }, () => client);
  });

  testWidgets('late like response is safe after leaving the player', (
    tester,
  ) async {
    final response = Completer<http.Response>();
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/reaction')) return response.future;
      return http.Response(
        '{"liked":false,"likeCount":0,"commentCount":0,"comments":[]}',
        200,
      );
    });
    await http.runWithClient(() async {
      await tester.pumpWidget(app());
      await tester.pumpAndSettle();
      await tester.ensureVisible(action('Like'));
      await tester.tap(action('Like'));
      await tester.pump();
      await tester.pumpWidget(const SizedBox.shrink());
      response.complete(http.Response('{"liked":true,"likeCount":1}', 200));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    }, () => client);
  });
}
