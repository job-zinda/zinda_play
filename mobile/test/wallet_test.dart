import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:zinda_play/screens/wallet_screen.dart';

class _Headers extends Fake implements HttpHeaders {
  @override
  void set(String name, Object value, {bool preserveHeaderCase = false}) {}
  @override
  void forEach(void Function(String, List<String>) action) {}
}

class _Response extends Stream<List<int>> implements HttpClientResponse {
  final List<int> bytes;
  _Response(Map<String, dynamic> data) : bytes = utf8.encode(jsonEncode(data));
  @override
  int get statusCode => 200;
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
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
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
}

class _Request extends Fake implements HttpClientRequest {
  final Map<String, dynamic> data;
  _Request(this.data);
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
  Future<void> addStream(Stream<List<int>> stream) async {
    await stream.drain<void>();
  }

  @override
  Future<HttpClientResponse> close() async => _Response(data);
}

class _Client extends Fake implements HttpClient {
  final Map<String, dynamic> data;
  _Client(this.data);
  @override
  set autoUncompress(bool value) {}
  @override
  Future<HttpClientRequest> openUrl(String method, Uri url) async =>
      _Request(data);
  @override
  void close({bool force = false}) {}
}

class _Network extends HttpOverrides {
  final Map<String, dynamic> data;
  _Network(this.data);
  @override
  HttpClient createHttpClient(SecurityContext? context) => _Client(data);
}

void main() {
  tearDown(() => HttpOverrides.global = null);
  testWidgets(
    'creator wallet displays Simply and regular rates with combined estimates',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(800, 1000));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      HttpOverrides.global = _Network({
        'rateRupees': 50,
        'rateViews': 1000,
        'simplyRateRupees': 25,
        'simplyRateViews': 1000,
        'totalViews': 1600,
        'eligibleViews': 1500,
        'estimatedEarningsRupees': 92.5,
        'creatorAdRateRupees': 200,
        'simplyAdRateRupees': 100,
        'adRateViews': 1000,
        'adEstimatedEarningsRupees': 30,
        'adEligibleViews': 200,
        'rewardSettings': {
          'creatorRegularViews': {'enabled': true, 'rateRupees': 50},
          'creatorSimplyViews': {'enabled': false, 'rateRupees': 25},
          'creatorRegularAds': {'enabled': false, 'rateRupees': 200},
          'creatorSimplyAds': {'enabled': true, 'rateRupees': 100},
        },
        'videos': [
          {
            'title': 'Portrait clip',
            'videoType': 'short',
            'totalViews': 600,
            'eligibleViews': 500,
            'estimatedEarningsRupees': 12.5,
            'totalEstimatedEarningsRupees': 22.5,
            'adEstimatedEarningsRupees': 10,
            'adEligibleViews': 100,
          },
          {
            'title': 'Landscape video',
            'videoType': 'regular',
            'totalViews': 1000,
            'eligibleViews': 1000,
            'estimatedEarningsRupees': 50,
            'totalEstimatedEarningsRupees': 70,
            'adEstimatedEarningsRupees': 20,
            'adEligibleViews': 100,
            'deleted': true,
          },
        ],
      });
      await tester.pumpWidget(const MaterialApp(home: WalletScreen()));
      await tester.pumpAndSettle();
      expect(find.text('₹92.50'), findsOneWidget);
      expect(
        find.text('Simply view rewards: paused (no new rewards).'),
        findsOneWidget,
      );
      expect(
        find.text('Regular-video ad rewards: paused (no new rewards).'),
        findsOneWidget,
      );
      expect(find.text('₹22.50'), findsOneWidget);
      expect(find.text('₹70.00'), findsOneWidget);
      expect(find.text('Deleted · Landscape video'), findsOneWidget);
      expect(find.textContaining('Simply ads ₹100.00'), findsOneWidget);
      expect(find.textContaining('Ad earnings: ₹30.00'), findsOneWidget);
      expect(
        find.text('Simply: ₹25.00 per 1000 qualifying views.'),
        findsOneWidget,
      );
      expect(
        find.text('Regular videos: ₹50.00 per 1000 qualifying views.'),
        findsOneWidget,
      );
      expect(
        find.textContaining('Simply · 600 views · 500 qualifying'),
        findsOneWidget,
      );
      expect(
        find.textContaining('Earlier views do not earn retroactively'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'wallet remains compatible with a backend without Simply rate fields',
    (tester) async {
      HttpOverrides.global = _Network({
        'rateRupees': 50,
        'rateViews': 1000,
        'totalViews': 0,
        'eligibleViews': 0,
        'estimatedEarningsRupees': 0,
        'videos': [],
      });
      await tester.pumpWidget(const MaterialApp(home: WalletScreen()));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.text('No videos yet.'),
        150,
        scrollable: find.byType(Scrollable).first,
      );
      expect(find.text('No videos yet.'), findsOneWidget);
      expect(find.textContaining('Simply:'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
}
