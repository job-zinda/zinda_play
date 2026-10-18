import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:zinda_play/api.dart';
import 'package:zinda_play/screens/home_screen.dart';
import 'package:zinda_play/screens/creator_screen.dart';

void main() {
  setUpAll(() async {
    final root = Platform.environment['FLUTTER_ROOT']!;
    final font = File(
      [
        root,
        'bin',
        'cache',
        'artifacts',
        'material_fonts',
        'roboto-regular.ttf',
      ].join(Platform.pathSeparator),
    );
    final loader = FontLoader('Roboto')
      ..addFont(Future.value(ByteData.sublistView(await font.readAsBytes())));
    await loader.load();
  });
  for (final width in [320.0, 390.0, 430.0]) {
    for (final hasDescription in [false, true]) {
      testWidgets(
        'banner and popular creator navigation at $width, creators: $hasDescription',
        (tester) async {
          tester.view.physicalSize = Size(width, 1800);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          FlutterSecureStorage.setMockInitialValues({});
          await Api.instance.restore();
          final videos = [
            {
              'id': 'first',
              'title': 'First featured video',
              'description': hasDescription ? 'A short description.' : '',
              'featured': true,
              'views': 20,
            },
            {
              'id': 'second',
              'title': 'Another featured video with a much longer title',
              'description': hasDescription
                  ? 'A longer description that should wrap naturally.'
                  : '',
              'featured': true,
              'views': 10,
            },
          ];
          String? requestedProfile;
          final client = MockClient((request) async {
            if (request.url.path.startsWith('/api/creators/')) {
              requestedProfile = request.url.path;
              return http.Response(
                jsonEncode({
                  'followerCount': 42,
                  'following': false,
                  'videos': [],
                }),
                200,
              );
            }
            final Object body = switch (request.url.path) {
              '/api/banner' => {
                'enabled': true,
                'imageUrl': 'https://example.test/banner.png',
                'title': 'Featured promotion',
                'description': 'Watch and discover.',
                'buttonLabel': 'Watch Now',
                'buttonUrl': 'https://example.test/watch',
              },
              '/api/videos' => videos,
              '/api/discover/popular-creators' =>
                hasDescription
                    ? [
                        {
                          'id': 'creator-one',
                          'displayName': 'Creator One',
                          'followerCount': 42,
                        },
                        {
                          'id': 'creator-two',
                          'displayName': 'Creator Two',
                          'followerCount': 12,
                        },
                      ]
                    : [],
              _ => [],
            };
            return http.Response(jsonEncode(body), 200);
          });

          await http.runWithClient(() async {
            await tester.pumpWidget(const MaterialApp(home: HomeScreen()));
            await tester.pumpAndSettle();
            final promotion = tester.getRect(find.byType(Card).first);
            expect(promotion.height, closeTo((width - 28) / 3, 0.01));
            expect(find.text('FEATURED'), findsNothing);
            expect(find.text('Featured promotion'), findsNothing);
            expect(find.text('Watch Now'), findsNothing);
            expect(find.text('Play Now'), findsNothing);
            final heading = find
                .ancestor(
                  of: find.text('Trending now'),
                  matching: find.byType(Row),
                )
                .first;
            if (hasDescription) {
              expect(find.text('Popular creators'), findsOneWidget);
              final creatorsHeading = find
                  .ancestor(
                    of: find.text('Popular creators'),
                    matching: find.byType(Row),
                  )
                  .first;
              expect(
                tester.getTopLeft(creatorsHeading).dy - promotion.bottom,
                closeTo(12, 0.01),
              );
              expect(
                tester.getTopLeft(find.text('Creator One')).dy,
                lessThan(tester.getTopLeft(heading).dy),
              );
              for (final entry in [
                ('Creator One', 'creator-one'),
                ('Creator Two', 'creator-two'),
              ]) {
                await tester.tap(find.text(entry.$1));
                await tester.pumpAndSettle();
                expect(find.byType(CreatorScreen), findsOneWidget);
                expect(
                  tester
                      .widget<CreatorScreen>(find.byType(CreatorScreen))
                      .creator['id'],
                  entry.$2,
                );
                expect(requestedProfile, '/api/creators/${entry.$2}/profile');
                await tester.pageBack();
                await tester.pumpAndSettle();
              }
            } else {
              expect(find.text('Popular creators'), findsNothing);
              expect(
                tester.getTopLeft(heading).dy - promotion.bottom,
                closeTo(0, 0.01),
              );
            }
            expect(find.text('First featured video'), findsWidgets);
            expect(tester.takeException(), isNull);
            await tester.pumpWidget(const SizedBox.shrink());
          }, () => client);
        },
      );
    }
  }
}
