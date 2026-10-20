import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:zinda_play/api.dart';
import 'package:zinda_play/engagement.dart';
import 'package:zinda_play/widgets/comment_threads.dart';
import 'package:zinda_play/widgets/reaction_button.dart';
import 'package:zinda_play/widgets/short_comments.dart';

void main() {
  setUp(() {
    Api.instance.token = 'viewer-token';
    Api.instance.role = 'member';
  });
  tearDown(() {
    Api.instance.token = null;
    Api.instance.role = null;
  });

  testWidgets('tap likes, long press and picker expose all six reactions', (
    tester,
  ) async {
    String? selected;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ReactionButton(count: 4, onReact: (type) => selected = type),
        ),
      ),
    );
    await tester.tap(find.text('Like'));
    expect(selected, 'like');
    await tester.longPress(find.text('Like'));
    await tester.pumpAndSettle();
    for (final choice in reactionChoices) {
      expect(find.widgetWithText(OutlinedButton, choice.label), findsOneWidget);
    }
    await tester.tap(find.widgetWithText(OutlinedButton, 'Love'));
    await tester.pumpAndSettle();
    expect(selected, 'love');
    await tester.tap(find.byTooltip('Choose reaction'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(OutlinedButton, 'Angry'));
    await tester.pumpAndSettle();
    expect(selected, 'angry');
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets(
    'comments load nested replies, react and preserve failed reply drafts',
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
      var added = 0;
      var fail = true;
      var writes = 0;
      var signIns = 0;
      final client = MockClient((request) async {
        if (request.url.path.endsWith('/root/reaction')) {
          expect(jsonDecode(request.body), {'reaction': 'love'});
          return http.Response(
            '{"reaction":"love","reactionCount":2,"reactions":{"love":2}}',
            200,
          );
        }
        if (request.method == 'GET') {
          expect(request.url.queryParameters['parentId'], 'root');
          return http.Response(
            jsonEncode({
              'comments': [
                {
                  'id': 'child',
                  'username': 'Child author',
                  'text': 'Child comment',
                  'replyCount': 0,
                },
              ],
              'nextCursor': null,
            }),
            200,
          );
        }
        final body = jsonDecode(request.body);
        expect(body, {'text': 'Nested reply', 'parentId': 'child'});
        writes++;
        if (fail) return http.Response('{"error":"Try this reply again"}', 503);
        return http.Response(
          jsonEncode({
            'id': 'nested',
            'username': 'viewer',
            'text': body['text'],
            'parentId': 'child',
            'replyCount': 0,
          }),
          201,
        );
      });
      await http.runWithClient(() async {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: SingleChildScrollView(
                child: CommentThreads(
                  videoId: 'video',
                  comments: const [
                    {
                      'id': 'root',
                      'username': 'Root author',
                      'text': 'Root comment',
                      'replyCount': 1,
                    },
                  ],
                  requireSignIn: () async {
                    signIns++;
                    return true;
                  },
                  onAdded: () => added++,
                ),
              ),
            ),
          ),
        );
        await tester.tap(find.text('Show replies (1)'));
        await tester.pumpAndSettle();
        expect(find.text('Child comment'), findsOneWidget);
        await tester.tap(find.byTooltip('Choose reaction').first);
        await tester.pumpAndSettle();
        await tester.tap(find.widgetWithText(OutlinedButton, 'Love'));
        await tester.pumpAndSettle();
        expect(sounds, hasLength(1));
        await tester.tap(find.text('Reply').last);
        await tester.pumpAndSettle();
        await tester.enterText(find.byType(TextField), 'Nested reply');
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.text('Send reply'));
        await tester.tap(find.text('Send reply'));
        await tester.pumpAndSettle();
        expect(find.text('Try this reply again'), findsOneWidget);
        expect(
          tester.widget<TextField>(find.byType(TextField)).controller!.text,
          'Nested reply',
        );
        expect(sounds, hasLength(1));
        fail = false;
        await tester.tap(find.text('Send reply'));
        await tester.pumpAndSettle();
        expect(find.byType(TextField), findsNothing);
        expect(find.text('Nested reply'), findsOneWidget);
        expect(added, 1);
        expect(writes, 2);
        expect(signIns, 4);
        expect(sounds, hasLength(2));
        await tester.pumpWidget(const SizedBox.shrink());
      }, () => client);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'guest comment reactions and replies require sign in without writes',
    (tester) async {
      Api.instance.token = null;
      var signIns = 0;
      var requests = 0;
      await http.runWithClient(
        () async {
          await tester.pumpWidget(
            MaterialApp(
              home: Scaffold(
                body: CommentThreads(
                  videoId: 'video',
                  comments: const [
                    {'id': 'root', 'text': 'Hello', 'username': 'Author'},
                  ],
                  requireSignIn: () async {
                    signIns++;
                    return false;
                  },
                  onAdded: () {},
                ),
              ),
            ),
          );
          await tester.tap(find.text('Reply'));
          await tester.pumpAndSettle();
          await tester.tap(find.byTooltip('0 likes'));
          await tester.pumpAndSettle();
          expect(find.byType(TextField), findsNothing);
          expect(signIns, 2);
          expect(requests, 0);
          await tester.pumpWidget(const SizedBox.shrink());
        },
        () => MockClient((_) async {
          requests++;
          return http.Response('{}', 200);
        }),
      );
    },
  );

  testWidgets(
    'root pagination preserves comment order and loads older comments',
    (tester) async {
      await http.runWithClient(
        () async {
          await tester.pumpWidget(
            MaterialApp(
              home: Scaffold(
                body: SingleChildScrollView(
                  child: CommentThreads(
                    videoId: 'video',
                    comments: const [
                      {'id': 'root', 'text': 'Latest', 'username': 'Author'},
                    ],
                    nextCursor: 'cursor',
                    requireSignIn: () async => true,
                    onAdded: () {},
                  ),
                ),
              ),
            ),
          );
          await tester.tap(find.text('Load more comments'));
          await tester.pumpAndSettle();
          expect(find.text('Older'), findsOneWidget);
          expect(find.text('Load more comments'), findsNothing);
          await tester.pumpWidget(const SizedBox.shrink());
        },
        () => MockClient((request) async {
          expect(request.url.queryParameters['before'], 'cursor');
          return http.Response(
            '{"comments":[{"id":"older","username":"Other","text":"Older"}],"nextCursor":null}',
            200,
          );
        }),
      );
    },
  );

  testWidgets('Simply comment sound plays only after a successful post', (
    tester,
  ) async {
    var sounds = 0;
    var fail = true;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async {
        if (call.method == 'SystemSound.play') sounds++;
        return null;
      },
    );
    addTearDown(
      () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        null,
      ),
    );
    await http.runWithClient(
      () async {
        await tester.pumpWidget(
          const MaterialApp(
            home: Scaffold(
              body: ShortComments(id: 'video', comments: [], commentCount: 0),
            ),
          ),
        );
        await tester.enterText(find.byType(TextField), 'My comment');
        await tester.tap(find.text('Send'));
        await tester.pumpAndSettle();
        expect(sounds, 0);
        fail = false;
        await tester.tap(find.text('Send'));
        await tester.pumpAndSettle();
        expect(sounds, 1);
        expect(find.text('My comment'), findsOneWidget);
        await tester.pumpWidget(const SizedBox.shrink());
      },
      () => MockClient(
        (_) async => fail
            ? http.Response('{"error":"Retry comment"}', 400)
            : http.Response(
                '{"id":"posted","username":"viewer","text":"My comment"}',
                201,
              ),
      ),
    );
  });
}
