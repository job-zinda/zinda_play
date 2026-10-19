import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:visibility_detector/visibility_detector.dart';
import 'package:zinda_play/api.dart';
import 'package:zinda_play/widgets/member_watch_tracker.dart';

void main() {
  setUp(() async {
    VisibilityDetectorController.instance.updateInterval = Duration.zero;
    FlutterSecureStorage.setMockInitialValues({
      'token': 'member-token',
      'username': 'member',
      'role': 'member',
    });
    await Api.instance.restore();
  });

  tearDown(() async {
    VisibilityDetectorController.instance.updateInterval = const Duration(
      milliseconds: 500,
    );
    FlutterSecureStorage.setMockInitialValues({});
    await Api.instance.restore();
  });

  for (final role in ['member', 'creator', 'promoter']) {
    testWidgets('$role counts visible watch time and submits only once', (
      tester,
    ) async {
      Api.instance.role = role;
      Map<String, dynamic>? completed;
      var completions = 0;
      final errors = <String>[];
      final client = MockClient((request) async {
        if (request.url.path.endsWith('/watch-start')) {
          return http.Response(
            jsonEncode({'watchId': 'watch', 'requiredWatchSeconds': 2}),
            201,
          );
        }
        expect(request.url.path, '/api/videos/video-id/watch-complete');
        completions++;
        completed = jsonDecode(request.body) as Map<String, dynamic>;
        return http.Response(jsonEncode({'counted': true}), 200);
      });
      await http.runWithClient(() async {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: MemberWatchTracker(
                videoId: 'video-id',
                onError: errors.add,
                child: const SizedBox(width: 200, height: 200),
              ),
            ),
          ),
        );
        await tester.pump();
        await tester.pump(const Duration(seconds: 1));
        expect(completions, 0);
        tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
        await tester.pump(const Duration(seconds: 5));
        expect(completions, 0);
        tester.binding.handleAppLifecycleStateChanged(
          AppLifecycleState.resumed,
        );
        await tester.pump(const Duration(seconds: 1));
        await tester.pump();
        expect(completed, {'watchId': 'watch', 'activeSeconds': 2});
        await tester.pump(const Duration(seconds: 5));
        expect(completions, 1);
        expect(errors, isEmpty);
        await tester.pumpWidget(const SizedBox.shrink());
      }, () => client);
    });
  }

  testWidgets('covered routes do not earn watch time', (tester) async {
    final navigator = GlobalKey<NavigatorState>();
    var completed = false;
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/watch-start')) {
        return http.Response(
          jsonEncode({'watchId': 'watch', 'requiredWatchSeconds': 2}),
          201,
        );
      }
      completed = true;
      return http.Response('{}', 200);
    });
    await http.runWithClient(() async {
      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: navigator,
          home: Scaffold(
            body: MemberWatchTracker(
              videoId: 'video-id',
              onError: (error) => fail(error),
              child: const SizedBox(width: 200, height: 200),
            ),
          ),
        ),
      );
      await tester.pump();
      navigator.currentState!.push(
        MaterialPageRoute<void>(
          builder: (_) => const Scaffold(body: Text('Other page')),
        ),
      );
      await tester.pumpAndSettle();
      await tester.pump(const Duration(seconds: 5));
      expect(completed, false);
      await tester.pumpWidget(const SizedBox.shrink());
    }, () => client);
  });

  for (final role in ['business', 'admin', null]) {
    testWidgets('$role does not start member rewards', (tester) async {
      Api.instance.role = role;
      var requests = 0;
      final client = MockClient((request) async {
        requests++;
        return http.Response('{}', 500);
      });
      await http.runWithClient(() async {
        await tester.pumpWidget(
          MaterialApp(
            home: MemberWatchTracker(
              videoId: 'video-id',
              onError: (error) => fail(error),
              child: const SizedBox(width: 200, height: 200),
            ),
          ),
        );
        await tester.pump(const Duration(seconds: 5));
        expect(requests, 0);
        await tester.pumpWidget(const SizedBox.shrink());
      }, () => client);
    });
  }

  testWidgets(
    'failed watch sessions surface an error instead of reporting earnings',
    (tester) async {
      final errors = <String>[];
      final client = MockClient(
        (request) async => http.Response(
          jsonEncode({'error': 'Watch service unavailable'}),
          500,
        ),
      );
      await http.runWithClient(() async {
        await tester.pumpWidget(
          MaterialApp(
            home: MemberWatchTracker(
              videoId: 'video-id',
              onError: errors.add,
              child: const SizedBox(width: 200, height: 200),
            ),
          ),
        );
        await tester.pump();
        expect(errors.single, contains('Watch service unavailable'));
        await tester.pumpWidget(const SizedBox.shrink());
      }, () => client);
    },
  );
}
