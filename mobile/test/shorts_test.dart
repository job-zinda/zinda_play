import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:video_player_platform_interface/video_player_platform_interface.dart';
import 'package:zinda_play/api.dart';
import 'package:zinda_play/navigation.dart';
import 'package:zinda_play/screens/auth_screen.dart';
import 'package:zinda_play/screens/shorts_screen.dart';
import 'package:zinda_play/shorts.dart';

class _Feed extends ShortsApi {
  final List<Map<String, dynamic>> items;
  int calls = 0;
  bool fail = false;
  _Feed(this.items);
  @override
  Future<ShortsPage> page({String? cursor, bool saved = false}) async {
    calls++;
    if (fail) throw ApiException('Test connection failed');
    return ShortsPage(items, null);
  }
}

class _PagedFeed extends ShortsApi {
  final List<Map<String, dynamic>> items;
  final cursors = <String?>[];
  _PagedFeed(this.items);
  @override
  Future<ShortsPage> page({String? cursor, bool saved = false}) async {
    cursors.add(cursor);
    return cursor == null
        ? ShortsPage(items.take(2).toList(), 'next-page')
        : ShortsPage(items.skip(1).take(2).toList(), null);
  }
}

class _Players extends VideoPlayerPlatform {
  final events = <String>[];
  final players = <int, StreamController<VideoEvent>>{};
  final playing = <int>{};
  final volumes = <int, double>{};
  int created = 0;
  int maxPlayers = 0;
  @override
  Future<void> init() async {}
  @override
  Future<int?> createWithOptions(VideoCreationOptions options) async {
    final id = ++created;
    this.events.add('create:$id');
    late StreamController<VideoEvent> events;
    events = StreamController<VideoEvent>(
      onCancel: () {
        this.events.add('cancel:$id');
      },
      onListen: () {
        events.add(
          VideoEvent(
            eventType: VideoEventType.initialized,
            duration: const Duration(seconds: 30),
            size: const Size(1080, 1920),
          ),
        );
      },
    );
    players[id] = events;
    if (players.length > maxPlayers) maxPlayers = players.length;
    return id;
  }

  @override
  Stream<VideoEvent> videoEventsFor(int playerId) => players[playerId]!.stream;
  @override
  Future<void> dispose(int playerId) async {
    events.add('dispose:$playerId');
    playing.remove(playerId);
    await players.remove(playerId)?.close();
  }

  @override
  Future<void> play(int playerId) async {
    events.add('play:$playerId');
    playing.add(playerId);
  }

  @override
  Future<void> pause(int playerId) async {
    events.add('pause:$playerId');
    playing.remove(playerId);
  }

  @override
  Future<void> setVolume(int playerId, double volume) async {
    volumes[playerId] = volume;
  }

  @override
  Future<void> setLooping(int playerId, bool looping) async {}
  @override
  Future<void> setPlaybackSpeed(int playerId, double speed) async {}
  @override
  Future<void> seekTo(int playerId, Duration position) async {}
  @override
  Future<Duration> getPosition(int playerId) async => Duration.zero;
  @override
  Widget buildViewWithOptions(VideoViewOptions options) =>
      const ColoredBox(color: Colors.black);
}

class _Headers extends Fake implements HttpHeaders {
  @override
  void set(String name, Object value, {bool preserveHeaderCase = false}) {}
  @override
  void forEach(void Function(String, List<String>) action) {}
}

class _Response extends Stream<List<int>> implements HttpClientResponse {
  final List<int> bytes;
  _Response(Object data, {this.statusCode = 200})
    : bytes = utf8.encode(jsonEncode(data));
  @override
  final int statusCode;
  @override
  int get contentLength => bytes.length;
  @override
  bool get isRedirect => false;
  @override
  List<RedirectInfo> get redirects => [];
  @override
  bool get persistentConnection => false;
  @override
  String get reasonPhrase => 'OK';
  @override
  HttpHeaders get headers => _Headers();
  @override
  StreamSubscription<List<int>> listen(
    void Function(List<int>)? onData, {
    Function? onError,
    void Function()? onDone,
    bool? cancelOnError,
  }) => Stream.value(bytes).listen(
    onData,
    onError: onError,
    onDone: onDone,
    cancelOnError: cancelOnError,
  );
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _Request extends Fake implements HttpClientRequest {
  @override
  final Uri uri;
  @override
  final String method;
  final _Network network;
  final bytes = <int>[];
  _Request(this.uri, this.method, this.network);
  @override
  HttpHeaders get headers => _Headers();
  @override
  set followRedirects(bool value) {}
  @override
  set maxRedirects(int value) {}
  @override
  set persistentConnection(bool value) {}
  @override
  set contentLength(int value) {}
  @override
  void add(List<int> data) {
    bytes.addAll(data);
  }

  @override
  Future<void> addStream(Stream<List<int>> stream) async {
    await for (final chunk in stream) {
      bytes.addAll(chunk);
    }
  }

  @override
  Future<HttpClientResponse> close() async {
    network.calls.add('$method ${uri.path}');
    if (uri.path == '/api/ads') return _Response([]);
    if (uri.path.endsWith('/like')) {
      network.liked = !network.liked;
      return _Response({
        'liked': network.liked,
        'likeCount': network.liked ? 1 : 0,
      });
    }
    if (uri.path.endsWith('/follow')) {
      if (method != 'GET') network.following = method == 'POST';
      return _Response({'following': network.following, 'isSelf': false});
    }
    if (uri.path.endsWith('/saved')) {
      network.saved = method == 'PUT';
      return _Response({'saved': network.saved});
    }
    if (uri.path.endsWith('/state')) return _Response({'saved': network.saved});
    if (uri.path.endsWith('/comments')) {
      if (network.commentError != null) {
        return _Response({'error': network.commentError}, statusCode: 400);
      }
      final data = jsonDecode(utf8.decode(bytes)) as Map;
      network.comments.add({
        'username': 'tester',
        'text': data['text'],
        'id': 'new-comment',
      });
      return _Response(network.comments.last);
    }
    if (uri.path.endsWith('/view-start')) {
      return _Response({'ticket': 'test-ticket', 'minimumWatchMs': 3000});
    }
    if (uri.path.endsWith('/interactions')) {
      return _Response({
        'liked': network.liked,
        'likeCount': network.liked ? 1 : 0,
        'comments': network.comments,
        'commentCount': network.comments.length + 101,
      });
    }
    return _Response({'saved': false});
  }
}

class _Client extends Fake implements HttpClient {
  final _Network network;
  _Client(this.network);
  @override
  set autoUncompress(bool value) {}
  @override
  Future<HttpClientRequest> openUrl(String method, Uri url) async =>
      _Request(url, method, network);
  @override
  void close({bool force = false}) {}
}

class _Network extends HttpOverrides {
  final calls = <String>[];
  final comments = <Map<String, dynamic>>[];
  bool liked = false;
  bool saved = false;
  bool following = false;
  String? commentError;
  @override
  HttpClient createHttpClient(SecurityContext? context) => _Client(this);
}

void main() {
  test('Shorts duration, portrait and hashtags validation', () {
    expect(validateShortVideo(const Duration(seconds: 60), 1080, 1920), isNull);
    expect(
      validateShortVideo(const Duration(milliseconds: 60001), 1080, 1920),
      isNotNull,
    );
    expect(validateShortVideo(Duration.zero, 1080, 1920), isNotNull);
    expect(
      validateShortVideo(const Duration(seconds: 10), 1920, 1080),
      isNotNull,
    );
    expect(
      validateShortVideo(const Duration(seconds: 10), 1000, 1000),
      isNotNull,
    );
    expect(shortHashtags('#zinda #learn, #zinda'), ['zinda', 'learn']);
  });

  late _Players players;
  late _Network network;
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    players = _Players();
    VideoPlayerPlatform.instance = players;
    network = _Network();
    HttpOverrides.global = network;
    Api.instance.token = null;
    Api.instance.role = null;
  });
  tearDown(() => HttpOverrides.global = null);

  Future<void> mount(
    WidgetTester tester,
    ShortsApi feed, {
    bool reducedMotion = false,
  }) async {
    await tester.pumpWidget(
      MaterialApp(
        navigatorObservers: [appRouteObserver],
        home: MediaQuery(
          data: MediaQueryData.fromView(tester.view)
              .copyWith(disableAnimations: reducedMotion),
          child: Scaffold(body: ShortsScreen(service: feed)),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pumpAndSettle();
  }

  final items = List.generate(
    5,
    (i) => <String, dynamic>{
      'id': 'short-$i',
      'streamUrl': 'https://test.b-cdn.net/$i/playlist.m3u8',
      'caption': 'Caption $i',
      'hashtags': ['zinda'],
      'views': 0,
      'creatorProfile': {'id': 'creator', 'username': 'creator'},
    },
  );

  testWidgets(
    'active video autoplays muted, swipe changes playback and lifecycle pauses it',
    (tester) async {
      await mount(tester, _Feed(items));
      expect(find.text('Simply'), findsOneWidget);
      expect(find.text('Zinda Shorts'), findsNothing);
      expect(players.created, 1);
      expect(players.playing, hasLength(1));
      expect(players.volumes.values, everyElement(0));
      await tester.tap(find.byTooltip('Unmute'));
      await tester.pump();
      expect(players.volumes[players.playing.single], 1);
      await tester.tap(find.byTooltip('Pause'));
      await tester.pump();
      expect(players.playing, isEmpty);
      await tester.tap(find.byTooltip('Play'));
      await tester.pump();
      expect(players.playing, hasLength(1));
      await tester.drag(find.byType(PageView), const Offset(0, -650));
      await tester.pumpAndSettle();
      await tester.pump();
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 10)),
      );
      expect(find.text('Caption 1'), findsOneWidget);
      expect(players.playing, hasLength(1), reason: players.events.toString());
      expect(players.players, hasLength(1), reason: players.events.toString());
      final navigator = Navigator.of(tester.element(find.byType(ShortsScreen)));
      unawaited(
        navigator.push(
          MaterialPageRoute<void>(
            builder: (_) => const Scaffold(body: Text('Other page')),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(players.playing, isEmpty);
      navigator.pop();
      await tester.pumpAndSettle();
      expect(players.playing, hasLength(1));
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await tester.pump();
      expect(players.playing, isEmpty);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));
      expect(players.playing, hasLength(1));
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
      await tester.runAsync(() => Future<void>.delayed(Duration.zero));
      expect(players.playing, isEmpty);
    },
  );

  testWidgets(
    'preload opt-in initializes only active plus next and releases others',
    (tester) async {
      await mount(tester, _Feed(items));
      await tester.tap(find.byTooltip('Data saver on: no next-video preload'));
      await tester.pumpAndSettle();
      expect(players.players.length, lessThanOrEqualTo(2));
      expect(players.created, 2);
      expect(players.playing, hasLength(1));
      await tester.drag(find.byType(PageView), const Offset(0, -650));
      await tester.pumpAndSettle();
      await tester.pump();
      await tester.runAsync(() => Future<void>.delayed(Duration.zero));
      expect(players.players.length, lessThanOrEqualTo(2));
      expect(players.playing, hasLength(1));
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
      await tester.runAsync(() => Future<void>.delayed(Duration.zero));
      expect(players.players, isEmpty);
    },
  );

  testWidgets('reduced-motion avoids next-video preload even when enabled', (
    tester,
  ) async {
    await mount(tester, _Feed(items), reducedMotion: true);
    await tester.tap(find.byTooltip('Data saver on: no next-video preload'));
    await tester.pumpAndSettle();
    expect(players.created, 1);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
  });

  testWidgets('empty state and failed feed offer refresh and retry', (
    tester,
  ) async {
    final feed = _Feed([])..fail = true;
    await mount(tester, feed);
    expect(find.textContaining('Test connection failed'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
    feed.fail = false;
    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();
    expect(
      find.text('No Simply videos yet. Be the first to create one!'),
      findsOneWidget,
    );
    expect(find.text('Refresh'), findsOneWidget);
    expect(feed.calls, 2);
  });

  testWidgets('cursor pages append without repeating a Short', (tester) async {
    final feed = _PagedFeed(items);
    await mount(tester, feed);
    await tester.drag(find.byType(PageView), const Offset(0, -650));
    await tester.pumpAndSettle();
    expect(feed.cursors, [null, 'next-page']);
    expect(find.text('Caption 1'), findsOneWidget);
    await tester.drag(find.byType(PageView), const Offset(0, -650));
    await tester.pumpAndSettle();
    expect(find.text('Caption 2'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
    await tester.runAsync(() => Future<void>.delayed(Duration.zero));
  });

  testWidgets('guest save opens authentication without writing engagement', (
    tester,
  ) async {
    await mount(tester, _Feed(items));
    await tester.tap(find.byTooltip('Save'));
    await tester.pumpAndSettle();
    expect(find.byType(AuthScreen), findsOneWidget);
    expect(players.playing, isEmpty);
    expect(network.calls.where((call) => call.startsWith('PUT ')), isEmpty);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
    await tester.runAsync(() => Future<void>.delayed(Duration.zero));
  });

  testWidgets('Shorts controls remain reachable at 320 by 640', (tester) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await mount(tester, _Feed(items));
    for (final tooltip in [
      '0 likes',
      '101 comments',
      'Share',
      'Save',
      'Report',
      'Pause',
      'Unmute',
    ]) {
      expect(
        find.byTooltip(tooltip).hitTestable(),
        findsOneWidget,
        reason: tooltip,
      );
    }
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
    await tester.runAsync(() => Future<void>.delayed(Duration.zero));
  });

  testWidgets(
    'signed-in Shorts actions use existing likes, follows and comments plus save and report APIs',
    (tester) async {
      Api.instance.token = 'test-only-token';
      Api.instance.role = 'member';
      await mount(tester, _Feed(items));
      await tester.tap(find.byTooltip('0 likes'));
      await tester.pumpAndSettle();
      expect(find.byTooltip('1 likes'), findsOneWidget);
      await tester.tap(find.byTooltip('1 likes'));
      await tester.pumpAndSettle();
      expect(find.byTooltip('0 likes'), findsOneWidget);
      await tester.tap(find.text('Follow'));
      await tester.pumpAndSettle();
      expect(find.text('Following'), findsOneWidget);
      await tester.tap(find.text('Following'));
      await tester.pumpAndSettle();
      expect(find.text('Follow'), findsOneWidget);
      await tester.tap(find.byTooltip('Save'));
      await tester.pumpAndSettle();
      expect(find.byTooltip('Saved'), findsOneWidget);
      await tester.tap(find.byTooltip('Saved'));
      await tester.pumpAndSettle();
      expect(find.byTooltip('Save'), findsOneWidget);
      await tester.tap(find.byTooltip('101 comments'));
      await tester.pumpAndSettle();
      expect(players.playing, isEmpty);
      expect(find.text('Comments (101)'), findsOneWidget);
      tester.view.physicalSize = const Size(360, 640);
      tester.view.devicePixelRatio = 1;
      tester.view.viewInsets = const FakeViewPadding(bottom: 300);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetViewInsets);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.enterText(find.byType(TextField), 'Great Short!');
      await tester.testTextInput.receiveAction(TextInputAction.send);
      await tester.pumpAndSettle();
      expect(network.comments.single['text'], 'Great Short!');
      expect(find.text('Comments (102)'), findsOneWidget);
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        isEmpty,
      );
      expect(find.text('Great Short!'), findsOneWidget);
      network.commentError = 'Comment service unavailable. Try again.';
      await tester.enterText(find.byType(TextField), 'Retry this comment');
      await tester.tap(find.text('Send'));
      await tester.pumpAndSettle();
      expect(find.text(network.commentError!), findsOneWidget);
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        'Retry this comment',
      );
      expect(network.comments, hasLength(1));
      network.commentError = null;
      await tester.tap(find.text('Send'));
      await tester.pumpAndSettle();
      expect(network.comments, hasLength(2));
      expect(find.text('Comments (103)'), findsOneWidget);
      expect(find.text('Retry this comment'), findsOneWidget);
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        isEmpty,
      );
      Navigator.of(tester.element(find.byType(TextField))).pop();
      await tester.pumpAndSettle();
      expect(players.playing, hasLength(1));
      await tester.tap(find.byTooltip('Report'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('spam'));
      await tester.pumpAndSettle();
      expect(network.calls, contains('POST /api/shorts/short-0/report'));
      expect(network.comments.first['text'], 'Great Short!');
      expect(network.calls, contains('PUT /api/shorts/short-0/saved'));
      expect(network.calls, contains('DELETE /api/shorts/short-0/saved'));
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
      await tester.runAsync(() => Future<void>.delayed(Duration.zero));
    },
  );
}
